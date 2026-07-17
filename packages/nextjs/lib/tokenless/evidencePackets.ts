import {
  EVIDENCE_AGGREGATION_VERSION,
  EVIDENCE_SCHEMA_VERSION,
  canonicalizeEvidenceValue,
  computeEvidenceAggregation,
  evidenceMerkleRoot,
  evidenceSigningKeyId,
  sha256EvidenceValue,
  verifyEvidenceExport as verifyEvidenceExportCore,
} from "../../scripts/assurance-evidence-core.mjs";
import { type KeyObject, createHmac, createPrivateKey, createPublicKey, randomUUID, sign } from "node:crypto";
import "server-only";
import { isRateLoopPrincipalId, normalizeAccountSubject } from "~~/lib/auth/accountSubject";
import { dbPool } from "~~/lib/db";
import { appendAuditEvent } from "~~/lib/privacy/audit";
import { enqueueAssuranceAttestation } from "~~/lib/tokenless/assuranceAttestationPipeline";
import { decisionExplanationRequired } from "~~/lib/tokenless/decisionPromptSampling";
import { TokenlessServiceError } from "~~/lib/tokenless/server";

type Queryable = { query: (text: string, values?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }> };
type QueryRow = Record<string, unknown>;
type ReviewerSource = "customer_invited" | "rateloop_network";
type ClientDecision = "go" | "revise" | "stop";
type EvidenceSigner = { keyId?: string; privateKey: KeyObject };
type SelectionTriggerKind =
  | "adaptive_sample"
  | "critical_risk"
  | "guardrail_escalation"
  | "maximum_gap"
  | "owner_required"
  | "policy_rule";

type ReviewerSourceCount = {
  source: ReviewerSource;
  targetReviewerCount: number;
  assignedReviewerCount: number;
  paidReviewerCount: number;
  respondingReviewerCount: number;
  completeJudgmentSetReviewerCount: number;
};

type CaseJudgmentCount = {
  source?: ReviewerSource;
  targetReviewerCount: number;
  assignedReviewerCount: number;
  candidate: number;
  baseline: number;
  tie: number;
  invalidJudgmentCount: number;
  pendingJudgmentCount: number;
};

type EvidenceExport = {
  payload: Record<string, any>;
  signing: { algorithm: "Ed25519"; keyId: string; publicKey: string };
  packetDigest: string;
  signature: string;
};

const HASH_PATTERN = /^sha256:[0-9a-f]{64}$/;
const SOURCES = new Set<ReviewerSource>(["customer_invited", "rateloop_network"]);
const WRITE_ROLES = new Set(["owner", "admin", "member"]);
const SELECTION_POLICY_MODES = new Set(["manual", "always", "fixed", "rules", "adaptive"]);
const TERMINAL_REVIEW_STATES = new Set(["completed", "inconclusive", "failed_terminal", "cancelled_before_commit"]);

function rowString(row: QueryRow | undefined, key: string) {
  const value = row?.[key];
  return value === null || value === undefined ? null : String(value);
}

function rowNumber(row: QueryRow | undefined, key: string) {
  const value = row?.[key];
  const number = typeof value === "number" ? value : Number(value);
  if (!Number.isSafeInteger(number)) throw new Error(`Database returned an invalid ${key}.`);
  return number;
}

function rowPositiveNumber(row: QueryRow | undefined, key: string) {
  const value = rowNumber(row, key);
  if (value < 1) throw new Error(`Database returned an invalid ${key}.`);
  return value;
}

function rowBps(row: QueryRow | undefined, key: string) {
  const value = rowNumber(row, key);
  if (value < 0 || value > 10_000) throw new Error(`Database returned an invalid ${key}.`);
  return value;
}

function rowSampleBucket(row: QueryRow | undefined, key: string) {
  const value = rowNumber(row, key);
  if (value < 0 || value > 9_999) throw new Error(`Database returned an invalid ${key}.`);
  return value;
}

function rowDate(row: QueryRow | undefined, key: string) {
  const value = row?.[key];
  const date = value instanceof Date ? value : new Date(String(value));
  if (!Number.isFinite(date.getTime())) throw new Error(`Database returned an invalid ${key}.`);
  return date;
}

function parseJson<T>(value: unknown, name: string): T {
  try {
    return JSON.parse(String(value)) as T;
  } catch {
    throw new TokenlessServiceError(`${name} is invalid.`, 409, "assurance_evidence_source_invalid");
  }
}

function persistedReasonCodes(value: unknown) {
  const reasons = parseJson<unknown>(value, "Review selection reasons");
  if (
    !Array.isArray(reasons) ||
    reasons.length === 0 ||
    reasons.some(reason => typeof reason !== "string" || !/^[a-z0-9][a-z0-9_]{0,63}$/u.test(reason))
  ) {
    evidenceError("Persisted review selection reasons are invalid.", "assurance_evidence_source_invalid");
  }
  return [...new Set(reasons)].sort();
}

function primarySelectionTrigger(reasons: string[], automatedTrigger: string | null): SelectionTriggerKind {
  if (automatedTrigger === "guardrail_uncertain") return "guardrail_escalation";
  if (reasons.includes("critical_risk")) return "critical_risk";
  if (reasons.includes("maximum_gap")) return "maximum_gap";
  if (reasons.includes("sampled") || reasons.includes("calibrating")) return "adaptive_sample";
  if (
    reasons.some(reason =>
      ["always_review", "low_confidence", "missing_metadata", "policy_reset", "rules_match"].includes(reason),
    )
  ) {
    return "policy_rule";
  }
  return "owner_required";
}

function normalizeAddress(value: string) {
  try {
    return normalizeAccountSubject(value);
  } catch {
    throw new TokenlessServiceError("A valid signed-in account is required.", 400, "invalid_account");
  }
}

function evidenceError(message: string, code = "assurance_evidence_unavailable", status = 409): never {
  throw new TokenlessServiceError(message, status, code);
}

function parseSigningKey(value: string) {
  try {
    if (value.includes("BEGIN PRIVATE KEY")) return createPrivateKey(value);
    return createPrivateKey({ key: Buffer.from(value, "base64url"), format: "der", type: "pkcs8" });
  } catch {
    throw new TokenlessServiceError(
      "The evidence signing key is invalid.",
      503,
      "assurance_evidence_signing_unavailable",
      true,
    );
  }
}

function loadEvidenceSigner(): EvidenceSigner {
  const encoded = process.env.TOKENLESS_EVIDENCE_SIGNING_PRIVATE_KEY?.trim();
  if (!encoded) {
    throw new TokenlessServiceError(
      "Evidence packet signing is unavailable.",
      503,
      "assurance_evidence_signing_unavailable",
      true,
    );
  }
  return {
    keyId: process.env.TOKENLESS_EVIDENCE_SIGNING_KEY_ID?.trim() || undefined,
    privateKey: parseSigningKey(encoded),
  };
}

function signingMetadata(signer: EvidenceSigner) {
  if (signer.privateKey.asymmetricKeyType !== "ed25519") {
    throw new TokenlessServiceError(
      "Evidence packets require a dedicated Ed25519 signing key.",
      503,
      "assurance_evidence_signing_unavailable",
      true,
    );
  }
  const publicKey = createPublicKey(signer.privateKey).export({ format: "der", type: "spki" }).toString("base64url");
  const derivedKeyId = evidenceSigningKeyId(publicKey);
  if (signer.keyId && signer.keyId !== derivedKeyId) {
    throw new TokenlessServiceError(
      "Evidence signing key IDs must equal the public-key fingerprint.",
      503,
      "assurance_evidence_signing_unavailable",
      true,
    );
  }
  return { algorithm: "Ed25519" as const, keyId: derivedKeyId, publicKey };
}

function loadTenantCommitmentKey(value?: Buffer) {
  if (value && value.byteLength >= 32) return value;
  if (value) {
    evidenceError("The tenant commitment key is too short.", "assurance_evidence_signing_unavailable", 503);
  }
  const encoded = process.env.TOKENLESS_EVIDENCE_TENANT_COMMITMENT_KEY?.trim();
  const key = encoded ? Buffer.from(encoded, "base64url") : Buffer.alloc(0);
  if (key.byteLength < 32) {
    evidenceError("Evidence tenant commitments are unavailable.", "assurance_evidence_signing_unavailable", 503);
  }
  return key;
}

function tenantCommitment(workspaceId: string, key: Buffer) {
  return `hmac-sha256:${createHmac("sha256", key).update(workspaceId).digest("hex")}`;
}

