import type { TokenlessAskResponse, TokenlessQuoteRequest } from "@rateloop/sdk";
import { createHash } from "node:crypto";
import "server-only";
import { dbClient, dbPool } from "~~/lib/db";
import { freezeAdmissionPolicy } from "~~/lib/tokenless/admissionPolicy";
import type { AgentMcpPrincipal } from "~~/lib/tokenless/agentIntegrations";
import { ensureFeedbackBonusPoolForDelivery } from "~~/lib/tokenless/feedbackBonusPoolProjection";
import { hashHumanReviewConfiguration } from "~~/lib/tokenless/humanReviewConfiguration";
import { transitionHumanReviewOpportunityLifecycleInTransaction } from "~~/lib/tokenless/humanReviewOpportunityLifecycle";
import {
  type BoundHumanReviewRequestProfile,
  type PreparedHumanReviewRequest,
  hashPreparedHumanReviewValue,
  prepareHumanReviewRequest,
} from "~~/lib/tokenless/humanReviewRequestPreparation";
import {
  type PreparedProductAsk,
  attachProductAsk,
  prepareProductAsk,
  releasePreparedProductAsk,
  requireProductPrincipalScope,
} from "~~/lib/tokenless/productCore";
import { hashReviewRequestProfile } from "~~/lib/tokenless/reviewRequestProfiles";
import { countEligibleNetworkExpertisePool } from "~~/lib/tokenless/reviewerExpertise";
import {
  expertiseQualificationRules,
  normalizeReviewerExpertiseKeys,
} from "~~/lib/tokenless/reviewerExpertiseVocabulary";
import { TokenlessServiceError, createTokenlessAsk, createTokenlessQuote } from "~~/lib/tokenless/server";
import { isWorldIdAssuranceEnabled } from "~~/lib/tokenless/worldIdAssurance";

type Row = Record<string, unknown>;
const BYTES32_PATTERN = /^0x[0-9a-f]{64}$/u;
const HASH_PATTERN = /^sha256:[0-9a-f]{64}$/u;
let beforePublicPaidActivationForTests:
  | null
  | ((input: { idempotencyKey: string; operationKey: string; opportunityId: string }) => Promise<void>) = null;

export type PublicPaidHumanReviewPrincipal = Extract<AgentMcpPrincipal, { kind: "integration" }>;

export type PublicPaidHumanReviewPublication = {
  visibility: "public";
  dataClassification: "public" | "synthetic" | "redacted";
  confirmedNoSensitiveData: true;
  redactionSummary?: string;
};

export type PublicPaidHumanReviewRequest = {
  principal: PublicPaidHumanReviewPrincipal;
  opportunityId: string;
  sourcePayload: string;
  suggestionPayload: string;
  publication: PublicPaidHumanReviewPublication;
  appOrigin: string;
};

type FrozenOpportunity = {
  opportunityId: string;
  decision: string;
  legacyStatus: string;
  operationKey: string | null;
  operationIdempotencyKey: string | null;
  operationWorkspaceId: string | null;
  sourceEvidenceHash: string;
  suggestionCommitment: string;
  workflowKey: string;
  createdAt: Date;
  lifecycle: { state: string; revision: number };
  binding: {
    id: string;
    version: number;
    canonicalHash: string;
    authority: "check_only" | "prepare_for_approval" | "ask_automatically";
  };
  requestProfile: BoundHumanReviewRequestProfile;
  selectionPolicy: { id: string; version: number };
  admissionPolicyHash: `0x${string}`;
  policy: {
    reviewEnabled: boolean;
    reviewSuperseded: boolean;
    bindingEnabled: boolean;
    bindingSuperseded: boolean;
    publishingEnabled: boolean;
    publishingRevoked: boolean;
    publishingEffectiveAt: Date;
    publishingExpiresAt: Date | null;
  };
};

type FrozenApproval = {
  approvalId: string;
  status: string;
  createdAt: Date;
  expiresAt: Date;
  consumedAt: Date | null;
  consumptionReference: string | null;
  requestProfileId: string;
  requestProfileVersion: number;
  requestProfileHash: string;
  sourceEvidenceHash: string;
  suggestionCommitment: string;
  preparedRequestJson: string;
  preparedRequestHash: string;
  derivedEconomicsJson: string;
  derivedEconomicsHash: string;
  maximumChargeAtomic: string;
};

function text(row: Row | undefined, key: string) {
  const value = row?.[key];
  return value === null || value === undefined ? null : String(value);
}

function bool(row: Row | undefined, key: string) {
  return row?.[key] === true || row?.[key] === "t" || row?.[key] === 1;
}

function integer(row: Row | undefined, key: string, minimum = 1, maximum = Number.MAX_SAFE_INTEGER) {
  const value = Number(row?.[key]);
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new TokenlessServiceError(`Stored ${key} is invalid.`, 500, "review_configuration_invalid");
  }
  return value;
}

function date(row: Row | undefined, key: string, nullable = false) {
  if (nullable && (row?.[key] === null || row?.[key] === undefined)) return null;
  const value = row?.[key] instanceof Date ? (row[key] as Date) : new Date(String(row?.[key]));
  if (!Number.isFinite(value.getTime())) {
    throw new TokenlessServiceError(`Stored ${key} is invalid.`, 500, "review_configuration_invalid");
  }
  return value;
}

