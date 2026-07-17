import { createHash } from "node:crypto";
import type { PoolClient } from "pg";
import "server-only";
import { dbPool } from "~~/lib/db";
import type { AgentMcpPrincipal } from "~~/lib/tokenless/agentIntegrations";
import { hashHumanReviewConfiguration } from "~~/lib/tokenless/humanReviewConfiguration";
import type { FrozenBinaryReviewQuestion } from "~~/lib/tokenless/humanReviewQuestions";
import {
  type BoundHumanReviewRequestProfile,
  type HumanReviewDerivedEconomics,
  type HumanReviewPreparedRequest,
  type PreparedHumanReviewRequest,
  hashPreparedHumanReviewValue,
  prepareHumanReviewRequest,
} from "~~/lib/tokenless/humanReviewRequestPreparation";
import { hashReviewRequestProfile } from "~~/lib/tokenless/reviewRequestProfiles";
import { normalizeReviewerExpertiseRequirementsSelection } from "~~/lib/tokenless/reviewerExpertiseOptions";
import { normalizeReviewerExpertiseKeys } from "~~/lib/tokenless/reviewerExpertiseVocabulary";
import { TokenlessServiceError } from "~~/lib/tokenless/server";

type Row = Record<string, unknown>;
type IntegrationPrincipal = Extract<AgentMcpPrincipal, { kind: "integration" }>;

const HASH_PATTERN = /^sha256:[0-9a-f]{64}$/u;
const APPROVAL_STATUSES = ["pending", "approved", "denied", "invalidated", "expired", "consumed"] as const;
type ApprovalStatus = (typeof APPROVAL_STATUSES)[number];

export type PreparedOwnerApproval = Readonly<{
  schemaVersion: "rateloop.human-review-owner-approval.v1";
  action: "owner_approval_required";
  approvalId: string;
  revision: number;
  status: ApprovalStatus;
  createdAt: string;
  expiresAt: string;
  preparedRequest: Readonly<HumanReviewPreparedRequest>;
  preparedRequestHash: string;
  economics: Readonly<HumanReviewDerivedEconomics>;
  derivedEconomicsHash: string;
  maximumChargeAtomic: string;
  feedbackBonusEconomics: PreparedHumanReviewRequest["feedbackBonusEconomics"];
  maximumConsentAtomic: string;
  sideEffects: Readonly<{
    published: false;
    assigned: false;
    fundsReserved: false;
    spent: false;
  }>;
}>;

type FrozenApprovalOpportunity = {
  workspaceId: string;
  opportunityId: string;
  workflowKey: string;
  sourceEvidenceHash: string;
  suggestionCommitment: string;
  selectionPolicy: { id: string; version: number };
  requestProfile: BoundHumanReviewRequestProfile;
  integrationId: string;
  lifecycle: { state: string; terminal: boolean };
};

function text(row: Row | undefined, key: string) {
  const value = row?.[key];
  return value === null || value === undefined ? null : String(value);
}

function integer(row: Row | undefined, key: string, minimum = 1, maximum = Number.MAX_SAFE_INTEGER) {
  const value = Number(row?.[key]);
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new TokenlessServiceError(`Stored ${key} is invalid.`, 500, "review_configuration_invalid");
  }
  return value;
}

function boolean(row: Row | undefined, key: string) {
  return row?.[key] === true || row?.[key] === "t" || row?.[key] === 1;
}

function date(row: Row | undefined, key: string) {
  const value = row?.[key] instanceof Date ? (row[key] as Date) : new Date(String(row?.[key]));
  if (!Number.isFinite(value.getTime())) {
    throw new TokenlessServiceError(`Stored ${key} is invalid.`, 500, "review_configuration_invalid");
  }
  return value;
}

function oneOf<Value extends string>(row: Row | undefined, key: string, allowed: readonly Value[]) {
  const value = text(row, key);
  if (!value || !allowed.includes(value as Value)) {
    throw new TokenlessServiceError(`Stored ${key} is invalid.`, 500, "review_configuration_invalid");
  }
  return value as Value;
}

function optionalInteger(row: Row | undefined, key: string) {
  return row?.[key] === null || row?.[key] === undefined ? null : integer(row, key);
}