/**
 * Shared run-access gate: workspace write roles for reads, and the decision
 * gate (owner, admin, or `decision_owner` governance role) when
 * `options.decision` is set. Exported for oversight surfaces that must apply
 * exactly the same boundary — never reimplement it.
 */
export async function loadRunAccess(
  client: Queryable,
  input: { accountAddress: string; workspaceId: string; runId: string },
  options: { lock?: boolean; decision?: boolean } = {},
) {
  const address = normalizeAddress(input.accountAddress);
  const result = await client.query(
    `SELECT r.*, p.workspace_id, p.data_classification,
            m.role AS workspace_role, g.governance_role,
            s.manifest_hash AS suite_manifest_hash, s.manifest_json AS suite_manifest_json,
            ap.policy_hash AS frozen_policy_hash, ap.policy_json,
            rb.pass_rule_json
     FROM tokenless_assurance_runs r
     JOIN tokenless_assurance_projects p ON p.project_id = r.project_id
     JOIN tokenless_workspaces w ON w.workspace_id = p.workspace_id AND w.status = 'active'
     JOIN tokenless_workspace_members m ON m.workspace_id = p.workspace_id AND m.account_address = $1
     LEFT JOIN tokenless_workspace_member_governance g
       ON g.workspace_id = m.workspace_id AND g.account_address = m.account_address
     JOIN tokenless_assurance_suites s ON s.suite_id = r.suite_id AND s.version = r.suite_version
     JOIN tokenless_assurance_audience_policies ap
       ON ap.policy_id = r.audience_policy_id AND ap.version = r.audience_policy_version
     JOIN tokenless_assurance_rubrics rb ON rb.rubric_id = s.rubric_id AND rb.version = s.rubric_version
     WHERE r.run_id = $2 AND p.workspace_id = $3
     LIMIT 1${options.lock ? " FOR UPDATE" : ""}`,
    [address, input.runId, input.workspaceId],
  );
  const row = result.rows[0];
  if (!row) evidenceError("Assurance run not found.", "assurance_run_not_found", 404);
  const role = rowString(row, "workspace_role");
  if (!WRITE_ROLES.has(role ?? "")) {
    evidenceError("Assurance run not found.", "assurance_run_not_found", 404);
  }
  if (
    options.decision &&
    role !== "owner" &&
    role !== "admin" &&
    rowString(row, "governance_role") !== "decision_owner"
  ) {
    evidenceError("A decision owner must sign off on this packet.", "assurance_decision_forbidden", 403);
  }
  return { row, address };
}

function requireFrozenSource(row: QueryRow) {
  const runManifestHash = rowString(row, "manifest_hash");
  const suiteManifestHash = rowString(row, "suite_manifest_hash");
  const policyHash = rowString(row, "policy_hash");
  const frozenPolicyHash = rowString(row, "frozen_policy_hash");
  if (
    rowString(row, "status") !== "completed" ||
    !runManifestHash ||
    !suiteManifestHash ||
    !policyHash ||
    policyHash !== frozenPolicyHash ||
    !HASH_PATTERN.test(runManifestHash) ||
    !HASH_PATTERN.test(suiteManifestHash) ||
    !HASH_PATTERN.test(policyHash)
  ) {
    evidenceError("Only a completed run with exact frozen manifests can produce evidence.");
  }
  const runManifest = parseJson<Record<string, any>>(row.manifest_json, "Run manifest");
  const suiteManifest = parseJson<Record<string, any>>(row.suite_manifest_json, "Suite manifest");
  const policy = parseJson<Record<string, any>>(row.policy_json, "Audience policy");
  if (
    sha256EvidenceValue(runManifest) !== runManifestHash ||
    sha256EvidenceValue(suiteManifest) !== suiteManifestHash ||
    sha256EvidenceValue(policy) !== policyHash
  ) {
    evidenceError("A frozen evidence source no longer matches its hash.", "assurance_evidence_hash_mismatch");
  }
  return { runManifestHash, suiteManifestHash, policyHash, runManifest, suiteManifest, policy };
}

async function persistedReviewContext(client: Queryable, input: { workspaceId: string; runId: string }) {
  const result = await client.query(
    `SELECT o.opportunity_id, o.policy_id AS selection_policy_id,
            o.policy_version AS selection_policy_version, o.reason_codes_json,
            o.selection_probability_bps, o.sample_bucket,
            o.request_profile_id, o.request_profile_version, o.request_profile_hash,
            rp.mode AS selection_policy_mode, rp.rules_json,
            escalation.trigger_kind AS automated_trigger_kind,
            lifecycle.state AS lifecycle_state, lifecycle.state_revision AS lifecycle_revision,
            event.event_id AS transition_event_id, event.transition_commitment
     FROM tokenless_agent_review_opportunities o
     JOIN tokenless_agent_review_policies rp
       ON rp.workspace_id = o.workspace_id AND rp.policy_id = o.policy_id AND rp.version = o.policy_version
     JOIN tokenless_agent_review_opportunity_lifecycles lifecycle
       ON lifecycle.workspace_id = o.workspace_id AND lifecycle.opportunity_id = o.opportunity_id
     LEFT JOIN tokenless_assurance_automated_eval_escalations escalation
       ON escalation.workspace_id = o.workspace_id AND escalation.opportunity_id = o.opportunity_id
     LEFT JOIN tokenless_agent_review_opportunity_transition_events event
       ON event.workspace_id = lifecycle.workspace_id AND event.opportunity_id = lifecycle.opportunity_id
      AND event.to_revision = lifecycle.state_revision
     WHERE o.workspace_id = $1 AND o.run_id = $2
     LIMIT 2`,
    [input.workspaceId, input.runId],
  );
  if (result.rows.length > 1) {
    evidenceError("An assurance run has ambiguous persisted review context.", "assurance_evidence_source_invalid");
  }
  const row = result.rows[0];
  if (!row) {
    return {
      selectionTrigger: {
        kind: "owner_required" as const,
        source: "explicit_workspace_assurance_run" as const,
        reasonCodes: ["explicit_workspace_assurance_run"],
      },
      gate: {
        type: "not_applicable" as const,
        policyReference: null,
        stopGateEvidenceReference: null,
        statement: "This workspace-started assurance run was not bound to an agent output stop gate.",
      },
      versions: {
        selectionPolicy: null,
        requestProfile: null,
      },
    };
  }
  const opportunityId = rowString(row, "opportunity_id");
  const policyId = rowString(row, "selection_policy_id");
  const policyMode = rowString(row, "selection_policy_mode");
  const requestProfileId = rowString(row, "request_profile_id");
  const requestProfileHash = rowString(row, "request_profile_hash");
  const lifecycleState = rowString(row, "lifecycle_state");
  const transitionEventId = rowString(row, "transition_event_id");
  const transitionCommitment = rowString(row, "transition_commitment");
  const automatedTriggerKind = rowString(row, "automated_trigger_kind");
  const rules = parseJson<Record<string, unknown>>(row.rules_json, "Review selection policy rules");
  const enforcementMode = rules.enforcementMode;
  if (
    !opportunityId ||
    !policyId ||
    !policyMode ||
    !SELECTION_POLICY_MODES.has(policyMode) ||
    !requestProfileId ||
    !requestProfileHash ||
    !HASH_PATTERN.test(requestProfileHash) ||
    !lifecycleState ||
    !TERMINAL_REVIEW_STATES.has(lifecycleState) ||
    !transitionEventId ||
    !transitionCommitment ||
    !HASH_PATTERN.test(transitionCommitment) ||
    (automatedTriggerKind !== null && automatedTriggerKind !== "guardrail_uncertain") ||
    (enforcementMode !== "advisory" && enforcementMode !== "host_enforced")
  ) {
    evidenceError("Persisted agent review context is incomplete.", "assurance_evidence_source_invalid");
  }
  const reasonCodes = persistedReasonCodes(row.reason_codes_json);
  const lifecycleRevision = rowPositiveNumber(row, "lifecycle_revision");
  const selectionPolicyVersion = rowPositiveNumber(row, "selection_policy_version");
  const gateType = enforcementMode === "host_enforced" ? ("blocking" as const) : ("advisory" as const);
  return {
    selectionTrigger: {
      kind: primarySelectionTrigger(reasonCodes, automatedTriggerKind),
      source: "persisted_agent_review_opportunity" as const,
      opportunityId,
      reasonCodes,
      selectionProbabilityBps: rowBps(row, "selection_probability_bps"),
      sampleBucket: rowSampleBucket(row, "sample_bucket"),
    },
    gate: {
      type: gateType,
      policyReference: {
        id: policyId,
        version: selectionPolicyVersion,
        enforcementMode,
      },
      stopGateEvidenceReference: {
        kind: "human_review_lifecycle_transition" as const,
        opportunityId,
        lifecycleState,
        lifecycleRevision,
        transitionEventId,
        transitionCommitment,
      },
      statement:
        gateType === "blocking"
          ? "The policy required host enforcement and is bound to the persisted review lifecycle; this packet does not independently prove that the host blocked output."
          : "The advisory review lifecycle is recorded but does not itself prove that the host blocked output.",
    },
    versions: {
      selectionPolicy: {
        id: policyId,
        version: selectionPolicyVersion,
        mode: policyMode,
      },
      requestProfile: {
        id: requestProfileId,
        version: rowPositiveNumber(row, "request_profile_version"),
        hash: requestProfileHash,
      },
    },
  };
}