function oneOf<Value extends string>(row: Row | undefined, key: string, values: readonly Value[]) {
  const value = text(row, key);
  if (!value || !values.includes(value as Value)) {
    throw new TokenlessServiceError(`Stored ${key} is invalid.`, 500, "review_configuration_invalid");
  }
  return value as Value;
}

function parseAdmissionHash(value: unknown) {
  try {
    const parsed = JSON.parse(String(value)) as unknown;
    if (!Array.isArray(parsed) || parsed.length !== 1 || !BYTES32_PATTERN.test(String(parsed[0]))) throw new Error();
    return String(parsed[0]).toLowerCase() as `0x${string}`;
  } catch {
    throw new TokenlessServiceError(
      "Public paid review requires exactly one admission policy.",
      409,
      "review_admission_policy_ambiguous",
    );
  }
}

function sha256(value: string) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function assertPrincipal(principal: PublicPaidHumanReviewPrincipal) {
  const integration = principal.integration;
  if (
    integration.status !== "active" ||
    principal.principal.kind !== "api_key" ||
    principal.principal.workspaceId !== integration.workspaceId ||
    principal.principal.policyId !== integration.publishingPolicyId ||
    !integration.publishingPolicyId ||
    !integration.publishingPolicyVersion
  ) {
    throw new TokenlessServiceError("The agent integration is not active.", 403, "integration_inactive");
  }
}

export function normalizePublicPaidReviewPublication(value: unknown): PublicPaidHumanReviewPublication {
  const declaration =
    value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
  const classification = declaration?.dataClassification;
  const redactionSummary = declaration?.redactionSummary;
  if (
    declaration?.visibility !== "public" ||
    !["public", "synthetic", "redacted"].includes(String(classification)) ||
    declaration.confirmedNoSensitiveData !== true ||
    (redactionSummary !== undefined && typeof redactionSummary !== "string") ||
    (classification === "redacted" && (typeof redactionSummary !== "string" || redactionSummary.trim().length < 10))
  ) {
    throw new TokenlessServiceError(
      "RateLoop-network review publication requires visibility 'public', dataClassification 'public', 'synthetic', or 'redacted', and confirmedNoSensitiveData true. Redacted work also requires a redactionSummary of at least 10 characters.",
      400,
      "invalid_review_publication",
    );
  }
  return {
    visibility: "public",
    dataClassification: classification as PublicPaidHumanReviewPublication["dataClassification"],
    confirmedNoSensitiveData: true,
    ...(typeof redactionSummary === "string" ? { redactionSummary: redactionSummary.trim() } : {}),
  };
}

function exactPayload(value: string, field: "sourcePayload" | "suggestionPayload") {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new TokenlessServiceError(`${field} must be a non-empty string.`, 400, "invalid_review_payload");
  }
  return value;
}