function stringArray(value: unknown, field: string) {
  try {
    const parsed = JSON.parse(String(value)) as unknown;
    if (!Array.isArray(parsed) || parsed.some(entry => typeof entry !== "string")) throw new Error();
    return [...new Set(parsed)];
  } catch {
    throw new TokenlessServiceError(`Stored ${field} is invalid.`, 500, "review_configuration_invalid");
  }
}

function sha256Text(value: string) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function deterministicApprovalId(input: {
  workspaceId: string;
  opportunityId: string;
  preparedRequestHash: string;
  derivedEconomicsHash: string;
}) {
  return `hrap_${hashPreparedHumanReviewValue({
    schemaVersion: "rateloop.human-review-approval-id.v1",
    ...input,
  }).slice("sha256:".length, "sha256:".length + 40)}`;
}

function parsedDocument(value: unknown, field: string) {
  try {
    const parsed = JSON.parse(String(value)) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error();
    return parsed;
  } catch {
    throw new TokenlessServiceError(`Stored ${field} is invalid.`, 500, "human_review_approval_corrupt");
  }
}

function assertPrincipal(principal: IntegrationPrincipal) {
  if (
    principal.integration.status !== "active" ||
    principal.principal.kind !== "api_key" ||
    principal.principal.workspaceId !== principal.integration.workspaceId
  ) {
    throw new TokenlessServiceError("The agent integration is not active.", 403, "integration_inactive");
  }
}

function profileFromRow(row: Row): BoundHumanReviewRequestProfile {
  const profileHash = text(row, "profile_hash");
  if (!profileHash || !HASH_PATTERN.test(profileHash)) {
    throw new TokenlessServiceError("Stored request profile hash is invalid.", 500, "review_configuration_invalid");
  }
  const panelSize = integer(row, "panel_size", 1, 100);
  let expertiseRequirements;
  try {
    expertiseRequirements = normalizeReviewerExpertiseRequirementsSelection(
      JSON.parse(text(row, "expertise_requirements_json") ?? "[]"),
      panelSize,
    );
  } catch {
    throw new TokenlessServiceError(
      "Stored exact specialist requirements are invalid.",
      500,
      "review_configuration_invalid",
    );
  }
  return {
    id: text(row, "profile_id") ?? "",
    version: integer(row, "profile_version"),
    hash: profileHash as `sha256:${string}`,
    agentId: text(row, "profile_agent_id") ?? "",
    agentVersionId: text(row, "profile_agent_version_id") ?? "",
    questionAuthority: oneOf(row, "question_authority", ["owner_fixed", "agent_per_request"] as const),
    resultSemantics: oneOf(row, "result_semantics", ["assurance", "feedback"] as const),
    criterion: text(row, "criterion"),
    positiveLabel: text(row, "positive_label"),
    negativeLabel: text(row, "negative_label"),
    rationaleMode: oneOf(row, "rationale_mode", ["off", "optional", "required"] as const),
    audience: oneOf(row, "audience", ["private_invited", "public_network", "hybrid"] as const),
    contentBoundary: oneOf(row, "content_boundary", ["private_workspace", "public_or_test"] as const),
    privateSensitivity:
      row.private_sensitivity === null || row.private_sensitivity === undefined
        ? null
        : oneOf(row, "private_sensitivity", ["internal", "confidential", "restricted", "regulated"] as const),
    privateGroupId: text(row, "private_group_id"),
    requiredExpertiseKeys: normalizeReviewerExpertiseKeys(
      stringArray(row.required_expertise_keys_json, "required expertise keys"),
    ),
    expertiseRequirements,
    responseWindowSeconds: integer(row, "response_window_seconds", 1_200, 86_400),
    panelSize,
    compensationMode: oneOf(row, "compensation_mode", ["unpaid", "usdc"] as const),
    bountyPerSeatAtomic: text(row, "bounty_per_seat_atomic"),
    feedbackBonusEnabled: boolean(row, "feedback_bonus_enabled"),
    feedbackBonusPoolAtomic: text(row, "feedback_bonus_pool_atomic"),
    feedbackBonusAwarderKind: oneOf(row, "feedback_bonus_awarder_kind", ["requester", "designated"] as const),
    feedbackBonusAwarderAccount: text(row, "feedback_bonus_awarder_account"),
    feedbackBonusAwardWindowSeconds: optionalInteger(row, "feedback_bonus_award_window_seconds"),
  };
}

