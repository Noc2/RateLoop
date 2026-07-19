import { createHash } from "node:crypto";
import type { PoolClient } from "pg";
import "server-only";
import { normalizeAccountSubject } from "~~/lib/auth/accountSubject";
import { dbPool } from "~~/lib/db";
import { transitionHumanReviewOpportunityLifecycleInTransaction } from "~~/lib/tokenless/humanReviewOpportunityLifecycle";
import type { ProductPrincipal } from "~~/lib/tokenless/productCore";
import { qualificationProvenanceSatisfiesExpertise } from "~~/lib/tokenless/reviewerExpertise";
import { exactReviewerExpertiseDefinitionKey } from "~~/lib/tokenless/reviewerExpertiseAssignments";
import { chooseExpertiseCoveredPanel } from "~~/lib/tokenless/reviewerExpertiseCoverage";
import { normalizeReviewerExpertiseRequirementsSelection } from "~~/lib/tokenless/reviewerExpertiseOptions";
import {
  expertiseQualificationRules,
  normalizeReviewerExpertiseKeys,
} from "~~/lib/tokenless/reviewerExpertiseVocabulary";
import { TokenlessServiceError } from "~~/lib/tokenless/server";

type Row = Record<string, unknown>;
type PrivateUnpaidReviewPrincipal = Extract<ProductPrincipal, { kind: "api_key" }>;
type PrivateReviewCompensationMode = "unpaid" | "usdc";

const RESERVATION_TTL_MS = 15 * 60_000;
const ARTIFACT_LEASE_TTL_MS = 10 * 60_000;
const HASH_PATTERN = /^sha256:[0-9a-f]{64}$/u;

let beforeDeliveryCommitForTests: null | (() => Promise<void>) = null;
let beforeLeaseCommitForTests: null | ((artifactId: string) => Promise<void>) = null;

function text(row: Row | undefined, key: string) {
  const value = row?.[key];
  return value === null || value === undefined ? null : String(value);
}

function integer(row: Row | undefined, key: string, minimum = 0) {
  const value = Number(row?.[key]);
  if (!Number.isSafeInteger(value) || value < minimum) throw new Error(`Stored ${key} is invalid.`);
  return value;
}

function date(row: Row | undefined, key: string) {
  const value = row?.[key] instanceof Date ? (row[key] as Date) : new Date(String(row?.[key]));
  if (!Number.isFinite(value.getTime())) throw new Error(`Stored ${key} is invalid.`);
  return value;
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`)
      .join(",")}}`;
  }
  const encoded = JSON.stringify(value);
  if (encoded === undefined) throw new Error("Private-review value is not canonicalizable.");
  return encoded;
}

function sha256(value: unknown) {
  return `sha256:${createHash("sha256").update(stableJson(value)).digest("hex")}`;
}

function identifier(prefix: string, value: unknown) {
  return `${prefix}_${sha256(value).slice("sha256:".length, "sha256:".length + 40)}`;
}

function parseStringArray(value: unknown, field: string) {
  try {
    const parsed = JSON.parse(String(value)) as unknown;
    if (!Array.isArray(parsed) || parsed.some(entry => typeof entry !== "string")) throw new Error();
    return [...new Set(parsed)].sort();
  } catch {
    throw new Error(`Stored ${field} is invalid.`);
  }
}

function parseJsonDocument(value: unknown, field: string) {
  try {
    return JSON.parse(String(value)) as unknown;
  } catch {
    throw new Error(`Stored ${field} is invalid.`);
  }
}

function normalizeReviewers(values: readonly string[]) {
  if (!Array.isArray(values) || values.length === 0 || values.length > 100) {
    throw new TokenlessServiceError(
      "Private invited review requires 1-100 named reviewers.",
      400,
      "invalid_private_reviewers",
    );
  }
  const normalized = values.map(value => {
    try {
      return normalizeAccountSubject(value);
    } catch {
      throw new TokenlessServiceError("A named reviewer is invalid.", 400, "invalid_private_reviewers");
    }
  });
  const unique = [...new Set(normalized)].sort();
  if (unique.length !== normalized.length) {
    throw new TokenlessServiceError("Named reviewers must be unique.", 400, "invalid_private_reviewers");
  }
  return unique;
}

function assertHash(value: string | null, field: string) {
  if (!value || !HASH_PATTERN.test(value)) throw new Error(`Stored ${field} is invalid.`);
  return value;
}

