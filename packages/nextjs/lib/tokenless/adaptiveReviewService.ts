import { createHash } from "node:crypto";
import type { PoolClient } from "pg";
import "server-only";
import { dbClient, dbPool } from "~~/lib/db";
import {
  type AdaptiveObservationWindow,
  type AdaptiveReviewPolicy,
  type AdaptiveReviewStage,
  type AdaptiveScopeState,
  decideAdaptiveReview,
  nextAdaptiveStage,
} from "~~/lib/tokenless/adaptiveReview";
import { type AgentExecutionEvidence, projectAgentExecutionEvidence } from "~~/lib/tokenless/agentExecutionEvidence";
import {
  AGENT_EXECUTION_PROFILE_SCHEMA_VERSION,
  type AgentExecutionProfile,
  type AgentExecutionProvenanceInput,
  LEGACY_AGENT_EXECUTION_PROFILE_SCHEMA_VERSION,
  type NormalizedAgentExecutionProvenance,
  legacyAgentExecutionProfileHash,
  normalizeAgentExecutionProvenance,
} from "~~/lib/tokenless/agentExecutionProvenance";
import { decideFixedReview } from "~~/lib/tokenless/fixedReview";
import { humanReviewRequiresPayment } from "~~/lib/tokenless/humanReviewGrantScopes";
import {
  type HumanReviewOpportunityState,
  transitionHumanReviewOpportunityLifecycleInTransaction,
} from "~~/lib/tokenless/humanReviewOpportunityLifecycle";
import {
  type ProductPrincipal,
  authenticateProductPrincipal,
  requireProductPrincipalScope,
} from "~~/lib/tokenless/productCore";
import { TokenlessServiceError } from "~~/lib/tokenless/server";
import { wilsonIntervalBps } from "~~/lib/tokenless/transparency";
import { isWorldIdAssuranceEnabled } from "~~/lib/tokenless/worldIdAssurance";

type QueryRow = Record<string, unknown>;
type AdaptivePrincipal = Extract<ProductPrincipal, { kind: "api_key" }>;

const HASH_PATTERN = /^sha256:[0-9a-f]{64}$/;
// Adaptive coverage must not fall below 100% until these gates are backed by
// persisted, scope-specific drift and severe-disagreement evidence.
const ADAPTIVE_SAFETY_GATES_AVAILABLE = false;
const IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/;
const SOURCE_REFERENCE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,239}$/;
const RISK_TIER_PATTERN = /^[a-z][a-z0-9_-]{0,63}$/;

type ReviewPolicyRow = {
  policyId: string;
  policyVersion: number;
  agentId: string;
  agentVersionId: string;
  mode: "manual" | "always" | "rules" | "adaptive" | "fixed";
  agreementThresholdBps: number;
  productionFloorBps: number;
  fixedRateBps: number | null;
  maximumUnreviewedGap: number;
  rules: ReviewRules;
  audiencePolicyHash: string;
  publishingPolicyId: string | null;
};

type ReviewRules = {
  requiredRiskTiers: string[];
  criticalRiskTiers: string[];
  minimumConfidenceBps: number | null;
  maximumLatencyMs: number | null;
};

type ScopeRow = AdaptiveScopeState & {
  scopeId: string;
  stageEnteredAt: Date;
  executionProfileHash: string;
  executionProfile: AgentExecutionProfile | null;
  humanReviewBindingId: string;
  humanReviewBindingVersion: number;
  requestProfileId: string;
  requestProfileVersion: number;
  requestProfileHash: string;
};

type HumanReviewBindingRow = {
  bindingId: string;
  bindingVersion: number;
  requestProfileId: string;
  requestProfileVersion: number;
  requestProfileHash: string;
  configurationStatus: "ready" | "action_required";
  authority: "check_only" | "prepare_for_approval" | "ask_automatically";
  publishingPolicyId: string | null;
  publishingPolicyVersion: number | null;
  audience: "private_invited" | "public_network" | "hybrid";
  contentBoundary: "private_workspace" | "public_or_test";
  compensationMode: "unpaid" | "usdc";
  feedbackBonusEnabled: boolean;
};

type IntegrationReviewGrant = { active: boolean; reason: string };

export type AdaptiveReviewDecisionRequest = {
  externalOpportunityId: string;
  agentId: string;
  agentVersionId: string;
  policyId: string;
  policyVersion: number;
  workflowKey: string;
  riskTier: string;
  audiencePolicyHash: string;
  suggestionCommitment: string;
  sourceEvidence: { reference: string; hash: string };
  declaredConfidenceBps?: number | null;
  criticalRisk?: boolean;
  metadataComplete: boolean;
  execution: AgentExecutionProvenanceInput;
};

export type AdaptiveAssuranceState = {
  schemaVersion: "rateloop.assurance-state.v1";
  workspaceId: string;
  agentId: string;
  agentVersionId: string;
  scopeId: string;
  policyId: string;
  policyVersion: number;
  stage: AdaptiveReviewStage;
  reviewRateBps: number;
  completedComparableCases: number;
  stableCasesSinceStage: number;
  reviewedOpportunityCount: number;
  skippedOpportunityCount: number;
  humanAgreementBps: number | null;
  humanAgreementLower95Bps: number | null;
  nextReassessmentAfter: number;
  executionProfileHash: string;
  executionProfile: AgentExecutionProfile | null;
};

export type AdaptiveReviewDecision = Omit<AdaptiveAssuranceState, "schemaVersion"> & {
  schemaVersion: "rateloop.review-decision.v1";
  opportunityId: string;
  externalOpportunityId: string;
  decision: "required" | "recommended" | "skip";
  required: boolean;
  reasonCodes: string[];
  selectionProbabilityBps: number;
  sampleBucket: number;
  policyFrozen: true;
  suggestionCommitment: string;
  metadataCommitment: string;
  sourceEvidenceHash: string;
  executionId: string;
  executionManifestCommitment: string;
  executionEvidence: AgentExecutionEvidence;
  createdAt: string;
  lifecycle: {
    state: HumanReviewOpportunityState;
    revision: number;
    terminal: boolean;
    reasonCodes: string[];
    stateEnteredAt: string;
  };
};

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right));
    return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function sha256(value: unknown) {
  return `sha256:${createHash("sha256")
    .update(typeof value === "string" ? value : stableJson(value))
    .digest("hex")}`;
}

function rowString(row: QueryRow | undefined, key: string) {
  const value = row?.[key];
  return value === null || value === undefined ? null : String(value);
}

function rowInteger(row: QueryRow | undefined, key: string) {
  const value = Number(row?.[key]);
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`Database returned an invalid ${key}.`);
  return value;
}

function rowOptionalInteger(row: QueryRow | undefined, key: string) {
  return row?.[key] === null || row?.[key] === undefined ? null : rowInteger(row, key);
}

function rowBoolean(row: QueryRow | undefined, key: string) {
  return row?.[key] === true || row?.[key] === "t" || row?.[key] === 1;
}

function parseJson(value: unknown, field: string) {
  if (typeof value !== "string") throw new Error(`Database returned invalid ${field}.`);
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error();
    return parsed as Record<string, unknown>;
  } catch {
    throw new Error(`Database returned invalid ${field}.`);
  }
}

function parseRules(value: unknown): ReviewRules {
  const rules = parseJson(value, "review rules");
  const stringArray = (field: string) => {
    const entry = rules[field] ?? [];
    if (!Array.isArray(entry) || entry.some(item => typeof item !== "string" || !RISK_TIER_PATTERN.test(item))) {
      throw new Error("Database returned invalid review rules.");
    }
    return [...new Set(entry as string[])];
  };
  const optionalBps = (field: string) => {
    const entry = rules[field];
    if (entry === null || entry === undefined) return null;
    if (!Number.isSafeInteger(entry) || Number(entry) < 0 || Number(entry) > 10_000) {
      throw new Error("Database returned invalid review rules.");
    }
    return Number(entry);
  };
  const optionalDuration = (field: string) => {
    const entry = rules[field];
    if (entry === null || entry === undefined) return null;
    if (!Number.isSafeInteger(entry) || Number(entry) < 1) throw new Error("Database returned invalid review rules.");
    return Number(entry);
  };
  return {
    requiredRiskTiers: stringArray("requiredRiskTiers"),
    criticalRiskTiers: stringArray("criticalRiskTiers"),
    minimumConfidenceBps: optionalBps("minimumConfidenceBps"),
    maximumLatencyMs: optionalDuration("maximumLatencyMs"),
  };
}