async function loadFrozenOpportunity(
  principal: PublicPaidHumanReviewPrincipal,
  opportunityId: string,
): Promise<FrozenOpportunity> {
  assertPrincipal(principal);
  const integration = principal.integration;
  const result = await dbClient.execute({
    sql: `SELECT o.opportunity_id, o.decision, o.status, o.operation_key,
                 o.source_evidence_hash, o.suggestion_commitment, o.policy_id, o.policy_version, o.created_at,
                 o.human_review_binding_id, o.human_review_binding_version,
                 l.state AS lifecycle_state, l.state_revision AS lifecycle_revision,
                 s.workflow_key,
                 rp.enabled AS review_policy_enabled, rp.superseded_at AS review_policy_superseded_at,
                 rp.publishing_policy_id AS review_publishing_policy_id,
                 b.binding_id AS bound_binding_id, b.version AS bound_binding_version,
                 b.enabled AS binding_enabled, b.superseded_at AS binding_superseded_at,
                 b.canonical_hash AS binding_canonical_hash, b.authority AS binding_authority,
                 b.selection_policy_id, b.selection_policy_version,
                 b.request_profile_id AS binding_profile_id,
                 b.request_profile_version AS binding_profile_version,
                 b.request_profile_hash AS binding_profile_hash,
                 b.publishing_policy_id AS binding_publishing_policy_id,
                 b.publishing_policy_version AS binding_publishing_policy_version,
                 rrp.profile_id, rrp.version AS request_profile_version, rrp.profile_hash,
                 rrp.agent_id AS profile_agent_id, rrp.agent_version_id AS profile_agent_version_id,
                 rrp.criterion, rrp.positive_label, rrp.negative_label, rrp.rationale_mode,
                 rrp.audience, rrp.content_boundary, rrp.private_sensitivity, rrp.private_group_id,
                 rrp.private_group_policy_version, rrp.private_group_policy_hash,
                 rrp.required_expertise_keys_json,rrp.response_window_seconds,
                 rrp.panel_size, rrp.compensation_mode,
                 rrp.bounty_per_seat_atomic,rrp.feedback_bonus_enabled,rrp.feedback_bonus_pool_atomic,
                 rrp.feedback_bonus_awarder_kind,rrp.feedback_bonus_awarder_account,
                 rrp.feedback_bonus_award_window_seconds,
                 pp.enabled AS publishing_policy_enabled, pp.revoked_at AS publishing_policy_revoked_at,
                 pp.effective_at AS publishing_policy_effective_at, pp.expires_at AS publishing_policy_expires_at,
                 pp.allowed_admission_policy_hashes_json,
                 a.idempotency_key AS operation_idempotency_key,
                 own.workspace_id AS operation_workspace_id
          FROM tokenless_agent_review_opportunities o
          JOIN tokenless_agent_review_opportunity_lifecycles l
            ON l.workspace_id = o.workspace_id AND l.opportunity_id = o.opportunity_id
          JOIN tokenless_agent_human_review_bindings b
            ON b.workspace_id = o.workspace_id
           AND b.binding_id = o.human_review_binding_id AND b.version = o.human_review_binding_version
          JOIN tokenless_agent_review_policies rp
            ON rp.workspace_id = o.workspace_id AND rp.policy_id = o.policy_id AND rp.version = o.policy_version
          JOIN tokenless_agent_review_request_profiles rrp
            ON rrp.workspace_id = o.workspace_id
           AND rrp.profile_id = o.request_profile_id
           AND rrp.version = o.request_profile_version
           AND rrp.profile_hash = o.request_profile_hash
          JOIN tokenless_agent_evaluation_scopes s
            ON s.workspace_id = o.workspace_id AND s.scope_id = o.scope_id
          JOIN tokenless_agent_publishing_policies pp
            ON pp.workspace_id = o.workspace_id AND pp.policy_id = ? AND pp.version = ?
          LEFT JOIN tokenless_agent_asks a ON a.operation_key = o.operation_key
          LEFT JOIN tokenless_ask_ownership own ON own.operation_key = o.operation_key
          WHERE o.workspace_id = ? AND o.agent_id = ? AND o.agent_version_id = ?
            AND o.policy_id = ? AND o.policy_version = ? AND o.opportunity_id = ?
          LIMIT 1`,
    args: [
      integration.publishingPolicyId,
      integration.publishingPolicyVersion,
      integration.workspaceId,
      integration.agentId,
      integration.agentVersionId,
      integration.reviewPolicyId,
      integration.reviewPolicyVersion,
      opportunityId,
    ],
  });
  const row = result.rows[0] as Row | undefined;
  if (!row) throw new TokenlessServiceError("Review opportunity not found.", 404, "review_opportunity_not_found");
  const profileHash = text(row, "profile_hash");
  const bindingCanonicalHash = text(row, "binding_canonical_hash");
  if (
    !profileHash ||
    !HASH_PATTERN.test(profileHash) ||
    !bindingCanonicalHash ||
    !HASH_PATTERN.test(bindingCanonicalHash)
  ) {
    throw new TokenlessServiceError("Stored review bindings are invalid.", 500, "review_configuration_invalid");
  }
  const profile: BoundHumanReviewRequestProfile = {
    id: text(row, "profile_id") ?? "",
    version: integer(row, "request_profile_version"),
    hash: profileHash as `sha256:${string}`,
    agentId: text(row, "profile_agent_id") ?? "",
    agentVersionId: text(row, "profile_agent_version_id") ?? "",
    criterion: text(row, "criterion") ?? "",
    positiveLabel: text(row, "positive_label") ?? "",
    negativeLabel: text(row, "negative_label") ?? "",
    rationaleMode: oneOf(row, "rationale_mode", ["off", "optional", "required"] as const),
    audience: oneOf(row, "audience", ["private_invited", "public_network", "hybrid"] as const),
    contentBoundary: oneOf(row, "content_boundary", ["private_workspace", "public_or_test"] as const),
    privateSensitivity:
      row.private_sensitivity === null || row.private_sensitivity === undefined
        ? null
        : oneOf(row, "private_sensitivity", ["internal", "confidential", "restricted", "regulated"] as const),
    privateGroupId: text(row, "private_group_id"),
    requiredExpertiseKeys: normalizeReviewerExpertiseKeys(
      JSON.parse(text(row, "required_expertise_keys_json") ?? "[]"),
    ),
    responseWindowSeconds: integer(row, "response_window_seconds", 1_200, 86_400),
    panelSize: integer(row, "panel_size", 1, 100),
    compensationMode: oneOf(row, "compensation_mode", ["unpaid", "usdc"] as const),
    bountyPerSeatAtomic: text(row, "bounty_per_seat_atomic"),
    feedbackBonusEnabled: bool(row, "feedback_bonus_enabled"),
    feedbackBonusPoolAtomic: text(row, "feedback_bonus_pool_atomic"),
    feedbackBonusAwarderKind: oneOf(row, "feedback_bonus_awarder_kind", ["requester", "designated"] as const),
    feedbackBonusAwarderAccount: text(row, "feedback_bonus_awarder_account"),
    feedbackBonusAwardWindowSeconds:
      row.feedback_bonus_award_window_seconds === null || row.feedback_bonus_award_window_seconds === undefined
        ? null
        : integer(row, "feedback_bonus_award_window_seconds", 3_600, 31_536_000),
  };
  const expectedProfileHash = hashReviewRequestProfile({
    agentId: profile.agentId,
    agentVersionId: profile.agentVersionId,
    criterion: profile.criterion,
    positiveLabel: profile.positiveLabel,
    negativeLabel: profile.negativeLabel,
    rationaleMode: profile.rationaleMode,
    audience: profile.audience,
    contentBoundary: profile.contentBoundary,
    privateSensitivity: profile.privateSensitivity,
    privateGroupId: profile.privateGroupId,
    privateGroupPolicyVersion:
      row.private_group_policy_version === null || row.private_group_policy_version === undefined
        ? null
        : integer(row, "private_group_policy_version"),
    privateGroupPolicyHash: text(row, "private_group_policy_hash"),
    requiredExpertiseKeys: profile.requiredExpertiseKeys,
    responseWindowSeconds: profile.responseWindowSeconds,
    panelSize: profile.panelSize,
    compensationMode: profile.compensationMode,
    bountyPerSeatAtomic: profile.bountyPerSeatAtomic,
    feedbackBonusEnabled: profile.feedbackBonusEnabled,
    feedbackBonusPoolAtomic: profile.feedbackBonusPoolAtomic,
    feedbackBonusAwarderKind: profile.feedbackBonusAwarderKind,
    feedbackBonusAwarderAccount: profile.feedbackBonusAwarderAccount,
    feedbackBonusAwardWindowSeconds: profile.feedbackBonusAwardWindowSeconds,
  });
  const authority = oneOf(row, "binding_authority", [
    "check_only",
    "prepare_for_approval",
    "ask_automatically",
  ] as const);
  const expectedBindingHash = hashHumanReviewConfiguration({
    workspaceId: integration.workspaceId,
    agentId: integration.agentId,
    agentVersionId: integration.agentVersionId,
    selectionPolicy: { id: text(row, "policy_id")!, version: integer(row, "policy_version") },
    requestProfile: { id: profile.id, version: profile.version, hash: profile.hash },
    publishingPolicy: {
      id: integration.publishingPolicyId!,
      version: integration.publishingPolicyVersion!,
    },
    authority,
  });
  const exactBinding =
    text(row, "bound_binding_id") === text(row, "human_review_binding_id") &&
    integer(row, "bound_binding_version") === integer(row, "human_review_binding_version") &&
    text(row, "selection_policy_id") === text(row, "policy_id") &&
    integer(row, "selection_policy_version") === integer(row, "policy_version") &&
    text(row, "binding_profile_id") === profile.id &&
    integer(row, "binding_profile_version") === profile.version &&
    text(row, "binding_profile_hash") === profile.hash &&
    text(row, "review_publishing_policy_id") === integration.publishingPolicyId &&
    text(row, "binding_publishing_policy_id") === integration.publishingPolicyId &&
    integer(row, "binding_publishing_policy_version") === integration.publishingPolicyVersion &&
    profile.agentId === integration.agentId &&
    profile.agentVersionId === integration.agentVersionId &&
    profile.hash === expectedProfileHash &&
    bindingCanonicalHash === expectedBindingHash;
  if (!exactBinding) {
    throw new TokenlessServiceError(
      "The opportunity no longer matches its exact frozen binding.",
      409,
      "review_configuration_mismatch",
    );
  }
  return {
    opportunityId: text(row, "opportunity_id")!,
    decision: text(row, "decision") ?? "",
    legacyStatus: text(row, "status") ?? "",
    operationKey: text(row, "operation_key"),
    operationIdempotencyKey: text(row, "operation_idempotency_key"),
    operationWorkspaceId: text(row, "operation_workspace_id"),
    sourceEvidenceHash: text(row, "source_evidence_hash") ?? "",
    suggestionCommitment: text(row, "suggestion_commitment") ?? "",
    workflowKey: text(row, "workflow_key") ?? "",
    createdAt: date(row, "created_at")!,
    lifecycle: {
      state: text(row, "lifecycle_state") ?? "",
      revision: integer(row, "lifecycle_revision"),
    },
    binding: {
      id: text(row, "human_review_binding_id")!,
      version: integer(row, "human_review_binding_version"),
      canonicalHash: bindingCanonicalHash,
      authority,
    },
    requestProfile: profile,
    selectionPolicy: { id: text(row, "policy_id")!, version: integer(row, "policy_version") },
    admissionPolicyHash: parseAdmissionHash(row.allowed_admission_policy_hashes_json),
    policy: {
      reviewEnabled: bool(row, "review_policy_enabled"),
      reviewSuperseded: row.review_policy_superseded_at !== null && row.review_policy_superseded_at !== undefined,
      bindingEnabled: bool(row, "binding_enabled"),
      bindingSuperseded: row.binding_superseded_at !== null && row.binding_superseded_at !== undefined,
      publishingEnabled: bool(row, "publishing_policy_enabled"),
      publishingRevoked: row.publishing_policy_revoked_at !== null && row.publishing_policy_revoked_at !== undefined,
      publishingEffectiveAt: date(row, "publishing_policy_effective_at")!,
      publishingExpiresAt: date(row, "publishing_policy_expires_at", true),
    },
  };
}