function assertExactFoundation(input: {
  row: Row;
  principal: PrivateUnpaidReviewPrincipal;
  privateReviewId: string;
  opportunityId: string;
  now: Date;
  compensationMode: PrivateReviewCompensationMode;
}) {
  const row = input.row;
  const responseDeadline = date(row, "response_deadline");
  const requiredExpertise = normalizeReviewerExpertiseKeys(
    JSON.parse(text(row, "required_expertise_keys_json") ?? "[]"),
  );
  const storedQualificationRules = parseJsonDocument(row.cohort_qualification_rules_json, "cohort qualification rules");
  if (!Array.isArray(storedQualificationRules)) throw new Error("Stored cohort qualification rules are invalid.");
  const requiredRules = expertiseQualificationRules(requiredExpertise);
  const requiredRuleKeys = new Set(requiredRules.map(rule => rule.key));
  const projectBindingHash = sha256({
    projectId: text(row, "project_id"),
    workspaceId: text(row, "workspace_id"),
    visibility: text(row, "project_visibility"),
    privateSensitivity: text(row, "project_private_sensitivity"),
    retentionDays: integer(row, "project_retention_days", 1),
    homeRegion: text(row, "project_home_region"),
    retentionPolicyId: text(row, "project_retention_policy_id"),
    dataUsePolicyVersion: text(row, "project_data_use_policy_version"),
  });
  const cohortBindingHash = sha256({
    cohortId: text(row, "cohort_id"),
    projectId: text(row, "project_id"),
    privateGroupId: text(row, "cohort_private_group_id"),
    source: text(row, "cohort_source"),
    selection: text(row, "cohort_selection"),
    capacity: integer(row, "cohort_capacity", 1),
    qualificationRules: [
      ...storedQualificationRules.filter(rule => !requiredRuleKeys.has(String((rule as Record<string, unknown>)?.key))),
      ...requiredRules,
    ],
  });
  const sourceArtifactCommitment = assertHash(text(row, "source_digest"), "private source artifact commitment");
  const suggestionArtifactCommitment = assertHash(
    text(row, "suggestion_digest"),
    "private suggestion artifact commitment",
  );
  const storedExternalSourceEvidenceHash = text(row, "external_source_evidence_hash");
  const storedExternalSuggestionCommitment = text(row, "external_suggestion_commitment");
  const legacyExternalCommitments =
    storedExternalSourceEvidenceHash === null && storedExternalSuggestionCommitment === null;
  const exactExternalCommitments =
    legacyExternalCommitments ||
    (storedExternalSourceEvidenceHash !== null &&
      storedExternalSuggestionCommitment !== null &&
      HASH_PATTERN.test(storedExternalSourceEvidenceHash) &&
      HASH_PATTERN.test(storedExternalSuggestionCommitment));
  const externalSourceEvidenceHash = legacyExternalCommitments
    ? sourceArtifactCommitment
    : storedExternalSourceEvidenceHash;
  const externalSuggestionCommitment = legacyExternalCommitments
    ? suggestionArtifactCommitment
    : storedExternalSuggestionCommitment;
  const taskCommitment = sha256({
    kind: "binary_review",
    criterion: text(row, "criterion"),
    positiveLabel: text(row, "positive_label"),
    negativeLabel: text(row, "negative_label"),
    rationaleMode: text(row, "rationale_mode"),
    sourceCommitment: sourceArtifactCommitment,
    suggestionCommitment: suggestionArtifactCommitment,
  });
  const foundationBindingHash = sha256({
    callerCredentialId: text(row, "caller_credential_id"),
    callerCredentialKind: text(row, "caller_credential_kind"),
    integrationId: text(row, "integration_id"),
    lane: "private",
    taskKind: "binary_review",
    taskCommitment,
    project: { id: text(row, "project_id"), hash: projectBindingHash },
    requestProfile: {
      id: text(row, "request_profile_id"),
      version: integer(row, "request_profile_version", 1),
      hash: text(row, "request_profile_hash"),
    },
    privateGroup: {
      id: text(row, "private_group_id"),
      policyVersion: integer(row, "private_group_policy_version", 1),
      policyHash: text(row, "private_group_policy_hash"),
      allowlistHash: text(row, "group_allowlist_hash"),
      allowlistStatus: text(row, "group_allowlist_status"),
    },
    cohort: { id: text(row, "cohort_id"), hash: cohortBindingHash },
    ...(legacyExternalCommitments
      ? {}
      : {
          externalContentCommitments: {
            sourceEvidenceHash: externalSourceEvidenceHash,
            suggestionCommitment: externalSuggestionCommitment,
          },
        }),
    responseWindowSeconds: integer(row, "response_window_seconds", 1),
    responseDeadline: responseDeadline.toISOString(),
  });
  if (
    text(row, "private_review_id") !== input.privateReviewId ||
    text(row, "opportunity_id") !== input.opportunityId ||
    text(row, "workspace_id") !== input.principal.workspaceId ||
    text(row, "caller_credential_id") !== input.principal.apiKeyId ||
    text(row, "integration_status") !== "active" ||
    text(row, "project_status") !== "active" ||
    text(row, "project_visibility") !== "private" ||
    text(row, "project_data_classification") !== text(row, "private_sensitivity") ||
    text(row, "project_private_sensitivity") !== text(row, "private_sensitivity") ||
    projectBindingHash !== text(row, "project_binding_hash") ||
    !exactExternalCommitments ||
    taskCommitment !== text(row, "task_commitment") ||
    foundationBindingHash !== text(row, "binding_hash") ||
    text(row, "foundation_status") !== "ready_for_assignment" ||
    text(row, "group_allowlist_status") !== "allowed" ||
    text(row, "lane") !== "private" ||
    text(row, "task_kind") !== "binary_review" ||
    text(row, "profile_audience") !== "private_invited" ||
    text(row, "content_boundary") !== "private_workspace" ||
    text(row, "compensation_mode") !== input.compensationMode ||
    text(row, "cohort_source") !== "customer_invited" ||
    text(row, "cohort_selection") !== "customer_named" ||
    text(row, "cohort_status") !== "active" ||
    text(row, "group_status") !== "active" ||
    integer(row, "group_current_policy_version", 1) !== integer(row, "private_group_policy_version", 1) ||
    text(row, "group_current_policy_hash") !== text(row, "private_group_policy_hash") ||
    text(row, "profile_id") !== text(row, "request_profile_id") ||
    integer(row, "profile_version", 1) !== integer(row, "request_profile_version", 1) ||
    text(row, "profile_hash") !== text(row, "request_profile_hash") ||
    text(row, "opportunity_profile_id") !== text(row, "request_profile_id") ||
    integer(row, "opportunity_profile_version", 1) !== integer(row, "request_profile_version", 1) ||
    text(row, "opportunity_profile_hash") !== text(row, "request_profile_hash") ||
    text(row, "opportunity_agent_id") !== text(row, "integration_agent_id") ||
    text(row, "opportunity_agent_version_id") !== text(row, "integration_agent_version_id") ||
    text(row, "profile_agent_id") !== text(row, "integration_agent_id") ||
    text(row, "profile_agent_version_id") !== text(row, "integration_agent_version_id") ||
    text(row, "source_evidence_hash") !== externalSourceEvidenceHash ||
    text(row, "suggestion_commitment") !== externalSuggestionCommitment ||
    text(row, "private_group_id") !== text(row, "profile_private_group_id") ||
    text(row, "private_group_id") !== text(row, "cohort_private_group_id") ||
    cohortBindingHash !== text(row, "cohort_binding_hash") ||
    responseDeadline <= input.now
  ) {
    throw new TokenlessServiceError(
      "The private review foundation no longer matches its exact opportunity, profile, group, or cohort.",
      409,
      input.compensationMode === "usdc"
        ? "private_paid_review_binding_conflict"
        : "private_unpaid_review_binding_conflict",
    );
  }
  assertHash(text(row, "binding_hash"), "private-review binding hash");
  assertHash(text(row, "cohort_binding_hash"), "private-review cohort hash");
  assertHash(text(row, "request_profile_hash"), "private-review profile hash");
  assertHash(text(row, "private_group_policy_hash"), "private-group policy hash");
  return responseDeadline;
}