function parseStringArray(value: unknown, field: string) {
  if (typeof value !== "string") throw new Error(`Database returned invalid ${field}.`);
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed) || parsed.some(entry => typeof entry !== "string")) throw new Error();
    return [...new Set(parsed as string[])];
  } catch {
    throw new Error(`Database returned invalid ${field}.`);
  }
}

function boundedIdentifier(value: unknown, field: string) {
  if (typeof value !== "string" || !IDENTIFIER_PATTERN.test(value)) {
    throw new TokenlessServiceError(`${field} is invalid.`, 400, "invalid_review_opportunity");
  }
  return value;
}

function strictHash(value: unknown, field: string) {
  if (typeof value !== "string" || !HASH_PATTERN.test(value)) {
    throw new TokenlessServiceError(
      `${field} must be a lowercase sha256 commitment.`,
      400,
      "invalid_review_opportunity",
    );
  }
  return value;
}

function normalizeRequest(input: AdaptiveReviewDecisionRequest) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new TokenlessServiceError("Review opportunity body must be an object.", 400, "invalid_review_opportunity");
  }
  const allowedKeys = new Set([
    "externalOpportunityId",
    "agentId",
    "agentVersionId",
    "policyId",
    "policyVersion",
    "workflowKey",
    "riskTier",
    "audiencePolicyHash",
    "suggestionCommitment",
    "sourceEvidence",
    "declaredConfidenceBps",
    "criticalRisk",
    "metadataComplete",
    "execution",
  ]);
  if (Object.keys(input).some(key => !allowedKeys.has(key))) {
    throw new TokenlessServiceError(
      "Review opportunity body contains unknown fields.",
      400,
      "invalid_review_opportunity",
    );
  }
  const declaredConfidenceBps = input.declaredConfidenceBps ?? null;
  if (
    declaredConfidenceBps !== null &&
    (!Number.isSafeInteger(declaredConfidenceBps) || declaredConfidenceBps < 0 || declaredConfidenceBps > 10_000)
  ) {
    throw new TokenlessServiceError(
      "declaredConfidenceBps must be an integer from 0 to 10000.",
      400,
      "invalid_review_opportunity",
    );
  }
  if (
    typeof input.metadataComplete !== "boolean" ||
    (input.criticalRisk !== undefined && typeof input.criticalRisk !== "boolean")
  ) {
    throw new TokenlessServiceError("Review risk flags must be boolean values.", 400, "invalid_review_opportunity");
  }
  if (!RISK_TIER_PATTERN.test(input.riskTier)) {
    throw new TokenlessServiceError("riskTier is invalid.", 400, "invalid_review_opportunity");
  }
  if (!SOURCE_REFERENCE_PATTERN.test(input.sourceEvidence?.reference ?? "")) {
    throw new TokenlessServiceError(
      "sourceEvidence.reference must be a privacy-safe opaque reference.",
      400,
      "invalid_review_opportunity",
    );
  }
  if (
    !input.sourceEvidence ||
    typeof input.sourceEvidence !== "object" ||
    Array.isArray(input.sourceEvidence) ||
    Object.keys(input.sourceEvidence).some(key => key !== "reference" && key !== "hash")
  ) {
    throw new TokenlessServiceError("sourceEvidence is invalid.", 400, "invalid_review_opportunity");
  }
  return {
    externalOpportunityId: boundedIdentifier(input.externalOpportunityId, "externalOpportunityId"),
    agentId: boundedIdentifier(input.agentId, "agentId"),
    agentVersionId: boundedIdentifier(input.agentVersionId, "agentVersionId"),
    policyId: boundedIdentifier(input.policyId, "policyId"),
    policyVersion: input.policyVersion,
    workflowKey: boundedIdentifier(input.workflowKey, "workflowKey"),
    riskTier: input.riskTier,
    audiencePolicyHash: strictHash(input.audiencePolicyHash, "audiencePolicyHash"),
    suggestionCommitment: strictHash(input.suggestionCommitment, "suggestionCommitment"),
    sourceEvidenceReference: input.sourceEvidence.reference,
    sourceEvidenceHash: strictHash(input.sourceEvidence.hash, "sourceEvidence.hash"),
    declaredConfidenceBps,
    criticalRisk: input.criticalRisk ?? false,
    metadataComplete: input.metadataComplete,
    execution: normalizeAgentExecutionProvenance(input.execution),
  };
}

function samplerConfig() {
  const encoded = process.env.TOKENLESS_ADAPTIVE_REVIEW_SAMPLER_KEY?.trim() ?? "";
  const version = process.env.TOKENLESS_ADAPTIVE_REVIEW_SAMPLER_KEY_VERSION?.trim() ?? "";
  let key: Buffer;
  if (/^[0-9a-fA-F]{64,}$/.test(encoded) && encoded.length % 2 === 0) key = Buffer.from(encoded, "hex");
  else key = Buffer.from(encoded, "base64url");
  if (key.length < 32 || !version || version.length > 80) {
    throw new TokenlessServiceError(
      "Adaptive review sampling is unavailable.",
      503,
      "adaptive_review_unavailable",
      true,
    );
  }
  return { key, version };
}

function deterministicId(prefix: string, fields: string[]) {
  return `${prefix}_${createHash("sha256").update(fields.join("\0")).digest("hex").slice(0, 40)}`;
}

function policyFromRow(row: QueryRow | undefined): ReviewPolicyRow {
  const policyId = rowString(row, "policy_id");
  const agentId = rowString(row, "agent_id");
  const agentVersionId = rowString(row, "agent_version_id");
  const mode = rowString(row, "mode") as ReviewPolicyRow["mode"] | null;
  if (
    !policyId ||
    !agentId ||
    !agentVersionId ||
    !mode ||
    !["manual", "always", "rules", "adaptive", "fixed"].includes(mode)
  ) {
    throw new TokenlessServiceError("Review policy not found.", 404, "review_policy_not_found");
  }
  const audiencePolicy = parseJson(row?.audience_policy_json, "audience policy");
  const fixedRateBps = rowOptionalInteger(row, "fixed_rate_bps");
  if ((mode === "fixed") !== (fixedRateBps !== null) || (fixedRateBps !== null && fixedRateBps < 1)) {
    throw new Error("Database returned an invalid fixed review rate.");
  }
  return {
    policyId,
    policyVersion: rowInteger(row, "version"),
    agentId,
    agentVersionId,
    mode,
    agreementThresholdBps: rowInteger(row, "agreement_threshold_bps"),
    productionFloorBps: rowInteger(row, "production_floor_bps"),
    fixedRateBps,
    maximumUnreviewedGap: rowInteger(row, "maximum_unreviewed_gap"),
    rules: parseRules(row?.rules_json),
    audiencePolicyHash: sha256(audiencePolicy),
    publishingPolicyId: rowString(row, "publishing_policy_id"),
  };
}

function executionProfileFromRow(row: QueryRow): AgentExecutionProfile | null {
  const value = parseJson(row.execution_profile_json, "execution profile");
  if (
    value.schemaVersion !== AGENT_EXECUTION_PROFILE_SCHEMA_VERSION &&
    value.schemaVersion !== LEGACY_AGENT_EXECUTION_PROFILE_SCHEMA_VERSION
  ) {
    return null;
  }
  const primary = value.primary;
  const contributors = value.contributors;
  const orchestrationMode = value.orchestrationMode;
  if (
    !primary ||
    typeof primary !== "object" ||
    Array.isArray(primary) ||
    !Array.isArray(contributors) ||
    (orchestrationMode !== "single_model" && orchestrationMode !== "multi_model")
  ) {
    throw new Error("Database returned invalid execution profile.");
  }
  return value as AgentExecutionProfile;
}

function scopeFromRow(row: QueryRow): ScopeRow {
  const scopeId = rowString(row, "scope_id");
  const executionProfileHash = rowString(row, "execution_profile_hash");
  const humanReviewBindingId = rowString(row, "human_review_binding_id");
  const requestProfileId = rowString(row, "request_profile_id");
  const requestProfileHash = rowString(row, "request_profile_hash");
  const stage = rowString(row, "stage") as AdaptiveReviewStage | null;
  const stageEnteredAt =
    row.stage_entered_at instanceof Date ? row.stage_entered_at : new Date(String(row.stage_entered_at));
  if (
    !scopeId ||
    !executionProfileHash ||
    !HASH_PATTERN.test(executionProfileHash) ||
    !humanReviewBindingId ||
    !requestProfileId ||
    !requestProfileHash ||
    !HASH_PATTERN.test(requestProfileHash) ||
    !stage ||
    !Number.isFinite(stageEnteredAt.getTime())
  )
    throw new Error("Database returned an invalid adaptive scope.");
  return {
    scopeId,
    stage,
    completedComparableCases: rowInteger(row, "completed_comparable_cases"),
    stableCasesSinceStage: rowInteger(row, "stable_cases_since_stage"),
    unreviewedSinceLastSample: rowInteger(row, "unreviewed_since_last_sample"),
    stageEnteredAt,
    executionProfileHash,
    executionProfile: executionProfileFromRow(row),
    humanReviewBindingId,
    humanReviewBindingVersion: rowInteger(row, "human_review_binding_version"),
    requestProfileId,
    requestProfileVersion: rowInteger(row, "request_profile_version"),
    requestProfileHash,
  };
}