async function loadFrozenApproval(workspaceId: string, opportunityId: string): Promise<FrozenApproval | null> {
  const result = await dbClient.execute({
    sql: `SELECT * FROM tokenless_agent_review_approval_requests
          WHERE workspace_id = ? AND opportunity_id = ?
          ORDER BY revision DESC LIMIT 1`,
    args: [workspaceId, opportunityId],
  });
  const row = result.rows[0] as Row | undefined;
  if (!row) return null;
  return {
    approvalId: text(row, "approval_id")!,
    status: text(row, "status")!,
    createdAt: date(row, "created_at")!,
    expiresAt: date(row, "expires_at")!,
    consumedAt: date(row, "consumed_at", true),
    consumptionReference: text(row, "consumption_reference"),
    requestProfileId: text(row, "request_profile_id")!,
    requestProfileVersion: integer(row, "request_profile_version"),
    requestProfileHash: text(row, "request_profile_hash")!,
    sourceEvidenceHash: text(row, "source_evidence_hash")!,
    suggestionCommitment: text(row, "suggestion_commitment")!,
    preparedRequestJson: text(row, "prepared_request_json")!,
    preparedRequestHash: text(row, "prepared_request_hash")!,
    derivedEconomicsJson: text(row, "derived_economics_json")!,
    derivedEconomicsHash: text(row, "derived_economics_hash")!,
    maximumChargeAtomic: text(row, "maximum_charge_atomic")!,
  };
}

