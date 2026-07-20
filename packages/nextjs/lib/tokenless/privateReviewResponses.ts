import { type HumanReviewResultEnvelope, parseHumanReviewResultEnvelope } from "@rateloop/sdk";
import { createHash } from "node:crypto";
import type { PoolClient } from "pg";
import "server-only";
import { normalizeAccountSubject } from "~~/lib/auth/accountSubject";
import { dbClient, dbPool } from "~~/lib/db";
import {
  assuranceRationaleDigest,
  assuranceReviewerKey,
  encryptAssuranceRationale,
  getAssuranceResponseKeyrings,
} from "~~/lib/tokenless/assuranceResponses";
import { hashHumanAssuranceDocument } from "~~/lib/tokenless/humanAssurance";
import { transitionHumanReviewOpportunityLifecycleInTransaction } from "~~/lib/tokenless/humanReviewOpportunityLifecycle";
import {
  type SelectionPolicySnapshot,
  hashHumanReviewSelectionPolicySnapshot,
  observeHumanReviewResult,
} from "~~/lib/tokenless/humanReviewResultObservation";
import { projectPrivateHumanReviewResultEnvelope } from "~~/lib/tokenless/humanReviewResultProjection";
import { TokenlessServiceError } from "~~/lib/tokenless/server";

type Row = Record<string, unknown>;
type PrivateChoice = "positive" | "negative";

const IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,159}$/u;
const IDEMPOTENCY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.:-]{7,159}$/u;

function text(row: Row | undefined, key: string) {
  const value = row?.[key];
  return value === null || value === undefined ? null : String(value);
}

function integer(row: Row | undefined, key: string, minimum = 0) {
  const value = Number(row?.[key]);
  if (!Number.isSafeInteger(value) || value < minimum) throw new Error(`Stored ${key} is invalid.`);
  return value;
}

function boolean(row: Row | undefined, key: string) {
  const value = row?.[key];
  if (value === true || value === "t") return true;
  if (value === false || value === "f") return false;
  throw new Error(`Stored ${key} is invalid.`);
}

function date(row: Row | undefined, key: string) {
  const value = row?.[key] instanceof Date ? (row[key] as Date) : new Date(String(row?.[key]));
  if (!Number.isFinite(value.getTime())) throw new Error(`Stored ${key} is invalid.`);
  return value;
}

function json<T>(value: unknown, field: string): T {
  try {
    return JSON.parse(String(value)) as T;
  } catch {
    throw new Error(`Stored ${field} is invalid.`);
  }
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`)
      .join(",")}}`;
  }
  const encoded = JSON.stringify(value);
  if (encoded === undefined) throw new Error("Private review response is not canonicalizable.");
  return encoded;
}

function sha256(value: unknown) {
  return `sha256:${createHash("sha256").update(stableJson(value)).digest("hex")}` as const;
}

function normalizePrincipal(value: string) {
  try {
    return normalizeAccountSubject(value);
  } catch {
    throw new TokenlessServiceError("Account is invalid.", 400, "invalid_account");
  }
}

export function isDirectPrivateReviewAssignmentId(value: string) {
  return /^hpua_[0-9a-f]{40}$/u.test(value);
}

function qualificationProvenance(value: unknown) {
  const parsed = json<unknown[]>(value, "qualification snapshot");
  if (!Array.isArray(parsed)) throw new Error("Stored qualification snapshot is invalid.");
  return parsed.filter(
    (
      entry,
    ): entry is {
      key: string;
      value: string | number | boolean | string[];
      source: string;
      assertedBy: string;
      verifiedAt: string;
    } =>
      Boolean(
        entry &&
          typeof entry === "object" &&
          typeof (entry as Row).key === "string" &&
          typeof (entry as Row).source === "string" &&
          typeof (entry as Row).assertedBy === "string" &&
          typeof (entry as Row).verifiedAt === "string" &&
          (typeof (entry as Row).value === "string" ||
            typeof (entry as Row).value === "number" ||
            typeof (entry as Row).value === "boolean" ||
            (Array.isArray((entry as Row).value) &&
              ((entry as Row).value as unknown[]).every(item => typeof item === "string"))),
      ),
  );
}