function policyMath(policy: ReviewPolicyRow): AdaptiveReviewPolicy {
  return {
    policyVersion: policy.policyVersion,
    agreementThresholdBps: policy.agreementThresholdBps,
    productionFloorBps: policy.productionFloorBps,
    maximumUnreviewedGap: policy.maximumUnreviewedGap,
  };
}

function humanAgreementGatePassed(rows: QueryRow[], thresholdBps: number) {
  return rows.every(row => {
    if (rowInteger(row, "responding_human_count") < 2) return false;
    const value = row.human_human_agreement_bps;
    return value !== null && value !== undefined && Number(value) >= thresholdBps;
  });
}

function observationWindow(rows: QueryRow[], policy: ReviewPolicyRow): AdaptiveObservationWindow {
  const comparable = rows.length;
  const agreements = rows.filter(row => rowString(row, "agreement") === "agree").length;
  return {
    comparable,
    agreements,
    safetyGatesAvailable: ADAPTIVE_SAFETY_GATES_AVAILABLE,
    completionGatePassed: comparable === 15,
    humanAgreementGatePassed: humanAgreementGatePassed(rows, policy.agreementThresholdBps),
    latencyGatePassed: rows.every(row => {
      if (policy.rules.maximumLatencyMs === null) return true;
      return (
        row.latency_ms !== null &&
        row.latency_ms !== undefined &&
        Number(row.latency_ms) <= policy.rules.maximumLatencyMs
      );
    }),
    driftGatePassed: true,
    severeDisagreementOpen: false,
  };
}

async function recordPolicyEvent(
  client: PoolClient,
  input: {
    workspaceId: string;
    scopeId: string;
    policy: ReviewPolicyRow;
    eventType: "created" | "stage_changed" | "reset" | "forced_review";
    fromStage?: AdaptiveReviewStage | null;
    toStage?: AdaptiveReviewStage | null;
    reasonCodes: string[];
    actorReference: string;
    createdAt: Date;
  },
) {
  const eventBody = {
    workspaceId: input.workspaceId,
    scopeId: input.scopeId,
    policyId: input.policy.policyId,
    policyVersion: input.policy.policyVersion,
    eventType: input.eventType,
    fromStage: input.fromStage ?? null,
    toStage: input.toStage ?? null,
    reasonCodes: input.reasonCodes,
    actorReference: input.actorReference,
    createdAt: input.createdAt.toISOString(),
  };
  await client.query(
    `INSERT INTO tokenless_agent_review_policy_events
     (event_id, workspace_id, scope_id, policy_id, policy_version, event_type, from_stage, to_stage,
      reason_codes_json, actor_type, actor_reference, event_commitment, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'service', $10, $11, $12)`,
    [
      deterministicId("are", [input.scopeId, input.eventType, input.createdAt.toISOString(), sha256(eventBody)]),
      input.workspaceId,
      input.scopeId,
      input.policy.policyId,
      input.policy.policyVersion,
      input.eventType,
      input.fromStage ?? null,
      input.toStage ?? null,
      JSON.stringify(input.reasonCodes),
      input.actorReference,
      sha256(eventBody),
      input.createdAt,
    ],
  );
}

async function refreshScopeState(
  client: PoolClient,
  input: { workspaceId: string; scope: ScopeRow; policy: ReviewPolicyRow; resetReason?: string | null },
) {
  const observations = await client.query(
    `SELECT agreement, responding_human_count, human_human_agreement_bps, latency_ms, finalized_at
     FROM tokenless_agent_evaluation_observations
     WHERE workspace_id = $1 AND scope_id = $2 AND comparable = true
     ORDER BY finalized_at DESC LIMIT 30`,
    [input.workspaceId, input.scope.scopeId],
  );
  const totals = await client.query(
    `SELECT COUNT(*) AS completed,
            COUNT(*) FILTER (WHERE finalized_at >= $3) AS stable
     FROM tokenless_agent_evaluation_observations
     WHERE workspace_id = $1 AND scope_id = $2 AND comparable = true`,
    [input.workspaceId, input.scope.scopeId, input.scope.stageEnteredAt],
  );
  const completed = rowInteger(totals.rows[0] as QueryRow, "completed");
  const stable = rowInteger(totals.rows[0] as QueryRow, "stable");
  const latestRows = (observations.rows as QueryRow[]).slice(0, 15);
  const previousRows = (observations.rows as QueryRow[]).slice(15, 30);
  const result = nextAdaptiveStage({
    policy: policyMath(input.policy),
    state: { ...input.scope, completedComparableCases: completed, stableCasesSinceStage: stable },
    latestWindow: observationWindow(latestRows, input.policy),
    ...(previousRows.length > 0 ? { previousWindow: observationWindow(previousRows, input.policy) } : {}),
    resetReason: input.resetReason,
  });
  const now = new Date();
  const stageChanged = result.stage !== input.scope.stage;
  const resetToCalibration = stageChanged && result.stage === "calibrating";
  await client.query(
    `UPDATE tokenless_agent_evaluation_scopes
     SET stage = $1, completed_comparable_cases = $2, stable_cases_since_stage = $3,
         stage_entered_at = $4, updated_at = $5
     WHERE workspace_id = $6 AND scope_id = $7`,
    [
      result.stage,
      completed,
      stageChanged ? 0 : stable,
      stageChanged ? now : input.scope.stageEnteredAt,
      now,
      input.workspaceId,
      input.scope.scopeId,
    ],
  );
  if (stageChanged) {
    await recordPolicyEvent(client, {
      workspaceId: input.workspaceId,
      scopeId: input.scope.scopeId,
      policy: input.policy,
      eventType: resetToCalibration ? "reset" : "stage_changed",
      fromStage: input.scope.stage,
      toStage: result.stage,
      reasonCodes: [result.reason],
      actorReference: "adaptive-review-service",
      createdAt: now,
    });
  }
  return {
    ...input.scope,
    stage: result.stage,
    completedComparableCases: completed,
    stableCasesSinceStage: stageChanged ? 0 : stable,
    stageEnteredAt: stageChanged ? now : input.scope.stageEnteredAt,
  } satisfies ScopeRow;
}

async function loadPolicy(client: PoolClient, workspaceId: string, request: ReturnType<typeof normalizeRequest>) {
  const result = await client.query(
    `SELECT p.policy_id, p.version, p.agent_id, p.agent_version_id, p.mode,
            p.agreement_threshold_bps, p.production_floor_bps, p.fixed_rate_bps, p.maximum_unreviewed_gap,
            p.rules_json, p.audience_policy_json, p.publishing_policy_id
     FROM tokenless_agent_review_policies p
     JOIN tokenless_agents a
       ON a.workspace_id = p.workspace_id AND a.agent_id = p.agent_id AND a.status = 'active'
     JOIN tokenless_agent_versions v
       ON v.workspace_id = p.workspace_id AND v.agent_id = p.agent_id AND v.version_id = p.agent_version_id
     WHERE p.workspace_id = $1 AND p.policy_id = $2 AND p.version = $3
       AND p.agent_id = $4 AND p.agent_version_id = $5 AND p.enabled = true
       AND p.superseded_at IS NULL
     FOR SHARE`,
    [workspaceId, request.policyId, request.policyVersion, request.agentId, request.agentVersionId],
  );
  const policy = policyFromRow(result.rows[0] as QueryRow | undefined);
  if (policy.audiencePolicyHash !== request.audiencePolicyHash) {
    throw new TokenlessServiceError(
      "The opportunity audience does not match the frozen review policy.",
      409,
      "review_policy_mismatch",
    );
  }
  return policy;
}