function assertRequestable(opportunity: FrozenOpportunity, principal: PublicPaidHumanReviewPrincipal) {
  const now = Date.now();
  if (opportunity.decision !== "required") {
    throw new TokenlessServiceError("This opportunity does not require human review.", 409, "review_not_required");
  }
  if (opportunity.lifecycle.state !== "request_ready" && opportunity.lifecycle.state !== "pending") {
    throw new TokenlessServiceError(
      "Public paid review requires a request_ready opportunity.",
      409,
      "human_review_lifecycle_not_request_ready",
    );
  }
  if (
    !opportunity.policy.reviewEnabled ||
    opportunity.policy.reviewSuperseded ||
    !opportunity.policy.bindingEnabled ||
    opportunity.policy.bindingSuperseded
  ) {
    throw new TokenlessServiceError("The exact review binding is not active.", 409, "review_policy_inactive");
  }
  if (
    !opportunity.policy.publishingEnabled ||
    opportunity.policy.publishingRevoked ||
    opportunity.policy.publishingEffectiveAt.getTime() > now ||
    (opportunity.policy.publishingExpiresAt && opportunity.policy.publishingExpiresAt.getTime() <= now)
  ) {
    throw new TokenlessServiceError("The bound publishing policy is not active.", 409, "publishing_policy_inactive");
  }
  if (
    opportunity.requestProfile.audience !== "public_network" ||
    opportunity.requestProfile.contentBoundary !== "public_or_test" ||
    opportunity.requestProfile.privateGroupId !== null ||
    opportunity.requestProfile.privateSensitivity !== null ||
    opportunity.requestProfile.compensationMode !== "usdc"
  ) {
    throw new TokenlessServiceError("This is not a public paid review opportunity.", 409, "review_lane_mismatch");
  }
  if (
    opportunity.lifecycle.state === "request_ready" &&
    (opportunity.operationKey || opportunity.legacyStatus !== "decided")
  ) {
    throw new TokenlessServiceError("The request-ready opportunity is already bound.", 409, "review_binding_conflict");
  }
  if (
    opportunity.lifecycle.state === "pending" &&
    (!opportunity.operationKey ||
      !opportunity.operationIdempotencyKey ||
      (opportunity.operationWorkspaceId !== null &&
        opportunity.operationWorkspaceId !== principal.integration.workspaceId) ||
      opportunity.legacyStatus !== "review_requested")
  ) {
    throw new TokenlessServiceError("The pending opportunity binding is incomplete.", 409, "review_binding_conflict");
  }
  if (!isWorldIdAssuranceEnabled()) {
    throw new TokenlessServiceError(
      "RateLoop-network assurance is disabled. Enable TOKENLESS_NETWORK_PANELS_ENABLED on the hosted service before retrying.",
      404,
      "network_panels_disabled",
    );
  }
}

async function assertAdmissionPolicyExpertiseBinding(opportunity: FrozenOpportunity) {
  const required = opportunity.requestProfile.requiredExpertiseKeys ?? [];
  if (required.length === 0) return;
  const policyHash = `sha256:${opportunity.admissionPolicyHash.slice(2)}`;
  const result = await dbClient.execute({
    sql: `SELECT policy_json FROM tokenless_assurance_audience_policies
          WHERE policy_hash=? AND reviewer_source='rateloop_network'`,
    args: [policyHash],
  });
  const requiredRules = expertiseQualificationRules(required);
  const exact = result.rows.some(value => {
    try {
      const frozen = freezeAdmissionPolicy(JSON.parse(text(value as Row, "policy_json") ?? "null"));
      if (frozen.admissionPolicyHash.toLowerCase() !== opportunity.admissionPolicyHash.toLowerCase()) return false;
      const rules = new Map(frozen.policy.requiredQualifications.map(rule => [rule.key, rule] as const));
      return requiredRules.every(rule => {
        const actual = rules.get(rule.key);
        return actual?.operator === "attested" && actual.value === true;
      });
    } catch {
      return false;
    }
  });
  if (!exact) {
    throw new TokenlessServiceError(
      "The frozen public admission policy does not enforce every expertise requirement in this review profile.",
      409,
      "expertise_admission_policy_mismatch",
    );
  }
}

