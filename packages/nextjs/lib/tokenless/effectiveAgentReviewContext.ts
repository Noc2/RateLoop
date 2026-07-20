import { createHash } from "node:crypto";
import "server-only";
import { dbClient } from "~~/lib/db";
import { connectionLaneFromClientCapabilitiesJson } from "~~/lib/tokenless/agentConnectionIntents";
import { type AgentMcpPrincipal, OWNER_APPROVED_AGENT_SCOPES } from "~~/lib/tokenless/agentIntegrations";
import { humanReviewRequiresPayment } from "~~/lib/tokenless/humanReviewGrantScopes";
import {
  HUMAN_REVIEW_QUESTION_AUTHORITIES,
  HUMAN_REVIEW_RESULT_SEMANTICS,
} from "~~/lib/tokenless/humanReviewQuestions";
import {
  HUMAN_REVIEW_AUDIENCES,
  HUMAN_REVIEW_AUTHORITY_LEVELS,
  HUMAN_REVIEW_COMPENSATION_MODES,
  HUMAN_REVIEW_CONTENT_BOUNDARIES,
  configuredHumanReviewLanes,
  deployedHumanReviewReadiness,
  resolveHumanReviewCapability,
} from "~~/lib/tokenless/reviewCapabilities";
import { REVIEW_POLICY_MODES } from "~~/lib/tokenless/reviewPolicyManagement";
import {
  REVIEW_REQUEST_PRIVATE_SENSITIVITIES,
  REVIEW_REQUEST_RATIONALE_MODES,
} from "~~/lib/tokenless/reviewRequestProfiles";
import { normalizeReviewerExpertiseKeys } from "~~/lib/tokenless/reviewerExpertise";
import { normalizeReviewerExpertiseRequirementsSelection } from "~~/lib/tokenless/reviewerExpertiseOptions";
import { TokenlessServiceError } from "~~/lib/tokenless/server";

type Row = Record<string, unknown>;
type IntegrationPrincipal = Extract<AgentMcpPrincipal, { kind: "integration" }>;

const HASH_PATTERN = /^sha256:[0-9a-f]{64}$/u;
const REQUIRED_EVALUATION_SCOPES = ["evaluation:read", "review:decide"] as const;
const REQUIRED_PUBLISHING_SCOPE = "panel:publish";
const REQUIRED_SPENDING_SCOPE = "payment:submit";

function invalidContext(message: string): never {
  throw new TokenlessServiceError(message, 500, "agent_context_invalid");
}

function text(row: Row | undefined, key: string) {
  const value = row?.[key];
  return value === null || value === undefined ? null : String(value);
}

function positiveInteger(row: Row | undefined, key: string) {
  const value = Number(row?.[key]);
  if (!Number.isSafeInteger(value) || value < 1) invalidContext(`Stored ${key} is invalid.`);
  return value;
}

function optionalInteger(row: Row | undefined, key: string) {
  return row?.[key] === null || row?.[key] === undefined ? null : positiveInteger(row, key);
}

function basisPoints(row: Row | undefined, key: string) {
  const value = Number(row?.[key]);
  if (!Number.isSafeInteger(value) || value < 0 || value > 10_000) {
    invalidContext(`Stored ${key} is invalid.`);
  }
  return value;
}

function boolean(row: Row | undefined, key: string) {
  const value = row?.[key];
  if (value === true || value === "t" || value === 1) return true;
  if (value === false || value === "f" || value === 0) return false;
  invalidContext(`Stored ${key} is invalid.`);
}

function jsonObject(value: unknown, field: string) {
  try {
    const parsed = JSON.parse(String(value)) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error();
    return parsed as Record<string, unknown>;
  } catch {
    return invalidContext(`Stored ${field} is invalid.`);
  }
}