async function loadHumanReviewBinding(
  client: PoolClient,
  workspaceId: string,
  request: ReturnType<typeof normalizeRequest>,
): Promise<HumanReviewBindingRow> {
  const result = await client.query(
    `SELECT b.binding_id, b.version AS binding_version,
            b.request_profile_id, b.request_profile_version, b.request_profile_hash,
            b.authority, b.publishing_policy_id, b.publishing_policy_version,
            r.configuration_status, r.audience, r.content_boundary, r.compensation_mode,
            r.feedback_bonus_enabled
     FROM tokenless_agent_human_review_bindings b
     JOIN tokenless_agent_review_request_profiles r
       ON r.workspace_id = b.workspace_id
      AND r.profile_id = b.request_profile_id
      AND r.version = b.request_profile_version
      AND r.profile_hash = b.request_profile_hash
      AND r.agent_id = b.agent_id
      AND r.agent_version_id = b.agent_version_id
     WHERE b.workspace_id = $1
       AND b.agent_id = $2 AND b.agent_version_id = $3
       AND b.selection_policy_id = $4 AND b.selection_policy_version = $5
       AND b.enabled = true AND b.superseded_at IS NULL
     FOR SHARE`,
    [workspaceId, request.agentId, request.agentVersionId, request.policyId, request.policyVersion],
  );
  const row = result.rows[0] as QueryRow | undefined;
  const bindingId = rowString(row, "binding_id");
  const requestProfileId = rowString(row, "request_profile_id");
  const requestProfileHash = rowString(row, "request_profile_hash");
  const configurationStatus = rowString(row, "configuration_status");
  const authority = rowString(row, "authority");
  const audience = rowString(row, "audience");
  const contentBoundary = rowString(row, "content_boundary");
  const compensationMode = rowString(row, "compensation_mode");
  const feedbackBonusEnabled = rowBoolean(row, "feedback_bonus_enabled");
  const publishingPolicyId = rowString(row, "publishing_policy_id");
  const publishingPolicyVersion = rowOptionalInteger(row, "publishing_policy_version");
  if (
    result.rowCount !== 1 ||
    !bindingId ||
    !requestProfileId ||
    !requestProfileHash ||
    !HASH_PATTERN.test(requestProfileHash) ||
    (configurationStatus !== "ready" && configurationStatus !== "action_required") ||
    !["check_only", "prepare_for_approval", "ask_automatically"].includes(authority ?? "") ||
    !["private_invited", "public_network", "hybrid"].includes(audience ?? "") ||
    !["private_workspace", "public_or_test"].includes(contentBoundary ?? "") ||
    !["unpaid", "usdc"].includes(compensationMode ?? "") ||
    (publishingPolicyId === null) !== (publishingPolicyVersion === null)
  ) {
    throw new TokenlessServiceError(
      "The exact human-review configuration is unavailable.",
      409,
      "human_review_configuration_required",
    );
  }
  if (configurationStatus === "action_required") {
    throw new TokenlessServiceError(
      "The human-review request profile still requires owner configuration.",
      409,
      "human_review_configuration_action_required",
    );
  }
  return {
    bindingId,
    bindingVersion: rowInteger(row, "binding_version"),
    requestProfileId,
    requestProfileVersion: rowInteger(row, "request_profile_version"),
    requestProfileHash,
    configurationStatus,
    authority: authority as HumanReviewBindingRow["authority"],
    publishingPolicyId,
    publishingPolicyVersion,
    audience: audience as HumanReviewBindingRow["audience"],
    contentBoundary: contentBoundary as HumanReviewBindingRow["contentBoundary"],
    compensationMode: compensationMode as HumanReviewBindingRow["compensationMode"],
    feedbackBonusEnabled,
  };
}

async function verifyIntegrationBinding(
  client: PoolClient,
  input: {
    workspaceId: string;
    integrationId: string | null;
    request: ReturnType<typeof normalizeRequest>;
    binding: HumanReviewBindingRow;
    apiKeyId: string;
  },
): Promise<IntegrationReviewGrant> {
  if (input.integrationId === null) return { active: false, reason: "integration_not_supplied" };
  const integrationResult = await client.query(
    `SELECT i.activation_mode, i.granted_scopes_json, i.allowed_workflow_keys_json,
            i.publishing_policy_id, i.publishing_policy_version,
            i.api_key_id, i.token_family_id, i.connection_intent_id
     FROM tokenless_agent_integrations i
     WHERE i.workspace_id = $1 AND i.integration_id = $2 AND i.status = 'active'
       AND i.agent_id = $3 AND i.agent_version_id = $4
       AND i.review_policy_id = $5 AND i.review_policy_version = $6
       AND i.human_review_binding_id = $7 AND i.human_review_binding_version = $8
     FOR SHARE`,
    [
      input.workspaceId,
      input.integrationId,
      input.request.agentId,
      input.request.agentVersionId,
      input.request.policyId,
      input.request.policyVersion,
      input.binding.bindingId,
      input.binding.bindingVersion,
    ],
  );
  if (integrationResult.rowCount !== 1) {
    throw new TokenlessServiceError(
      "The agent connection is not bound to this exact human-review configuration.",
      409,
      "human_review_integration_binding_mismatch",
    );
  }
  const integration = integrationResult.rows[0] as QueryRow;
  const connectionIntentId = rowString(integration, "connection_intent_id");
  const publishingPolicyId = rowString(integration, "publishing_policy_id");
  const publishingPolicyVersion = rowOptionalInteger(integration, "publishing_policy_version");
  const connectionResult = connectionIntentId
    ? await client.query(
        `SELECT status
         FROM tokenless_agent_connection_intents
         WHERE workspace_id = $1 AND intent_id = $2
         FOR SHARE`,
        [input.workspaceId, connectionIntentId],
      )
    : null;
  const publishingPolicyResult =
    publishingPolicyId && publishingPolicyVersion !== null
      ? await client.query(
          `SELECT enabled, revoked_at, effective_at, expires_at
           FROM tokenless_agent_publishing_policies
           WHERE workspace_id = $1 AND policy_id = $2 AND version = $3
           FOR SHARE`,
          [input.workspaceId, publishingPolicyId, publishingPolicyVersion],
        )
      : null;
  const connection = connectionResult?.rows[0] as QueryRow | undefined;
  const publishingPolicy = publishingPolicyResult?.rows[0] as QueryRow | undefined;
  const callerCredentialId = rowString(integration, "token_family_id") ?? rowString(integration, "api_key_id");
  if (callerCredentialId !== input.apiKeyId) {
    throw new TokenlessServiceError(
      "The agent connection credential does not match this evaluator.",
      409,
      "human_review_integration_binding_mismatch",
    );
  }
  const scopes = parseStringArray(integration.granted_scopes_json, "integration scopes");
  const workflows = parseStringArray(integration.allowed_workflow_keys_json, "integration workflows");
  const effectiveAt = new Date(String(publishingPolicy?.effective_at));
  const expiresAt = publishingPolicy?.expires_at ? new Date(String(publishingPolicy.expires_at)) : null;
  const now = Date.now();
  const policyActive =
    rowBoolean(publishingPolicy, "enabled") &&
    (publishingPolicy?.revoked_at === null || publishingPolicy?.revoked_at === undefined) &&
    Number.isFinite(effectiveAt.getTime()) &&
    effectiveAt.getTime() <= now &&
    (!expiresAt || (Number.isFinite(expiresAt.getTime()) && expiresAt.getTime() > now));
  const exactPolicy =
    input.binding.publishingPolicyId !== null &&
    publishingPolicyId === input.binding.publishingPolicyId &&
    publishingPolicyVersion === input.binding.publishingPolicyVersion;
  const active =
    rowString(integration, "activation_mode") === "owner_approved" &&
    rowString(connection, "status") === "connected" &&
    exactPolicy &&
    policyActive &&
    workflows.includes(input.request.workflowKey) &&
    scopes.includes("panel:publish") &&
    (!humanReviewRequiresPayment(input.binding) || scopes.includes("payment:submit"));
  return { active, reason: active ? "active_exact_owner_grant" : "owner_grant_inactive" };
}