function assertSupportedPreparedLane(profile: BoundHumanReviewRequestProfile) {
  const publicPaid =
    profile.audience === "public_network" &&
    profile.contentBoundary === "public_or_test" &&
    profile.privateSensitivity === null &&
    profile.privateGroupId === null &&
    profile.compensationMode === "usdc" &&
    profile.bountyPerSeatAtomic !== null;
  const privateLane =
    profile.audience === "private_invited" &&
    profile.contentBoundary === "private_workspace" &&
    profile.privateSensitivity !== null &&
    profile.privateGroupId !== null &&
    ((profile.compensationMode === "unpaid" && profile.bountyPerSeatAtomic === null) ||
      (profile.compensationMode === "usdc" && profile.bountyPerSeatAtomic !== null));
  const hybridPaid =
    profile.audience === "hybrid" &&
    profile.contentBoundary === "public_or_test" &&
    profile.privateSensitivity === null &&
    profile.privateGroupId !== null &&
    profile.compensationMode === "usdc" &&
    profile.bountyPerSeatAtomic !== null;
  if (!publicPaid && !privateLane && !hybridPaid) {
    throw new TokenlessServiceError(
      "This frozen review lane is not ready for owner approval.",
      409,
      "review_lane_not_ready_for_approval",
    );
  }
}