export async function listDirectPrivateReviewAssignments(input: {
  accountAddress: string;
  query?: string;
  state?: string;
  limit?: number;
}) {
  const principal = normalizePrincipal(input.accountAddress);
  const query = input.query?.trim() ?? "";
  const state = input.state?.trim() ?? "";
  const limit = Math.min(Math.max(input.limit ?? 50, 1), 50);
  const result = await dbClient.execute({
    sql: `SELECT a.assignment_id,a.status,a.reservation_expires_at,a.assignment_expires_at,
                 a.response_deadline,a.created_at,d.private_group_policy_hash,
                 p.name AS project_name,p.data_classification,rp.compensation_mode
          FROM tokenless_private_unpaid_review_assignments a
          JOIN tokenless_private_unpaid_review_deliveries d ON d.delivery_id=a.delivery_id
          JOIN tokenless_assurance_projects p ON p.project_id=a.project_id
          JOIN tokenless_agent_review_request_profiles rp
            ON rp.workspace_id=d.workspace_id AND rp.profile_id=d.request_profile_id
           AND rp.version=d.request_profile_version AND rp.profile_hash=d.request_profile_hash
          LEFT JOIN tokenless_private_group_memberships membership
            ON membership.group_id=a.private_group_id
           AND membership.principal_address=a.reviewer_account_address
           AND membership.status='active'
           AND (membership.membership_expires_at IS NULL OR membership.membership_expires_at>?)
          WHERE a.reviewer_account_address=?
            AND rp.compensation_mode='unpaid'
            AND (a.status IN ('accepted','completed') OR membership.principal_address IS NOT NULL)
            AND (?='' OR a.status=?)
            AND (?='' OR a.assignment_id ILIKE ? OR p.name ILIKE ?)
          ORDER BY a.created_at DESC,a.assignment_id DESC LIMIT ?`,
    args: [new Date(), principal, state, state, query, `%${query}%`, `%${query}%`, limit],
  });
  return result.rows.map(value => {
    const row = value as Row;
    return {
      assignmentId: text(row, "assignment_id"),
      projectId: null,
      projectName: text(row, "project_name"),
      dataClassification: text(row, "data_classification"),
      source: "customer_invited",
      status: text(row, "status"),
      paidAssignment: false,
      confidentialityTermsHash: text(row, "private_group_policy_hash"),
      privateGroup: null,
      reservationExpiresAt: date(row, "reservation_expires_at").toISOString(),
      assignmentExpiresAt:
        row.assignment_expires_at === null || row.assignment_expires_at === undefined
          ? date(row, "response_deadline").toISOString()
          : date(row, "assignment_expires_at").toISOString(),
      createdAt: date(row, "created_at").toISOString(),
      caseCount: 1,
    };
  });
}

async function loadAcceptedAssignment(accountAddress: string, assignmentId: string, now: Date) {
  const result = await dbClient.execute({
    sql: `SELECT a.*,d.private_group_policy_hash,d.foundation_binding_hash,d.operation_hash,
                 f.source_artifact_id,f.suggestion_artifact_id,
                 rp.criterion,rp.positive_label,rp.negative_label,rp.rationale_mode,
                 source.content_type AS source_content_type,
                 suggestion.content_type AS suggestion_content_type
          FROM tokenless_private_unpaid_review_assignments a
          JOIN tokenless_private_unpaid_review_deliveries d ON d.delivery_id=a.delivery_id
          JOIN tokenless_private_review_requests f ON f.private_review_id=a.private_review_id
          JOIN tokenless_agent_review_request_profiles rp
            ON rp.workspace_id=d.workspace_id AND rp.profile_id=d.request_profile_id
           AND rp.version=d.request_profile_version AND rp.profile_hash=d.request_profile_hash
          JOIN tokenless_assurance_artifacts source ON source.artifact_id=f.source_artifact_id
          JOIN tokenless_assurance_artifacts suggestion ON suggestion.artifact_id=f.suggestion_artifact_id
          WHERE a.assignment_id=? AND a.reviewer_account_address=?
            AND a.status='accepted' AND a.lease_state='issued' AND a.response_deadline>? LIMIT 1`,
    args: [assignmentId, normalizePrincipal(accountAddress), now],
  });
  const row = result.rows[0] as Row | undefined;
  if (!row) throw new TokenlessServiceError("Assignment not found.", 404, "assignment_not_found");
  return row;
}