async function loadFrozenFoundation(
  client: PoolClient,
  input: {
    principal: PrivateUnpaidReviewPrincipal;
    privateReviewId: string;
    opportunityId: string;
    now: Date;
    compensationMode: PrivateReviewCompensationMode;
  },
) {
  const result = await client.query(
    `SELECT f.*,
            i.status AS integration_status, i.agent_id AS integration_agent_id,
            i.agent_version_id AS integration_agent_version_id,
            project.status AS project_status, project.visibility AS project_visibility,
            project.data_classification AS project_data_classification,
            project.private_sensitivity AS project_private_sensitivity,
            project.retention_days AS project_retention_days,
            project.home_region AS project_home_region,
            project.retention_policy_id AS project_retention_policy_id,
            project.data_use_policy_version AS project_data_use_policy_version,
            p.profile_id, p.version AS profile_version, p.profile_hash,
            p.agent_id AS profile_agent_id, p.agent_version_id AS profile_agent_version_id,
            p.audience AS profile_audience, p.content_boundary, p.compensation_mode, p.panel_size,
            p.criterion,p.positive_label,p.negative_label,p.rationale_mode,
            p.required_expertise_keys_json,p.expertise_requirements_json,
            p.private_group_id AS profile_private_group_id,
            o.opportunity_id, o.agent_id AS opportunity_agent_id,
            o.agent_version_id AS opportunity_agent_version_id,
            o.request_profile_id AS opportunity_profile_id,
            o.request_profile_version AS opportunity_profile_version,
            o.request_profile_hash AS opportunity_profile_hash,
            o.source_evidence_hash, o.suggestion_commitment, o.status AS opportunity_status,
            l.state AS lifecycle_state, l.state_revision AS lifecycle_revision,
            g.status AS group_status, g.current_policy_version AS group_current_policy_version,
            gp.policy_hash AS group_current_policy_hash,
            c.source AS cohort_source, c.selection AS cohort_selection, c.status AS cohort_status,
            c.capacity AS cohort_capacity, c.active_reservations AS cohort_active_reservations,
            c.private_group_id AS cohort_private_group_id,
            c.qualification_rules_json AS cohort_qualification_rules_json,
            source.digest AS source_digest, suggestion.digest AS suggestion_digest
     FROM tokenless_private_review_requests f
     JOIN tokenless_agent_integrations i ON i.integration_id = f.integration_id
     JOIN tokenless_assurance_projects project
       ON project.workspace_id = f.workspace_id AND project.project_id = f.project_id
     JOIN tokenless_agent_review_request_profiles p
       ON p.workspace_id = f.workspace_id
      AND p.profile_id = f.request_profile_id
      AND p.version = f.request_profile_version
      AND p.profile_hash = f.request_profile_hash
     JOIN tokenless_agent_review_opportunities o
       ON o.workspace_id = f.workspace_id AND o.opportunity_id = $1
     JOIN tokenless_agent_review_opportunity_lifecycles l
       ON l.workspace_id = o.workspace_id AND l.opportunity_id = o.opportunity_id
     JOIN tokenless_private_groups g ON g.group_id = f.private_group_id
     JOIN tokenless_private_group_policy_versions gp
       ON gp.group_id = g.group_id AND gp.version = g.current_policy_version
     JOIN tokenless_assurance_cohorts c
       ON c.project_id = f.project_id AND c.cohort_id = f.cohort_id
     JOIN tokenless_assurance_artifacts source ON source.artifact_id = f.source_artifact_id
     JOIN tokenless_assurance_artifacts suggestion ON suggestion.artifact_id = f.suggestion_artifact_id
     WHERE f.workspace_id = $2 AND f.private_review_id = $3
     LIMIT 1 FOR UPDATE`,
    [input.opportunityId, input.principal.workspaceId, input.privateReviewId],
  );
  const row = result.rows[0] as Row | undefined;
  if (!row) {
    throw new TokenlessServiceError("Private review foundation not found.", 404, "private_review_not_found");
  }
  const responseDeadline = assertExactFoundation({ ...input, row });
  return { row, responseDeadline };
}

async function responseForDelivery(
  client: PoolClient,
  deliveryId: string,
  replayed: boolean,
  compensationMode: PrivateReviewCompensationMode,
) {
  const result = await client.query(
    `SELECT d.delivery_id, d.opportunity_id, d.private_review_id, d.operation_hash,
            d.membership_snapshot_hash, d.response_deadline, d.status,
            a.assignment_id, a.reviewer_account_address, a.reservation_expires_at,
            a.status AS assignment_status
     FROM tokenless_private_unpaid_review_deliveries d
     JOIN tokenless_private_unpaid_review_assignments a ON a.delivery_id = d.delivery_id
     WHERE d.delivery_id = $1 ORDER BY a.reviewer_account_address ASC`,
    [deliveryId],
  );
  if (!result.rows.length) throw new Error("Private unpaid delivery has no assignments.");
  const first = result.rows[0] as Row;
  return {
    schemaVersion:
      compensationMode === "usdc"
        ? ("rateloop.private-paid-review-delivery.v1" as const)
        : ("rateloop.private-unpaid-review-delivery.v1" as const),
    deliveryId,
    opportunityId: text(first, "opportunity_id")!,
    privateReviewId: text(first, "private_review_id")!,
    operationHash: text(first, "operation_hash") as `sha256:${string}`,
    membershipSnapshotHash: text(first, "membership_snapshot_hash") as `sha256:${string}`,
    responseDeadline: date(first, "response_deadline").toISOString(),
    status: text(first, "status") as "pending",
    replayed,
    assignments: result.rows.map(value => {
      const row = value as Row;
      return {
        assignmentId: text(row, "assignment_id")!,
        reviewerAccountAddress: text(row, "reviewer_account_address")!,
        reservationExpiresAt: date(row, "reservation_expires_at").toISOString(),
        status: text(row, "assignment_status") as "reserved" | "accepted" | "expired" | "completed",
      };
    }),
  };
}

