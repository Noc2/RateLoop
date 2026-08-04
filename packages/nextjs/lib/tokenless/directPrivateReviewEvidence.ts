import { createHash } from "node:crypto";
import type { PoolClient } from "pg";
import "server-only";
import { dbPool } from "~~/lib/db";
import {
  decryptWorkspaceOwnedRationale,
  encryptAssuranceRationale,
  getAssuranceResponseKeyrings,
} from "~~/lib/tokenless/assuranceResponses";
import { generateAssuranceEvidencePacket } from "~~/lib/tokenless/evidencePackets";
import { canonicalizeHumanAssuranceDocument, hashHumanAssuranceDocument } from "~~/lib/tokenless/humanAssurance";
import { throwIfMaintenanceCancelled } from "~~/lib/tokenless/maintenanceCancellation";
import {
  enqueueTokenlessScheduledWorkInTransaction,
  tokenlessScheduledWorkItemId,
} from "~~/lib/tokenless/scheduledWorkItems";

type Row = Record<string, unknown>;
type PacketGenerator = typeof generateAssuranceEvidencePacket;

const DEADLINE_TERMINAL_REQUIREMENT = "deadline_terminal_inconclusive_allowed";

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

function parseJson(value: unknown, field: string): unknown {
  try {
    return JSON.parse(String(value));
  } catch {
    throw new Error(`Stored ${field} is invalid.`);
  }
}

function digest(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function projectedId(prefix: string, deliveryId: string, suffix = "") {
  return `${prefix}_${digest(`${deliveryId}\0${suffix}`).slice(0, 40)}`;
}

function bytes32(value: unknown) {
  return `0x${createHash("sha256").update(canonicalizeHumanAssuranceDocument(value)).digest("hex")}`;
}

function qualificationKeys(value: unknown) {
  const parsed = parseJson(value, "qualification snapshot");
  if (!Array.isArray(parsed)) throw new Error("Stored qualification snapshot is invalid.");
  const keys = new Set<string>();
  for (const item of parsed) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const entry = item as Row;
    if (typeof entry.key === "string" && entry.key.trim()) keys.add(entry.key.trim());
    if (entry.kind === "exact_expertise" && typeof entry.definitionId === "string" && entry.definitionId.trim()) {
      const version = Number(entry.definitionVersion);
      keys.add(
        Number.isSafeInteger(version) && version > 0
          ? `expertise:${entry.definitionId.trim()}:v${version}`
          : `expertise:${entry.definitionId.trim()}`,
      );
    }
  }
  return [...keys].sort();
}