export async function getDirectPrivateReviewTask(input: { accountAddress: string; assignmentId: string; now?: Date }) {
  const row = await loadAcceptedAssignment(input.accountAddress, input.assignmentId, input.now ?? new Date());
  const rationaleMode = text(row, "rationale_mode");
  if (rationaleMode !== "off" && rationaleMode !== "optional" && rationaleMode !== "required") {
    throw new Error("Stored rationale mode is invalid.");
  }
  const leaseResult = await dbClient.execute({
    sql: `SELECT artifact_id,lease_id,expires_at FROM tokenless_assurance_artifact_leases
          WHERE assignment_id=? AND account_address=? AND revoked_at IS NULL AND expires_at>?
          ORDER BY created_at DESC`,
    args: [input.assignmentId, normalizePrincipal(input.accountAddress), input.now ?? new Date()],
  });
  const leases = new Map<string, { artifactId: string; leaseId: string; expiresAt: string }>();
  for (const value of leaseResult.rows) {
    const lease = value as Row;
    const artifactId = text(lease, "artifact_id")!;
    if (!leases.has(artifactId)) {
      leases.set(artifactId, {
        artifactId,
        leaseId: text(lease, "lease_id")!,
        expiresAt: date(lease, "expires_at").toISOString(),
      });
    }
  }
  const source = leases.get(text(row, "source_artifact_id")!);
  const suggestion = leases.get(text(row, "suggestion_artifact_id")!);
  if (!source || !suggestion) throw new TokenlessServiceError("Artifact lease expired.", 410, "artifact_lease_expired");
  return {
    assignmentId: input.assignmentId,
    runId: text(row, "delivery_id"),
    taskKind: "binary_review" as const,
    source: "customer_invited" as const,
    runManifestHash: text(row, "foundation_binding_hash"),
    policyHash: text(row, "private_group_policy_hash"),
    qualificationProvenance: qualificationProvenance(row.qualification_snapshot_json),
    rubric: {
      prompt: text(row, "criterion"),
      failureTags: [],
      rationale: { mode: rationaleMode, minLength: rationaleMode === "required" ? 10 : 0, maxLength: 2_000 },
    },
    cases: [
      {
        caseId: text(row, "private_review_id"),
        position: 0,
        title: "Review the agent output",
        instructions: text(row, "criterion"),
        options: [],
        context: [],
        objectiveReference: null,
        binaryReview: {
          positiveLabel: text(row, "positive_label"),
          negativeLabel: text(row, "negative_label"),
          source: { ...source, contentType: text(row, "source_content_type") },
          suggestion: { ...suggestion, contentType: text(row, "suggestion_content_type") },
        },
      },
    ],
  };
}

export async function directPrivateArtifactAccess(input: {
  accountAddress: string;
  assignmentId: string;
  artifactId: string;
  now?: Date;
}) {
  const row = await loadAcceptedAssignment(input.accountAddress, input.assignmentId, input.now ?? new Date());
  if (![text(row, "source_artifact_id"), text(row, "suggestion_artifact_id")].includes(input.artifactId)) {
    throw new TokenlessServiceError("Artifact not found.", 404, "artifact_not_found");
  }
  return { workspaceId: text(row, "workspace_id")!, projectId: text(row, "project_id")! };
}

function selectionPolicySnapshot(row: Row): SelectionPolicySnapshot {
  return {
    schemaVersion: "rateloop.human-review-selection-policy.v1",
    workspaceId: text(row, "workspace_id")!,
    agentId: text(row, "agent_id")!,
    agentVersionId: text(row, "agent_version_id")!,
    policyId: text(row, "policy_id")!,
    version: integer(row, "policy_version", 1),
    mode: text(row, "policy_mode")!,
    agreementThresholdBps: integer(row, "agreement_threshold_bps"),
    productionFloorBps: integer(row, "production_floor_bps"),
    fixedRateBps:
      row.fixed_rate_bps === null || row.fixed_rate_bps === undefined ? null : integer(row, "fixed_rate_bps"),
    maximumUnreviewedGap: integer(row, "maximum_unreviewed_gap", 1),
    rules: json<Record<string, unknown>>(row.rules_json, "selection rules"),
    audience: json<Record<string, unknown>>(row.audience_policy_json, "selection audience"),
    publishingPolicyId: text(row, "review_publishing_policy_id"),
  };
}