function admissionPolicyVersions(input: {
  runManifest: Record<string, any>;
  caseRows: QueryRow[];
  audiencePolicy: { id: string | null; version: number; hash: string };
}) {
  const admissionPolicyHash = input.runManifest.audiencePolicy?.admissionPolicyHash;
  const caseHashes = [...new Set(input.caseRows.map(row => rowString(row, "admission_policy_hash")))];
  if (
    typeof admissionPolicyHash !== "string" ||
    !/^0x[0-9a-f]{64}$/u.test(admissionPolicyHash) ||
    caseHashes.length !== 1 ||
    caseHashes[0] !== admissionPolicyHash ||
    !input.audiencePolicy.id
  ) {
    evidenceError("Admission policy linkage does not match the frozen run.", "assurance_evidence_hash_mismatch");
  }
  return [
    {
      admissionPolicyHash,
      derivedFrom: {
        kind: "assurance_audience_policy" as const,
        id: input.audiencePolicy.id,
        version: input.audiencePolicy.version,
        hash: input.audiencePolicy.hash,
      },
    },
  ];
}

function reviewerSource(value: unknown): ReviewerSource {
  const source = String(value) as ReviewerSource;
  if (!SOURCES.has(source)) evidenceError("A reviewer source is invalid.", "assurance_evidence_source_invalid");
  return source;
}

function caseLeaf(row: QueryRow) {
  return sha256EvidenceValue({
    admissionPolicyHash: rowString(row, "admission_policy_hash"),
    caseId: rowString(row, "case_id"),
    contentId: rowString(row, "content_id"),
    deterministicChecksHash: rowString(row, "deterministic_checks_hash"),
    deterministicChecksStatus: rowString(row, "deterministic_checks_status"),
    position: rowNumber(row, "position"),
    roundId: rowString(row, "round_id"),
    roundStatus: rowString(row, "round_status"),
  });
}

function responseLeaf(row: QueryRow) {
  return sha256EvidenceValue({
    caseId: rowString(row, "case_id"),
    choice: rowString(row, "choice"),
    failureTagKeys: parseJson<string[]>(row.failure_tag_keys_json, "Failure tags"),
    qualificationKeys: parseJson<string[]>(row.qualification_keys_json, "Qualifications"),
    responseDigest: rowString(row, "response_digest"),
    reviewerSource: reviewerSource(row.reviewer_source),
    settlementReference: rowString(row, "settlement_reference"),
    validity: rowString(row, "validity"),
  });
}

function rationaleDigest(row: QueryRow) {
  const ciphertext = rowString(row, "rationale_ciphertext");
  if (!ciphertext) return null;
  return sha256EvidenceValue({
    ciphertext,
    keyRef: rowString(row, "rationale_key_ref"),
    responseDigest: rowString(row, "response_digest"),
  });
}

async function collectAggregationInputs(
  client: Queryable,
  runId: string,
  runCases: QueryRow[],
  responses: QueryRow[],
  policy: Record<string, any>,
) {
  const [subpanelResult, assignmentResult] = await Promise.all([
    client.query(
      `SELECT source, SUM(target_count) AS target_count
       FROM tokenless_assurance_run_subpanels WHERE run_id = $1 GROUP BY source ORDER BY source ASC`,
      [runId],
    ),
    client.query(
      `SELECT source, reviewer_account_address, paid_assignment
       FROM tokenless_assurance_assignments WHERE run_id = $1`,
      [runId],
    ),
  ]);
  const reviewerCounts = new Map<
    ReviewerSource,
    {
      source: ReviewerSource;
      targetReviewerCount: number;
      assignedReviewers: Set<string>;
      paidReviewers: Set<string>;
      respondingReviewers: Set<string>;
      responseCasesByReviewer: Map<string, Set<string>>;
    }
  >();
  for (const row of subpanelResult.rows) {
    const source = reviewerSource(row.source);
    reviewerCounts.set(source, {
      source,
      targetReviewerCount: rowNumber(row, "target_count"),
      assignedReviewers: new Set(),
      paidReviewers: new Set(),
      respondingReviewers: new Set(),
      responseCasesByReviewer: new Map(),
    });
  }
  if (reviewerCounts.size === 0) evidenceError("The run has no frozen source subpanels.");
  let paidAssignments = 0;
  for (const row of assignmentResult.rows) {
    const source = reviewerSource(row.source);
    const reviewerCount = reviewerCounts.get(source);
    if (!reviewerCount) evidenceError("An assignment is outside the frozen source subpanels.");
    const reviewer = rowString(row, "reviewer_account_address");
    if (!reviewer) evidenceError("An assignment has no reviewer.", "assurance_evidence_source_invalid");
    reviewerCount.assignedReviewers.add(reviewer);
    if (row.paid_assignment === true) {
      reviewerCount.paidReviewers.add(reviewer);
      paidAssignments += 1;
    }
  }
  const caseIds = new Set(runCases.map(runCase => rowString(runCase, "case_id")!));
  const emptyCaseCount = (source?: ReviewerSource): CaseJudgmentCount => ({
    ...(source ? { source } : {}),
    targetReviewerCount: source
      ? reviewerCounts.get(source)!.targetReviewerCount
      : [...reviewerCounts.values()].reduce((total, entry) => total + entry.targetReviewerCount, 0),
    assignedReviewerCount: source
      ? reviewerCounts.get(source)!.assignedReviewers.size
      : [...reviewerCounts.values()].reduce((total, entry) => total + entry.assignedReviewers.size, 0),
    candidate: 0,
    baseline: 0,
    tie: 0,
    invalidJudgmentCount: 0,
    pendingJudgmentCount: 0,
  });
  const caseCounts = new Map<
    string,
    { caseId: string; overall: CaseJudgmentCount; sourceCounts: Map<ReviewerSource, CaseJudgmentCount> }
  >();
  for (const caseId of caseIds) {
    caseCounts.set(caseId, {
      caseId,
      overall: emptyCaseCount(),
      sourceCounts: new Map([...reviewerCounts.keys()].map(source => [source, emptyCaseCount(source)])),
    });
  }
  const failureTags = new Map<string, number>();
  const rationaleDigests: string[] = [];
  for (const row of responses) {
    const caseId = rowString(row, "case_id");
    const reviewerKey = rowString(row, "reviewer_key");
    const caseCount = caseId ? caseCounts.get(caseId) : undefined;
    if (!caseId || !reviewerKey || !caseCount) {
      evidenceError("A response is outside the frozen run cases.", "assurance_evidence_source_invalid");
    }
    const source = reviewerSource(row.reviewer_source);
    const reviewerCount = reviewerCounts.get(source);
    const sourceCaseCount = caseCount.sourceCounts.get(source);
    if (!reviewerCount || !sourceCaseCount) evidenceError("A response is outside the frozen source subpanels.");
    reviewerCount.respondingReviewers.add(reviewerKey);
    const reviewerCases = reviewerCount.responseCasesByReviewer.get(reviewerKey) ?? new Set<string>();
    reviewerCases.add(caseId);
    reviewerCount.responseCasesByReviewer.set(reviewerKey, reviewerCases);
    const validity = rowString(row, "validity");
    if (validity === "valid") {
      const choice = rowString(row, "choice");
      if (choice !== "candidate" && choice !== "baseline" && choice !== "tie") {
        evidenceError("A valid response has an unsupported choice.", "assurance_evidence_source_invalid");
      }
      caseCount.overall[choice] += 1;
      sourceCaseCount[choice] += 1;
      for (const key of parseJson<string[]>(row.failure_tag_keys_json, "Failure tags")) {
        failureTags.set(key, (failureTags.get(key) ?? 0) + 1);
      }
    } else if (validity === "invalid" || validity === "withdrawn") {
      caseCount.overall.invalidJudgmentCount += 1;
      sourceCaseCount.invalidJudgmentCount += 1;
    } else if (validity === "pending") {
      caseCount.overall.pendingJudgmentCount += 1;
      sourceCaseCount.pendingJudgmentCount += 1;
    } else {
      evidenceError("A response has an unsupported validity state.", "assurance_evidence_source_invalid");
    }
    const digest = rationaleDigest(row);
    if (digest) rationaleDigests.push(digest);
  }
  const publicReviewerCounts: ReviewerSourceCount[] = [...reviewerCounts.values()]
    .sort((left, right) => left.source.localeCompare(right.source))
    .map(entry => ({
      source: entry.source,
      targetReviewerCount: entry.targetReviewerCount,
      assignedReviewerCount: entry.assignedReviewers.size,
      paidReviewerCount: entry.paidReviewers.size,
      respondingReviewerCount: entry.respondingReviewers.size,
      completeJudgmentSetReviewerCount: [...entry.responseCasesByReviewer.values()].filter(
        reviewerCases => reviewerCases.size === caseIds.size,
      ).length,
    }));
  const minimumAggregationSize = Number(policy.buyerPrivacy?.minimumAggregationSize);
  if (!Number.isSafeInteger(minimumAggregationSize) || minimumAggregationSize < 1 || minimumAggregationSize > 10_000) {
    evidenceError("The frozen minimum aggregation size is invalid.", "assurance_evidence_source_invalid");
  }
  return {
    reviewerCounts: publicReviewerCounts,
    caseCounts: [...caseCounts.values()].sort((left, right) => left.caseId.localeCompare(right.caseId)),
    minimumAggregationSize,
    paidAssignments,
    failureTagCounts: [...failureTags.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, count]) => ({ key, count })),
    rationaleDigests: rationaleDigests.sort(),
  };
}