async function loadProjectionSource(client: PoolClient, deliveryId: string) {
  const lockedDelivery = await client.query(
    "SELECT delivery_id FROM tokenless_private_unpaid_review_deliveries WHERE delivery_id=$1 LIMIT 1 FOR UPDATE",
    [deliveryId],
  );
  if (lockedDelivery.rowCount !== 1) throw new Error("Terminal private review delivery not found.");
  const result = await client.query(
    `SELECT d.*, f.source_artifact_id, f.suggestion_artifact_id,
            f.workspace_reviewer_terms_version AS request_reviewer_terms_version,
            f.workspace_reviewer_terms_hash AS request_reviewer_terms_hash,
            rp.criterion, rp.rationale_mode, rp.compensation_mode, rp.bounty_per_seat_atomic,
            rp.feedback_bonus_enabled, rp.feedback_bonus_pool_atomic, p.data_classification,
            o.run_id, l.state AS lifecycle_state
     FROM tokenless_private_unpaid_review_deliveries d
     JOIN tokenless_private_review_requests f ON f.private_review_id=d.private_review_id
     JOIN tokenless_agent_review_request_profiles rp
       ON rp.workspace_id=d.workspace_id AND rp.profile_id=d.request_profile_id
      AND rp.version=d.request_profile_version AND rp.profile_hash=d.request_profile_hash
     JOIN tokenless_assurance_projects p ON p.project_id=d.project_id
     JOIN tokenless_agent_review_opportunities o
       ON o.workspace_id=d.workspace_id AND o.opportunity_id=d.opportunity_id
     JOIN tokenless_agent_review_opportunity_lifecycles l
       ON l.workspace_id=d.workspace_id AND l.opportunity_id=d.opportunity_id
     WHERE d.delivery_id=$1
     LIMIT 1`,
    [deliveryId],
  );
  const row = result.rows[0] as Row | undefined;
  if (!row) throw new Error("Terminal private review delivery not found.");
  const lockedOpportunity = await client.query(
    `SELECT run_id FROM tokenless_agent_review_opportunities
     WHERE workspace_id=$1 AND opportunity_id=$2 LIMIT 1 FOR UPDATE`,
    [text(row, "workspace_id"), text(row, "opportunity_id")],
  );
  if (lockedOpportunity.rowCount !== 1) throw new Error("Private review opportunity not found.");
  row.run_id = lockedOpportunity.rows[0]?.run_id ?? null;
  const owner = await client.query(
    `SELECT account_address FROM tokenless_workspace_members
     WHERE workspace_id=$1 AND role IN ('owner','admin','member')
     ORDER BY CASE role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END,account_address
     LIMIT 1`,
    [text(row, "workspace_id")],
  );
  if (owner.rowCount !== 1) throw new Error("Private review workspace has no evidence manager.");
  row.projection_owner = owner.rows[0]?.account_address;
  if (
    !["completed", "inconclusive"].includes(text(row, "status") ?? "") ||
    !["completed", "inconclusive"].includes(text(row, "lifecycle_state") ?? "") ||
    !row.result_envelope_json ||
    !row.completed_at
  ) {
    throw new Error("Only a terminal private review can be projected into decision evidence.");
  }
  return row;
}