function decisionForMode(input: {
  policy: ReviewPolicyRow;
  request: ReturnType<typeof normalizeRequest>;
  scope: ScopeRow;
  sampler: ReturnType<typeof samplerConfig>;
}) {
  const criticalRisk =
    input.request.criticalRisk || input.policy.rules.criticalRiskTiers.includes(input.request.riskTier);
  const confidenceBelowMinimum =
    input.policy.rules.minimumConfidenceBps !== null &&
    input.request.declaredConfidenceBps !== null &&
    input.request.declaredConfidenceBps < input.policy.rules.minimumConfidenceBps;
  const metadataComplete =
    input.request.metadataComplete &&
    (input.policy.rules.minimumConfidenceBps === null || input.request.declaredConfidenceBps !== null);
  if (input.policy.mode === "fixed") {
    if (input.policy.fixedRateBps === null) throw new Error("Fixed review rate is unavailable.");
    const fixed = decideFixedReview({
      samplerKey: input.sampler.key,
      samplerKeyVersion: input.sampler.version,
      opportunityId: input.request.externalOpportunityId,
      scopeId: input.scope.scopeId,
      policy: {
        policyVersion: input.policy.policyVersion,
        fixedRateBps: input.policy.fixedRateBps,
        maximumUnreviewedGap: input.policy.maximumUnreviewedGap,
      },
      state: input.scope,
      criticalRisk,
      metadataComplete,
      confidenceBelowMinimum,
    });
    return {
      ...fixed,
      decision: fixed.required ? ("required" as const) : ("skip" as const),
      criticalRisk,
    };
  }
  const sampledDecision = decideAdaptiveReview({
    samplerKey: input.sampler.key,
    samplerKeyVersion: input.sampler.version,
    opportunityId: input.request.externalOpportunityId,
    scopeId: input.scope.scopeId,
    policy: policyMath(input.policy),
    state: input.scope,
    criticalRisk,
    metadataComplete,
  });
  const sampled = confidenceBelowMinimum
    ? {
        ...sampledDecision,
        required: true,
        reasonCodes: ["low_confidence", ...sampledDecision.reasonCodes.filter(reason => reason !== "not_sampled")],
      }
    : sampledDecision;
  if (input.policy.mode === "manual") {
    return {
      ...sampled,
      required: false,
      decision: "recommended" as const,
      reviewRateBps: 0,
      selectionProbabilityBps: 0,
      criticalRisk,
      reasonCodes: ["manual_handoff"],
    };
  }
  if (input.policy.mode === "always") {
    return {
      ...sampled,
      required: true,
      decision: "required" as const,
      reviewRateBps: 10_000,
      selectionProbabilityBps: 10_000,
      criticalRisk,
      reasonCodes: ["always_review"],
    };
  }
  if (input.policy.mode === "rules") {
    const confidenceRequired =
      input.policy.rules.minimumConfidenceBps !== null &&
      (input.request.declaredConfidenceBps === null ||
        input.request.declaredConfidenceBps < input.policy.rules.minimumConfidenceBps);
    const rulesMatch = input.policy.rules.requiredRiskTiers.includes(input.request.riskTier) || confidenceRequired;
    const required = criticalRisk || !metadataComplete || rulesMatch;
    return {
      ...sampled,
      required,
      decision: required ? ("required" as const) : ("skip" as const),
      reviewRateBps: required ? 10_000 : 0,
      selectionProbabilityBps: required ? 10_000 : 0,
      criticalRisk,
      reasonCodes: criticalRisk
        ? ["critical_risk"]
        : !metadataComplete
          ? ["missing_metadata"]
          : [rulesMatch ? "rules_match" : "no_rule_match"],
    };
  }
  if (!ADAPTIVE_SAFETY_GATES_AVAILABLE) {
    return {
      ...sampled,
      required: true,
      decision: "required" as const,
      reviewRateBps: 10_000,
      selectionProbabilityBps: 10_000,
      criticalRisk,
      reasonCodes: [
        ...sampled.reasonCodes.filter(reason => reason !== "sampled" && reason !== "not_sampled"),
        "safety_gates_unavailable",
      ],
    };
  }
  const forced = sampled.reasonCodes.some(reason => reason !== "sampled" && reason !== "not_sampled");
  return {
    ...sampled,
    decision: sampled.required ? ("required" as const) : ("skip" as const),
    selectionProbabilityBps: forced ? 10_000 : sampled.reviewRateBps,
    criticalRisk,
  };
}

function parseReasonCodes(value: unknown) {
  if (typeof value !== "string") throw new Error("Database returned invalid review reasons.");
  const parsed = JSON.parse(value) as unknown;
  if (!Array.isArray(parsed) || parsed.some(reason => typeof reason !== "string")) {
    throw new Error("Database returned invalid review reasons.");
  }
  return parsed as string[];
}

function initialLifecycleDisposition(input: {
  decision: "required" | "recommended" | "skip";
  binding: HumanReviewBindingRow;
  policy: ReviewPolicyRow;
  grant: IntegrationReviewGrant;
  networkPanelsEnabled: boolean;
  workspaceStopped: boolean;
}) {
  if (input.workspaceStopped) {
    // The workspace-wide stop control fails every new opportunity closed,
    // including ones the policy would otherwise skip: no output may release
    // while the stop is engaged.
    return { state: "blocked" as const, reason: "workspace_stopped" };
  }
  if (input.decision !== "required") {
    return { state: "skipped" as const, reason: "selection_skipped" };
  }
  if (input.binding.authority === "check_only") {
    return { state: "approval_required" as const, reason: "check_only_owner_action_required" };
  }
  if (input.binding.authority === "prepare_for_approval") {
    return { state: "approval_required" as const, reason: "owner_approval_required" };
  }
  if (!input.grant.active) {
    return { state: "approval_required" as const, reason: input.grant.reason };
  }
  const privateInvitedUnpaidLane =
    input.binding.audience === "private_invited" &&
    input.binding.contentBoundary === "private_workspace" &&
    input.binding.compensationMode === "unpaid" &&
    input.binding.publishingPolicyId !== null &&
    input.binding.publishingPolicyId === input.policy.publishingPolicyId;
  if (privateInvitedUnpaidLane) {
    return { state: "request_ready" as const, reason: "private_invited_unpaid_lane_ready" };
  }
  const publicPaidLane =
    input.binding.audience === "public_network" &&
    input.binding.contentBoundary === "public_or_test" &&
    input.binding.compensationMode === "usdc" &&
    input.binding.publishingPolicyId !== null &&
    input.binding.publishingPolicyId === input.policy.publishingPolicyId;
  if (!publicPaidLane || !input.networkPanelsEnabled) {
    return { state: "blocked" as const, reason: "public_paid_lane_unavailable" };
  }
  return { state: "request_ready" as const, reason: "public_paid_lane_ready" };
}

function lifecycleFromRow(row: QueryRow) {
  const state = rowString(row, "state") as HumanReviewOpportunityState | null;
  if (
    !state ||
    ![
      "evaluating",
      "skipped",
      "approval_required",
      "request_ready",
      "pending",
      "blocked",
      "completed",
      "inconclusive",
      "failed_terminal",
      "cancelled_before_commit",
    ].includes(state)
  ) {
    throw new Error("Database returned an invalid opportunity lifecycle.");
  }
  const stateEnteredAt =
    row.state_entered_at instanceof Date ? row.state_entered_at : new Date(String(row.state_entered_at));
  if (!Number.isFinite(stateEnteredAt.getTime())) throw new Error("Database returned an invalid lifecycle timestamp.");
  return {
    state,
    revision: rowInteger(row, "state_revision"),
    terminal: row.terminal_at !== null && row.terminal_at !== undefined,
    reasonCodes: parseReasonCodes(row.reason_codes_json),
    stateEnteredAt: stateEnteredAt.toISOString(),
  } satisfies AdaptiveReviewDecision["lifecycle"];
}

function projectedLegacyOpportunityStatus(state: HumanReviewOpportunityState) {
  if (state === "skipped") return "skipped";
  if (state === "pending") return "review_requested";
  if (state === "completed" || state === "inconclusive") return "completed";
  if (state === "failed_terminal") return "failed";
  return "decided";
}

async function stateMetrics(client: PoolClient, workspaceId: string, scopeId: string) {
  const result = await client.query(
    `SELECT
       COUNT(*) FILTER (WHERE status IN ('review_requested', 'completed')) AS reviewed,
       COUNT(*) FILTER (WHERE status = 'skipped') AS skipped
     FROM tokenless_agent_review_opportunities
     WHERE workspace_id = $1 AND scope_id = $2`,
    [workspaceId, scopeId],
  );
  const observations = await client.query(
    `SELECT COUNT(*) FILTER (WHERE comparable = true) AS comparable,
            COUNT(*) FILTER (WHERE comparable = true AND agreement = 'agree') AS agreements
     FROM tokenless_agent_evaluation_observations
     WHERE workspace_id = $1 AND scope_id = $2`,
    [workspaceId, scopeId],
  );
  const comparable = rowInteger(observations.rows[0] as QueryRow, "comparable");
  const agreements = rowInteger(observations.rows[0] as QueryRow, "agreements");
  const interval = comparable > 0 ? wilsonIntervalBps(agreements, comparable) : null;
  return {
    reviewed: rowInteger(result.rows[0] as QueryRow, "reviewed"),
    skipped: rowInteger(result.rows[0] as QueryRow, "skipped"),
    humanAgreementBps: comparable > 0 ? Math.floor((agreements * 10_000) / comparable) : null,
    humanAgreementLower95Bps: interval?.lower ?? null,
  };
}