function privacySafeRecomputation(
  reviewerCounts: ReviewerSourceCount[],
  caseCounts: { caseId: string; overall: CaseJudgmentCount; sourceCounts: Map<ReviewerSource, CaseJudgmentCount> }[],
  minimumAggregationSize: number,
) {
  const safeCaseEntry = (entry: CaseJudgmentCount) => {
    const validReviewerCount = entry.candidate + entry.baseline + entry.tie;
    const common = {
      ...(entry.source ? { source: entry.source } : {}),
      targetReviewerCount: entry.targetReviewerCount,
      assignedReviewerCount: entry.assignedReviewerCount,
      validReviewerCount,
      invalidJudgmentCount: entry.invalidJudgmentCount,
      pendingJudgmentCount: entry.pendingJudgmentCount,
      suppressed: validReviewerCount < minimumAggregationSize,
    };
    return common.suppressed
      ? common
      : { ...common, candidate: entry.candidate, baseline: entry.baseline, tie: entry.tie };
  };
  return {
    reviewerSources: reviewerCounts,
    cases: caseCounts.map(entry => ({
      caseId: entry.caseId,
      overall: safeCaseEntry(entry.overall),
      sourceCounts: [...entry.sourceCounts.values()]
        .sort((left, right) => left.source!.localeCompare(right.source!))
        .map(safeCaseEntry),
    })),
  };
}

function privacySafeQualificationCounts(responses: QueryRow[], minimumAggregationSize: number) {
  const qualificationsByReviewer = new Map<string, string[]>();
  for (const response of responses) {
    const reviewerKey = rowString(response, "reviewer_key");
    if (!reviewerKey) evidenceError("A response has no reviewer key.", "assurance_evidence_source_invalid");
    const qualifications = [...new Set(parseJson<string[]>(response.qualification_keys_json, "Qualifications"))].sort();
    if (qualifications.some(value => typeof value !== "string" || value.length === 0)) {
      evidenceError("A reviewer qualification is invalid.", "assurance_evidence_source_invalid");
    }
    const previous = qualificationsByReviewer.get(reviewerKey);
    if (previous && canonicalizeEvidenceValue(previous) !== canonicalizeEvidenceValue(qualifications)) {
      evidenceError("A reviewer's frozen qualifications changed within the run.", "assurance_evidence_source_invalid");
    }
    qualificationsByReviewer.set(reviewerKey, qualifications);
  }
  const reviewersByQualification = new Map<string, Set<string>>();
  let unqualifiedReviewerCount = 0;
  for (const [reviewerKey, qualifications] of qualificationsByReviewer) {
    if (qualifications.length === 0) unqualifiedReviewerCount += 1;
    for (const qualification of qualifications) {
      const reviewers = reviewersByQualification.get(qualification) ?? new Set<string>();
      reviewers.add(reviewerKey);
      reviewersByQualification.set(qualification, reviewers);
    }
  }
  const privacySafeCount = (count: number) => ({
    suppressed: count < minimumAggregationSize,
    ...(count >= minimumAggregationSize ? { reviewerCount: count } : {}),
  });
  return {
    taxonomy: "explicit_qualification_categories",
    orderedTiers: false,
    minimumAggregationSize,
    categories: [...reviewersByQualification.entries()]
      .filter(([, reviewers]) => reviewers.size >= minimumAggregationSize)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, reviewers]) => ({ key, ...privacySafeCount(reviewers.size) })),
    unqualified: privacySafeCount(unqualifiedReviewerCount),
  };
}

function periodCoverage(row: QueryRow, responses: QueryRow[], aggregation: Record<string, any>) {
  const startedAt = rowDate(row, "created_at");
  const endedAt = rowDate(row, "completed_at");
  if (endedAt < startedAt) evidenceError("The assurance period is invalid.", "assurance_evidence_source_invalid");
  const latencies = responses
    .map(response => rowDate(response, "submitted_at").getTime() - startedAt.getTime())
    .sort((left, right) => left - right);
  if (latencies.some(latency => latency < 0)) {
    evidenceError("A response predates the assurance period.", "assurance_evidence_source_invalid");
  }
  const percentile = (numerator: number, denominator: number) =>
    latencies.length === 0 ? null : latencies[Math.ceil((latencies.length * numerator) / denominator) - 1];
  return {
    startInclusive: startedAt.toISOString(),
    endInclusive: endedAt.toISOString(),
    durationMs: endedAt.getTime() - startedAt.getTime(),
    coverage: {
      caseCount: aggregation.judgmentCoverage.caseCount,
      targetExpectedJudgmentCount: aggregation.judgmentCoverage.targetExpectedJudgmentCount,
      submittedJudgmentCount: aggregation.judgmentCoverage.submittedJudgmentCount,
      respondingReviewerCount: aggregation.reviewerCoverage.respondingReviewerCount,
      targetReviewerCount: aggregation.reviewerCoverage.targetReviewerCount,
    },
    responseSubmissionLatencyFromPeriodStartMs: {
      count: latencies.length,
      minimum: latencies[0] ?? null,
      median: percentile(1, 2),
      p95: percentile(95, 100),
      maximum: latencies.at(-1) ?? null,
    },
  };
}

function passRuleFrom(row: QueryRow, runManifest: Record<string, any>) {
  const passRule = runManifest.rubric?.passRule ?? parseJson<Record<string, any>>(row.pass_rule_json, "Pass rule");
  if (
    passRule?.metric !== "candidate_preference_share_bps" ||
    passRule?.operator !== "gte" ||
    !Number.isSafeInteger(passRule.thresholdBps) ||
    !Number.isSafeInteger(passRule.minimumValidResponses)
  ) {
    evidenceError("The frozen pass rule is unsupported.", "assurance_evidence_source_invalid");
  }
  return {
    metric: "candidate_preference_share_bps",
    operator: "gte",
    thresholdBps: passRule.thresholdBps,
    minimumValidResponses: passRule.minimumValidResponses,
  };
}