function prepareExactRequest(input: {
  opportunity: FrozenOpportunity;
  approval: FrozenApproval | null;
  sourcePayload: string;
  suggestionPayload: string;
}) {
  const { opportunity, approval } = input;
  if (opportunity.binding.authority !== "ask_automatically" && !approval) {
    throw new TokenlessServiceError(
      "Owner approval is required before publishing this review.",
      409,
      "approval_required",
    );
  }
  if (approval && approval.status !== "approved" && approval.status !== "consumed") {
    throw new TokenlessServiceError("Owner approval is not actionable.", 409, "human_review_approval_not_actionable");
  }
  if (approval?.status === "approved" && approval.expiresAt.getTime() <= Date.now()) {
    throw new TokenlessServiceError("Owner approval expired before publication.", 409, "human_review_approval_expired");
  }
  const preparedAt = approval?.createdAt ?? opportunity.createdAt;
  const expiresAt =
    approval?.expiresAt ?? new Date(preparedAt.getTime() + opportunity.requestProfile.responseWindowSeconds * 1_000);
  const preparation = prepareHumanReviewRequest({
    opportunityId: opportunity.opportunityId,
    workflowKey: opportunity.workflowKey,
    requestProfile: opportunity.requestProfile,
    selectionPolicy: opportunity.selectionPolicy,
    contentCommitments: {
      source: opportunity.sourceEvidenceHash,
      suggestion: opportunity.suggestionCommitment,
    },
    preparedAt,
    expiresAt,
    sourcePayload: input.sourcePayload,
    suggestionPayload: input.suggestionPayload,
  });
  if (approval) {
    const tupleMatches =
      approval.requestProfileId === opportunity.requestProfile.id &&
      approval.requestProfileVersion === opportunity.requestProfile.version &&
      approval.requestProfileHash === opportunity.requestProfile.hash &&
      approval.sourceEvidenceHash === opportunity.sourceEvidenceHash &&
      approval.suggestionCommitment === opportunity.suggestionCommitment &&
      approval.preparedRequestHash === preparation.preparedRequestHash &&
      approval.derivedEconomicsHash === preparation.derivedEconomicsHash &&
      approval.maximumChargeAtomic === preparation.maximumChargeAtomic &&
      hashPreparedHumanReviewValue(JSON.parse(approval.preparedRequestJson)) === approval.preparedRequestHash &&
      hashPreparedHumanReviewValue(JSON.parse(approval.derivedEconomicsJson)) === approval.derivedEconomicsHash;
    if (!tupleMatches) {
      throw new TokenlessServiceError(
        "Owner approval does not match the exact frozen request.",
        409,
        "human_review_approval_conflict",
      );
    }
  }
  return preparation;
}

function deterministicAdapterKey(opportunity: FrozenOpportunity, preparation: PreparedHumanReviewRequest) {
  const hash = hashPreparedHumanReviewValue({
    schemaVersion: "rateloop.public-paid-review-adapter-key.v1",
    opportunityId: opportunity.opportunityId,
    profile: {
      id: opportunity.requestProfile.id,
      version: opportunity.requestProfile.version,
      hash: opportunity.requestProfile.hash,
    },
    binding: opportunity.binding,
    contentCommitments: {
      source: opportunity.sourceEvidenceHash,
      suggestion: opportunity.suggestionCommitment,
    },
    derivedEconomicsHash: preparation.derivedEconomicsHash,
  });
  return `adaptive-public-paid:${hash.slice("sha256:".length)}`;
}