function nextReassessmentAfter(scope: ScopeRow) {
  if (scope.stage === "calibrating") return Math.max(0, 30 - scope.completedComparableCases);
  if (scope.stage === "high_coverage") return Math.max(0, 50 - scope.stableCasesSinceStage);
  if (scope.stage === "medium_coverage") return Math.max(0, 100 - scope.stableCasesSinceStage);
  return 0;
}

async function assuranceState(
  client: PoolClient,
  input: { workspaceId: string; policy: ReviewPolicyRow; scope: ScopeRow },
): Promise<AdaptiveAssuranceState> {
  const metrics = await stateMetrics(client, input.workspaceId, input.scope.scopeId);
  const rate = Math.max(
    input.scope.stage === "calibrating"
      ? 10_000
      : input.scope.stage === "high_coverage"
        ? 5_000
        : input.scope.stage === "medium_coverage"
          ? 2_500
          : 1_000,
    input.policy.productionFloorBps,
  );
  return {
    schemaVersion: "rateloop.assurance-state.v1",
    workspaceId: input.workspaceId,
    agentId: input.policy.agentId,
    agentVersionId: input.policy.agentVersionId,
    scopeId: input.scope.scopeId,
    policyId: input.policy.policyId,
    policyVersion: input.policy.policyVersion,
    stage: input.scope.stage,
    reviewRateBps:
      input.policy.mode === "always"
        ? 10_000
        : input.policy.mode === "fixed"
          ? (input.policy.fixedRateBps ?? 0)
          : input.policy.mode === "adaptive"
            ? rate
            : 0,
    completedComparableCases: input.scope.completedComparableCases,
    stableCasesSinceStage: input.scope.stableCasesSinceStage,
    reviewedOpportunityCount: metrics.reviewed,
    skippedOpportunityCount: metrics.skipped,
    humanAgreementBps: metrics.humanAgreementBps,
    humanAgreementLower95Bps: metrics.humanAgreementLower95Bps,
    nextReassessmentAfter: input.policy.mode === "adaptive" ? nextReassessmentAfter(input.scope) : 0,
    executionProfileHash: input.scope.executionProfileHash,
    executionProfile: input.scope.executionProfile,
  };
}

function parentFirstGenerationSpans(execution: NormalizedAgentExecutionProvenance) {
  const byId = new Map(execution.generationSpans.map(span => [span.spanId, span]));
  const depths = new Map<string, number>();
  const depth = (spanId: string): number => {
    const known = depths.get(spanId);
    if (known !== undefined) return known;
    const parentSpanId = byId.get(spanId)?.parentSpanId ?? null;
    const value = parentSpanId ? depth(parentSpanId) + 1 : 0;
    depths.set(spanId, value);
    return value;
  };
  return [...execution.generationSpans].sort(
    (left, right) => depth(left.spanId) - depth(right.spanId) || left.spanId.localeCompare(right.spanId),
  );
}

async function persistExecution(
  client: PoolClient,
  input: {
    workspaceId: string;
    agentId: string;
    agentVersionId: string;
    integrationId: string | null;
    execution: NormalizedAgentExecutionProvenance;
    createdAt: Date;
  },
) {
  const executionId = deterministicId("aex", [input.workspaceId, input.agentId, input.execution.externalExecutionId]);
  const existing = await client.query(
    `SELECT execution_id, agent_version_id, integration_id, manifest_commitment, execution_profile_hash
     FROM tokenless_agent_executions
     WHERE workspace_id = $1 AND agent_id = $2 AND external_execution_id = $3
     FOR UPDATE`,
    [input.workspaceId, input.agentId, input.execution.externalExecutionId],
  );
  const row = existing.rows[0] as QueryRow | undefined;
  if (row) {
    const storedProfileHash = rowString(row, "execution_profile_hash");
    if (
      rowString(row, "execution_id") !== executionId ||
      rowString(row, "agent_version_id") !== input.agentVersionId ||
      rowString(row, "integration_id") !== input.integrationId ||
      rowString(row, "manifest_commitment") !== input.execution.manifestCommitment ||
      (storedProfileHash !== input.execution.executionProfileHash &&
        storedProfileHash !== legacyAgentExecutionProfileHash(input.execution))
    ) {
      throw new TokenlessServiceError(
        "externalExecutionId is already bound to different immutable provenance.",
        409,
        "execution_provenance_conflict",
      );
    }
    return executionId;
  }
  await client.query(
    `INSERT INTO tokenless_agent_executions
     (execution_id, workspace_id, agent_id, agent_version_id, integration_id, external_execution_id,
      status, metadata_source, started_at, completed_at, total_duration_ms, tool_call_count, tool_duration_ms,
      model_call_count, input_token_total, cached_input_token_total, output_token_total,
      reasoning_output_token_total, primary_span_id, manifest_commitment, execution_profile_hash,
      execution_profile_json, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 'host_reported', $8, $9, $10, $11, $12, $13, $14,
             $15, $16, $17, $18, $19, $20, $21, $22)`,
    [
      executionId,
      input.workspaceId,
      input.agentId,
      input.agentVersionId,
      input.integrationId,
      input.execution.externalExecutionId,
      input.execution.status,
      input.execution.startedAt ? new Date(input.execution.startedAt) : null,
      input.execution.completedAt ? new Date(input.execution.completedAt) : null,
      input.execution.durationMs,
      input.execution.toolCallCount,
      input.execution.toolDurationMs,
      input.execution.totals.generationSpanCount,
      input.execution.totals.inputTokens,
      input.execution.totals.cachedInputTokens,
      input.execution.totals.outputTokens,
      input.execution.totals.reasoningOutputTokens,
      input.execution.primarySpanId,
      input.execution.manifestCommitment,
      input.execution.executionProfileHash,
      JSON.stringify(input.execution.executionProfile),
      input.createdAt,
    ],
  );
  for (const span of parentFirstGenerationSpans(input.execution)) {
    await client.query(
      `INSERT INTO tokenless_agent_generation_spans
       (execution_id, span_id, parent_span_id, role, provider, requested_model, resolved_model, model_version,
        reasoning_effort, service_tier, started_at, completed_at, duration_ms, time_to_first_output_ms,
        input_tokens, cached_input_tokens, output_tokens, reasoning_output_tokens, response_id_hash,
        finish_reason, metadata_source)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17,
               $18, $19, $20, 'host_reported')`,
      [
        executionId,
        span.spanId,
        span.parentSpanId,
        span.role,
        span.provider,
        span.requestedModel,
        span.resolvedModel,
        span.modelVersion,
        span.reasoningEffort,
        span.serviceTier,
        span.startedAt ? new Date(span.startedAt) : null,
        span.completedAt ? new Date(span.completedAt) : null,
        span.durationMs,
        span.timeToFirstOutputMs,
        span.inputTokens,
        span.cachedInputTokens,
        span.outputTokens,
        span.reasoningOutputTokens,
        span.responseIdHash,
        span.finishReason,
      ],
    );
  }
  return executionId;
}

function replayMatches(
  row: QueryRow,
  request: ReturnType<typeof normalizeRequest>,
  scopeId: string,
  executionId: string,
  metadataCommitment: string,
  effectiveCriticalRisk: boolean,
  binding: HumanReviewBindingRow,
) {
  return (
    rowString(row, "agent_id") === request.agentId &&
    rowString(row, "agent_version_id") === request.agentVersionId &&
    rowString(row, "scope_id") === scopeId &&
    rowString(row, "policy_id") === request.policyId &&
    rowInteger(row, "policy_version") === request.policyVersion &&
    rowString(row, "human_review_binding_id") === binding.bindingId &&
    rowInteger(row, "human_review_binding_version") === binding.bindingVersion &&
    rowString(row, "request_profile_id") === binding.requestProfileId &&
    rowInteger(row, "request_profile_version") === binding.requestProfileVersion &&
    rowString(row, "request_profile_hash") === binding.requestProfileHash &&
    rowString(row, "suggestion_commitment") === request.suggestionCommitment &&
    rowString(row, "metadata_commitment") === metadataCommitment &&
    rowString(row, "execution_id") === executionId &&
    rowString(row, "source_evidence_reference") === request.sourceEvidenceReference &&
    rowString(row, "source_evidence_hash") === request.sourceEvidenceHash &&
    (row.declared_confidence_bps === null ? null : Number(row.declared_confidence_bps)) ===
      request.declaredConfidenceBps &&
    rowBoolean(row, "critical_risk") === effectiveCriticalRisk &&
    rowBoolean(row, "metadata_complete") === request.metadataComplete
  );
}