async function collectChainEvidence(client: Queryable, runCases: QueryRow[]) {
  const rounds: Record<string, unknown>[] = [];
  for (const runCase of runCases) {
    const roundId = rowString(runCase, "round_id");
    const entry: Record<string, unknown> = {
      caseId: rowString(runCase, "case_id"),
      contentId: rowString(runCase, "content_id"),
      admissionPolicyHash: rowString(runCase, "admission_policy_hash"),
      roundId,
      roundStatus: rowString(runCase, "round_status"),
      execution: null,
      indexedEvents: [],
    };
    if (roundId) {
      const executionResult = await client.query(
        `SELECT operation_key, deployment_key, deployment_block, chain_id, panel_address,
                submission_transaction_hash, receipt_block_number, receipt_block_hash, state
         FROM tokenless_chain_executions
         WHERE content_id = $1 AND round_id = $2 ORDER BY created_at DESC LIMIT 1`,
        [rowString(runCase, "content_id"), roundId],
      );
      const execution = executionResult.rows[0];
      if (execution) {
        const eventResult = await client.query(
          `SELECT sequence, event_type, evidence_hash, occurred_at
           FROM tokenless_transparency_events WHERE operation_key = $1 ORDER BY sequence ASC`,
          [rowString(execution, "operation_key")],
        );
        entry.execution = {
          operationKey: rowString(execution, "operation_key"),
          deploymentKey: rowString(execution, "deployment_key"),
          deploymentBlock: rowString(execution, "deployment_block"),
          chainId: rowNumber(execution, "chain_id"),
          panelAddress: rowString(execution, "panel_address"),
          roundCreationTransactionHash: rowString(execution, "submission_transaction_hash"),
          receiptBlockNumber: rowString(execution, "receipt_block_number"),
          receiptBlockHash: rowString(execution, "receipt_block_hash"),
          state: rowString(execution, "state"),
        };
        entry.indexedEvents = eventResult.rows.map(event => ({
          sequence: rowNumber(event, "sequence"),
          eventType: rowString(event, "event_type"),
          evidenceHash: rowString(event, "evidence_hash"),
          occurredAt: new Date(String(event.occurred_at)).toISOString(),
        }));
      }
    }
    rounds.push(entry);
  }
  return rounds;
}

function settlementSummary(input: {
  chainEvidence: Record<string, any>[];
  paidAssignments: number;
  policy: Record<string, any>;
  reviewerCounts: ReviewerSourceCount[];
  responses: QueryRow[];
}) {
  const paidSources = new Set(
    input.reviewerCounts.filter(entry => entry.paidReviewerCount > 0).map(entry => entry.source),
  );
  const links = new Set<string>();
  for (const response of input.responses) {
    const reference = rowString(response, "settlement_reference");
    if (reference && paidSources.has(reviewerSource(response.reviewer_source))) links.add(reference);
  }
  const unpaidInvited =
    input.paidAssignments === 0 &&
    input.policy.compensation === "unpaid" &&
    input.reviewerCounts.every(entry => entry.source === "customer_invited");
  if (unpaidInvited) {
    return {
      mode: "no_onchain_settlement_unpaid_invited",
      statement: "This invited panel was unpaid; there is no on-chain settlement for this evidence packet.",
      links: [],
    };
  }
  if (input.paidAssignments === 0) {
    return {
      mode: "no_onchain_settlement_unpaid",
      statement: "This run has no paid assignments and therefore no on-chain settlement.",
      links: [],
    };
  }
  return {
    mode: links.size > 0 ? "onchain_evidence_recorded" : "onchain_evidence_pending",
    statement:
      links.size > 0
        ? "Settlement references are linked to deployment-pinned chain evidence."
        : "Paid assignments exist, but settlement evidence has not reached a recorded terminal state.",
    links: [...links].sort(),
  };
}

function isTerminalIndexedEvent(eventType: unknown) {
  return eventType === "RoundTerminal" || eventType === "round.terminal" || eventType === "round.finalized";
}

function assertTerminalPacket(input: {
  aggregation: Record<string, any>;
  chainEvidence: Record<string, any>[];
  paidAssignments: number;
  policy: Record<string, any>;
  responses: QueryRow[];
  runCases: QueryRow[];
}) {
  const reviewerCoverage = input.aggregation.reviewerCoverage;
  if (
    reviewerCoverage.assignedReviewerCount !== reviewerCoverage.targetReviewerCount ||
    reviewerCoverage.respondingReviewerCount !== reviewerCoverage.targetReviewerCount ||
    reviewerCoverage.completeJudgmentSetReviewerCount !== reviewerCoverage.targetReviewerCount
  ) {
    evidenceError(
      "The frozen reviewer target and complete reviewer count must match before evidence is generated.",
      "assurance_run_not_terminal",
    );
  }
  const judgmentCoverage = input.aggregation.judgmentCoverage;
  if (
    judgmentCoverage.submittedJudgmentCount !== judgmentCoverage.targetExpectedJudgmentCount ||
    judgmentCoverage.validJudgmentCount !== judgmentCoverage.targetExpectedJudgmentCount ||
    judgmentCoverage.invalidJudgmentCount !== 0 ||
    judgmentCoverage.missingTargetJudgmentCount !== 0 ||
    judgmentCoverage.pendingJudgmentCount !== 0
  ) {
    evidenceError(
      "Every targeted reviewer must submit one valid terminal judgment for every frozen case.",
      "assurance_run_not_terminal",
    );
  }
  const sourceSubpanels = reviewerCoverage.sourceSubpanels as Record<string, any>[];
  const paidSourceSubpanels = sourceSubpanels.filter(entry => entry.paidReviewerCount > 0);
  const paidReviewerCount = sourceSubpanels.reduce((total, entry) => total + entry.paidReviewerCount, 0);
  if (
    paidReviewerCount !== input.paidAssignments ||
    paidSourceSubpanels.some(entry => entry.paidReviewerCount !== entry.assignedReviewerCount)
  ) {
    evidenceError(
      "A frozen reviewer source cannot mix paid and unpaid assignments.",
      "assurance_settlement_evidence_invalid",
    );
  }
  if (
    (input.policy.compensation === "unpaid" && paidSourceSubpanels.length !== 0) ||
    (input.policy.compensation === "paid" && paidSourceSubpanels.length !== sourceSubpanels.length) ||
    (input.policy.compensation === "mixed" &&
      (paidSourceSubpanels.length === 0 || paidSourceSubpanels.length === sourceSubpanels.length))
  ) {
    evidenceError("Assignment compensation does not match the frozen policy.", "assurance_settlement_evidence_invalid");
  }
  if (paidSourceSubpanels.length === 0) {
    if (
      input.runCases.some(
        runCase =>
          rowString(runCase, "round_status") !== "offchain_complete" || rowString(runCase, "round_id") !== null,
      )
    ) {
      evidenceError(
        "Unpaid cases require the explicit off-chain terminal state and no round ID.",
        "assurance_run_not_terminal",
      );
    }
    if (input.responses.some(response => rowString(response, "settlement_reference"))) {
      evidenceError("Unpaid evidence cannot claim an on-chain settlement.", "assurance_settlement_evidence_invalid");
    }
    return;
  }
  const onchainTerminalStates = new Set(["finalized", "terminal", "failed"]);
  if (
    input.runCases.some(
      runCase =>
        !onchainTerminalStates.has(rowString(runCase, "round_status") ?? "") || !rowString(runCase, "round_id"),
    )
  ) {
    evidenceError("Paid cases require a bound round in a terminal on-chain state.", "assurance_run_not_terminal");
  }
  const paidSources = new Set(paidSourceSubpanels.map(entry => entry.source));
  if (
    input.responses.some(response => {
      const paid = paidSources.has(reviewerSource(response.reviewer_source));
      const reference = rowString(response, "settlement_reference");
      return paid ? !reference : Boolean(reference);
    })
  ) {
    evidenceError(
      "Paid responses require terminal settlement references and unpaid responses must not claim them.",
      "assurance_settlement_evidence_pending",
    );
  }
  if (
    input.chainEvidence.some(
      round => !round.indexedEvents?.some((event: Record<string, unknown>) => isTerminalIndexedEvent(event.eventType)),
    )
  ) {
    evidenceError(
      "Paid evidence requires a stored terminal settlement event for every case.",
      "assurance_settlement_evidence_pending",
    );
  }
}