async function insertProjection(client: PoolClient, source: Row, now: Date) {
  const deliveryId = text(source, "delivery_id")!;
  const existingRunId = text(source, "run_id");
  if (existingRunId) return existingRunId;

  const assignments = await client.query(
    `SELECT a.*, cr.qualification_provenance_json,
            seat.rater_id AS paid_rater_id,seat.state AS paid_seat_state,
            seat.settlement_reference AS paid_settlement_reference,
            seat.settlement_evidence_hash AS paid_settlement_evidence_hash,
            operation.round_id AS paid_round_id,operation.state AS paid_operation_state,
            operation.chain_admission_policy_hash AS paid_admission_policy_hash,
            issuance.snapshot_id AS paid_eligibility_snapshot_id
     FROM tokenless_private_unpaid_review_assignments a
     JOIN tokenless_assurance_cohort_reviewers cr
       ON cr.project_id=a.project_id AND cr.cohort_id=a.cohort_id
      AND cr.reviewer_account_address=a.reviewer_account_address
     LEFT JOIN tokenless_paid_assignment_seats seat ON seat.assignment_id=a.assignment_id
     LEFT JOIN tokenless_paid_assignment_operations operation ON operation.operation_id=seat.operation_id
     LEFT JOIN tokenless_paid_review_voucher_issuances issuance
       ON issuance.issuance_id=seat.voucher_issuance_id
     WHERE a.delivery_id=$1 ORDER BY a.assignment_id`,
    [deliveryId],
  );
  const responses = await client.query(
    `SELECT response.*, assignment.qualification_snapshot_json,
            seat.settlement_reference AS paid_settlement_reference,
            seat.settlement_evidence_hash AS paid_settlement_evidence_hash
     FROM tokenless_private_review_responses response
     JOIN tokenless_private_unpaid_review_assignments assignment
       ON assignment.assignment_id=response.assignment_id
     LEFT JOIN tokenless_paid_assignment_seats seat ON seat.assignment_id=assignment.assignment_id
     WHERE response.delivery_id=$1 ORDER BY response.response_id`,
    [deliveryId],
  );
  const panelSize = integer(source, "panel_size", 1);
  if (assignments.rows.length !== panelSize) {
    throw new Error("The terminal private review assignment panel is incomplete.");
  }
  const paid = text(source, "compensation_mode") === "usdc";
  if (
    paid &&
    (assignments.rows.some(
      value =>
        text(value as Row, "paid_seat_state") !== "terminal" ||
        text(value as Row, "paid_operation_state") !== "terminal" ||
        !text(value as Row, "paid_settlement_reference") ||
        !text(value as Row, "paid_settlement_evidence_hash") ||
        !text(value as Row, "paid_round_id") ||
        !text(value as Row, "paid_admission_policy_hash"),
    ) ||
      responses.rows.length !== panelSize ||
      responses.rows.some(
        value =>
          !text(value as Row, "paid_settlement_reference") || !text(value as Row, "paid_settlement_evidence_hash"),
      ))
  ) {
    throw new Error("Paid private review settlement evidence is not terminal yet.");
  }

  const projectId = text(source, "project_id")!;
  const workspaceId = text(source, "workspace_id")!;
  const privateReviewId = text(source, "private_review_id")!;
  const owner = text(source, "projection_owner")!;
  const completedAt = date(source, "completed_at");
  const createdAt = date(source, "created_at");
  const rubricId = projectedId("har", deliveryId);
  const suiteId = projectedId("has", deliveryId);
  const caseId = projectedId("hac", deliveryId);
  const policyId = projectedId("haa", deliveryId);
  const runId = projectedId("hau", deliveryId);
  const subpanelId = projectedId("hasp", deliveryId);
  const passRule = {
    metric: "candidate_preference_share_bps",
    operator: "gte",
    thresholdBps: 5_001,
    minimumValidResponses: Math.floor(panelSize / 2) + 1,
  };
  const rationaleMode = text(source, "rationale_mode");
  const rubric = {
    prompt: text(source, "criterion") ?? "Review the agent output.",
    failureTags: [],
    rationale: {
      mode: rationaleMode === "required" || rationaleMode === "off" ? rationaleMode : "optional",
    },
    passRule,
  };
  const suiteManifest = {
    kind: "suite_manifest",
    projectId,
    suiteId,
    version: 1,
    rubric,
    cases: [{ caseId }],
    source: { kind: "direct_private_review", deliveryCommitment: text(source, "operation_hash") },
  };
  const suiteManifestHash = hashHumanAssuranceDocument(suiteManifest);
  const policy = {
    schemaVersion: "human-assurance-v1",
    policyId,
    version: 1,
    reviewerSource: "customer_invited",
    compensation: paid ? "paid" : "unpaid",
    cohorts: [{ cohortId: text(source, "cohort_id"), minimumReviewers: panelSize }],
    selection: "customer_named",
    fallbacks: { allowed: false, sources: [] },
    requiredQualifications: [],
    assurance: { requirements: [DEADLINE_TERMINAL_REQUIREMENT] },
    buyerPrivacy: {
      visibleFields: ["reviewer_source"],
      minimumAggregationSize: passRule.minimumValidResponses,
      suppressSmallCells: true,
    },
    legalEligibilityRequired: paid,
  };
  const policyHash = hashHumanAssuranceDocument(policy);
  const paidAdmissionPolicyHashes = [
    ...new Set(assignments.rows.map(value => text(value as Row, "paid_admission_policy_hash")).filter(Boolean)),
  ];
  const admissionPolicyHash = paid
    ? paidAdmissionPolicyHashes.length === 1
      ? paidAdmissionPolicyHashes[0]!
      : (() => {
          throw new Error("Paid private review admission policy binding is inconsistent.");
        })()
    : bytes32({
        kind: "direct_private_review_admission",
        deliveryId,
        cohortId: text(source, "cohort_id"),
        cohortBindingHash: text(source, "cohort_binding_hash"),
        privateGroupPolicyHash: text(source, "private_group_policy_hash"),
        membershipSnapshotHash: text(source, "membership_snapshot_hash"),
      });
  const paidRoundIds = [...new Set(assignments.rows.map(value => text(value as Row, "paid_round_id")).filter(Boolean))];
  const paidRoundId = paid
    ? paidRoundIds.length === 1
      ? paidRoundIds[0]!
      : (() => {
          throw new Error("Paid private review round binding is inconsistent.");
        })()
    : null;
  const runManifest = {
    schemaVersion: "human-assurance-run-orchestration-v1",
    kind: "run_orchestration_manifest",
    runId,
    projectId,
    suite: { suiteId, version: 1, manifestHash: suiteManifestHash },
    rubric: {
      rubricId,
      version: 1,
      rubricHash: hashHumanAssuranceDocument(rubric),
      passRule,
      passRuleHash: hashHumanAssuranceDocument(passRule),
    },
    audiencePolicy: { policyId, version: 1, manifestHash: policyHash, admissionPolicyHash },
    source: {
      kind: "direct_private_review",
      deliveryId,
      privateReviewId,
      resultCommitment: text(source, "result_commitment"),
    },
  };
  const runManifestHash = hashHumanAssuranceDocument(runManifest);
  const checks: unknown[] = [];
  const checksHash = hashHumanAssuranceDocument(checks);
  const blinding = { swap: false, source: "direct_private_review" };

  await client.query(
    `INSERT INTO tokenless_assurance_rubrics
     (rubric_id,project_id,version,prompt,failure_tags_json,rationale_json,pass_rule_json,rubric_json,created_at)
     VALUES ($1,$2,1,$3,'[]',$4,$5,$6,$7)
     ON CONFLICT (rubric_id,version) DO NOTHING`,
    [
      rubricId,
      projectId,
      rubric.prompt,
      JSON.stringify(rubric.rationale),
      JSON.stringify(passRule),
      canonicalizeHumanAssuranceDocument(rubric),
      createdAt,
    ],
  );
  await client.query(
    `INSERT INTO tokenless_assurance_suites
     (suite_id,project_id,name,version,status,rubric_id,rubric_version,manifest_hash,manifest_json,
      frozen_at,created_at,updated_at)
     VALUES ($1,$2,'Direct private review',1,'frozen',$3,1,$4,$5,$6,$7,$6)
     ON CONFLICT (suite_id,version) DO NOTHING`,
    [
      suiteId,
      projectId,
      rubricId,
      suiteManifestHash,
      canonicalizeHumanAssuranceDocument(suiteManifest),
      completedAt,
      createdAt,
    ],
  );
  await client.query(
    `INSERT INTO tokenless_assurance_cases
     (case_id,project_id,suite_id,suite_version,position,title,instructions,baseline_artifact_id,
      candidate_artifact_id,context_artifact_ids_json,objective_reference,status,created_at,updated_at,
      deterministic_checks_json)
     VALUES ($1,$2,$3,1,1,'Review the agent output',$4,$5,$6,'[]',NULL,'ready',$7,$8,'[]')
     ON CONFLICT (case_id) DO NOTHING`,
    [
      caseId,
      projectId,
      suiteId,
      rubric.prompt,
      text(source, "source_artifact_id"),
      text(source, "suggestion_artifact_id"),
      createdAt,
      completedAt,
    ],
  );
  await client.query(
    `INSERT INTO tokenless_assurance_audience_policies
     (policy_id,project_id,version,reviewer_source,compensation,cohorts_json,selection,fallbacks_json,
      required_qualifications_json,assurance_json,buyer_privacy_json,legal_eligibility_required,
      policy_hash,policy_json,created_at)
     VALUES ($1,$2,1,'customer_invited',$3,$4,'customer_named',$5,'[]',$6,$7,$8,$9,$10,$11)
     ON CONFLICT (policy_id,version) DO NOTHING`,
    [
      policyId,
      projectId,
      policy.compensation,
      JSON.stringify(policy.cohorts),
      JSON.stringify(policy.fallbacks),
      JSON.stringify(policy.assurance),
      JSON.stringify(policy.buyerPrivacy),
      policy.legalEligibilityRequired,
      policyHash,
      canonicalizeHumanAssuranceDocument(policy),
      createdAt,
    ],
  );
  await client.query(
    `INSERT INTO tokenless_assurance_runs
     (run_id,project_id,suite_id,suite_version,audience_policy_id,audience_policy_version,status,
      policy_hash,manifest_hash,manifest_json,created_by,created_at,updated_at,frozen_at,completed_at)
     VALUES ($1,$2,$3,1,$4,1,'completed',$5,$6,$7,$8,$9,$10,$10,$10)
     ON CONFLICT (run_id) DO NOTHING`,
    [
      runId,
      projectId,
      suiteId,
      policyId,
      policyHash,
      runManifestHash,
      canonicalizeHumanAssuranceDocument(runManifest),
      owner,
      createdAt,
      completedAt,
    ],
  );
  await client.query(
    `INSERT INTO tokenless_assurance_run_cases
     (run_id,case_id,position,variant_a_artifact_id,variant_b_artifact_id,blinding_commitment,
      blinding_secret_json,deterministic_checks_json,deterministic_checks_hash,
      deterministic_checks_status,content_id,admission_policy_hash,round_id,round_status,created_at,updated_at)
     VALUES ($1,$2,1,$3,$4,$5,$6,'[]',$7,'not_applicable',$8,$9,$10,$11,$12,$13)
     ON CONFLICT (run_id,case_id) DO NOTHING`,
    [
      runId,
      caseId,
      text(source, "source_artifact_id"),
      text(source, "suggestion_artifact_id"),
      hashHumanAssuranceDocument(blinding),
      canonicalizeHumanAssuranceDocument(blinding),
      checksHash,
      bytes32({ deliveryId, privateReviewId }),
      admissionPolicyHash,
      paidRoundId,
      paid ? "terminal" : "offchain_complete",
      createdAt,
      completedAt,
    ],
  );
  await client.query(
    `INSERT INTO tokenless_assurance_run_subpanels
     (subpanel_id,workspace_id,project_id,run_id,cohort_id,source,selection,target_count,
      active_reservations,policy_id,policy_version,policy_hash,run_manifest_hash,created_at,
      private_group_id,private_group_policy_version,private_group_policy_hash,
      workspace_reviewer_terms_version,workspace_reviewer_terms_hash)
     VALUES ($1,$2,$3,$4,$5,'customer_invited','customer_named',$6,0,$7,1,$8,$9,$10,$11,$12,$13,$14,$15)
     ON CONFLICT (subpanel_id) DO NOTHING`,
    [
      subpanelId,
      workspaceId,
      projectId,
      runId,
      text(source, "cohort_id"),
      panelSize,
      policyId,
      policyHash,
      runManifestHash,
      createdAt,
      text(source, "private_group_id"),
      integer(source, "private_group_policy_version", 1),
      text(source, "private_group_policy_hash"),
      source.workspace_reviewer_terms_version ?? source.request_reviewer_terms_version ?? null,
      source.workspace_reviewer_terms_hash ?? source.request_reviewer_terms_hash ?? null,
    ],
  );

  for (const value of assignments.rows) {
    const assignment = value as Row;
    const originalAssignmentId = text(assignment, "assignment_id")!;
    const snapshot = {
      schemaVersion: "rateloop.direct-private-review-assurance-snapshot.v1",
      sourceAssignmentId: originalAssignmentId,
      membershipSnapshotHash: text(assignment, "membership_snapshot_hash"),
      qualificationSnapshotHash: hashHumanAssuranceDocument(
        parseJson(assignment.qualification_snapshot_json, "qualification snapshot"),
      ),
    };
    await client.query(
      `INSERT INTO tokenless_assurance_assignments
       (assignment_id,workspace_id,project_id,run_id,subpanel_id,cohort_id,reviewer_account_address,
        source,selection,status,confidentiality_terms_hash,confidentiality_accepted_at,
        qualification_provenance_json,assurance_snapshot_json,assurance_snapshot_hash,blinding_json,
        paid_assignment,paid_eligibility_checked_at,voucher_marker,rater_id,
        reservation_expires_at,assignment_expires_at,
        lease_issuer_account_address,lease_state,created_at,accepted_at,updated_at,
        private_group_id,private_group_policy_version,private_group_policy_hash,
        private_group_membership_joined_at,workspace_reviewer_access_grant_id,
        workspace_reviewer_access_grant_hash,workspace_reviewer_terms_version,workspace_reviewer_terms_hash)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'customer_invited','customer_named',$8,$9,$10,$11,$12,$13,$14,
               $15,$16,$17,$18,$19,$20,$21,'expired',$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32)
       ON CONFLICT (assignment_id) DO NOTHING`,
      [
        projectedId("haa", deliveryId, originalAssignmentId),
        workspaceId,
        projectId,
        runId,
        subpanelId,
        text(source, "cohort_id"),
        text(assignment, "reviewer_account_address"),
        text(assignment, "status"),
        text(source, "private_group_policy_hash"),
        assignment.accepted_at ?? null,
        text(assignment, "qualification_provenance_json") ?? "[]",
        canonicalizeHumanAssuranceDocument(snapshot),
        hashHumanAssuranceDocument(snapshot),
        canonicalizeHumanAssuranceDocument(blinding),
        paid,
        paid ? completedAt : null,
        paid ? text(assignment, "paid_eligibility_snapshot_id") : null,
        paid ? text(assignment, "paid_rater_id") : null,
        assignment.reservation_expires_at,
        assignment.assignment_expires_at ?? null,
        owner,
        assignment.created_at,
        assignment.accepted_at ?? null,
        completedAt,
        text(source, "private_group_id"),
        integer(source, "private_group_policy_version", 1),
        text(source, "private_group_policy_hash"),
        assignment.membership_joined_at,
        assignment.workspace_reviewer_access_grant_id ?? null,
        assignment.workspace_reviewer_access_grant_hash ?? null,
        source.workspace_reviewer_terms_version ?? source.request_reviewer_terms_version ?? null,
        source.workspace_reviewer_terms_hash ?? source.request_reviewer_terms_hash ?? null,
      ],
    );
  }

  for (const value of responses.rows) {
    const response = value as Row;
    const rationaleDigest = text(response, "rationale_digest");
    const projectedRationale =
      response.rationale_ciphertext && response.rationale_key_ref && rationaleDigest
        ? encryptAssuranceRationale(
            {
              caseId,
              digest: rationaleDigest,
              rationale: decryptWorkspaceOwnedRationale({
                ...response,
                run_id: deliveryId,
                case_id: privateReviewId,
              }),
              reviewerKey: text(response, "reviewer_key")!,
              runId,
            },
            getAssuranceResponseKeyrings().rationale,
          )
        : { ciphertext: null, keyRef: null };
    await client.query(
      `INSERT INTO tokenless_assurance_responses
       (response_id,run_id,case_id,reviewer_key,reviewer_source,choice,failure_tag_keys_json,
        rationale_ciphertext,rationale_key_ref,rationale_digest,qualification_keys_json,
        assurance_capabilities_json,response_digest,settlement_reference,validity,submitted_at,updated_at)
       VALUES ($1,$2,$3,$4,'customer_invited',$5,'[]',$6,$7,$8,$9,'[]',$10,$11,'valid',$12,$12)
       ON CONFLICT (response_id) DO NOTHING`,
      [
        projectedId("harp", deliveryId, text(response, "response_id")!),
        runId,
        caseId,
        text(response, "reviewer_key"),
        text(response, "choice") === "positive" ? "candidate" : "baseline",
        projectedRationale.ciphertext,
        projectedRationale.keyRef,
        rationaleDigest,
        JSON.stringify(qualificationKeys(response.qualification_snapshot_json)),
        text(response, "response_commitment"),
        paid ? text(response, "paid_settlement_reference") : null,
        response.created_at,
      ],
    );
  }

  const projectedRun = await client.query(
    `SELECT project_id,status,policy_hash,manifest_hash
     FROM tokenless_assurance_runs WHERE run_id=$1 LIMIT 1`,
    [runId],
  );
  const projectedRunRow = projectedRun.rows[0] as Row | undefined;
  if (
    text(projectedRunRow, "project_id") !== projectId ||
    text(projectedRunRow, "status") !== "completed" ||
    text(projectedRunRow, "policy_hash") !== policyHash ||
    text(projectedRunRow, "manifest_hash") !== runManifestHash
  ) {
    throw new Error("A deterministic private review evidence record conflicts with its frozen source.");
  }
  const projectedCounts = await client.query(
    `SELECT
       (SELECT COUNT(*) FROM tokenless_assurance_run_cases WHERE run_id=$1) AS case_count,
       (SELECT COUNT(*) FROM tokenless_assurance_run_subpanels WHERE run_id=$1) AS subpanel_count,
       (SELECT COUNT(*) FROM tokenless_assurance_assignments WHERE run_id=$1) AS assignment_count,
       (SELECT COUNT(*) FROM tokenless_assurance_responses WHERE run_id=$1) AS response_count`,
    [runId],
  );
  const projectedCountRow = projectedCounts.rows[0] as Row | undefined;
  if (
    integer(projectedCountRow, "case_count") !== 1 ||
    integer(projectedCountRow, "subpanel_count") !== 1 ||
    integer(projectedCountRow, "assignment_count") !== assignments.rows.length ||
    integer(projectedCountRow, "response_count") !== responses.rows.length
  ) {
    throw new Error("The private review evidence projection is incomplete.");
  }

  const linked = await client.query(
    `UPDATE tokenless_agent_review_opportunities
     SET run_id=$1,updated_at=CASE WHEN updated_at<$2 THEN $2 ELSE updated_at END
     WHERE workspace_id=$3 AND opportunity_id=$4 AND run_id IS NULL`,
    [runId, now, workspaceId, text(source, "opportunity_id")],
  );
  if (linked.rowCount !== 1) throw new Error("Private review evidence linkage changed while it was projected.");
  await client.query(
    `UPDATE tokenless_agent_evaluation_observations
     SET run_id=$1
     WHERE workspace_id=$2 AND opportunity_id=$3 AND run_id IS NULL`,
    [runId, workspaceId, text(source, "opportunity_id")],
  );
  return runId;
}