export async function authenticateAdaptiveReviewPrincipal(
  authorization: string | null,
  scope: "evaluation:read" | "review:decide",
): Promise<AdaptivePrincipal> {
  if (!authorization) {
    throw new TokenlessServiceError("A workspace API key is required.", 401, "workspace_api_key_required");
  }
  const principal = await authenticateProductPrincipal({ authorization, sessionToken: undefined });
  if (principal.kind !== "api_key") {
    throw new TokenlessServiceError("A workspace API key is required.", 401, "workspace_api_key_required");
  }
  requireProductPrincipalScope(principal, scope);
  return principal;
}

export async function evaluateAdaptiveReviewRequirement(input: {
  principal: AdaptivePrincipal;
  request: AdaptiveReviewDecisionRequest;
  integrationId?: string | null;
}): Promise<AdaptiveReviewDecision> {
  requireProductPrincipalScope(input.principal, "review:decide");
  const request = normalizeRequest(input.request);
  if (!Number.isSafeInteger(request.policyVersion) || request.policyVersion < 1) {
    throw new TokenlessServiceError("policyVersion is invalid.", 400, "invalid_review_opportunity");
  }
  const sampler = samplerConfig();
  const workspaceId = input.principal.workspaceId;
  const integrationId =
    input.integrationId === undefined || input.integrationId === null
      ? null
      : boundedIdentifier(input.integrationId, "integrationId");
  const opportunityId = deterministicId("aop", [workspaceId, request.agentId, request.externalOpportunityId]);
  const client = await dbPool.connect();
  try {
    await client.query("BEGIN");
    const policy = await loadPolicy(client, workspaceId, request);
    const binding = await loadHumanReviewBinding(client, workspaceId, request);
    const grant = await verifyIntegrationBinding(client, {
      workspaceId,
      integrationId,
      request,
      binding,
      apiKeyId: input.principal.apiKeyId,
    });
    const currentScopeId = deterministicId("evs", [
      workspaceId,
      request.agentId,
      request.agentVersionId,
      request.policyId,
      String(request.policyVersion),
      binding.bindingId,
      String(binding.bindingVersion),
      binding.requestProfileId,
      String(binding.requestProfileVersion),
      binding.requestProfileHash,
      request.workflowKey,
      request.riskTier,
      request.audiencePolicyHash,
      request.execution.executionProfileHash,
    ]);
    const partitionCommitment = sha256({
      workspaceId,
      agentId: request.agentId,
      agentVersionId: request.agentVersionId,
      policyId: request.policyId,
      policyVersion: request.policyVersion,
      humanReviewBinding: { id: binding.bindingId, version: binding.bindingVersion },
      requestProfile: {
        id: binding.requestProfileId,
        version: binding.requestProfileVersion,
        hash: binding.requestProfileHash,
      },
      workflowKey: request.workflowKey,
      riskTier: request.riskTier,
      audiencePolicyHash: request.audiencePolicyHash,
      executionProfileHash: request.execution.executionProfileHash,
    });
    const metadataCommitment = sha256({
      workflowKey: request.workflowKey,
      riskTier: request.riskTier,
      audiencePolicyHash: request.audiencePolicyHash,
      requestProfileHash: binding.requestProfileHash,
      declaredConfidenceBps: request.declaredConfidenceBps,
      criticalRisk: request.criticalRisk,
      metadataComplete: request.metadataComplete,
      sourceEvidenceHash: request.sourceEvidenceHash,
      executionManifestCommitment: request.execution.manifestCommitment,
    });
    const now = new Date();
    const executionId = await persistExecution(client, {
      workspaceId,
      agentId: request.agentId,
      agentVersionId: request.agentVersionId,
      integrationId,
      execution: request.execution,
      createdAt: now,
    });
    const existing = await client.query(
      `SELECT * FROM tokenless_agent_review_opportunities
       WHERE workspace_id = $1 AND agent_id = $2 AND external_opportunity_id = $3
       FOR UPDATE`,
      [workspaceId, request.agentId, request.externalOpportunityId],
    );
    let opportunity = existing.rows[0] as QueryRow | undefined;
    const effectiveCriticalRisk = request.criticalRisk || policy.rules.criticalRiskTiers.includes(request.riskTier);
    const scopeId = opportunity ? rowString(opportunity, "scope_id") : currentScopeId;
    if (!scopeId) throw new Error("Stored review opportunity is missing its evaluation scope.");
    if (!opportunity) {
      const insertedScope = await client.query(
        `INSERT INTO tokenless_agent_evaluation_scopes
       (scope_id, workspace_id, agent_id, agent_version_id, policy_id, policy_version, workflow_key, risk_tier,
        audience_policy_hash, execution_profile_hash, execution_profile_json,
        human_review_binding_id, human_review_binding_version,
        request_profile_id, request_profile_version, request_profile_hash, partition_commitment, stage,
        completed_comparable_cases, stable_cases_since_stage, unreviewed_since_last_sample, stage_entered_at,
        updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17,
               'calibrating', 0, 0, 0, $18, $18)
       ON CONFLICT (scope_id) DO NOTHING RETURNING scope_id`,
        [
          scopeId,
          workspaceId,
          request.agentId,
          request.agentVersionId,
          request.policyId,
          request.policyVersion,
          request.workflowKey,
          request.riskTier,
          request.audiencePolicyHash,
          request.execution.executionProfileHash,
          JSON.stringify(request.execution.executionProfile),
          binding.bindingId,
          binding.bindingVersion,
          binding.requestProfileId,
          binding.requestProfileVersion,
          binding.requestProfileHash,
          partitionCommitment,
          now,
        ],
      );
      if (insertedScope.rowCount === 1) {
        await recordPolicyEvent(client, {
          workspaceId,
          scopeId,
          policy,
          eventType: "created",
          toStage: "calibrating",
          reasonCodes: ["scope_created"],
          actorReference: input.principal.apiKeyId,
          createdAt: now,
        });
      }
    }
    const scopeResult = await client.query(
      `SELECT scope_id, stage, completed_comparable_cases, stable_cases_since_stage,
              unreviewed_since_last_sample, stage_entered_at, execution_profile_hash, execution_profile_json
              , human_review_binding_id, human_review_binding_version,
              request_profile_id, request_profile_version, request_profile_hash
       FROM tokenless_agent_evaluation_scopes
       WHERE workspace_id = $1 AND scope_id = $2 FOR UPDATE`,
      [workspaceId, scopeId],
    );
    if (scopeResult.rowCount !== 1) throw new Error("Adaptive scope could not be locked.");
    let scope = scopeFromRow(scopeResult.rows[0] as QueryRow);
    if (
      opportunity &&
      !replayMatches(opportunity, request, scopeId, executionId, metadataCommitment, effectiveCriticalRisk, binding)
    ) {
      throw new TokenlessServiceError(
        "externalOpportunityId is already bound to different immutable inputs.",
        409,
        "review_opportunity_conflict",
      );
    }
    if (policy.mode === "adaptive") {
      const metadataReset = !request.metadataComplete && scope.stage !== "calibrating" ? "missing_metadata" : null;
      scope = await refreshScopeState(client, { workspaceId, scope, policy, resetReason: metadataReset });
    }

    let lifecycle: AdaptiveReviewDecision["lifecycle"] | undefined;
    if (!opportunity) {
      const stopState = await client.query(
        "SELECT 1 FROM tokenless_workspace_stop_states WHERE workspace_id = $1 AND status = 'engaged' LIMIT 1",
        [workspaceId],
      );
      const workspaceStopped = stopState.rows.length > 0;
      const decision = decisionForMode({ policy, request, scope, sampler });
      const disposition = initialLifecycleDisposition({
        decision: decision.decision,
        binding,
        policy,
        grant,
        networkPanelsEnabled:
          decision.required && binding.authority === "ask_automatically" && grant.active
            ? isWorldIdAssuranceEnabled()
            : false,
        workspaceStopped,
      });
      const status = projectedLegacyOpportunityStatus(disposition.state);
      const inserted = await client.query(
        `INSERT INTO tokenless_agent_review_opportunities
         (opportunity_id, workspace_id, agent_id, agent_version_id, scope_id, policy_id, policy_version,
          human_review_binding_id, human_review_binding_version,
          request_profile_id, request_profile_version, request_profile_hash,
          external_opportunity_id, execution_id, suggestion_commitment, suggestion_ciphertext, suggestion_key_ref,
          declared_confidence_bps, metadata_commitment, metadata_complete, critical_risk, decision,
          review_rate_bps, selection_probability_bps, sample_bucket, sampler_key_version, sampler_commitment,
          reason_codes_json, status, source_evidence_reference, source_evidence_hash, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, NULL, NULL,
                 $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28, $29, $30, $30)
         RETURNING *`,
        [
          opportunityId,
          workspaceId,
          request.agentId,
          request.agentVersionId,
          scopeId,
          request.policyId,
          request.policyVersion,
          binding.bindingId,
          binding.bindingVersion,
          binding.requestProfileId,
          binding.requestProfileVersion,
          binding.requestProfileHash,
          request.externalOpportunityId,
          executionId,
          request.suggestionCommitment,
          request.declaredConfidenceBps,
          metadataCommitment,
          request.metadataComplete,
          decision.criticalRisk,
          decision.decision,
          decision.reviewRateBps,
          decision.selectionProbabilityBps,
          decision.sampleBucket,
          sampler.version,
          decision.samplerCommitment,
          JSON.stringify(decision.reasonCodes),
          status,
          request.sourceEvidenceReference,
          request.sourceEvidenceHash,
          now,
        ],
      );
      opportunity = inserted.rows[0] as QueryRow;
      await client.query(
        `INSERT INTO tokenless_agent_review_opportunity_lifecycles
         (workspace_id, opportunity_id, state, state_revision, reason_codes_json,
          state_entered_at, terminal_at, created_at, updated_at)
         VALUES ($1, $2, 'evaluating', 1, '[]', $3, NULL, $3, $3)`,
        [workspaceId, opportunityId, now],
      );
      const actor = integrationId
        ? ({ kind: "agent", reference: integrationId } as const)
        : ({ kind: "service", reference: input.principal.apiKeyId } as const);
      const transition = await transitionHumanReviewOpportunityLifecycleInTransaction(client, {
        workspaceId,
        opportunityId,
        transitionKey: `evaluation:${sha256({
          actor: actor.reference,
          opportunityId,
          bindingId: binding.bindingId,
          bindingVersion: binding.bindingVersion,
        }).slice("sha256:".length)}`,
        expectedState: "evaluating",
        expectedRevision: 1,
        toState: disposition.state,
        reasonCodes: [...decision.reasonCodes, disposition.reason],
        actor,
        details: {
          apiKeyId: input.principal.apiKeyId,
          integrationId,
          humanReviewBindingId: binding.bindingId,
          humanReviewBindingVersion: binding.bindingVersion,
          legacyStatusProjection: status,
        },
        occurredAt: now,
      });
      lifecycle = {
        state: transition.toState,
        revision: transition.toRevision,
        terminal: transition.toState === "skipped",
        reasonCodes: transition.reasonCodes,
        stateEnteredAt: transition.occurredAt,
      };
      if (integrationId) {
        await client.query(
          `UPDATE tokenless_agent_integrations
           SET last_decision_at = CASE
             WHEN last_decision_at IS NULL OR last_decision_at < $1 THEN $1
             ELSE last_decision_at
           END,
           updated_at = CASE WHEN updated_at < $1 THEN $1 ELSE updated_at END
           WHERE integration_id = $2 AND workspace_id = $3 AND agent_id = $4 AND agent_version_id = $5
             AND human_review_binding_id = $6 AND human_review_binding_version = $7`,
          [
            now,
            integrationId,
            workspaceId,
            request.agentId,
            request.agentVersionId,
            binding.bindingId,
            binding.bindingVersion,
          ],
        );
      }
      await client.query(
        `UPDATE tokenless_agent_evaluation_scopes
         SET unreviewed_since_last_sample = $1, updated_at = $2
         WHERE workspace_id = $3 AND scope_id = $4`,
        [decision.required ? 0 : scope.unreviewedSinceLastSample + 1, now, workspaceId, scopeId],
      );
      scope = { ...scope, unreviewedSinceLastSample: decision.required ? 0 : scope.unreviewedSinceLastSample + 1 };
      if (
        decision.required &&
        decision.reasonCodes.some(
          reason => reason !== "sampled" && reason !== "calibrating" && reason !== "safety_gates_unavailable",
        )
      ) {
        await recordPolicyEvent(client, {
          workspaceId,
          scopeId,
          policy,
          eventType: "forced_review",
          fromStage: scope.stage,
          toStage: scope.stage,
          reasonCodes: decision.reasonCodes,
          actorReference: input.principal.apiKeyId,
          createdAt: now,
        });
      }
    }
    if (!lifecycle) {
      const lifecycleResult = await client.query(
        `SELECT state, state_revision, reason_codes_json, state_entered_at, terminal_at
         FROM tokenless_agent_review_opportunity_lifecycles
         WHERE workspace_id = $1 AND opportunity_id = $2
         FOR UPDATE`,
        [workspaceId, opportunityId],
      );
      const lifecycleRow = lifecycleResult.rows[0] as QueryRow | undefined;
      if (!lifecycleRow) throw new Error("Human-review opportunity lifecycle is unavailable.");
      lifecycle = lifecycleFromRow(lifecycleRow);
    }
    const state = await assuranceState(client, { workspaceId, policy, scope });
    await client.query("COMMIT");
    const decision = rowString(opportunity, "decision") as AdaptiveReviewDecision["decision"];
    return {
      ...state,
      schemaVersion: "rateloop.review-decision.v1",
      opportunityId: rowString(opportunity, "opportunity_id")!,
      externalOpportunityId: rowString(opportunity, "external_opportunity_id")!,
      decision,
      required: decision === "required",
      reasonCodes: parseReasonCodes(opportunity.reason_codes_json),
      selectionProbabilityBps: rowInteger(opportunity, "selection_probability_bps"),
      sampleBucket: rowInteger(opportunity, "sample_bucket"),
      policyFrozen: true,
      suggestionCommitment: rowString(opportunity, "suggestion_commitment")!,
      metadataCommitment: rowString(opportunity, "metadata_commitment")!,
      sourceEvidenceHash: rowString(opportunity, "source_evidence_hash")!,
      executionId,
      executionManifestCommitment: request.execution.manifestCommitment,
      executionEvidence: projectAgentExecutionEvidence({
        executionId,
        opportunityId: rowString(opportunity, "opportunity_id")!,
        metadataCommitment: rowString(opportunity, "metadata_commitment")!,
        execution: request.execution,
        ...(scope.executionProfile ? { profileSchemaVersion: scope.executionProfile.schemaVersion } : {}),
      }),
      createdAt: new Date(String(opportunity.created_at)).toISOString(),
      lifecycle,
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function getAdaptiveAssuranceState(input: {
  principal: AdaptivePrincipal;
  scopeId: string;
}): Promise<AdaptiveAssuranceState> {
  requireProductPrincipalScope(input.principal, "evaluation:read");
  const scopeId = boundedIdentifier(input.scopeId, "scopeId");
  const result = await dbClient.execute({
    sql: `SELECT s.scope_id, s.stage, s.completed_comparable_cases, s.stable_cases_since_stage,
                 s.unreviewed_since_last_sample, s.stage_entered_at,
                 s.execution_profile_hash, s.execution_profile_json,
                 s.human_review_binding_id, s.human_review_binding_version,
                 s.request_profile_id, s.request_profile_version, s.request_profile_hash,
                 p.policy_id, p.version, p.agent_id, p.agent_version_id, p.mode,
                 p.agreement_threshold_bps, p.production_floor_bps, p.fixed_rate_bps, p.maximum_unreviewed_gap,
                 p.rules_json, p.audience_policy_json
          FROM tokenless_agent_evaluation_scopes s
          JOIN tokenless_agent_review_policies p
            ON p.workspace_id = s.workspace_id AND p.policy_id = s.policy_id AND p.version = s.policy_version
          WHERE s.workspace_id = ? AND s.scope_id = ? LIMIT 1`,
    args: [input.principal.workspaceId, scopeId],
  });
  const row = result.rows[0] as QueryRow | undefined;
  if (!row) throw new TokenlessServiceError("Assurance state not found.", 404, "assurance_state_not_found");
  const client = await dbPool.connect();
  try {
    return await assuranceState(client, {
      workspaceId: input.principal.workspaceId,
      policy: policyFromRow(row),
      scope: scopeFromRow(row),
    });
  } finally {
    client.release();
  }
}

export const __adaptiveReviewServiceTestUtils = {
  humanAgreementGatePassed,
  initialLifecycleDisposition,
  sha256,
  verifyIntegrationBinding,
};