function buildLimitations(input: {
  aggregation: Record<string, any>;
  settlement: Record<string, any>;
  chainEvidence: Record<string, any>[];
}) {
  const limitations = [
    {
      code: "descriptive_case_results",
      message:
        "Preference shares are descriptive per-case reviewer results; judgments across cases are not treated as independent samples and no confidence interval is claimed.",
    },
    {
      code: "rationale_minimized",
      message: "The export contains rationale digests only; raw or decryptable rationale is excluded.",
    },
    {
      code: "decision_separate",
      message: "The measured packet is separate from the client's go, revise, or stop sign-off.",
    },
  ];
  if (input.aggregation.cases.some((entry: Record<string, any>) => entry.suppressed)) {
    limitations.push({
      code: "minimum_aggregation_not_met",
      message: "Preference and disagreement metrics are suppressed until the frozen minimum aggregate size is met.",
    });
  }
  if (
    input.aggregation.cases.some((entry: Record<string, any>) =>
      entry.sourceSubpanels.some((panel: Record<string, any>) => panel.suppressed),
    )
  ) {
    limitations.push({
      code: "small_source_cells_suppressed",
      message: "One or more source-separated panels are below the frozen minimum aggregate size.",
    });
  }
  if (
    input.aggregation.judgmentCoverage.missingTargetJudgmentCount > 0 ||
    input.aggregation.judgmentCoverage.invalidJudgmentCount > 0 ||
    input.aggregation.judgmentCoverage.pendingJudgmentCount > 0
  ) {
    limitations.push({
      code: "incomplete_or_invalid_work",
      message: "Missing, invalid, or pending responses are counted separately and excluded from preference statistics.",
    });
  }
  if (String(input.settlement.mode).startsWith("no_onchain")) {
    limitations.push({ code: "no_onchain_settlement", message: String(input.settlement.statement) });
  }
  if (input.chainEvidence.some(round => round.roundId && !round.execution)) {
    limitations.push({
      code: "chain_evidence_incomplete",
      message: "At least one bound round has no deployment-pinned execution record in this packet.",
    });
  }
  return limitations;
}

function signPacket(payload: Record<string, any>, signer: EvidenceSigner): EvidenceExport {
  const signing = signingMetadata(signer);
  const signedDocument = { payload, signing };
  const canonical = canonicalizeEvidenceValue(signedDocument);
  return {
    ...signedDocument,
    packetDigest: sha256EvidenceValue(signedDocument),
    signature: sign(null, Buffer.from(canonical), signer.privateKey).toString("base64url"),
  };
}

function parseStoredPacket(row: QueryRow | undefined): EvidenceExport {
  const packetJson = rowString(row, "packet_json");
  if (!packetJson) evidenceError("Evidence packet not found.", "assurance_evidence_not_found", 404);
  const packet = parseJson<EvidenceExport>(packetJson, "Evidence packet");
  const verification = verifyEvidenceExportCore(packet, {
    expectedPublicKey: rowString(row, "signing_public_key"),
    expectedKeyId: rowString(row, "signing_key_id"),
  });
  if (!verification.valid) evidenceError("Stored evidence packet verification failed.", "assurance_evidence_invalid");
  return packet;
}

export function assertEvidenceGenerationRequest(value: unknown) {
  if (value === undefined || value === null) return;
  if (typeof value !== "object" || Array.isArray(value) || Object.keys(value as object).length !== 0) {
    throw new TokenlessServiceError(
      "Evidence metrics are derived from stored records and cannot be supplied by the caller.",
      400,
      "caller_metrics_rejected",
    );
  }
}

export function verifyEvidenceExport(packet: unknown, trust?: { expectedPublicKey?: string; expectedKeyId?: string }) {
  return verifyEvidenceExportCore(packet, trust);
}