async function loadAndVerifyOpportunity(
  client: PoolClient,
  principal: IntegrationPrincipal,
  opportunityId: string,
): Promise<FrozenApprovalOpportunity> {
  assertPrincipal(principal);
  const integration = principal.integration;
  const result = await client.query(
    `SELECT o.workspace_id, o.opportunity_id, o.agent_id AS opportunity_agent_id,
            o.agent_version_id AS opportunity_agent_version_id, o.decision, o.status AS opportunity_status,
            o.operation_key, o.source_evidence_hash, o.suggestion_commitment,
            o.policy_id, o.policy_version, o.human_review_binding_id, o.human_review_binding_version,
            o.request_profile_id AS opportunity_profile_id,
            o.request_profile_version AS opportunity_profile_version,
            o.request_profile_hash AS opportunity_profile_hash,
            l.state AS lifecycle_state, l.terminal_at AS lifecycle_terminal_at,
            s.workflow_key,
            i.integration_id, i.status AS integration_status, i.agent_id AS integration_agent_id,
            i.agent_version_id AS integration_agent_version_id,
            i.review_policy_id AS integration_policy_id,
            i.review_policy_version AS integration_policy_version,
            i.human_review_binding_id AS integration_binding_id,
            i.human_review_binding_version AS integration_binding_version,
            i.publishing_policy_id AS integration_publishing_policy_id,
            i.publishing_policy_version AS integration_publishing_policy_version,
            i.api_key_id AS integration_api_key_id, i.token_family_id AS integration_token_family_id,
            i.allowed_workflow_keys_json,
            rp.enabled AS review_policy_enabled, rp.superseded_at AS review_policy_superseded_at,
            b.binding_id, b.version AS binding_version, b.agent_id AS binding_agent_id,
            b.agent_version_id AS binding_agent_version_id,
            b.selection_policy_id, b.selection_policy_version,
            b.request_profile_id AS binding_profile_id, b.request_profile_version AS binding_profile_version,
            b.request_profile_hash AS binding_profile_hash,
            b.publishing_policy_id AS binding_publishing_policy_id,
            b.publishing_policy_version AS binding_publishing_policy_version,
            b.authority AS binding_authority, b.enabled AS binding_enabled,
            b.canonical_hash AS binding_canonical_hash, b.superseded_at AS binding_superseded_at,
            rrp.profile_id, rrp.version AS profile_version, rrp.profile_hash,
            rrp.agent_id AS profile_agent_id, rrp.agent_version_id AS profile_agent_version_id,
            rrp.question_authority, rrp.result_semantics,
            rrp.criterion, rrp.positive_label, rrp.negative_label, rrp.rationale_mode,
            rrp.audience, rrp.content_boundary, rrp.private_sensitivity, rrp.private_group_id,
            rrp.private_group_policy_version, rrp.private_group_policy_hash,
            rrp.required_expertise_keys_json, rrp.expertise_requirements_json, rrp.response_window_seconds,
            rrp.panel_size, rrp.compensation_mode,
            rrp.bounty_per_seat_atomic, rrp.feedback_bonus_enabled, rrp.feedback_bonus_pool_atomic,
            rrp.feedback_bonus_awarder_kind, rrp.feedback_bonus_awarder_account,
            rrp.feedback_bonus_award_window_seconds, rrp.configuration_status,
            rrp.approved_at AS profile_approved_at, rrp.superseded_at AS profile_superseded_at
     FROM tokenless_agent_review_opportunities o
     JOIN tokenless_agent_review_opportunity_lifecycles l
       ON l.workspace_id = o.workspace_id AND l.opportunity_id = o.opportunity_id
     JOIN tokenless_agent_evaluation_scopes s
       ON s.workspace_id = o.workspace_id AND s.scope_id = o.scope_id
     JOIN tokenless_agent_integrations i
       ON i.workspace_id = o.workspace_id AND i.integration_id = $2
     JOIN tokenless_agent_review_policies rp
       ON rp.workspace_id = o.workspace_id AND rp.policy_id = o.policy_id AND rp.version = o.policy_version
     JOIN tokenless_agent_human_review_bindings b
       ON b.workspace_id = o.workspace_id
      AND b.binding_id = o.human_review_binding_id AND b.version = o.human_review_binding_version
     JOIN tokenless_agent_review_request_profiles rrp
       ON rrp.workspace_id = o.workspace_id
      AND rrp.profile_id = o.request_profile_id
      AND rrp.version = o.request_profile_version
      AND rrp.profile_hash = o.request_profile_hash
     WHERE o.workspace_id = $1 AND o.opportunity_id = $3
       AND o.agent_id = $4 AND o.agent_version_id = $5
       AND o.policy_id = $6 AND o.policy_version = $7
     FOR UPDATE`,
    [
      integration.workspaceId,
      integration.integrationId,
      opportunityId,
      integration.agentId,
      integration.agentVersionId,
      integration.reviewPolicyId,
      integration.reviewPolicyVersion,
    ],
  );
  const row = result.rows[0] as Row | undefined;
  if (!row) throw new TokenlessServiceError("Review opportunity not found.", 404, "review_opportunity_not_found");
  const profile = profileFromRow(row);
  const exactProfileHash = hashReviewRequestProfile({
    agentId: profile.agentId,
    agentVersionId: profile.agentVersionId,
    questionAuthority: profile.questionAuthority ?? "owner_fixed",
    criterion: profile.criterion,
    positiveLabel: profile.positiveLabel,
    negativeLabel: profile.negativeLabel,
    rationaleMode: profile.rationaleMode,
    audience: profile.audience,
    contentBoundary: profile.contentBoundary,
    privateSensitivity: profile.privateSensitivity,
    privateGroupId: profile.privateGroupId,
    privateGroupPolicyVersion: optionalInteger(row, "private_group_policy_version"),
    privateGroupPolicyHash: text(row, "private_group_policy_hash"),
    requiredExpertiseKeys: profile.requiredExpertiseKeys,
    expertiseRequirements: profile.expertiseRequirements,
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
  const bindingPublishingPolicyId = text(row, "binding_publishing_policy_id");
  const bindingPublishingPolicyVersion = optionalInteger(row, "binding_publishing_policy_version");
  const exactBindingHash = hashHumanReviewConfiguration({
    workspaceId: integration.workspaceId,
    agentId: integration.agentId,
    agentVersionId: integration.agentVersionId,
    selectionPolicy: { id: text(row, "selection_policy_id")!, version: integer(row, "selection_policy_version") },
    requestProfile: { id: profile.id, version: profile.version, hash: profile.hash },
    publishingPolicy:
      bindingPublishingPolicyId === null || bindingPublishingPolicyVersion === null
        ? null
        : { id: bindingPublishingPolicyId, version: bindingPublishingPolicyVersion },
    authority: "prepare_for_approval",
  });
  const callerCredential = text(row, "integration_token_family_id") ?? text(row, "integration_api_key_id");
  const workflows = stringArray(row.allowed_workflow_keys_json, "integration workflows");
  if (
    text(row, "integration_status") !== "active" ||
    callerCredential !== principal.principal.apiKeyId ||
    text(row, "integration_agent_id") !== integration.agentId ||
    text(row, "integration_agent_version_id") !== integration.agentVersionId ||
    text(row, "integration_policy_id") !== integration.reviewPolicyId ||
    integer(row, "integration_policy_version") !== integration.reviewPolicyVersion ||
    text(row, "integration_binding_id") !== text(row, "human_review_binding_id") ||
    integer(row, "integration_binding_version") !== integer(row, "human_review_binding_version") ||
    text(row, "integration_publishing_policy_id") !== bindingPublishingPolicyId ||
    optionalInteger(row, "integration_publishing_policy_version") !== bindingPublishingPolicyVersion ||
    integration.publishingPolicyId !== bindingPublishingPolicyId ||
    integration.publishingPolicyVersion !== bindingPublishingPolicyVersion ||
    !workflows.includes(text(row, "workflow_key") ?? "") ||
    !integration.allowedWorkflowKeys.includes(text(row, "workflow_key") ?? "") ||
    text(row, "decision") !== "required" ||
    text(row, "opportunity_status") !== "decided" ||
    text(row, "operation_key") !== null ||
    !["approval_required", "request_ready", "cancelled_before_commit"].includes(text(row, "lifecycle_state") ?? "") ||
    (text(row, "lifecycle_state") === "cancelled_before_commit") !== (row.lifecycle_terminal_at !== null) ||
    !boolean(row, "review_policy_enabled") ||
    row.review_policy_superseded_at !== null ||
    !boolean(row, "binding_enabled") ||
    row.binding_superseded_at !== null ||
    text(row, "binding_authority") !== "prepare_for_approval" ||
    text(row, "binding_agent_id") !== integration.agentId ||
    text(row, "binding_agent_version_id") !== integration.agentVersionId ||
    text(row, "selection_policy_id") !== text(row, "policy_id") ||
    integer(row, "selection_policy_version") !== integer(row, "policy_version") ||
    text(row, "binding_profile_id") !== profile.id ||
    integer(row, "binding_profile_version") !== profile.version ||
    text(row, "binding_profile_hash") !== profile.hash ||
    text(row, "opportunity_profile_id") !== profile.id ||
    integer(row, "opportunity_profile_version") !== profile.version ||
    text(row, "opportunity_profile_hash") !== profile.hash ||
    text(row, "opportunity_agent_id") !== profile.agentId ||
    text(row, "opportunity_agent_version_id") !== profile.agentVersionId ||
    text(row, "configuration_status") !== "ready" ||
    row.profile_approved_at === null ||
    row.profile_superseded_at !== null ||
    profile.hash !== exactProfileHash ||
    text(row, "binding_canonical_hash") !== exactBindingHash
  ) {
    throw new TokenlessServiceError(
      "The opportunity no longer matches its exact owner-approved configuration.",
      409,
      "human_review_approval_binding_conflict",
    );
  }
  assertSupportedPreparedLane(profile);
  return {
    workspaceId: integration.workspaceId,
    opportunityId: text(row, "opportunity_id")!,
    workflowKey: text(row, "workflow_key")!,
    sourceEvidenceHash: text(row, "source_evidence_hash")!,
    suggestionCommitment: text(row, "suggestion_commitment")!,
    selectionPolicy: { id: text(row, "policy_id")!, version: integer(row, "policy_version") },
    requestProfile: profile,
    integrationId: integration.integrationId,
    lifecycle: {
      state: text(row, "lifecycle_state")!,
      terminal: row.lifecycle_terminal_at !== null,
    },
  };
}

function prepareExact(
  opportunity: FrozenApprovalOpportunity,
  input: {
    sourcePayload: string;
    suggestionPayload: string;
    preparedAt: Date;
    expiresAt: Date;
    effectiveQuestion?: FrozenBinaryReviewQuestion;
    effectiveQuestionHash?: `sha256:${string}`;
  },
) {
  return prepareHumanReviewRequest({
    opportunityId: opportunity.opportunityId,
    workflowKey: opportunity.workflowKey,
    requestProfile: opportunity.requestProfile,
    selectionPolicy: opportunity.selectionPolicy,
    contentCommitments: {
      source: opportunity.sourceEvidenceHash,
      suggestion: opportunity.suggestionCommitment,
    },
    preparedAt: input.preparedAt,
    expiresAt: input.expiresAt,
    sourcePayload: input.sourcePayload,
    suggestionPayload: input.suggestionPayload,
    effectiveQuestion: input.effectiveQuestion,
    effectiveQuestionHash: input.effectiveQuestionHash,
  });
}

function immutable<Value>(value: Value): Readonly<Value> {
  if (value !== null && typeof value === "object") {
    for (const child of Object.values(value as Record<string, unknown>)) immutable(child);
    Object.freeze(value);
  }
  return value;
}

function projection(input: { row: Row; preparation: PreparedHumanReviewRequest }): PreparedOwnerApproval {
  return immutable({
    schemaVersion: "rateloop.human-review-owner-approval.v1",
    action: "owner_approval_required",
    approvalId: text(input.row, "approval_id")!,
    revision: integer(input.row, "revision"),
    status: oneOf(input.row, "status", APPROVAL_STATUSES),
    createdAt: date(input.row, "created_at").toISOString(),
    expiresAt: date(input.row, "expires_at").toISOString(),
    preparedRequest: input.preparation.preparedRequest,
    preparedRequestHash: input.preparation.preparedRequestHash,
    economics: input.preparation.derivedEconomics,
    derivedEconomicsHash: input.preparation.derivedEconomicsHash,
    maximumChargeAtomic: input.preparation.maximumChargeAtomic,
    feedbackBonusEconomics: input.preparation.feedbackBonusEconomics,
    maximumConsentAtomic: input.preparation.maximumConsentAtomic,
    sideEffects: { published: false, assigned: false, fundsReserved: false, spent: false },
  });
}

function assertExactStoredApproval(
  row: Row,
  preparation: PreparedHumanReviewRequest,
  opportunity: FrozenApprovalOpportunity,
) {
  const storedPrepared = parsedDocument(row.prepared_request_json, "prepared approval request");
  const storedEconomics = parsedDocument(row.derived_economics_json, "prepared approval economics");
  const exact =
    text(row, "workspace_id") === opportunity.workspaceId &&
    text(row, "opportunity_id") === opportunity.opportunityId &&
    integer(row, "request_profile_version") === opportunity.requestProfile.version &&
    text(row, "request_profile_id") === opportunity.requestProfile.id &&
    text(row, "request_profile_hash") === opportunity.requestProfile.hash &&
    text(row, "source_evidence_hash") === opportunity.sourceEvidenceHash &&
    text(row, "suggestion_commitment") === opportunity.suggestionCommitment &&
    text(row, "prepared_request_hash") === preparation.preparedRequestHash &&
    text(row, "derived_economics_hash") === preparation.derivedEconomicsHash &&
    text(row, "maximum_charge_atomic") === preparation.maximumChargeAtomic &&
    text(row, "feedback_bonus_maximum_atomic") === preparation.feedbackBonusEconomics.poolAtomic &&
    text(row, "maximum_consent_atomic") === preparation.maximumConsentAtomic &&
    hashPreparedHumanReviewValue(storedPrepared) === preparation.preparedRequestHash &&
    hashPreparedHumanReviewValue(storedEconomics) === preparation.derivedEconomicsHash;
  if (!exact) {
    throw new TokenlessServiceError(
      "An approval already exists for different frozen terms.",
      409,
      "human_review_approval_conflict",
    );
  }
}

export async function prepareHumanReviewForOwnerApproval(input: {
  principal: IntegrationPrincipal;
  opportunityId: string;
  sourcePayload: string;
  suggestionPayload: string;
  effectiveQuestion?: FrozenBinaryReviewQuestion;
  effectiveQuestionHash?: `sha256:${string}`;
  now?: Date;
}): Promise<PreparedOwnerApproval> {
  const now = input.now ?? new Date();
  if (!Number.isFinite(now.getTime())) {
    throw new TokenlessServiceError("Preparation time is invalid.", 400, "invalid_human_review_preparation");
  }
  const client = await dbPool.connect();
  try {
    await client.query("BEGIN");
    const opportunity = await loadAndVerifyOpportunity(client, input.principal, input.opportunityId);
    if (sha256Text(input.sourcePayload) !== opportunity.sourceEvidenceHash) {
      throw new TokenlessServiceError(
        "sourcePayload does not match the committed source evidence.",
        409,
        "source_payload_commitment_mismatch",
      );
    }
    if (sha256Text(input.suggestionPayload) !== opportunity.suggestionCommitment) {
      throw new TokenlessServiceError(
        "suggestionPayload does not match the committed suggestion.",
        409,
        "suggestion_payload_commitment_mismatch",
      );
    }
    const existingResult = await client.query(
      `SELECT * FROM tokenless_agent_review_approval_requests
       WHERE workspace_id = $1 AND opportunity_id = $2
       ORDER BY revision DESC LIMIT 1 FOR UPDATE`,
      [opportunity.workspaceId, opportunity.opportunityId],
    );
    const existing = existingResult.rows[0] as Row | undefined;
    if (existing) {
      const preparation = prepareExact(opportunity, {
        sourcePayload: input.sourcePayload,
        suggestionPayload: input.suggestionPayload,
        preparedAt: date(existing, "created_at"),
        expiresAt: date(existing, "expires_at"),
        effectiveQuestion: input.effectiveQuestion,
        effectiveQuestionHash: input.effectiveQuestionHash,
      });
      assertExactStoredApproval(existing, preparation, opportunity);
      await client.query("COMMIT");
      return projection({ row: existing, preparation });
    }

    if (opportunity.lifecycle.state !== "approval_required" || opportunity.lifecycle.terminal) {
      throw new TokenlessServiceError(
        "This review opportunity is no longer waiting for an approval request.",
        409,
        "human_review_approval_not_actionable",
      );
    }

    const expiresAt = new Date(now.getTime() + opportunity.requestProfile.responseWindowSeconds * 1_000);
    const preparation = prepareExact(opportunity, {
      sourcePayload: input.sourcePayload,
      suggestionPayload: input.suggestionPayload,
      preparedAt: now,
      expiresAt,
      effectiveQuestion: input.effectiveQuestion,
      effectiveQuestionHash: input.effectiveQuestionHash,
    });
    const approvalId = deterministicApprovalId({
      workspaceId: opportunity.workspaceId,
      opportunityId: opportunity.opportunityId,
      preparedRequestHash: preparation.preparedRequestHash,
      derivedEconomicsHash: preparation.derivedEconomicsHash,
    });
    const inserted = await client.query(
      `INSERT INTO tokenless_agent_review_approval_requests
       (approval_id,workspace_id,opportunity_id,revision,
        request_profile_id,request_profile_version,request_profile_hash,
        source_evidence_hash,suggestion_commitment,
        prepared_request_json,prepared_request_hash,
        derived_economics_json,derived_economics_hash,maximum_charge_atomic,
        feedback_bonus_maximum_atomic,maximum_consent_atomic,
        status,prepared_by,created_at,expires_at)
       VALUES ($1,$2,$3,1,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,'pending',$16,$17,$18)
       RETURNING *`,
      [
        approvalId,
        opportunity.workspaceId,
        opportunity.opportunityId,
        opportunity.requestProfile.id,
        opportunity.requestProfile.version,
        opportunity.requestProfile.hash,
        opportunity.sourceEvidenceHash,
        opportunity.suggestionCommitment,
        JSON.stringify(preparation.preparedRequest),
        preparation.preparedRequestHash,
        JSON.stringify(preparation.derivedEconomics),
        preparation.derivedEconomicsHash,
        preparation.maximumChargeAtomic,
        preparation.feedbackBonusEconomics.poolAtomic,
        preparation.maximumConsentAtomic,
        opportunity.integrationId,
        now,
        expiresAt,
      ],
    );
    await client.query("COMMIT");
    return projection({ row: inserted.rows[0] as Row, preparation });
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export const __humanReviewApprovalPreparationTestUtils = {
  deterministicApprovalId,
  sha256Text,
};