async function requestPrivateHumanReviewAssignments(input: {
  principal: PrivateUnpaidReviewPrincipal;
  opportunityId: string;
  privateReviewId: string;
  reviewerAccountAddresses: readonly string[];
  compensationMode: PrivateReviewCompensationMode;
  now?: Date;
}) {
  const now = input.now ?? new Date();
  const reviewers = normalizeReviewers(input.reviewerAccountAddresses);
  const client = await dbPool.connect();
  try {
    await client.query("BEGIN");
    const { row, responseDeadline } = await loadFrozenFoundation(client, { ...input, now });
    const paid = input.compensationMode === "usdc";
    const laneSlug = paid ? "private-paid" : "private-unpaid";
    const laneCode = paid ? "private_paid" : "private_unpaid";
    const laneActor = paid ? "private-paid-v1" : "private-unpaid-v1";
    const operationHash = sha256({
      schemaVersion: paid ? "rateloop.private-paid-review-operation.v1" : "rateloop.private-unpaid-review-operation.v1",
      workspaceId: input.principal.workspaceId,
      opportunityId: input.opportunityId,
      privateReviewId: input.privateReviewId,
      foundationBindingHash: text(row, "binding_hash"),
      responseDeadline: responseDeadline.toISOString(),
      reviewers,
      compensationMode: input.compensationMode,
    });
    const deliveryId = identifier(paid ? "hppd" : "hpud", operationHash);
    const existing = await client.query(
      `SELECT * FROM tokenless_private_unpaid_review_deliveries
       WHERE workspace_id = $1 AND (opportunity_id = $2 OR private_review_id = $3)
       LIMIT 1 FOR UPDATE`,
      [input.principal.workspaceId, input.opportunityId, input.privateReviewId],
    );
    const existingRow = existing.rows[0] as Row | undefined;
    if (existingRow) {
      if (text(existingRow, "operation_hash") !== operationHash) {
        throw new TokenlessServiceError(
          "This opportunity or private foundation is already bound to different named reviewers.",
          409,
          "private_unpaid_review_idempotency_conflict",
        );
      }
      const response = await responseForDelivery(
        client,
        text(existingRow, "delivery_id")!,
        true,
        input.compensationMode,
      );
      if (
        response.membershipSnapshotHash !== text(existingRow, "membership_snapshot_hash") ||
        response.assignments.length !== reviewers.length ||
        response.assignments.some((assignment, index) => assignment.reviewerAccountAddress !== reviewers[index])
      ) {
        throw new TokenlessServiceError(
          "The durable private delivery no longer matches its frozen member snapshot.",
          409,
          "private_unpaid_review_recovery_conflict",
        );
      }
      const lifecycleState = text(row, "lifecycle_state");
      if (lifecycleState === "request_ready") {
        await transitionHumanReviewOpportunityLifecycleInTransaction(client, {
          workspaceId: input.principal.workspaceId,
          opportunityId: input.opportunityId,
          transitionKey: `${laneSlug}:${operationHash.slice("sha256:".length)}`,
          expectedState: "request_ready",
          expectedRevision: integer(row, "lifecycle_revision", 1),
          toState: "pending",
          reasonCodes: [`${laneCode}_assignments_reserved`],
          actor: { kind: "lane_adapter", reference: laneActor },
          details: {
            deliveryId: text(existingRow, "delivery_id"),
            privateReviewId: input.privateReviewId,
            operationHash,
            foundationBindingHash: text(existingRow, "foundation_binding_hash"),
            membershipSnapshotHash: text(existingRow, "membership_snapshot_hash"),
            responseDeadline: date(existingRow, "response_deadline").toISOString(),
            panelSize: integer(existingRow, "panel_size", 1),
          },
          occurredAt: date(existingRow, "created_at"),
        });
      } else if (lifecycleState !== "pending") {
        throw new TokenlessServiceError(
          "The private unpaid delivery cannot be reconciled with its opportunity lifecycle.",
          409,
          "private_unpaid_review_recovery_conflict",
        );
      }
      await client.query(
        `UPDATE tokenless_agent_review_opportunities
         SET status = 'review_requested', updated_at = CASE WHEN updated_at < $1 THEN $1 ELSE updated_at END
         WHERE workspace_id = $2 AND opportunity_id = $3 AND operation_key IS NULL
           AND status IN ('decided','review_requested')`,
        [now, input.principal.workspaceId, input.opportunityId],
      );
      await client.query("COMMIT");
      return response;
    }
    if (text(row, "lifecycle_state") !== "request_ready") {
      throw new TokenlessServiceError(
        "The private review opportunity must be request_ready before assignment.",
        409,
        "human_review_lifecycle_not_request_ready",
      );
    }
    const panelSize = integer(row, "panel_size", 1);
    if (reviewers.length !== panelSize) {
      throw new TokenlessServiceError(
        "Named reviewer count must equal the frozen private-review panel size.",
        409,
        "private_review_panel_size_mismatch",
      );
    }
    if (integer(row, "cohort_active_reservations") + panelSize > integer(row, "cohort_capacity", 1)) {
      throw new TokenlessServiceError("Private reviewer capacity is exhausted.", 409, "audience_capacity_exhausted");
    }

    const snapshots: Array<{
      reviewer: string;
      joinedAt: Date;
      expiresAt: Date | null;
      allowedProjects: string[];
      qualificationJson: string;
      membershipSnapshotHash: string;
    }> = [];
    const requiredExpertise = normalizeReviewerExpertiseKeys(
      JSON.parse(text(row, "required_expertise_keys_json") ?? "[]"),
    );
    const exactExpertiseRequirements = normalizeReviewerExpertiseRequirementsSelection(
      JSON.parse(text(row, "expertise_requirements_json") ?? "[]"),
      panelSize,
    );
    const exactExpertiseByReviewer = new Map<string, Set<string>>();
    for (const reviewer of reviewers) {
      const memberResult = await client.query(
        `SELECT m.status AS membership_status, m.allowed_project_ids_json,m.source_invitation_id,
                m.membership_expires_at, m.joined_at,
                cr.status AS cohort_reviewer_status, cr.qualification_provenance_json,
                cr.qualification_expires_at, cr.maximum_active_assignments, cr.active_reservations
         FROM tokenless_private_group_memberships m
         JOIN tokenless_assurance_cohort_reviewers cr
           ON cr.project_id = $1 AND cr.cohort_id = $2
          AND cr.reviewer_account_address = m.principal_address
         WHERE m.group_id = $3 AND m.principal_address = $4
         LIMIT 1 FOR UPDATE`,
        [text(row, "project_id"), text(row, "cohort_id"), text(row, "private_group_id"), reviewer],
      );
      const member = memberResult.rows[0] as Row | undefined;
      const joinedAt = member ? date(member, "joined_at") : new Date(Number.NaN);
      const expiresAt = member?.membership_expires_at ? date(member, "membership_expires_at") : null;
      const qualificationExpiresAt = member?.qualification_expires_at ? date(member, "qualification_expires_at") : null;
      const allowedProjects = member
        ? parseStringArray(member.allowed_project_ids_json, "private-group project allowlist")
        : [];
      if (
        !member ||
        text(member, "membership_status") !== "active" ||
        text(member, "cohort_reviewer_status") !== "active" ||
        !Number.isFinite(joinedAt.getTime()) ||
        joinedAt > now ||
        (expiresAt !== null && expiresAt < responseDeadline) ||
        (qualificationExpiresAt !== null && qualificationExpiresAt < responseDeadline) ||
        !qualificationProvenanceSatisfiesExpertise(
          member?.qualification_provenance_json,
          requiredExpertise,
          responseDeadline,
        ) ||
        (allowedProjects.length > 0 && !allowedProjects.includes(text(row, "project_id")!)) ||
        integer(member, "active_reservations") >= integer(member, "maximum_active_assignments", 1)
      ) {
        throw new TokenlessServiceError(
          "A named reviewer is not an active eligible member of the exact private group and cohort.",
          409,
          "private_reviewer_not_eligible",
        );
      }
      const exactResult = await client.query(
        `SELECT qualification_id,expertise_definition_id,expertise_definition_version,
                expertise_definition_hash,evidence_reference_hash,verified_at,expires_at,
                source_invitation_id,asserted_by
         FROM tokenless_reviewer_qualifications
         WHERE workspace_id=$1 AND reviewer_account_address=$2
           AND reviewer_source='customer_invited' AND qualification_kind='expertise'
           AND expertise_record_schema_version=2 AND status='active' AND expires_at>=$3
           AND source_invitation_id=$4
         ORDER BY expertise_definition_id,expertise_definition_version,qualification_id`,
        [text(row, "workspace_id"), reviewer, responseDeadline, text(member, "source_invitation_id")],
      );
      const exactQualificationRecords = (exactResult.rows as Row[]).map(qualification => ({
        kind: "exact_expertise",
        qualificationId: text(qualification, "qualification_id"),
        definitionId: text(qualification, "expertise_definition_id"),
        definitionVersion: integer(qualification, "expertise_definition_version", 1),
        definitionHash: text(qualification, "expertise_definition_hash"),
        evidenceReferenceHash: text(qualification, "evidence_reference_hash"),
        verifiedAt: date(qualification, "verified_at").toISOString(),
        expiresAt: date(qualification, "expires_at").toISOString(),
        sourceInvitationId: text(qualification, "source_invitation_id"),
        assertedBy: text(qualification, "asserted_by"),
      }));
      const exactKeys = new Set(
        exactQualificationRecords.map(qualification =>
          exactReviewerExpertiseDefinitionKey({
            definitionId: qualification.definitionId!,
            definitionVersion: qualification.definitionVersion,
            definitionHash: qualification.definitionHash as `sha256:${string}`,
          }),
        ),
      );
      exactExpertiseByReviewer.set(reviewer, exactKeys);
      const legacyQualificationProvenance = parseJsonDocument(
        member.qualification_provenance_json,
        "reviewer qualification provenance",
      );
      if (!Array.isArray(legacyQualificationProvenance)) {
        throw new Error("Stored reviewer qualification provenance is invalid.");
      }
      const qualificationJson = stableJson([...legacyQualificationProvenance, ...exactQualificationRecords]);
      snapshots.push({
        reviewer,
        joinedAt,
        expiresAt,
        allowedProjects,
        qualificationJson,
        membershipSnapshotHash: sha256({
          schemaVersion: "rateloop.private-review-membership-snapshot.v1",
          groupId: text(row, "private_group_id"),
          reviewer,
          joinedAt: joinedAt.toISOString(),
          expiresAt: expiresAt?.toISOString() ?? null,
          allowedProjects,
          qualificationHash: sha256(JSON.parse(qualificationJson)),
          cutoffAt: now.toISOString(),
        }),
      });
    }
    if (
      exactExpertiseRequirements.length > 0 &&
      !chooseExpertiseCoveredPanel(
        reviewers.map(reviewer => ({
          id: reviewer,
          expertiseKeys: [...(exactExpertiseByReviewer.get(reviewer) ?? [])],
        })),
        panelSize,
        exactExpertiseRequirements.map(requirement => ({
          key: exactReviewerExpertiseDefinitionKey(requirement),
          minimumSeats: requirement.minimumSeats,
        })),
      )
    ) {
      throw new TokenlessServiceError(
        "The named reviewer panel no longer covers every specialist requirement through the response deadline.",
        409,
        "private_reviewer_expertise_coverage_unavailable",
      );
    }
    const membershipSnapshotHash = sha256({
      schemaVersion: "rateloop.private-review-panel-snapshot.v1",
      cutoffAt: now.toISOString(),
      members: snapshots.map(snapshot => ({
        reviewer: snapshot.reviewer,
        membershipSnapshotHash: snapshot.membershipSnapshotHash,
      })),
    });
    const reservationExpiresAt = new Date(Math.min(now.getTime() + RESERVATION_TTL_MS, responseDeadline.getTime()));
    if (reservationExpiresAt <= now) {
      throw new TokenlessServiceError("Private review deadline expired.", 410, "private_review_expired");
    }
    await client.query(
      `INSERT INTO tokenless_private_unpaid_review_deliveries
       (delivery_id,workspace_id,project_id,integration_id,opportunity_id,private_review_id,
        operation_hash,request_profile_id,request_profile_version,request_profile_hash,
        private_group_id,private_group_policy_version,private_group_policy_hash,
        cohort_id,cohort_binding_hash,foundation_binding_hash,membership_snapshot_hash,
        snapshot_cutoff_at,response_deadline,panel_size,status,created_at,updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,'pending',$18,$18)`,
      [
        deliveryId,
        input.principal.workspaceId,
        text(row, "project_id"),
        text(row, "integration_id"),
        input.opportunityId,
        input.privateReviewId,
        operationHash,
        text(row, "request_profile_id"),
        integer(row, "request_profile_version", 1),
        text(row, "request_profile_hash"),
        text(row, "private_group_id"),
        integer(row, "private_group_policy_version", 1),
        text(row, "private_group_policy_hash"),
        text(row, "cohort_id"),
        text(row, "cohort_binding_hash"),
        text(row, "binding_hash"),
        membershipSnapshotHash,
        now,
        responseDeadline,
        panelSize,
      ],
    );
    for (const snapshot of snapshots) {
      const assignmentId = identifier("hpua", { deliveryId, reviewer: snapshot.reviewer });
      await client.query(
        `INSERT INTO tokenless_private_unpaid_review_assignments
         (assignment_id,delivery_id,workspace_id,project_id,private_review_id,cohort_id,
          private_group_id,reviewer_account_address,membership_joined_at,membership_expires_at,
          membership_allowed_projects_hash,qualification_snapshot_json,membership_snapshot_hash,
          snapshot_cutoff_at,reservation_expires_at,response_deadline,status,lease_state,created_at,updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,'reserved','pending',$14,$14)`,
        [
          assignmentId,
          deliveryId,
          input.principal.workspaceId,
          text(row, "project_id"),
          input.privateReviewId,
          text(row, "cohort_id"),
          text(row, "private_group_id"),
          snapshot.reviewer,
          snapshot.joinedAt,
          snapshot.expiresAt,
          sha256(snapshot.allowedProjects),
          snapshot.qualificationJson,
          snapshot.membershipSnapshotHash,
          now,
          reservationExpiresAt,
          responseDeadline,
        ],
      );
      const reviewerCapacity = await client.query(
        `UPDATE tokenless_assurance_cohort_reviewers
         SET active_reservations = active_reservations + 1, updated_at = $1
         WHERE project_id = $2 AND cohort_id = $3 AND reviewer_account_address = $4
           AND status = 'active' AND active_reservations < maximum_active_assignments`,
        [now, text(row, "project_id"), text(row, "cohort_id"), snapshot.reviewer],
      );
      if (reviewerCapacity.rowCount !== 1) {
        throw new TokenlessServiceError("Named reviewer capacity changed.", 409, "audience_capacity_exhausted");
      }
    }
    const cohortCapacity = await client.query(
      `UPDATE tokenless_assurance_cohorts
       SET active_reservations = active_reservations + $1, updated_at = $2
       WHERE project_id = $3 AND cohort_id = $4 AND status = 'active'
         AND active_reservations + $1 <= capacity`,
      [panelSize, now, text(row, "project_id"), text(row, "cohort_id")],
    );
    if (cohortCapacity.rowCount !== 1) {
      throw new TokenlessServiceError("Private reviewer capacity changed.", 409, "audience_capacity_exhausted");
    }
    await beforeDeliveryCommitForTests?.();
    const transition = await transitionHumanReviewOpportunityLifecycleInTransaction(client, {
      workspaceId: input.principal.workspaceId,
      opportunityId: input.opportunityId,
      transitionKey: `${laneSlug}:${operationHash.slice("sha256:".length)}`,
      expectedState: "request_ready",
      expectedRevision: integer(row, "lifecycle_revision", 1),
      toState: "pending",
      reasonCodes: [`${laneCode}_assignments_reserved`],
      actor: { kind: "lane_adapter", reference: laneActor },
      details: {
        deliveryId,
        privateReviewId: input.privateReviewId,
        operationHash,
        foundationBindingHash: text(row, "binding_hash"),
        membershipSnapshotHash,
        responseDeadline: responseDeadline.toISOString(),
        panelSize,
      },
      occurredAt: now,
    });
    const opportunity = await client.query(
      `UPDATE tokenless_agent_review_opportunities
       SET status = 'review_requested', updated_at = $1
       WHERE workspace_id = $2 AND opportunity_id = $3 AND operation_key IS NULL
         AND status IN ('decided','review_requested')`,
      [now, input.principal.workspaceId, input.opportunityId],
    );
    if (opportunity.rowCount !== 1) {
      throw new TokenlessServiceError("Private review opportunity changed.", 409, "review_binding_conflict");
    }
    if (!transition.replayed) {
      await client.query(
        `UPDATE tokenless_agent_integrations
         SET last_request_at = CASE WHEN last_request_at IS NULL OR last_request_at < $1 THEN $1 ELSE last_request_at END,
             updated_at = CASE WHEN updated_at < $1 THEN $1 ELSE updated_at END
         WHERE integration_id = $2 AND workspace_id = $3`,
        [now, text(row, "integration_id"), input.principal.workspaceId],
      );
    }
    const response = await responseForDelivery(client, deliveryId, false, input.compensationMode);
    await client.query("COMMIT");
    return response;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function requestPrivateUnpaidHumanReview(
  input: Omit<Parameters<typeof requestPrivateHumanReviewAssignments>[0], "compensationMode">,
) {
  return requestPrivateHumanReviewAssignments({ ...input, compensationMode: "unpaid" });
}

export async function requestPrivatePaidReviewAssignments(
  input: Omit<Parameters<typeof requestPrivateHumanReviewAssignments>[0], "compensationMode">,
) {
  return requestPrivateHumanReviewAssignments({ ...input, compensationMode: "usdc" });
}

export async function expirePrivateUnpaidReviewReservations(now = new Date()) {
  const client = await dbPool.connect();
  try {
    await client.query("BEGIN");
    const due = await client.query(
      `SELECT assignment_id,project_id,cohort_id,reviewer_account_address
       FROM tokenless_private_unpaid_review_assignments
       WHERE status = 'reserved' AND reservation_expires_at <= $1
       ORDER BY reservation_expires_at ASC FOR UPDATE`,
      [now],
    );
    for (const value of due.rows) {
      const row = value as Row;
      await client.query(
        `UPDATE tokenless_private_unpaid_review_assignments
         SET status = 'expired', lease_state = 'expired', updated_at = $1
         WHERE assignment_id = $2 AND status = 'reserved'`,
        [now, text(row, "assignment_id")],
      );
      await client.query(
        `UPDATE tokenless_assurance_cohort_reviewers
         SET active_reservations = active_reservations - 1, updated_at = $1
         WHERE project_id = $2 AND cohort_id = $3 AND reviewer_account_address = $4
           AND active_reservations > 0`,
        [now, text(row, "project_id"), text(row, "cohort_id"), text(row, "reviewer_account_address")],
      );
      await client.query(
        `UPDATE tokenless_assurance_cohorts
         SET active_reservations = active_reservations - 1, updated_at = $1
         WHERE project_id = $2 AND cohort_id = $3 AND active_reservations > 0`,
        [now, text(row, "project_id"), text(row, "cohort_id")],
      );
    }
    await client.query("COMMIT");
    return due.rowCount;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function upsertPrivateArtifactLease(
  client: PoolClient,
  input: {
    adapterReference: "private-paid-v1" | "private-unpaid-v1";
    artifactId: string;
    assignmentId: string;
    expiresAt: Date;
    now: Date;
    projectId: string;
    reviewer: string;
    workspaceId: string;
  },
) {
  const leaseId = identifier("lease", {
    schemaVersion:
      input.adapterReference === "private-paid-v1"
        ? "rateloop.private-paid-artifact-lease.v1"
        : "rateloop.private-unpaid-artifact-lease.v1",
    assignmentId: input.assignmentId,
    artifactId: input.artifactId,
  });
  const existing = await client.query(
    `SELECT * FROM tokenless_assurance_artifact_leases WHERE lease_id = $1 LIMIT 1 FOR UPDATE`,
    [leaseId],
  );
  const row = existing.rows[0] as Row | undefined;
  if (row) {
    if (
      text(row, "artifact_id") !== input.artifactId ||
      text(row, "workspace_id") !== input.workspaceId ||
      text(row, "project_id") !== input.projectId ||
      text(row, "account_address") !== input.reviewer ||
      text(row, "assignment_id") !== input.assignmentId ||
      row.revoked_at !== null
    ) {
      throw new TokenlessServiceError("Private artifact lease binding changed.", 409, "artifact_lease_conflict");
    }
    await client.query(
      `UPDATE tokenless_assurance_artifact_leases SET expires_at = $1
       WHERE lease_id = $2 AND revoked_at IS NULL AND expires_at < $1`,
      [input.expiresAt, leaseId],
    );
  } else {
    const artifact = await client.query(
      `SELECT artifact_id FROM tokenless_assurance_artifact_objects
       WHERE artifact_id = $1 AND workspace_id = $2 AND project_id = $3 AND status = 'active' LIMIT 1`,
      [input.artifactId, input.workspaceId, input.projectId],
    );
    if (artifact.rowCount !== 1) throw new TokenlessServiceError("Artifact not found.", 404, "artifact_not_found");
    await client.query(
      `INSERT INTO tokenless_assurance_artifact_leases
       (lease_id,artifact_id,workspace_id,project_id,account_address,assignment_id,purpose,
        expires_at,created_by,created_at)
       VALUES ($1,$2,$3,$4,$5,$6,'private_assigned_review',$7,$8,$9)`,
      [
        leaseId,
        input.artifactId,
        input.workspaceId,
        input.projectId,
        input.reviewer,
        input.assignmentId,
        input.expiresAt,
        input.adapterReference,
        input.now,
      ],
    );
  }
  const logId = identifier("halog", { leaseId, action: "lease" });
  await client.query(
    `INSERT INTO tokenless_assurance_access_logs
     (log_id,workspace_id,project_id,artifact_id,lease_id,actor_kind,actor_reference,
      action,purpose,request_reference,occurred_at)
     VALUES ($1,$2,$3,$4,$5,'service',$6,'lease','private_assigned_review',$7,$8)
     ON CONFLICT (log_id) DO NOTHING`,
    [
      logId,
      input.workspaceId,
      input.projectId,
      input.artifactId,
      leaseId,
      input.adapterReference,
      input.assignmentId,
      input.now,
    ],
  );
  return { artifactId: input.artifactId, leaseId, expiresAt: input.expiresAt.toISOString() };
}

export async function acceptPrivateUnpaidReviewAssignment(input: {
  assignmentId: string;
  reviewerAccountAddress: string;
  now?: Date;
}) {
  const now = input.now ?? new Date();
  const reviewer = normalizeReviewers([input.reviewerAccountAddress])[0]!;
  await expirePrivateUnpaidReviewReservations(now);
  const client = await dbPool.connect();
  try {
    await client.query("BEGIN");
    const result = await client.query(
      `SELECT a.*, d.response_deadline AS delivery_response_deadline,
              f.source_artifact_id, f.suggestion_artifact_id,p.compensation_mode,
              m.status AS membership_status, m.joined_at AS current_membership_joined_at,
              m.membership_expires_at AS current_membership_expires_at,
              m.allowed_project_ids_json AS current_allowed_project_ids_json
       FROM tokenless_private_unpaid_review_assignments a
       JOIN tokenless_private_unpaid_review_deliveries d ON d.delivery_id = a.delivery_id
       JOIN tokenless_private_review_requests f ON f.private_review_id = a.private_review_id
       JOIN tokenless_agent_review_request_profiles p
         ON p.workspace_id=f.workspace_id AND p.profile_id=f.request_profile_id
        AND p.version=f.request_profile_version AND p.profile_hash=f.request_profile_hash
       JOIN tokenless_private_group_memberships m
         ON m.group_id = a.private_group_id AND m.principal_address = a.reviewer_account_address
       WHERE a.assignment_id = $1 AND a.reviewer_account_address = $2
       LIMIT 1 FOR UPDATE`,
      [input.assignmentId, reviewer],
    );
    const row = result.rows[0] as Row | undefined;
    if (!row || !["reserved", "accepted"].includes(text(row, "status") ?? "")) {
      throw new TokenlessServiceError("Private review assignment not found.", 404, "assignment_not_found");
    }
    const responseDeadline = date(row, "response_deadline");
    const allowedProjects = parseStringArray(
      row.current_allowed_project_ids_json,
      "current private-group project allowlist",
    );
    const currentExpiry = row.current_membership_expires_at ? date(row, "current_membership_expires_at") : null;
    const frozenExpiry = row.membership_expires_at ? date(row, "membership_expires_at") : null;
    if (
      responseDeadline.getTime() !== date(row, "delivery_response_deadline").getTime() ||
      responseDeadline <= now ||
      text(row, "membership_status") !== "active" ||
      date(row, "membership_joined_at").getTime() !== date(row, "current_membership_joined_at").getTime() ||
      (frozenExpiry?.getTime() ?? null) !== (currentExpiry?.getTime() ?? null) ||
      (currentExpiry !== null && currentExpiry <= now) ||
      sha256(allowedProjects) !== text(row, "membership_allowed_projects_hash") ||
      (allowedProjects.length > 0 && !allowedProjects.includes(text(row, "project_id")!))
    ) {
      throw new TokenlessServiceError(
        "Private-group membership changed before assignment acceptance.",
        409,
        "private_group_membership_changed",
      );
    }
    const replayed = text(row, "status") === "accepted";
    const compensationMode = text(row, "compensation_mode");
    if (compensationMode !== "unpaid" && compensationMode !== "usdc") {
      throw new TokenlessServiceError(
        "The private assignment compensation mode is invalid.",
        409,
        "private_review_binding_conflict",
      );
    }
    const adapterReference = compensationMode === "usdc" ? "private-paid-v1" : "private-unpaid-v1";
    if (!replayed) {
      if (date(row, "reservation_expires_at") <= now) {
        throw new TokenlessServiceError("Assignment reservation expired.", 410, "assignment_expired");
      }
      const accepted = await client.query(
        `UPDATE tokenless_private_unpaid_review_assignments
         SET status = 'accepted', accepted_at = $1, assignment_expires_at = response_deadline,
             lease_state = 'pending', updated_at = $1
         WHERE assignment_id = $2 AND reviewer_account_address = $3 AND status = 'reserved'`,
        [now, input.assignmentId, reviewer],
      );
      if (accepted.rowCount !== 1) {
        throw new TokenlessServiceError("Assignment changed before acceptance.", 409, "assignment_conflict");
      }
    }
    const leaseExpiresAt = new Date(Math.min(now.getTime() + ARTIFACT_LEASE_TTL_MS, responseDeadline.getTime()));
    const artifacts = [text(row, "source_artifact_id")!, text(row, "suggestion_artifact_id")!];
    const leases = [];
    for (const artifactId of artifacts) {
      leases.push(
        await upsertPrivateArtifactLease(client, {
          adapterReference,
          artifactId,
          assignmentId: input.assignmentId,
          expiresAt: leaseExpiresAt,
          now,
          projectId: text(row, "project_id")!,
          reviewer,
          workspaceId: text(row, "workspace_id")!,
        }),
      );
      await beforeLeaseCommitForTests?.(artifactId);
    }
    await client.query(
      `UPDATE tokenless_private_unpaid_review_assignments
       SET lease_state = 'issued', updated_at = $1 WHERE assignment_id = $2`,
      [now, input.assignmentId],
    );
    await client.query("COMMIT");
    return {
      assignmentId: input.assignmentId,
      accepted: true as const,
      replayed,
      assignmentExpiresAt: responseDeadline.toISOString(),
      leases,
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export const __privateUnpaidReviewAdapterTestUtils = {
  setBeforeDeliveryCommitForTests(value: typeof beforeDeliveryCommitForTests) {
    beforeDeliveryCommitForTests = value;
  },
  setBeforeLeaseCommitForTests(value: typeof beforeLeaseCommitForTests) {
    beforeLeaseCommitForTests = value;
  },
};