export async function generateAssuranceEvidencePacket(input: {
  accountAddress: string;
  workspaceId: string;
  runId: string;
  now?: Date;
  signer?: EvidenceSigner;
  tenantCommitmentKey?: Buffer;
}) {
  const client = await dbPool.connect();
  try {
    await client.query("BEGIN");
    const { row } = await loadRunAccess(client, input, { lock: true });
    const existing = await client.query(
      `SELECT packet_json, signing_public_key, signing_key_id
       FROM tokenless_assurance_evidence_packets WHERE run_id = $1 LIMIT 1`,
      [input.runId],
    );
    if (existing.rows[0]) {
      const packet = parseStoredPacket(existing.rows[0]);
      await client.query("COMMIT");
      await enqueueAssuranceAttestation({
        workspaceId: input.workspaceId,
        kind: "decision_packet",
        artifactDigest: packet.packetDigest,
        artifactSchemaVersion: String(packet.payload.schemaVersion),
        boundaryAt: new Date(String(packet.payload.generatedAt)),
      });
      return packet;
    }
    const frozen = requireFrozenSource(row);
    const [caseResult, responseResult, goldResult] = await Promise.all([
      client.query(
        `SELECT case_id, position, content_id, admission_policy_hash, deterministic_checks_hash,
                deterministic_checks_status, round_id, round_status
         FROM tokenless_assurance_run_cases WHERE run_id = $1 ORDER BY position ASC`,
        [input.runId],
      ),
      client.query(
        `SELECT case_id, reviewer_key, reviewer_source, choice, failure_tag_keys_json, rationale_ciphertext,
                rationale_key_ref, qualification_keys_json, response_digest, settlement_reference, validity,
                submitted_at
         FROM tokenless_assurance_responses WHERE run_id = $1 ORDER BY response_id ASC`,
        [input.runId],
      ),
      client.query(
        `SELECT case_id FROM tokenless_assurance_run_gold_items WHERE run_id=$1 ORDER BY injection_ordinal`,
        [input.runId],
      ),
    ]);
    if (caseResult.rows.length === 0) evidenceError("The completed run has no frozen cases.");
    const goldCaseIds = new Set(goldResult.rows.map(value => rowString(value as QueryRow, "case_id")!));
    const aggregationCases = caseResult.rows.filter(
      value => !goldCaseIds.has(rowString(value as QueryRow, "case_id")!),
    );
    const aggregationResponses = responseResult.rows.filter(
      value => !goldCaseIds.has(rowString(value as QueryRow, "case_id")!),
    );
    if (aggregationCases.length === 0) evidenceError("The completed run has no customer-decision cases.");
    const [counts, decisionCounts] = await Promise.all([
      collectAggregationInputs(client, input.runId, caseResult.rows, responseResult.rows, frozen.policy),
      collectAggregationInputs(client, input.runId, aggregationCases, aggregationResponses, frozen.policy),
    ]);
    const persistedContext = await persistedReviewContext(client, {
      workspaceId: input.workspaceId,
      runId: input.runId,
    });
    const audiencePolicyVersion = {
      id: rowString(row, "audience_policy_id"),
      version: rowNumber(row, "audience_policy_version"),
      hash: frozen.policyHash,
    };
    const linkedAdmissionPolicies = admissionPolicyVersions({
      runManifest: frozen.runManifest,
      caseRows: caseResult.rows,
      audiencePolicy: audiencePolicyVersion,
    });
    const passRule = passRuleFrom(row, frozen.runManifest);
    const recomputation = privacySafeRecomputation(
      decisionCounts.reviewerCounts,
      decisionCounts.caseCounts,
      decisionCounts.minimumAggregationSize,
    );
    const aggregation = computeEvidenceAggregation(recomputation, decisionCounts.minimumAggregationSize, passRule);
    const caseLeaves = caseResult.rows.map(caseLeaf).sort();
    const responseLeaves = responseResult.rows.map(responseLeaf).sort();
    const chainEvidence = await collectChainEvidence(client, caseResult.rows);
    assertTerminalPacket({
      aggregation,
      chainEvidence,
      paidAssignments: counts.paidAssignments,
      policy: frozen.policy,
      responses: responseResult.rows,
      runCases: caseResult.rows,
    });
    const settlement = settlementSummary({
      chainEvidence,
      paidAssignments: counts.paidAssignments,
      policy: frozen.policy,
      reviewerCounts: counts.reviewerCounts,
      responses: responseResult.rows,
    });
    const limitations = buildLimitations({ aggregation, settlement, chainEvidence });
    const overrideDecisionCounts = await collectOverrideDecisionCounts(client, input.runId);
    const packetId = `haep_${randomUUID().replaceAll("-", "")}`;
    const generatedAt = input.now ?? new Date();
    const payload = {
      schemaVersion: EVIDENCE_SCHEMA_VERSION,
      packetId,
      runId: input.runId,
      tenantCommitment: tenantCommitment(input.workspaceId, loadTenantCommitmentKey(input.tenantCommitmentKey)),
      generatedAt: generatedAt.toISOString(),
      privacy: {
        classification: rowString(row, "data_classification"),
        minimumAggregationSize: decisionCounts.minimumAggregationSize,
        reviewerIdentitiesIncluded: false,
        rawRationaleIncluded: false,
        calibrationItemsIncludedInVerdict: false,
      },
      frozen: {
        runManifestHash: frozen.runManifestHash,
        runManifest: frozen.runManifest,
        suiteManifestHash: frozen.suiteManifestHash,
        suiteManifest: frozen.suiteManifest,
        policyHash: frozen.policyHash,
        policy: frozen.policy,
        admissionPolicyHashes: linkedAdmissionPolicies.map(policy => policy.admissionPolicyHash),
        admissionPolicies: linkedAdmissionPolicies,
      },
      reviewContext: {
        selectionTrigger: persistedContext.selectionTrigger,
        deliveryAuthority: {
          mode: "workspace_authorized_member",
          callerSupplied: false,
        },
        gate: persistedContext.gate,
        versions: {
          runManifest: { hash: frozen.runManifestHash },
          suite: {
            id: rowString(row, "suite_id"),
            version: rowNumber(row, "suite_version"),
            hash: frozen.suiteManifestHash,
          },
          audiencePolicy: audiencePolicyVersion,
          admissionPolicies: linkedAdmissionPolicies,
          ...persistedContext.versions,
        },
        reviewerQualifications: privacySafeQualificationCounts(
          aggregationResponses,
          decisionCounts.minimumAggregationSize,
        ),
        period: periodCoverage(row, responseResult.rows, aggregation),
      },
      roots: { caseRoot: evidenceMerkleRoot(caseLeaves), responseRoot: evidenceMerkleRoot(responseLeaves) },
      aggregation,
      calibration: {
        itemCount: goldCaseIds.size,
        statusDisclosedOnlyInAggregate: true,
      },
      overrideDecisions: {
        // Counts only; the append-only override records with reasons live
        // outside the frozen packet and may grow after generation.
        atGeneration: overrideDecisionCounts,
        recordedSeparately: true,
      },
      failureTagCounts: decisionCounts.failureTagCounts.filter(
        (entry: { count: number }) => entry.count >= decisionCounts.minimumAggregationSize,
      ),
      rationaleDigests: decisionCounts.rationaleDigests,
      settlement,
      chainEvidence,
      limitations,
      recomputation: {
        caseLeaves,
        responseLeaves,
        ...recomputation,
      },
    };
    const packet = signPacket(payload, input.signer ?? loadEvidenceSigner());
    await client.query(
      `INSERT INTO tokenless_assurance_evidence_packets
       (packet_id, run_id, manifest_hash, case_root, response_root, aggregation_version,
        result_json, limitations_json, chain_references_json, signature, generated_at,
        packet_digest, packet_json, signature_algorithm, signing_key_id, signing_public_key)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)`,
      [
        packetId,
        input.runId,
        frozen.runManifestHash,
        payload.roots.caseRoot,
        payload.roots.responseRoot,
        EVIDENCE_AGGREGATION_VERSION,
        JSON.stringify(aggregation),
        JSON.stringify(limitations),
        JSON.stringify({ settlement, chainEvidence }),
        packet.signature,
        generatedAt,
        packet.packetDigest,
        JSON.stringify(packet),
        packet.signing.algorithm,
        packet.signing.keyId,
        packet.signing.publicKey,
      ],
    );
    await client.query("COMMIT");
    await enqueueAssuranceAttestation({
      workspaceId: input.workspaceId,
      kind: "decision_packet",
      artifactDigest: packet.packetDigest,
      artifactSchemaVersion: EVIDENCE_SCHEMA_VERSION,
      boundaryAt: generatedAt,
    });
    return packet;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function getAssuranceEvidencePacket(input: {
  accountAddress: string;
  workspaceId: string;
  runId: string;
}) {
  const client = await dbPool.connect();
  try {
    await loadRunAccess(client, input);
    const result = await client.query(
      `SELECT packet_json, signing_public_key, signing_key_id
       FROM tokenless_assurance_evidence_packets WHERE run_id = $1 LIMIT 1`,
      [input.runId],
    );
    return parseStoredPacket(result.rows[0]);
  } finally {
    client.release();
  }
}

function normalizeDecisionNote(value: string | null | undefined) {
  if (value === null || value === undefined) return null;
  const note = value.trim();
  if (note.length > 2_000) {
    throw new TokenlessServiceError(
      "Decision note must not exceed 2000 characters.",
      400,
      "invalid_assurance_decision",
    );
  }
  return note || null;
}

function publicDecision(row: QueryRow) {
  const json = rowString(row, "decision_json");
  return json ? parseJson<Record<string, unknown>>(json, "Client decision") : null;
}

export async function recordAssuranceClientDecision(input: {
  accountAddress: string;
  workspaceId: string;
  runId: string;
  decision: ClientDecision;
  note?: string | null;
  now?: Date;
}) {
  if (input.decision !== "go" && input.decision !== "revise" && input.decision !== "stop") {
    throw new TokenlessServiceError("Decision must be go, revise, or stop.", 400, "invalid_assurance_decision");
  }
  const note = normalizeDecisionNote(input.note);
  // Anti-rubber-stamping: a deterministic low-rate sample of runs requires an
  // explained decision — written reasons even when the choice is `go`.
  if (decisionExplanationRequired(input.runId) && (!note || note.length < 10)) {
    throw new TokenlessServiceError(
      "This run was sampled for an explained decision: add reasons of at least 10 characters, even for go.",
      400,
      "decision_explanation_required",
    );
  }
  const client = await dbPool.connect();
  try {
    await client.query("BEGIN");
    const { address } = await loadRunAccess(client, input, { lock: true, decision: true });
    const packetResult = await client.query(
      `SELECT packet_id, packet_digest, packet_json, signing_public_key, signing_key_id
       FROM tokenless_assurance_evidence_packets
       WHERE run_id = $1 LIMIT 1`,
      [input.runId],
    );
    const packetRow = packetResult.rows[0];
    const packet = parseStoredPacket(packetRow);
    if (packet.packetDigest !== rowString(packetRow, "packet_digest")) {
      evidenceError("Evidence packet digest mismatch.", "assurance_evidence_invalid");
    }
    const existing = await client.query(
      "SELECT decision_json FROM tokenless_assurance_client_decisions WHERE run_id = $1 LIMIT 1",
      [input.runId],
    );
    if (existing.rows[0]) {
      const decision = publicDecision(existing.rows[0]);
      if (decision?.decision === input.decision && decision.note === note && decision.decidedBy === address) {
        await client.query("COMMIT");
        return decision;
      }
      evidenceError("This run already has a different client sign-off.", "assurance_decision_conflict");
    }
    const decisionId = `had_${randomUUID().replaceAll("-", "")}`;
    const decidedAt = input.now ?? new Date();
    const decisionPayload = {
      schemaVersion: "rateloop.human-assurance.client-decision.v1",
      decisionId,
      runId: input.runId,
      evidencePacketId: rowString(packetRow, "packet_id"),
      evidencePacketDigest: packet.packetDigest,
      decision: input.decision,
      note,
      decidedBy: address,
      decidedAt: decidedAt.toISOString(),
    };
    const decisionDigest = sha256EvidenceValue(decisionPayload);
    await client.query(
      `INSERT INTO tokenless_assurance_client_decisions
       (decision_id, run_id, evidence_packet_id, decision, note, decided_by, decided_at,
        evidence_packet_digest, decision_digest, decision_json)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        decisionId,
        input.runId,
        rowString(packetRow, "packet_id"),
        input.decision,
        note,
        address,
        decidedAt,
        packet.packetDigest,
        decisionDigest,
        JSON.stringify({ ...decisionPayload, decisionDigest }),
      ],
    );
    await client.query("COMMIT");
    return { ...decisionPayload, decisionDigest };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function getAssuranceClientDecision(input: {
  accountAddress: string;
  workspaceId: string;
  runId: string;
}) {
  const client = await dbPool.connect();
  try {
    await loadRunAccess(client, input);
    const result = await client.query(
      "SELECT decision_json FROM tokenless_assurance_client_decisions WHERE run_id = $1 LIMIT 1",
      [input.runId],
    );
    return result.rows[0] ? publicDecision(result.rows[0]) : null;
  } finally {
    client.release();
  }
}

export const ASSURANCE_OVERRIDE_OUTCOMES = ["accepted", "disregarded", "overridden", "reversed"] as const;
export type AssuranceOverrideOutcome = (typeof ASSURANCE_OVERRIDE_OUTCOMES)[number];

export type AssuranceOverrideDecision = {
  schemaVersion: "rateloop.human-assurance.override-decision.v1";
  recordId: string;
  runId: string;
  evidencePacketDigest: string | null;
  outcome: AssuranceOverrideOutcome;
  reasons: string;
  correctiveAction: string | null;
  supersedesRecordId: string | null;
  decidedBy: string;
  decidedAt: string;
  recordDigest: string;
  current: boolean;
};

function invalidOverrideDecision(message: string): never {
  throw new TokenlessServiceError(message, 400, "invalid_override_decision");
}

function normalizeOverrideOutcome(value: unknown): AssuranceOverrideOutcome {
  if (typeof value !== "string" || !ASSURANCE_OVERRIDE_OUTCOMES.includes(value as AssuranceOverrideOutcome)) {
    invalidOverrideDecision("Outcome must be accepted, disregarded, overridden, or reversed.");
  }
  return value as AssuranceOverrideOutcome;
}

function normalizeOverrideReasons(value: unknown) {
  if (typeof value !== "string") invalidOverrideDecision("Override reasons must be 10-2000 characters.");
  const reasons = value.trim();
  if (reasons.length < 10 || reasons.length > 2_000) {
    invalidOverrideDecision("Override reasons must be 10-2000 characters.");
  }
  return reasons;
}

function normalizeCorrectiveAction(value: unknown) {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") invalidOverrideDecision("Corrective action must be at most 2000 characters.");
  const note = value.trim();
  if (note.length > 2_000) invalidOverrideDecision("Corrective action must be at most 2000 characters.");
  return note || null;
}

function overrideDecisionFromRow(row: QueryRow, supersededIds: Set<string>): AssuranceOverrideDecision {
  const decidedAt = row.decided_at instanceof Date ? row.decided_at : new Date(String(row.decided_at));
  if (!Number.isFinite(decidedAt.getTime())) throw new Error("Stored override decision timestamp is invalid.");
  return {
    schemaVersion: "rateloop.human-assurance.override-decision.v1",
    recordId: rowString(row, "record_id")!,
    runId: rowString(row, "run_id")!,
    evidencePacketDigest: rowString(row, "evidence_packet_digest"),
    outcome: rowString(row, "outcome") as AssuranceOverrideOutcome,
    reasons: rowString(row, "reasons")!,
    correctiveAction: rowString(row, "corrective_action"),
    supersedesRecordId: rowString(row, "supersedes_record_id"),
    decidedBy: rowString(row, "decided_by")!,
    decidedAt: decidedAt.toISOString(),
    recordDigest: rowString(row, "record_digest")!,
    current: !supersededIds.has(rowString(row, "record_id")!),
  };
}

async function collectOverrideDecisionCounts(client: Queryable, runId: string) {
  const result = await client.query(
    `SELECT record_id, supersedes_record_id, outcome
     FROM tokenless_assurance_override_decisions WHERE run_id = $1`,
    [runId],
  );
  const supersededIds = new Set(
    result.rows.map(row => rowString(row, "supersedes_record_id")).filter((value): value is string => value !== null),
  );
  const byOutcome = { accepted: 0, disregarded: 0, overridden: 0, reversed: 0 };
  for (const row of result.rows) {
    if (supersededIds.has(rowString(row, "record_id")!)) continue;
    const outcome = rowString(row, "outcome") as AssuranceOverrideOutcome | null;
    if (outcome && outcome in byOutcome) byOutcome[outcome] += 1;
  }
  return { recorded: Object.values(byOutcome).reduce((sum, value) => sum + value, 0), byOutcome };
}

/**
 * Immutable per-output override record: an authorized person (owner, admin, or
 * decision owner) records whether the human-review outcome was accepted,
 * disregarded, overridden, or reversed, with mandatory reasons. Records are
 * append-only — a new record supersedes the previous one, nothing is edited —
 * and each recording lands in the workspace audit chain.
 */
export async function recordAssuranceOverrideDecision(input: {
  accountAddress: string;
  workspaceId: string;
  runId: string;
  outcome: unknown;
  reasons: unknown;
  correctiveAction?: unknown;
  now?: Date;
}): Promise<AssuranceOverrideDecision> {
  const outcome = normalizeOverrideOutcome(input.outcome);
  const reasons = normalizeOverrideReasons(input.reasons);
  const correctiveAction = normalizeCorrectiveAction(input.correctiveAction);
  const client = await dbPool.connect();
  let record: AssuranceOverrideDecision;
  let address: string;
  let workspaceId: string;
  try {
    await client.query("BEGIN");
    const access = await loadRunAccess(client, input, { lock: true, decision: true });
    address = access.address;
    workspaceId = input.workspaceId;
    if (rowString(access.row, "status") !== "completed") {
      evidenceError("Override decisions apply only to completed runs.", "assurance_run_not_completed", 409);
    }
    const projectId = rowString(access.row, "project_id");
    const packetResult = await client.query(
      "SELECT packet_digest FROM tokenless_assurance_evidence_packets WHERE run_id = $1 LIMIT 1",
      [input.runId],
    );
    const chainResult = await client.query(
      "SELECT record_id, supersedes_record_id FROM tokenless_assurance_override_decisions WHERE run_id = $1",
      [input.runId],
    );
    const chainSuperseded = new Set(
      chainResult.rows
        .map(row => rowString(row, "supersedes_record_id"))
        .filter((value): value is string => value !== null),
    );
    const head = chainResult.rows.find(row => !chainSuperseded.has(rowString(row, "record_id")!));
    const supersedesRecordId = head ? rowString(head, "record_id") : null;
    const recordId = `haor_${randomUUID().replaceAll("-", "")}`;
    const decidedAt = input.now ?? new Date();
    const payload = {
      schemaVersion: "rateloop.human-assurance.override-decision.v1" as const,
      recordId,
      runId: input.runId,
      evidencePacketDigest: rowString(packetResult.rows[0], "packet_digest"),
      outcome,
      reasons,
      correctiveAction,
      supersedesRecordId,
      decidedBy: address,
      decidedAt: decidedAt.toISOString(),
    };
    const recordDigest = sha256EvidenceValue(payload);
    await client.query(
      `INSERT INTO tokenless_assurance_override_decisions
       (record_id, workspace_id, project_id, run_id, supersedes_record_id, outcome, reasons,
        corrective_action, decided_by, decided_at, record_digest, record_json, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $10)`,
      [
        recordId,
        input.workspaceId,
        projectId,
        input.runId,
        supersedesRecordId,
        outcome,
        reasons,
        correctiveAction,
        address,
        decidedAt,
        recordDigest,
        JSON.stringify({ ...payload, recordDigest }),
      ],
    );
    await client.query("COMMIT");
    record = { ...payload, recordDigest, current: true };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
  await appendAuditEvent({
    workspaceId,
    actorKind: isRateLoopPrincipalId(address) ? "principal" : "account",
    actorReference: address,
    assuranceMethod: "rateloop_session",
    action: "oversight.override_recorded",
    targetKind: "assurance_override_decision",
    targetId: record.recordId,
    purpose: "workspace_oversight_override",
    reason: "authorized_person_recorded_override_decision",
    result: "success",
    metadata: {
      runId: record.runId,
      outcome: record.outcome,
      supersedesRecordId: record.supersedesRecordId,
      recordDigest: record.recordDigest,
    },
    occurredAt: new Date(record.decidedAt),
  });
  return record;
}

export async function listAssuranceOverrideDecisions(input: {
  accountAddress: string;
  workspaceId: string;
  runId: string;
}): Promise<AssuranceOverrideDecision[]> {
  const client = await dbPool.connect();
  try {
    await loadRunAccess(client, input);
    const packetResult = await client.query(
      "SELECT packet_digest FROM tokenless_assurance_evidence_packets WHERE run_id = $1 LIMIT 1",
      [input.runId],
    );
    const packetDigest = rowString(packetResult.rows[0], "packet_digest");
    const result = await client.query(
      `SELECT * FROM tokenless_assurance_override_decisions
       WHERE run_id = $1
       ORDER BY decided_at DESC, record_id DESC`,
      [input.runId],
    );
    for (const row of result.rows) row.evidence_packet_digest = packetDigest;
    const supersededIds = new Set(
      result.rows.map(row => rowString(row, "supersedes_record_id")).filter((value): value is string => value !== null),
    );
    return result.rows.map(row => overrideDecisionFromRow(row, supersededIds));
  } finally {
    client.release();
  }
}