async function terminalEnvelopeForDelivery(client: PoolClient, deliveryId: string, now: Date) {
  const result = await client.query(
    `SELECT d.*,f.external_source_evidence_hash,f.external_suggestion_commitment,
            source.digest AS source_digest,suggestion.digest AS suggestion_digest,
            o.agent_id,o.agent_version_id,o.policy_id,o.policy_version,
            o.human_review_binding_id,o.human_review_binding_version,
            l.state AS lifecycle_state,l.state_revision,l.created_at AS lifecycle_created_at,
            p.mode AS policy_mode,p.agreement_threshold_bps,p.production_floor_bps,p.fixed_rate_bps,
            p.maximum_unreviewed_gap,p.rules_json,p.audience_policy_json,
            p.publishing_policy_id AS review_publishing_policy_id,
            b.canonical_hash AS binding_hash
     FROM tokenless_private_unpaid_review_deliveries d
     JOIN tokenless_private_review_requests f ON f.private_review_id=d.private_review_id
     JOIN tokenless_assurance_artifacts source ON source.artifact_id=f.source_artifact_id
     JOIN tokenless_assurance_artifacts suggestion ON suggestion.artifact_id=f.suggestion_artifact_id
     JOIN tokenless_agent_review_opportunities o
       ON o.workspace_id=d.workspace_id AND o.opportunity_id=d.opportunity_id
     JOIN tokenless_agent_review_opportunity_lifecycles l
       ON l.workspace_id=d.workspace_id AND l.opportunity_id=d.opportunity_id
     JOIN tokenless_agent_review_policies p
       ON p.workspace_id=o.workspace_id AND p.policy_id=o.policy_id AND p.version=o.policy_version
     JOIN tokenless_agent_human_review_bindings b
       ON b.workspace_id=o.workspace_id AND b.binding_id=o.human_review_binding_id
      AND b.version=o.human_review_binding_version
     WHERE d.delivery_id=$1 LIMIT 1 FOR UPDATE`,
    [deliveryId],
  );
  const row = result.rows[0] as Row | undefined;
  if (!row) throw new Error("Private review delivery disappeared.");
  const responses = await client.query(
    `SELECT response_commitment,choice FROM tokenless_private_review_responses
     WHERE delivery_id=$1 ORDER BY response_commitment ASC`,
    [deliveryId],
  );
  if (responses.rowCount !== integer(row, "panel_size", 1)) return null;
  const positive = responses.rows.filter(value => text(value as Row, "choice") === "positive").length;
  const negative = responses.rowCount - positive;
  const outcome = positive === negative ? "inconclusive" : positive > negative ? "positive" : "negative";
  const toState = outcome === "inconclusive" ? "inconclusive" : "completed";
  const responseCommitments = responses.rows.map(value => text(value as Row, "response_commitment")!);
  const responseSet = sha256({ schemaVersion: "rateloop.private-review-response-set.v1", responseCommitments });
  const resultCommitment = sha256({
    schemaVersion: "rateloop.private-review-result.v1",
    deliveryId,
    outcome,
    responseSet,
  });
  const reasonCodes = ["private_panel_complete", "responses_recorded"].sort();
  const transition = await transitionHumanReviewOpportunityLifecycleInTransaction(client, {
    workspaceId: text(row, "workspace_id")!,
    opportunityId: text(row, "opportunity_id")!,
    transitionKey: `private-result:${text(row, "operation_hash")!.slice("sha256:".length)}`,
    expectedState: "pending",
    expectedRevision: integer(row, "state_revision", 1),
    toState,
    reasonCodes,
    actor: { kind: "lane_adapter", reference: "private-unpaid-v1" },
    details: { deliveryId, responseCount: responses.rowCount, responseSet, outcome },
    occurredAt: now,
  });
  const envelope = projectPrivateHumanReviewResultEnvelope({
    workspaceId: text(row, "workspace_id")!,
    integrationId: text(row, "integration_id")!,
    opportunityId: text(row, "opportunity_id")!,
    lane: "private_unpaid",
    lifecycle: {
      state: toState,
      terminal: true,
      revision: transition.toRevision,
      reasonCodes,
      startedAt: date(row, "lifecycle_created_at").toISOString(),
      stateEnteredAt: transition.occurredAt,
      finalizedAt: transition.occurredAt,
    },
    frozen: {
      selectionPolicy: {
        id: text(row, "policy_id")!,
        version: integer(row, "policy_version", 1),
        hash: hashHumanReviewSelectionPolicySnapshot(selectionPolicySnapshot(row)) as `sha256:${string}`,
      },
      binding: {
        id: text(row, "human_review_binding_id")!,
        version: integer(row, "human_review_binding_version", 1),
        hash: text(row, "binding_hash")! as `sha256:${string}`,
      },
      requestProfile: {
        id: text(row, "request_profile_id")!,
        version: integer(row, "request_profile_version", 1),
        hash: text(row, "request_profile_hash")! as `sha256:${string}`,
      },
      responseDeadline: date(row, "response_deadline").toISOString(),
    },
    panel: {
      requestedCount: integer(row, "panel_size", 1),
      assignedCount: integer(row, "panel_size", 1),
      responseCount: responses.rowCount,
      cohorts: [
        {
          source: "invited",
          requestedCount: integer(row, "panel_size", 1),
          assignedCount: integer(row, "panel_size", 1),
          responseCount: responses.rowCount,
        },
      ],
    },
    outcome,
    rationale: { summaryAllowed: false, aggregateSummary: null },
    economics: {
      asset: "USDC",
      decimals: 6,
      guaranteedBase: { mode: "off", fundedAtomic: "0", paidAtomic: "0", refundedAtomic: "0" },
      automaticQualityAllocation: { mode: "off", availableAtomic: "0", awardedAtomic: "0", refundedAtomic: "0" },
      feedbackBonus: { mode: "off", fundedAtomic: "0", awardedAtomic: "0", refundedAtomic: "0", awards: [] },
    },
    commitments: {
      sourceArtifact: text(row, "source_digest")! as `sha256:${string}`,
      suggestionArtifact: text(row, "suggestion_digest")! as `sha256:${string}`,
      responseSet,
      result: resultCommitment,
    },
    terminalEvidence: null,
  });
  await client.query(
    `UPDATE tokenless_private_unpaid_review_deliveries
     SET status=$1,result_envelope_json=$2,result_commitment=$3,completed_at=$4,updated_at=$4
     WHERE delivery_id=$5 AND status='pending'`,
    [toState, JSON.stringify(envelope), resultCommitment, now, deliveryId],
  );
  await client.query(
    `UPDATE tokenless_agent_review_opportunities SET status='completed',updated_at=$1
     WHERE workspace_id=$2 AND opportunity_id=$3 AND status='review_requested'`,
    [now, text(row, "workspace_id"), text(row, "opportunity_id")],
  );
  await client.query(
    `UPDATE tokenless_agent_integrations
     SET last_result_at=CASE WHEN last_result_at IS NULL OR last_result_at<$1 THEN $1 ELSE last_result_at END,
         updated_at=CASE WHEN updated_at<$1 THEN $1 ELSE updated_at END
     WHERE integration_id=$2 AND workspace_id=$3`,
    [now, text(row, "integration_id"), text(row, "workspace_id")],
  );
  return envelope;
}