async function finalizePublicPaidAsk(input: {
  principal: PublicPaidHumanReviewPrincipal;
  opportunity: FrozenOpportunity;
  approval: FrozenApproval | null;
  preparation: PreparedHumanReviewRequest;
  idempotencyKey: string;
  operationKey: string;
}) {
  const workspaceId = input.principal.integration.workspaceId;
  const client = await dbPool.connect();
  try {
    await client.query("BEGIN");
    const opportunityResult = await client.query(
      `SELECT operation_key, status, human_review_binding_id, human_review_binding_version,
              request_profile_id, request_profile_version, request_profile_hash,
              source_evidence_hash, suggestion_commitment
       FROM tokenless_agent_review_opportunities
       WHERE workspace_id = $1 AND opportunity_id = $2 FOR UPDATE`,
      [workspaceId, input.opportunity.opportunityId],
    );
    const row = opportunityResult.rows[0] as Row | undefined;
    if (
      !row ||
      text(row, "human_review_binding_id") !== input.opportunity.binding.id ||
      integer(row, "human_review_binding_version") !== input.opportunity.binding.version ||
      text(row, "request_profile_id") !== input.opportunity.requestProfile.id ||
      integer(row, "request_profile_version") !== input.opportunity.requestProfile.version ||
      text(row, "request_profile_hash") !== input.opportunity.requestProfile.hash ||
      text(row, "source_evidence_hash") !== input.opportunity.sourceEvidenceHash ||
      text(row, "suggestion_commitment") !== input.opportunity.suggestionCommitment ||
      (text(row, "operation_key") !== null && text(row, "operation_key") !== input.operationKey)
    ) {
      throw new TokenlessServiceError(
        "Review opportunity binding conflicts with this ask.",
        409,
        "review_binding_conflict",
      );
    }

    if (input.approval) {
      const approvalResult = await client.query(
        `SELECT status, prepared_request_hash, derived_economics_hash, consumed_at, consumption_reference,
                request_profile_id, request_profile_version, request_profile_hash,
                source_evidence_hash, suggestion_commitment, maximum_charge_atomic, expires_at
         FROM tokenless_agent_review_approval_requests
         WHERE workspace_id = $1 AND opportunity_id = $2 AND approval_id = $3 FOR UPDATE`,
        [workspaceId, input.opportunity.opportunityId, input.approval.approvalId],
      );
      const approval = approvalResult.rows[0] as Row | undefined;
      if (
        !approval ||
        text(approval, "prepared_request_hash") !== input.preparation.preparedRequestHash ||
        text(approval, "derived_economics_hash") !== input.preparation.derivedEconomicsHash ||
        text(approval, "request_profile_id") !== input.opportunity.requestProfile.id ||
        integer(approval, "request_profile_version") !== input.opportunity.requestProfile.version ||
        text(approval, "request_profile_hash") !== input.opportunity.requestProfile.hash ||
        text(approval, "source_evidence_hash") !== input.opportunity.sourceEvidenceHash ||
        text(approval, "suggestion_commitment") !== input.opportunity.suggestionCommitment ||
        text(approval, "maximum_charge_atomic") !== input.preparation.maximumChargeAtomic
      ) {
        throw new TokenlessServiceError(
          "Owner approval changed before consumption.",
          409,
          "human_review_approval_conflict",
        );
      }
      const status = text(approval, "status");
      if (status === "approved") {
        if (date(approval, "expires_at")!.getTime() <= Date.now()) {
          throw new TokenlessServiceError(
            "Owner approval expired before consumption.",
            409,
            "human_review_approval_expired",
          );
        }
        const consumed = await client.query(
          `UPDATE tokenless_agent_review_approval_requests
           SET status = 'consumed', consumed_at = $1, consumption_reference = $2
           WHERE workspace_id = $3 AND opportunity_id = $4 AND approval_id = $5
             AND status = 'approved' AND consumed_at IS NULL AND consumption_reference IS NULL`,
          [new Date(), input.operationKey, workspaceId, input.opportunity.opportunityId, input.approval.approvalId],
        );
        if (consumed.rowCount !== 1) {
          throw new TokenlessServiceError(
            "Owner approval could not be consumed.",
            409,
            "human_review_approval_conflict",
          );
        }
      } else if (
        status !== "consumed" ||
        text(approval, "consumption_reference") !== input.operationKey ||
        approval.consumed_at === null
      ) {
        throw new TokenlessServiceError(
          "Owner approval is not actionable.",
          409,
          "human_review_approval_not_actionable",
        );
      }
    } else if (input.opportunity.binding.authority !== "ask_automatically") {
      throw new TokenlessServiceError("Owner approval is required before publication.", 409, "approval_required");
    }

    const expectedRevision =
      input.opportunity.lifecycle.state === "pending"
        ? input.opportunity.lifecycle.revision - 1
        : input.opportunity.lifecycle.revision;
    const transition = await transitionHumanReviewOpportunityLifecycleInTransaction(client, {
      workspaceId,
      opportunityId: input.opportunity.opportunityId,
      transitionKey: `public-paid:${input.idempotencyKey.slice("adaptive-public-paid:".length)}`,
      expectedState: "request_ready",
      expectedRevision,
      toState: "pending",
      reasonCodes: ["public_paid_ask_created"],
      actor: { kind: "lane_adapter", reference: "public-paid-v1" },
      details: {
        operationKey: input.operationKey,
        idempotencyKey: input.idempotencyKey,
        bindingId: input.opportunity.binding.id,
        bindingVersion: input.opportunity.binding.version,
        requestProfileHash: input.opportunity.requestProfile.hash,
        preparedRequestHash: input.preparation.preparedRequestHash,
        derivedEconomicsHash: input.preparation.derivedEconomicsHash,
      },
    });
    const now = new Date();
    const update = await client.query(
      `UPDATE tokenless_agent_review_opportunities
       SET operation_key = $1, status = 'review_requested', updated_at = $2
       WHERE workspace_id = $3 AND opportunity_id = $4
         AND (operation_key IS NULL OR operation_key = $1)
         AND status IN ('decided', 'review_requested')`,
      [input.operationKey, now, workspaceId, input.opportunity.opportunityId],
    );
    if (update.rowCount !== 1) {
      throw new TokenlessServiceError(
        "Review opportunity binding conflicts with this ask.",
        409,
        "review_binding_conflict",
      );
    }
    if (!transition.replayed) {
      await client.query(
        `UPDATE tokenless_agent_integrations
         SET last_request_at = CASE WHEN last_request_at IS NULL OR last_request_at < $1 THEN $1 ELSE last_request_at END,
             updated_at = CASE WHEN updated_at < $1 THEN $1 ELSE updated_at END
         WHERE integration_id = $2 AND workspace_id = $3 AND agent_id = $4 AND agent_version_id = $5`,
        [
          now,
          input.principal.integration.integrationId,
          workspaceId,
          input.principal.integration.agentId,
          input.principal.integration.agentVersionId,
        ],
      );
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function requestPublicPaidHumanReview(
  input: PublicPaidHumanReviewRequest,
): Promise<{ schemaVersion: "rateloop.adaptive-review-request.v1"; opportunityId: string; ask: TokenlessAskResponse }> {
  requireProductPrincipalScope(input.principal.principal, "panel:publish");
  requireProductPrincipalScope(input.principal.principal, "payment:submit");
  const publication = normalizePublicPaidReviewPublication(input.publication);
  const sourcePayload = exactPayload(input.sourcePayload, "sourcePayload");
  const suggestionPayload = exactPayload(input.suggestionPayload, "suggestionPayload");
  const opportunity = await loadFrozenOpportunity(input.principal, input.opportunityId);
  assertRequestable(opportunity, input.principal);
  if ((opportunity.requestProfile.requiredExpertiseKeys?.length ?? 0) > 0) {
    await assertAdmissionPolicyExpertiseBinding(opportunity);
    const expertisePool = await countEligibleNetworkExpertisePool({
      expertiseKeys: opportunity.requestProfile.requiredExpertiseKeys,
    });
    if (!expertisePool.ready || expertisePool.eligible < opportunity.requestProfile.panelSize) {
      throw new TokenlessServiceError(
        "The RateLoop network does not currently have enough reviewers with every required expertise qualification.",
        409,
        "expertise_reviewer_pool_unavailable",
      );
    }
  }
  if (sha256(sourcePayload) !== opportunity.sourceEvidenceHash) {
    throw new TokenlessServiceError(
      "sourcePayload does not match the committed source evidence.",
      409,
      "source_payload_commitment_mismatch",
    );
  }
  if (sha256(suggestionPayload) !== opportunity.suggestionCommitment) {
    throw new TokenlessServiceError(
      "suggestionPayload does not match the committed suggestion.",
      409,
      "suggestion_payload_commitment_mismatch",
    );
  }
  const approval = await loadFrozenApproval(input.principal.integration.workspaceId, opportunity.opportunityId);
  const preparation = prepareExactRequest({ opportunity, approval, sourcePayload, suggestionPayload });
  await ensureFeedbackBonusPoolForDelivery({
    workspaceId: input.principal.integration.workspaceId,
    agentId: input.principal.integration.agentId,
    opportunityId: opportunity.opportunityId,
    admissionPolicyHash: opportunity.admissionPolicyHash,
    preparation,
    feedbackDeadline: new Date(preparation.preparedRequest.timing.expiresAt),
  });
  const idempotencyKey = deterministicAdapterKey(opportunity, preparation);
  if (opportunity.lifecycle.state === "pending" && opportunity.operationIdempotencyKey !== idempotencyKey) {
    throw new TokenlessServiceError(
      "The pending opportunity uses different frozen terms.",
      409,
      "review_binding_conflict",
    );
  }
  const quoteRequest: TokenlessQuoteRequest = {
    audience: { admissionPolicyHash: opportunity.admissionPolicyHash, source: "rateloop_network" },
    ...preparation.quoteTerms,
    confirmedNoSensitiveData: publication.confirmedNoSensitiveData,
    dataClassification: publication.dataClassification,
    ...(publication.redactionSummary ? { redactionSummary: publication.redactionSummary } : {}),
    visibility: publication.visibility,
  };
  const quote = await createTokenlessQuote(quoteRequest);
  const askRequest = {
    idempotencyKey,
    payment: { mode: "prepaid" as const, workspaceId: input.principal.integration.workspaceId },
    quoteId: quote.quoteId,
  };
  let prepared: PreparedProductAsk | null = null;
  let askCreated = false;
  let opportunityBound = false;
  try {
    prepared = await prepareProductAsk({ principal: input.principal.principal, request: askRequest });
    const ask = await createTokenlessAsk(askRequest, idempotencyKey, input.appOrigin);
    askCreated = true;
    await finalizePublicPaidAsk({
      principal: input.principal,
      opportunity,
      approval,
      preparation,
      idempotencyKey,
      operationKey: ask.operationKey,
    });
    opportunityBound = true;
    await beforePublicPaidActivationForTests?.({
      idempotencyKey,
      operationKey: ask.operationKey,
      opportunityId: opportunity.opportunityId,
    });
    await attachProductAsk(prepared, ask);
    return { schemaVersion: "rateloop.adaptive-review-request.v1", opportunityId: opportunity.opportunityId, ask };
  } catch (error) {
    if (prepared && (!askCreated || !opportunityBound)) await releasePreparedProductAsk(prepared);
    throw error;
  }
}

export function __setPublicPaidHumanReviewActivationHookForTests(hook: typeof beforePublicPaidActivationForTests) {
  beforePublicPaidActivationForTests = hook;
}

export const __publicPaidHumanReviewAdapterTestUtils = {
  deterministicAdapterKey,
  normalizePublicPaidReviewPublication,
  sha256,
};