export async function projectDirectPrivateReviewDecisionEvidence(input: {
  deliveryId: string;
  now?: Date;
  packetGenerator?: PacketGenerator;
  signal?: AbortSignal;
}) {
  throwIfMaintenanceCancelled(input.signal);
  const now = input.now ?? new Date();
  const client = await dbPool.connect();
  let workspaceId = "";
  let owner = "";
  let runId = "";
  let projected = false;
  try {
    await client.query("BEGIN");
    throwIfMaintenanceCancelled(input.signal);
    const source = await loadProjectionSource(client, input.deliveryId);
    workspaceId = text(source, "workspace_id")!;
    owner = text(source, "projection_owner")!;
    projected = !text(source, "run_id");
    runId = await insertProjection(client, source, now);
    throwIfMaintenanceCancelled(input.signal);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }

  try {
    throwIfMaintenanceCancelled(input.signal);
    await (input.packetGenerator ?? generateAssuranceEvidencePacket)({
      accountAddress: owner,
      workspaceId,
      runId,
      now,
      signal: input.signal,
    });
    throwIfMaintenanceCancelled(input.signal);
    await dbPool.query(
      `UPDATE tokenless_private_unpaid_review_deliveries
       SET evidence_projection_state='completed',
           evidence_projection_next_attempt_at=NULL,
           evidence_projection_last_error=NULL,
           evidence_projection_claimed_at=NULL,
           evidence_projection_dead_at=NULL
       WHERE delivery_id=$1`,
      [input.deliveryId],
    );
    return { runId, projected, packet: "ready" as const };
  } catch (error) {
    return {
      runId,
      projected,
      packet: "retry" as const,
      error: error instanceof Error ? error.message.slice(0, 500) : "Evidence packet generation failed.",
    };
  }
}

export async function enqueueDirectPrivateReviewEvidenceProjectionInTransaction(
  client: PoolClient,
  input: { deliveryId: string; now: Date },
) {
  return enqueueTokenlessScheduledWorkInTransaction(client, {
    kind: "project_private_review_evidence",
    subjectKey: input.deliveryId,
    now: input.now,
  });
}

export const __directPrivateReviewEvidenceTestUtils = {
  DEADLINE_TERMINAL_REQUIREMENT,
  projectedId,
  qualificationKeys,
  workItemId: (deliveryId: string) => tokenlessScheduledWorkItemId("project_private_review_evidence", deliveryId),
};