export async function submitDirectPrivateReviewResponse(input: {
  accountAddress: string;
  assignmentId: string;
  idempotencyKey: string;
  responses: Array<{
    caseId: string;
    displayedOption: "A" | "B";
    selectedArtifactId: string;
    failureTagKeys: string[];
    rationale: string;
  }>;
  now?: Date;
}) {
  if (!IDENTIFIER_PATTERN.test(input.assignmentId) || !IDEMPOTENCY_PATTERN.test(input.idempotencyKey)) {
    throw new TokenlessServiceError("Private review response is invalid.", 400, "invalid_assurance_response");
  }
  if (!Array.isArray(input.responses) || input.responses.length !== 1) {
    throw new TokenlessServiceError("Submit exactly one private review response.", 400, "invalid_assurance_response");
  }
  const principal = normalizePrincipal(input.accountAddress);
  const now = input.now ?? new Date();
  const responseInput = input.responses[0]!;
  const rationale = responseInput.rationale.trim();
  const client = await dbPool.connect();
  let terminalEnvelope: HumanReviewResultEnvelope | null = null;
  let responseCount = 0;
  let replay = false;
  try {
    await client.query("BEGIN");
    const loaded = await client.query(
      `SELECT a.*,d.private_group_policy_hash,d.foundation_binding_hash,d.operation_hash,d.status AS delivery_status,
              f.suggestion_artifact_id,rp.rationale_mode,rp.compensation_mode,rp.feedback_bonus_enabled
       FROM tokenless_private_unpaid_review_assignments a
       JOIN tokenless_private_unpaid_review_deliveries d ON d.delivery_id=a.delivery_id
       JOIN tokenless_private_review_requests f ON f.private_review_id=a.private_review_id
       JOIN tokenless_agent_review_request_profiles rp
         ON rp.workspace_id=d.workspace_id AND rp.profile_id=d.request_profile_id
        AND rp.version=d.request_profile_version AND rp.profile_hash=d.request_profile_hash
       WHERE a.assignment_id=$1 AND a.reviewer_account_address=$2 LIMIT 1 FOR UPDATE`,
      [input.assignmentId, principal],
    );
    const row = loaded.rows[0] as Row | undefined;
    if (!row || !["accepted", "completed"].includes(text(row, "status") ?? "")) {
      throw new TokenlessServiceError("Assignment not found.", 404, "assignment_not_found");
    }
    if (text(row, "compensation_mode") !== "unpaid") {
      throw new TokenlessServiceError(
        "This response requires the paid private-review flow.",
        409,
        "review_binding_conflict",
      );
    }
    if (boolean(row, "feedback_bonus_enabled")) {
      throw new TokenlessServiceError(
        "This response requires the feedback-bonus private-review flow.",
        409,
        "review_binding_conflict",
      );
    }
    if (
      text(row, "status") !== "completed" &&
      (date(row, "response_deadline") <= now || text(row, "lease_state") !== "issued")
    ) {
      throw new TokenlessServiceError("Assignment expired.", 410, "assignment_expired");
    }
    if (
      responseInput.caseId !== text(row, "private_review_id") ||
      !["A", "B"].includes(responseInput.displayedOption) ||
      responseInput.selectedArtifactId !== text(row, "suggestion_artifact_id") ||
      !Array.isArray(responseInput.failureTagKeys) ||
      responseInput.failureTagKeys.length !== 0
    ) {
      throw new TokenlessServiceError(
        "Response does not match the frozen private review.",
        409,
        "assurance_case_binding_mismatch",
      );
    }
    const rationaleMode = text(row, "rationale_mode");
    if (
      (rationaleMode === "off" && rationale.length !== 0) ||
      (rationaleMode === "required" && rationale.length < 10) ||
      (rationaleMode === "optional" && rationale.length > 0 && rationale.length < 10) ||
      rationale.length > 2_000 ||
      !["off", "optional", "required"].includes(rationaleMode ?? "")
    ) {
      throw new TokenlessServiceError(
        "Rationale does not match the frozen review policy.",
        400,
        "invalid_assurance_rationale",
      );
    }
    const choice: PrivateChoice = responseInput.displayedOption === "A" ? "positive" : "negative";
    const digest = assuranceRationaleDigest(rationale);
    const keyrings = getAssuranceResponseKeyrings();
    const reviewerKey = assuranceReviewerKey(
      { accountAddress: principal, runId: text(row, "delivery_id")! },
      keyrings.reviewerMapping,
    );
    const responseCommitment = hashHumanAssuranceDocument({
      schemaVersion: "rateloop.private-review-response.v1",
      deliveryId: text(row, "delivery_id"),
      assignmentId: input.assignmentId,
      privateReviewId: text(row, "private_review_id"),
      foundationBindingHash: text(row, "foundation_binding_hash"),
      membershipSnapshotHash: text(row, "membership_snapshot_hash"),
      choice,
      rationaleDigest: rationaleMode === "off" ? null : digest,
    });
    const existing = await client.query(
      `SELECT response_commitment FROM tokenless_private_review_responses WHERE assignment_id=$1`,
      [input.assignmentId],
    );
    if (existing.rowCount) {
      if (text(existing.rows[0] as Row, "response_commitment") !== responseCommitment) {
        throw new TokenlessServiceError(
          "This assignment already has a different response.",
          409,
          "assurance_response_conflict",
        );
      }
      replay = true;
    } else {
      const encrypted =
        rationaleMode === "off"
          ? { ciphertext: null, keyRef: null }
          : encryptAssuranceRationale(
              {
                caseId: text(row, "private_review_id")!,
                digest,
                rationale,
                reviewerKey,
                runId: text(row, "delivery_id")!,
              },
              keyrings.rationale,
            );
      const responseId = `hprr_${createHash("sha256")
        .update(`${text(row, "delivery_id")}\0${input.assignmentId}`)
        .digest("hex")
        .slice(0, 40)}`;
      await client.query(
        `INSERT INTO tokenless_private_review_responses
         (response_id,assignment_id,delivery_id,workspace_id,private_review_id,reviewer_key,choice,
          rationale_ciphertext,rationale_key_ref,rationale_digest,response_commitment,idempotency_key,created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
        [
          responseId,
          input.assignmentId,
          text(row, "delivery_id"),
          text(row, "workspace_id"),
          text(row, "private_review_id"),
          reviewerKey,
          choice,
          encrypted.ciphertext,
          encrypted.keyRef,
          rationaleMode === "off" ? null : digest,
          responseCommitment,
          input.idempotencyKey,
          now,
        ],
      );
      await client.query(
        `UPDATE tokenless_private_unpaid_review_assignments
         SET status='completed',lease_state='expired',updated_at=$1
         WHERE assignment_id=$2 AND status='accepted'`,
        [now, input.assignmentId],
      );
      await client.query(
        `UPDATE tokenless_assurance_cohort_reviewers SET active_reservations=active_reservations - 1,updated_at=$1
         WHERE project_id=$2 AND cohort_id=$3 AND reviewer_account_address=$4 AND active_reservations>0`,
        [now, text(row, "project_id"), text(row, "cohort_id"), principal],
      );
      await client.query(
        `UPDATE tokenless_assurance_cohorts SET active_reservations=active_reservations - 1,updated_at=$1
         WHERE project_id=$2 AND cohort_id=$3 AND active_reservations>0`,
        [now, text(row, "project_id"), text(row, "cohort_id")],
      );
    }
    const countResult = await client.query(
      "SELECT COUNT(*) AS response_count FROM tokenless_private_review_responses WHERE delivery_id=$1",
      [text(row, "delivery_id")],
    );
    responseCount = Number(countResult.rows[0]?.response_count ?? 0);
    if (text(row, "delivery_status") === "pending") {
      terminalEnvelope = await terminalEnvelopeForDelivery(client, text(row, "delivery_id")!, now);
    } else {
      const stored = await client.query(
        "SELECT result_envelope_json FROM tokenless_private_unpaid_review_deliveries WHERE delivery_id=$1",
        [text(row, "delivery_id")],
      );
      if (stored.rows[0]?.result_envelope_json) {
        terminalEnvelope = parseHumanReviewResultEnvelope(JSON.parse(String(stored.rows[0].result_envelope_json)));
      }
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
  if (terminalEnvelope) await observeHumanReviewResult({ envelope: terminalEnvelope });
  return {
    assignmentId: input.assignmentId,
    accepted: true as const,
    replay,
    responseCount,
    compensation: "unpaid" as const,
    settlementStatus: "not_applicable" as const,
  };
}

export async function getDirectPrivateReviewState(input: { workspaceId: string; opportunityId: string }) {
  const result = await dbClient.execute({
    sql: `SELECT d.delivery_id,d.status,d.response_deadline,d.result_envelope_json,
                 l.state AS lifecycle_state,l.state_revision,COUNT(response.response_id) AS response_count
          FROM tokenless_private_unpaid_review_deliveries d
          JOIN tokenless_agent_review_opportunity_lifecycles l
            ON l.workspace_id=d.workspace_id AND l.opportunity_id=d.opportunity_id
          LEFT JOIN tokenless_private_review_responses response ON response.delivery_id=d.delivery_id
          WHERE d.workspace_id=? AND d.opportunity_id=?
          GROUP BY d.delivery_id,d.status,d.response_deadline,d.result_envelope_json,
                   l.state,l.state_revision LIMIT 1`,
    args: [input.workspaceId, input.opportunityId],
  });
  const row = result.rows[0] as Row | undefined;
  if (!row) return null;
  const envelope = row.result_envelope_json
    ? parseHumanReviewResultEnvelope(JSON.parse(String(row.result_envelope_json)))
    : null;
  const observation = envelope ? await observeHumanReviewResult({ envelope }) : null;
  return {
    deliveryId: text(row, "delivery_id")!,
    status: text(row, "status")!,
    responseDeadline: date(row, "response_deadline").toISOString(),
    lifecycle: { state: text(row, "lifecycle_state")!, revision: integer(row, "state_revision", 1) },
    responseCount: Number(row.response_count ?? 0),
    envelope,
    observation,
  };
}

export const __privateReviewResponsesTestUtils = { sha256, stableJson };