function stringArray(value: unknown, field: string) {
  try {
    const parsed = JSON.parse(String(value ?? "[]")) as unknown;
    if (!Array.isArray(parsed) || parsed.some(entry => typeof entry !== "string" || !entry)) throw new Error();
    return [...new Set(parsed as string[])].sort();
  } catch {
    return invalidContext(`Stored ${field} is invalid.`);
  }
}

function valueStringArray(value: unknown, field: string) {
  if (!Array.isArray(value) || value.some(entry => typeof entry !== "string" || !entry)) {
    invalidContext(`Stored ${field} is invalid.`);
  }
  return [...new Set(value as string[])].sort();
}

function nullableRuleInteger(value: unknown, field: string, maximum: number) {
  if (value === null || value === undefined) return null;
  if (!Number.isSafeInteger(value) || Number(value) < 0 || Number(value) > maximum) {
    invalidContext(`Stored ${field} is invalid.`);
  }
  return Number(value);
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function sha256(value: unknown) {
  return `sha256:${createHash("sha256").update(stableJson(value)).digest("hex")}`;
}

function enumValue<const T extends readonly string[]>(row: Row, key: string, values: T): T[number] {
  const value = text(row, key);
  if (!value || !values.includes(value)) invalidContext(`Stored ${key} is invalid.`);
  return value as T[number];
}

function nullableReference(row: Row, idKey: string, versionKey: string) {
  const id = text(row, idKey);
  const version = optionalInteger(row, versionKey);
  if ((id === null) !== (version === null)) invalidContext(`Stored ${idKey} reference is invalid.`);
  return id && version !== null ? { policyId: id, version } : null;
}

function grantReason(input: {
  selectionMode: (typeof REVIEW_POLICY_MODES)[number];
  configuredPolicy: { policyId: string; version: number } | null;
  integrationPolicy: { policyId: string; version: number } | null;
  authority: string;
  activationMode: string;
  integrationBindingMatches: boolean;
  publishingPolicyActive: boolean;
  connectionReady: boolean;
  scopes: string[];
  workflows: string[];
  paymentRequired: boolean;
}) {
  if (input.selectionMode === "manual") return "manual_handoff_only" as const;
  if (!input.configuredPolicy) return "not_configured" as const;
  if (
    !input.integrationPolicy ||
    input.configuredPolicy.policyId !== input.integrationPolicy.policyId ||
    input.configuredPolicy.version !== input.integrationPolicy.version ||
    !input.integrationBindingMatches
  ) {
    return "exact_binding_mismatch" as const;
  }
  if (input.authority !== "ask_automatically") return "authority_does_not_delegate" as const;
  if (input.activationMode !== "owner_approved") return "owner_approval_required" as const;
  if (!input.publishingPolicyActive) return "publishing_policy_inactive" as const;
  if (!input.connectionReady) return "connection_not_ready" as const;
  if (!input.scopes.includes(REQUIRED_PUBLISHING_SCOPE)) return "publish_scope_missing" as const;
  if (input.paymentRequired && !input.scopes.includes(REQUIRED_SPENDING_SCOPE)) {
    return "payment_scope_missing" as const;
  }
  if (input.workflows.length === 0) return "workflow_scope_missing" as const;
  return "active" as const;
}

/**
 * Re-loads the complete effective review configuration for the authenticated integration.
 * Caller-supplied identity, version, policy, profile, authority, and grant fields are never accepted.
 */
export async function getEffectiveAgentReviewContext(principal: IntegrationPrincipal) {
  const bound = principal.integration;
  const result = await dbClient.execute({
    sql: `SELECT
            i.integration_id, i.workspace_id, i.agent_id, i.agent_version_id, i.status AS integration_status,
            i.review_policy_id AS integration_review_policy_id,
            i.review_policy_version AS integration_review_policy_version,
            i.publishing_policy_id AS integration_publishing_policy_id,
            i.publishing_policy_version AS integration_publishing_policy_version,
            i.enforcement_mode AS integration_enforcement_mode, i.activation_mode,
            i.allowed_workflow_keys_json, i.granted_scopes_json,
            i.human_review_binding_id AS integration_binding_id,
            i.human_review_binding_version AS integration_binding_version,
            i.connection_intent_id, c.status AS connection_status,
            c.client_capabilities_json AS connection_client_capabilities_json,
            p.mode AS selection_mode, p.enabled AS selection_enabled,
            p.superseded_at AS selection_superseded_at, p.agreement_threshold_bps,
            p.production_floor_bps, p.fixed_rate_bps, p.maximum_unreviewed_gap,
            p.rules_json, p.audience_policy_json,
            b.binding_id, b.version AS binding_version, b.canonical_hash AS binding_hash,
            b.authority, b.enabled AS binding_enabled, b.superseded_at AS binding_superseded_at,
            b.selection_policy_id AS binding_selection_policy_id,
            b.selection_policy_version AS binding_selection_policy_version,
            b.request_profile_id, b.request_profile_version, b.request_profile_hash,
            b.publishing_policy_id AS binding_publishing_policy_id,
            b.publishing_policy_version AS binding_publishing_policy_version,
            r.configuration_status AS profile_status, r.superseded_at AS profile_superseded_at,
            r.question_authority, r.result_semantics,
            r.criterion, r.positive_label, r.negative_label, r.rationale_mode,
            r.audience, r.content_boundary, r.private_sensitivity,
            r.private_group_id, r.private_group_policy_version, r.private_group_policy_hash,
            r.semantic_schema_version,r.required_expertise_keys_json,r.expertise_requirements_json,
            r.response_window_seconds,
            r.panel_size,r.compensation_mode,r.bounty_per_seat_atomic,
            r.feedback_bonus_enabled,r.feedback_bonus_pool_atomic,r.feedback_bonus_awarder_kind,
            r.feedback_bonus_awarder_account,r.feedback_bonus_award_window_seconds,
            pp.enabled AS publishing_policy_enabled, pp.revoked_at AS publishing_policy_revoked_at,
            pp.effective_at AS publishing_policy_effective_at, pp.expires_at AS publishing_policy_expires_at
          FROM tokenless_agent_integrations i
          JOIN tokenless_agents a
            ON a.workspace_id = i.workspace_id AND a.agent_id = i.agent_id AND a.status = 'active'
          JOIN tokenless_agent_review_policies p
            ON p.workspace_id = i.workspace_id AND p.policy_id = i.review_policy_id
           AND p.version = i.review_policy_version AND p.agent_id = i.agent_id
           AND p.agent_version_id = i.agent_version_id
          LEFT JOIN tokenless_agent_connection_intents c ON c.intent_id = i.connection_intent_id
          LEFT JOIN tokenless_agent_human_review_bindings b
            ON b.workspace_id = i.workspace_id AND b.binding_id = i.human_review_binding_id
           AND b.version = i.human_review_binding_version AND b.agent_id = i.agent_id
           AND b.agent_version_id = i.agent_version_id
          LEFT JOIN tokenless_agent_review_request_profiles r
            ON r.workspace_id = b.workspace_id AND r.profile_id = b.request_profile_id
           AND r.version = b.request_profile_version AND r.profile_hash = b.request_profile_hash
           AND r.agent_id = b.agent_id AND r.agent_version_id = b.agent_version_id
          LEFT JOIN tokenless_agent_publishing_policies pp
            ON pp.workspace_id = b.workspace_id AND pp.policy_id = b.publishing_policy_id
           AND pp.version = b.publishing_policy_version
          WHERE i.integration_id = ? AND i.workspace_id = ? AND i.agent_id = ?
            AND i.agent_version_id = ? AND i.status = 'active' AND i.revoked_at IS NULL
          LIMIT 1`,
    args: [bound.integrationId, bound.workspaceId, bound.agentId, bound.agentVersionId],
  });
  const row = result.rows[0] as Row | undefined;
  if (!row) invalidContext("The authenticated agent integration is no longer active.");

  const selectionPolicyId = text(row, "integration_review_policy_id");
  const selectionPolicyVersion = positiveInteger(row, "integration_review_policy_version");
  if (
    selectionPolicyId !== bound.reviewPolicyId ||
    selectionPolicyVersion !== bound.reviewPolicyVersion ||
    text(row, "workspace_id") !== bound.workspaceId ||
    text(row, "agent_id") !== bound.agentId ||
    text(row, "agent_version_id") !== bound.agentVersionId ||
    !boolean(row, "selection_enabled") ||
    text(row, "selection_superseded_at") !== null
  ) {
    invalidContext("The authenticated integration no longer matches its active selection policy.");
  }

  const selectionMode = enumValue(row, "selection_mode", REVIEW_POLICY_MODES);
  const fixedRateBps = optionalInteger(row, "fixed_rate_bps");
  if ((selectionMode === "fixed") !== (fixedRateBps !== null) || (fixedRateBps !== null && fixedRateBps > 10_000)) {
    invalidContext("Stored fixed review frequency is invalid.");
  }
  const rules = jsonObject(row.rules_json, "review selection rules");
  const audiencePolicy = jsonObject(row.audience_policy_json, "review audience policy");
  const storedReviewerSource = audiencePolicy.reviewerSource;
  const reviewerSource =
    storedReviewerSource === "customer_invited"
      ? "private_invited"
      : storedReviewerSource === "rateloop_network"
        ? "public_network"
        : storedReviewerSource;
  if (typeof reviewerSource !== "string" || !HUMAN_REVIEW_AUDIENCES.includes(reviewerSource as never)) {
    invalidContext("Stored review audience policy is invalid.");
  }
  const audiencePolicyHash = sha256(audiencePolicy);
  if (bound.audiencePolicyHash && audiencePolicyHash !== bound.audiencePolicyHash) {
    invalidContext("The authenticated integration audience commitment no longer matches.");
  }
  const integrationEnforcementMode = text(row, "integration_enforcement_mode");
  if (
    (integrationEnforcementMode !== "advisory" && integrationEnforcementMode !== "host_enforced") ||
    rules.enforcementMode !== integrationEnforcementMode ||
    integrationEnforcementMode !== bound.enforcementMode
  ) {
    invalidContext("Stored review enforcement mode is invalid.");
  }

  const integrationBindingId = text(row, "integration_binding_id");
  const integrationBindingVersion = optionalInteger(row, "integration_binding_version");
  if ((integrationBindingId === null) !== (integrationBindingVersion === null)) {
    invalidContext("Stored integration review binding is invalid.");
  }
  const bindingId = text(row, "binding_id");
  if (integrationBindingId && bindingId !== integrationBindingId) {
    invalidContext("The integration's exact human-review binding is unavailable.");
  }

  const grantedScopes = stringArray(row.granted_scopes_json, "integration grant scopes");
  if (grantedScopes.some(scope => !(OWNER_APPROVED_AGENT_SCOPES as readonly string[]).includes(scope))) {
    invalidContext("Stored integration grant scopes are invalid.");
  }
  const credentialScopes = [...new Set(principal.principal.scopes)].sort();
  const effectiveScopes = [...new Set([...credentialScopes, ...grantedScopes])].sort();
  const allowedWorkflowKeys = stringArray(row.allowed_workflow_keys_json, "allowed workflows");
  const canEvaluate = REQUIRED_EVALUATION_SCOPES.every(scope => effectiveScopes.includes(scope));
  const integrationPolicy = nullableReference(
    row,
    "integration_publishing_policy_id",
    "integration_publishing_policy_version",
  );
  // Host-attested only: never presented as verified hook presence; unreported defaults to 'mcp-oauth'.
  const reportedLane = text(row, "connection_intent_id")
    ? connectionLaneFromClientCapabilitiesJson(row.connection_client_capabilities_json)
    : null;

  const selection = {
    policyId: selectionPolicyId!,
    version: selectionPolicyVersion,
    frequency: {
      mode: selectionMode,
      fixedRateBps,
      agreementThresholdBps: basisPoints(row, "agreement_threshold_bps"),
      productionFloorBps: basisPoints(row, "production_floor_bps"),
      maximumUnreviewedGap: positiveInteger(row, "maximum_unreviewed_gap"),
    },
    rules: {
      requiredRiskTiers: valueStringArray(rules.requiredRiskTiers ?? [], "required risk tiers"),
      criticalRiskTiers: valueStringArray(rules.criticalRiskTiers ?? [], "critical risk tiers"),
      minimumConfidenceBps: nullableRuleInteger(rules.minimumConfidenceBps, "minimum confidence", 10_000),
      maximumLatencyMs: nullableRuleInteger(rules.maximumLatencyMs, "maximum latency", 2_147_483_647),
    },
    audiencePolicyHash,
    enforcementMode: integrationEnforcementMode,
  };

  const implementedLanes = configuredHumanReviewLanes();

  if (!bindingId) {
    return {
      schemaVersion: "rateloop.agent-context.v2",
      integrationId: bound.integrationId,
      workspaceId: bound.workspaceId,
      agentId: bound.agentId,
      agentVersionId: bound.agentVersionId,
      status: bound.status,
      enforcementMode: bound.enforcementMode,
      enforcementBoundary: bound.enforcementMode,
      reportedLane,
      allowedWorkflowKeys,
      reviewPolicy: {
        policyId: selection.policyId,
        version: selection.version,
        audiencePolicyHash: selection.audiencePolicyHash,
      },
      publishingPolicy: null,
      humanReview: {
        status: "configuration_required" as const,
        binding: null,
        selection,
        requestProfile: null,
        authority: null,
        blockingReason: {
          code: "human_review_configuration_required",
          message: "Complete the human-review configuration for this exact agent version.",
        },
      },
      publishingGrant: {
        active: false,
        reason: "not_configured" as const,
        configuredPolicy: null,
        integrationPolicy,
        activationMode: text(row, "activation_mode"),
        grantedScopes,
        credentialScopes,
        allowedWorkflowKeys,
      },
      capabilities: {
        implementedLanes,
        ownerApproval: { available: true },
        autonomousPublishing: { available: false, reason: "not_configured" as const },
        effectiveLane: null,
      },
      safeAccess: {
        canCheckReviewRequirement: canEvaluate,
        canSpend: false,
        canPublish: false,
        canReadPrivateArtifacts: false,
        canAdministerWorkspace: false,
      },
    };
  }

  const bindingVersion = positiveInteger(row, "binding_version");
  const bindingHash = text(row, "binding_hash");
  const requestProfileId = text(row, "request_profile_id");
  const requestProfileVersion = positiveInteger(row, "request_profile_version");
  const requestProfileHash = text(row, "request_profile_hash");
  const authority = enumValue(row, "authority", HUMAN_REVIEW_AUTHORITY_LEVELS);
  if (
    bindingVersion !== integrationBindingVersion ||
    !bindingHash ||
    !HASH_PATTERN.test(bindingHash) ||
    !requestProfileId ||
    !requestProfileHash ||
    !HASH_PATTERN.test(requestProfileHash) ||
    !boolean(row, "binding_enabled") ||
    text(row, "binding_superseded_at") !== null ||
    text(row, "binding_selection_policy_id") !== selectionPolicyId ||
    positiveInteger(row, "binding_selection_policy_version") !== selectionPolicyVersion ||
    text(row, "profile_superseded_at") !== null
  ) {
    invalidContext("The exact human-review binding is invalid or no longer active.");
  }

  const profileStatus = text(row, "profile_status");
  if (profileStatus !== "ready" && profileStatus !== "action_required") {
    invalidContext("Stored request-profile status is invalid.");
  }
  const rationaleMode = enumValue(row, "rationale_mode", REVIEW_REQUEST_RATIONALE_MODES);
  const questionAuthority = enumValue(row, "question_authority", HUMAN_REVIEW_QUESTION_AUTHORITIES);
  const resultSemantics = enumValue(row, "result_semantics", HUMAN_REVIEW_RESULT_SEMANTICS);
  const audience = enumValue(row, "audience", HUMAN_REVIEW_AUDIENCES);
  const contentBoundary = enumValue(row, "content_boundary", HUMAN_REVIEW_CONTENT_BOUNDARIES);
  const compensationMode = enumValue(row, "compensation_mode", HUMAN_REVIEW_COMPENSATION_MODES);
  const privateSensitivity = text(row, "private_sensitivity");
  if (
    (privateSensitivity !== null && !REVIEW_REQUEST_PRIVATE_SENSITIVITIES.includes(privateSensitivity as never)) ||
    reviewerSource !== audience
  ) {
    invalidContext("Stored request-profile audience or privacy boundary is invalid.");
  }
  const privateGroupId = text(row, "private_group_id");
  const privateGroupPolicyVersion = optionalInteger(row, "private_group_policy_version");
  const privateGroupPolicyHash = text(row, "private_group_policy_hash");
  if (
    (privateGroupId === null) !== (privateGroupPolicyVersion === null) ||
    (privateGroupId === null) !== (privateGroupPolicyHash === null) ||
    (privateGroupPolicyHash !== null && !HASH_PATTERN.test(privateGroupPolicyHash))
  ) {
    invalidContext("Stored private reviewer-group binding is invalid.");
  }
  if (
    (contentBoundary === "private_workspace" && (audience !== "private_invited" || privateSensitivity === null)) ||
    (contentBoundary === "public_or_test" && privateSensitivity !== null) ||
    (audience === "public_network" && privateGroupId !== null) ||
    ((audience === "private_invited" || audience === "hybrid") && profileStatus === "ready" && privateGroupId === null)
  ) {
    invalidContext("Stored request-profile audience and privacy terms are contradictory.");
  }
  const criterion = text(row, "criterion");
  const positiveLabel = text(row, "positive_label");
  const negativeLabel = text(row, "negative_label");
  if (
    (questionAuthority === "owner_fixed" &&
      (resultSemantics !== "assurance" || !criterion || !positiveLabel || !negativeLabel)) ||
    (questionAuthority === "agent_per_request" &&
      (resultSemantics !== "feedback" ||
        criterion !== null ||
        positiveLabel !== null ||
        negativeLabel !== null ||
        audience !== "public_network" ||
        contentBoundary !== "public_or_test")) ||
    (positiveLabel !== null &&
      negativeLabel !== null &&
      positiveLabel.toLocaleLowerCase("en-US") === negativeLabel.toLocaleLowerCase("en-US"))
  ) {
    invalidContext("Stored review question authority is invalid for this request profile.");
  }
  const responseWindowSeconds = optionalInteger(row, "response_window_seconds");
  const panelSize = optionalInteger(row, "panel_size");
  let requiredExpertiseKeys;
  let expertiseRequirements;
  try {
    requiredExpertiseKeys = normalizeReviewerExpertiseKeys(
      JSON.parse(text(row, "required_expertise_keys_json") ?? "[]"),
    );
    expertiseRequirements = normalizeReviewerExpertiseRequirementsSelection(
      JSON.parse(text(row, "expertise_requirements_json") ?? "[]"),
      panelSize ?? 1,
    );
  } catch {
    invalidContext("Stored reviewer expertise requirements are invalid.");
  }
  if (
    (responseWindowSeconds !== null && (responseWindowSeconds < 1_200 || responseWindowSeconds > 86_400)) ||
    (panelSize !== null && panelSize > 100) ||
    (profileStatus === "ready" && (responseWindowSeconds === null || panelSize === null)) ||
    (requiredExpertiseKeys.length > 0 && expertiseRequirements.length > 0) ||
    (expertiseRequirements.length > 0 &&
      (Number(row.semantic_schema_version) !== 3 ||
        (audience === "private_invited" &&
          expertiseRequirements.some(requirement => requirement.sourceScope !== "customer_invited")) ||
        (audience === "public_network" &&
          expertiseRequirements.some(
            requirement => requirement.sourceScope !== "rateloop_network" || requirement.minimumSeats !== panelSize,
          )) ||
        audience === "hybrid"))
  ) {
    invalidContext("The ready request profile is incomplete.");
  }
  const bountyPerSeatAtomic = text(row, "bounty_per_seat_atomic");
  const feedbackBonusEnabled = boolean(row, "feedback_bonus_enabled");
  const feedbackBonusPoolAtomic = text(row, "feedback_bonus_pool_atomic");
  const feedbackBonusAwarderKind = text(row, "feedback_bonus_awarder_kind");
  const feedbackBonusAwarderAccount = text(row, "feedback_bonus_awarder_account");
  const feedbackBonusAwardWindowSeconds = optionalInteger(row, "feedback_bonus_award_window_seconds");
  if (
    (compensationMode === "unpaid" && bountyPerSeatAtomic !== null) ||
    (compensationMode === "usdc" && (bountyPerSeatAtomic === null || !/^[1-9][0-9]*$/u.test(bountyPerSeatAtomic))) ||
    ((audience === "public_network" || audience === "hybrid") && compensationMode !== "usdc") ||
    ((audience === "public_network" || audience === "hybrid") && profileStatus === "ready" && panelSize! < 3) ||
    !["requester", "designated"].includes(feedbackBonusAwarderKind ?? "") ||
    (feedbackBonusAwarderKind === "requester") !== (feedbackBonusAwarderAccount === null) ||
    (feedbackBonusEnabled &&
      (feedbackBonusPoolAtomic === null ||
        !/^[1-9][0-9]*$/u.test(feedbackBonusPoolAtomic) ||
        feedbackBonusAwardWindowSeconds === null ||
        feedbackBonusAwardWindowSeconds < 3_600 ||
        feedbackBonusAwardWindowSeconds > 31_536_000)) ||
    (!feedbackBonusEnabled && (feedbackBonusPoolAtomic !== null || feedbackBonusAwardWindowSeconds !== null))
  ) {
    invalidContext("Stored review compensation is invalid.");
  }

  const configuredPolicy = nullableReference(row, "binding_publishing_policy_id", "binding_publishing_policy_version");
  const now = Date.now();
  const publishingEffectiveAt = text(row, "publishing_policy_effective_at");
  const publishingExpiresAt = text(row, "publishing_policy_expires_at");
  const publishingPolicyActive = Boolean(
    configuredPolicy &&
      boolean(row, "publishing_policy_enabled") &&
      text(row, "publishing_policy_revoked_at") === null &&
      publishingEffectiveAt &&
      new Date(publishingEffectiveAt).getTime() <= now &&
      (!publishingExpiresAt || new Date(publishingExpiresAt).getTime() > now),
  );
  const integrationBindingMatches = integrationBindingId === bindingId && integrationBindingVersion === bindingVersion;
  const connectionReady = text(row, "connection_intent_id") === null || text(row, "connection_status") === "connected";
  const reason = grantReason({
    selectionMode,
    configuredPolicy,
    integrationPolicy,
    authority,
    activationMode: text(row, "activation_mode") ?? "unknown",
    integrationBindingMatches,
    publishingPolicyActive,
    connectionReady,
    scopes: grantedScopes,
    workflows: allowedWorkflowKeys,
    paymentRequired: humanReviewRequiresPayment({ compensationMode, feedbackBonusEnabled }),
  });
  const exactGrantActive = reason === "active";

  const requestProfile = {
    profileId: requestProfileId,
    version: requestProfileVersion,
    hash: requestProfileHash,
    status: profileStatus,
    questionAuthority,
    resultSemantics,
    criterion,
    labels: { positive: positiveLabel, negative: negativeLabel },
    rationaleMode,
    audience: {
      type: audience,
      contentBoundary,
      privateSensitivity,
      privateGroup:
        privateGroupId && privateGroupPolicyVersion !== null && privateGroupPolicyHash
          ? { groupId: privateGroupId, policyVersion: privateGroupPolicyVersion, policyHash: privateGroupPolicyHash }
          : null,
      requiredExpertiseKeys,
      expertiseRequirements,
    },
    responseWindowSeconds,
    panelSize,
    compensation: { mode: compensationMode, bountyPerSeatAtomic },
    feedbackBonus: {
      enabled: feedbackBonusEnabled,
      poolAtomic: feedbackBonusPoolAtomic,
      awarderKind: feedbackBonusAwarderKind as "requester" | "designated",
      awarderAccount: feedbackBonusAwarderAccount,
      awardWindowSeconds: feedbackBonusAwardWindowSeconds,
      agentMayAward: false as const,
    },
  };
  const readiness = deployedHumanReviewReadiness({
    evaluation: canEvaluate,
    autonomousPublishing: exactGrantActive,
  });
  const effectiveLane =
    profileStatus === "ready"
      ? resolveHumanReviewCapability({ audience, compensationMode, contentBoundary, authority }, readiness)
      : {
          available: false,
          code: "request_profile_action_required",
          lane: null,
          message: "Complete the request profile before asking reviewers.",
        };
  const canPublish =
    authority === "ask_automatically" &&
    exactGrantActive &&
    effectiveLane.available &&
    grantedScopes.includes(REQUIRED_PUBLISHING_SCOPE);
  const canSpend =
    canPublish &&
    humanReviewRequiresPayment({ compensationMode, feedbackBonusEnabled }) &&
    grantedScopes.includes(REQUIRED_SPENDING_SCOPE);

  return {
    schemaVersion: "rateloop.agent-context.v2",
    integrationId: bound.integrationId,
    workspaceId: bound.workspaceId,
    agentId: bound.agentId,
    agentVersionId: bound.agentVersionId,
    status: bound.status,
    enforcementMode: bound.enforcementMode,
    enforcementBoundary: bound.enforcementMode,
    reportedLane,
    allowedWorkflowKeys,
    reviewPolicy: {
      policyId: selection.policyId,
      version: selection.version,
      audiencePolicyHash: selection.audiencePolicyHash,
    },
    publishingPolicy: configuredPolicy,
    humanReview: {
      status: profileStatus === "ready" ? ("configured" as const) : ("action_required" as const),
      binding: { bindingId, version: bindingVersion, hash: bindingHash },
      selection,
      requestProfile,
      authority,
      blockingReason: effectiveLane.available ? null : { code: effectiveLane.code, message: effectiveLane.message },
    },
    publishingGrant: {
      active: exactGrantActive,
      reason,
      configuredPolicy,
      integrationPolicy,
      activationMode: text(row, "activation_mode"),
      exactBinding: integrationBindingMatches,
      policyActive: publishingPolicyActive,
      grantedScopes,
      credentialScopes,
      allowedWorkflowKeys,
    },
    capabilities: {
      implementedLanes,
      ownerApproval: { available: true },
      autonomousPublishing: { available: exactGrantActive, reason },
      effectiveLane,
    },
    safeAccess: {
      canCheckReviewRequirement: canEvaluate,
      canSpend,
      canPublish,
      canReadPrivateArtifacts: false,
      canAdministerWorkspace: false,
    },
  };
}

export const __effectiveAgentReviewContextTestUtils = { grantReason, sha256, stableJson };
