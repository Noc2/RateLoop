import type {
  HumanAssurancePrivateReviewCreateRequest,
  HumanAssurancePrivateReviewCreateResponse,
  TokenlessAskResponse,
} from "@rateloop/sdk";
import { HUMAN_ASSURANCE_SCHEMA_VERSION } from "@rateloop/sdk";
import { createHash } from "node:crypto";
import "server-only";
import { dbClient } from "~~/lib/db";
import type { AgentMcpPrincipal } from "~~/lib/tokenless/agentIntegrations";
import { getEffectiveAgentReviewContext } from "~~/lib/tokenless/effectiveAgentReviewContext";
import {
  type FeedbackBonusPoolBinding,
  ensureFeedbackBonusPoolForDelivery,
} from "~~/lib/tokenless/feedbackBonusPoolProjection";
import {
  type PreparedOwnerApproval,
  prepareHumanReviewForOwnerApproval,
} from "~~/lib/tokenless/humanReviewApprovalPreparation";
import { transitionHumanReviewOpportunityLifecycle } from "~~/lib/tokenless/humanReviewOpportunityLifecycle";
import {
  type FrozenHumanReviewOpportunityQuestion,
  freezeHumanReviewOpportunityQuestion,
} from "~~/lib/tokenless/humanReviewOpportunityQuestions";
import { hashFrozenBinaryReviewQuestion, resolveHumanReviewQuestion } from "~~/lib/tokenless/humanReviewQuestions";
import { prepareHumanReviewRequest } from "~~/lib/tokenless/humanReviewRequestPreparation";
import type { FrozenHybridReviewSplit, HybridHumanReviewResult } from "~~/lib/tokenless/hybridHumanReviewAdapter";
import { requirePaidReviewEligibility } from "~~/lib/tokenless/paidReviewEligibilityPreflight";
import {
  type PrivatePaidHumanReviewDelivery,
  requestPrivatePaidHumanReview,
} from "~~/lib/tokenless/privatePaidHumanReviewAdapter";
import { preparePrivateReviewFoundation } from "~~/lib/tokenless/privateReviewFoundation";
import { requestPrivateUnpaidHumanReview } from "~~/lib/tokenless/privateUnpaidReviewAdapter";
import {
  type PublicPaidHumanReviewPublication,
  requestPublicPaidHumanReview,
} from "~~/lib/tokenless/publicPaidHumanReviewAdapter";
import type { HumanReviewAuthorityLevel, HumanReviewLane } from "~~/lib/tokenless/reviewCapabilities";
import {
  type ReviewerExpertiseKey,
  qualificationProvenanceSatisfiesExpertise,
} from "~~/lib/tokenless/reviewerExpertise";
import { exactReviewerExpertiseDefinitionKey } from "~~/lib/tokenless/reviewerExpertiseAssignments";
import { chooseExpertiseCoveredPanel } from "~~/lib/tokenless/reviewerExpertiseCoverage";
import type { ReviewerExpertiseRequirement } from "~~/lib/tokenless/reviewerExpertiseOptions";
import { TokenlessServiceError } from "~~/lib/tokenless/server";
import { isWorkspaceStopEngaged } from "~~/lib/tokenless/workspaceStopControl";

type Row = Record<string, unknown>;
type IntegrationPrincipal = Extract<AgentMcpPrincipal, { kind: "integration" }>;
type PrivateUnpaidDelivery = Awaited<ReturnType<typeof requestPrivateUnpaidHumanReview>>;

const HASH_PATTERN = /^sha256:[0-9a-f]{64}$/u;
const ACTIVE_OPPORTUNITY_STATES = new Set(["approval_required", "request_ready", "pending", "blocked"]);

export type HumanReviewRoutingMaterial =
  | {
      kind: "public";
      appOrigin: string;
      publication: PublicPaidHumanReviewPublication;
      hybridSplit?: FrozenHybridReviewSplit;
    }
  | {
      kind: "private";
      sourceContentType: string;
      suggestionContentType: string;
    };

export type HumanReviewRoutingRequest = {
  principal: IntegrationPrincipal;
  opportunityId: string;
  sourcePayload: string;
  suggestionPayload: string;
  question?: unknown;
  material?: HumanReviewRoutingMaterial;
  now?: Date;
};

export type FrozenHumanReviewRoutingContext = {
  workspaceId: string;
  integrationId: string;
  opportunityId: string;
  createdAt: Date;
  workflowKey: string;
  agent: { id: string; versionId: string };
  selectionPolicy: { id: string; version: number; audiencePolicyHash: `sha256:${string}` };
  contentCommitments: { source: `sha256:${string}`; suggestion: `sha256:${string}` };
  decision: "required" | "recommended" | "skip";
  lifecycle: { state: string; revision: number };
  binding: {
    id: string;
    version: number;
    hash: string;
    authority: HumanReviewAuthorityLevel;
  };
  requestProfile: {
    id: string;
    version: number;
    hash: `sha256:${string}`;
    lane: HumanReviewLane;
    audience: "private_invited" | "public_network" | "hybrid";
    contentBoundary: "private_workspace" | "public_or_test";
    privateSensitivity: "internal" | "confidential" | "restricted" | "regulated" | null;
    privateGroup: { id: string; policyVersion: number; policyHash: `sha256:${string}` } | null;
    requiredExpertiseKeys?: ReviewerExpertiseKey[];
    expertiseRequirements?: ReviewerExpertiseRequirement[];
    responseWindowSeconds: number;
    panelSize: number;
    compensationMode: "unpaid" | "usdc";
    bountyPerSeatAtomic: string | null;
    feedbackBonusEnabled: boolean;
    feedbackBonusPoolAtomic: string | null;
    feedbackBonusAwarderKind: "requester" | "designated";
    feedbackBonusAwarderAccount: string | null;
    feedbackBonusAwardWindowSeconds: number | null;
    questionAuthority?: "owner_fixed" | "agent_per_request";
    resultSemantics?: "assurance" | "feedback";
    criterion: string | null;
    positiveLabel: string | null;
    negativeLabel: string | null;
    rationaleMode: "off" | "optional" | "required";
  };
  grant: {
    active: boolean;
    configuredPolicy: { id: string; version: number } | null;
    integrationPolicy: { id: string; version: number } | null;
    activationMode: string | null;
    grantedScopes: string[];
    credentialScopes: string[];
    allowedWorkflowKeys: string[];
    policyCaps: {
      allowedProjectIds: string[];
      allowedReviewerSources: string[];
      allowedDataClassifications: string[];
      maxRetentionDays: number | null;
    } | null;
  };
};

export type ExactPrivateReviewBinding = {
  projectId: string;
  cohortId: string;
  reviewerAccountAddresses: string[];
};

export type HumanReviewRoutingResult =
  | {
      schemaVersion: "rateloop.human-review-route.v1";
      action: "no_review_required" | "requirement_recorded";
      opportunityId: string;
      authority: HumanReviewAuthorityLevel;
      lane: HumanReviewLane;
      sideEffects: { prepared: false; published: false; assigned: false; fundsReserved: false; spent: false };
    }
  | {
      schemaVersion: "rateloop.human-review-route.v1";
      action: "owner_approval_required";
      opportunityId: string;
      authority: "prepare_for_approval";
      lane: HumanReviewLane;
      approval: PreparedOwnerApproval;
      sideEffects: { prepared: true; published: false; assigned: false; fundsReserved: false; spent: false };
    }
  | {
      schemaVersion: "rateloop.human-review-route.v1";
      action: "public_review_requested";
      opportunityId: string;
      authority: "ask_automatically";
      lane: "public_paid_network";
      ask: TokenlessAskResponse;
    }
  | {
      schemaVersion: "rateloop.human-review-route.v1";
      action: "private_review_assigned";
      opportunityId: string;
      authority: "ask_automatically";
      lane: "private_invited_unpaid";
      foundation: HumanAssurancePrivateReviewCreateResponse;
      delivery: PrivateUnpaidDelivery;
    }
  | {
      schemaVersion: "rateloop.human-review-route.v1";
      action: "private_paid_review_assigned";
      opportunityId: string;
      authority: "ask_automatically";
      lane: "private_invited_paid";
      foundation: HumanAssurancePrivateReviewCreateResponse;
      delivery: PrivatePaidHumanReviewDelivery;
    }
  | {
      schemaVersion: "rateloop.human-review-route.v1";
      action: "hybrid_review_requested";
      opportunityId: string;
      authority: "ask_automatically";
      lane: "hybrid_public_safe";
      delivery: HybridHumanReviewResult;
    }
  | {
      schemaVersion: "rateloop.human-review-route.v1";
      action: "blocked";
      opportunityId: string;
      authority: HumanReviewAuthorityLevel;
      lane: HumanReviewLane;
      code:
        | "automatic_grant_inactive"
        | "lane_not_implemented"
        | "private_routing_configuration_required"
        | "workspace_stopped";
      retryable: boolean;
      sideEffects: { prepared: false; published: false; assigned: false; fundsReserved: false; spent: false };
    };

type RouterDependencies = {
  isWorkspaceStopped?: (workspaceId: string) => Promise<boolean>;
  loadContext: (
    principal: IntegrationPrincipal,
    opportunityId: string,
    now: Date,
  ) => Promise<FrozenHumanReviewRoutingContext>;
  freezeQuestion?: typeof freezeHumanReviewOpportunityQuestion;
  prepareApproval: typeof prepareHumanReviewForOwnerApproval;
  publishPublicPaid: typeof requestPublicPaidHumanReview;
  resolvePrivateBinding: (
    principal: IntegrationPrincipal,
    context: FrozenHumanReviewRoutingContext,
    now: Date,
  ) => Promise<ExactPrivateReviewBinding | null>;
  activateAutonomousLane: (
    context: FrozenHumanReviewRoutingContext,
    privateBinding: ExactPrivateReviewBinding | null,
    frozenQuestion: FrozenHumanReviewOpportunityQuestion,
    now: Date,
  ) => Promise<void>;
  preparePrivateFoundation: typeof preparePrivateReviewFoundation;
  assignPrivateUnpaid: typeof requestPrivateUnpaidHumanReview;
  assignPrivatePaid: typeof requestPrivatePaidHumanReview;
  assignHybrid?: (split: FrozenHybridReviewSplit) => Promise<HybridHumanReviewResult>;
  ensureFeedbackBonus?: typeof ensureFeedbackBonusPoolForDelivery;
  requireFeedbackBonusEligibility?: typeof requirePaidReviewEligibility;
};

const NO_SIDE_EFFECTS = Object.freeze({
  prepared: false,
  published: false,
  assigned: false,
  fundsReserved: false,
  spent: false,
} as const);

function text(row: Row | undefined, key: string) {
  const value = row?.[key];
  return value === null || value === undefined ? null : String(value);
}

function positiveInteger(row: Row | undefined, key: string) {
  const value = Number(row?.[key]);
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new TokenlessServiceError(`Stored ${key} is invalid.`, 500, "review_routing_configuration_invalid");
  }
  return value;
}

function optionalPositiveInteger(row: Row | undefined, key: string) {
  return row?.[key] === null || row?.[key] === undefined ? null : positiveInteger(row, key);
}

function stringArray(value: unknown, field: string) {
  try {
    const parsed = JSON.parse(String(value ?? "[]")) as unknown;
    if (!Array.isArray(parsed) || parsed.some(entry => typeof entry !== "string" || !entry)) throw new Error();
    return [...new Set(parsed)].sort();
  } catch {
    throw new TokenlessServiceError(`Stored ${field} is invalid.`, 500, "review_routing_configuration_invalid");
  }
}

function sameStrings(left: readonly string[], right: readonly string[]) {
  const a = [...new Set(left)].sort();
  const b = [...new Set(right)].sort();
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function deterministicPrivateIdempotencyKey(
  context: FrozenHumanReviewRoutingContext,
  binding: ExactPrivateReviewBinding,
  questionHash: string,
) {
  const canonical = JSON.stringify({
    schemaVersion: "rateloop.private-review-route-key.v1",
    workspaceId: context.workspaceId,
    integrationId: context.integrationId,
    opportunityId: context.opportunityId,
    binding: context.binding,
    requestProfile: {
      id: context.requestProfile.id,
      version: context.requestProfile.version,
      hash: context.requestProfile.hash,
    },
    projectId: binding.projectId,
    cohortId: binding.cohortId,
    reviewers: [...binding.reviewerAccountAddresses].sort(),
    questionHash,
  });
  return `private-route-${sha256(canonical)}`;
}

function deterministicActivationKey(
  context: FrozenHumanReviewRoutingContext,
  privateBinding: ExactPrivateReviewBinding | null,
  questionHash: string,
) {
  const canonical = JSON.stringify({
    schemaVersion: "rateloop.autonomous-review-activation.v1",
    workspaceId: context.workspaceId,
    opportunityId: context.opportunityId,
    workflowKey: context.workflowKey,
    lifecycle: context.lifecycle,
    binding: context.binding,
    requestProfile: {
      id: context.requestProfile.id,
      version: context.requestProfile.version,
      hash: context.requestProfile.hash,
      lane: context.requestProfile.lane,
    },
    privateBinding,
    questionHash,
  });
  return `route-ready:${sha256(canonical)}`;
}

function exactDecision(value: string | null): FrozenHumanReviewRoutingContext["decision"] {
  if (value === "required" || value === "recommended" || value === "skip") return value;
  throw new TokenlessServiceError("Stored review decision is invalid.", 500, "review_routing_configuration_invalid");
}

async function loadFrozenContext(
  principal: IntegrationPrincipal,
  opportunityId: string,
  _now: Date,
): Promise<FrozenHumanReviewRoutingContext> {
  void _now;
  const effective = await getEffectiveAgentReviewContext(principal);
  if (
    effective.humanReview.status !== "configured" ||
    !effective.humanReview.binding ||
    !effective.humanReview.requestProfile ||
    !effective.humanReview.authority ||
    !effective.capabilities.effectiveLane
  ) {
    throw new TokenlessServiceError(
      "The exact human-review configuration is unavailable.",
      409,
      "human_review_configuration_required",
    );
  }
  const profile = effective.humanReview.requestProfile;
  const lane = effective.capabilities.effectiveLane.lane;
  if (!lane) {
    throw new TokenlessServiceError("The configured review lane is invalid.", 409, "review_lane_not_configured");
  }
  const configuredPolicy = effective.publishingGrant.configuredPolicy
    ? {
        id: effective.publishingGrant.configuredPolicy.policyId,
        version: effective.publishingGrant.configuredPolicy.version,
      }
    : null;
  const integrationPolicy = effective.publishingGrant.integrationPolicy
    ? {
        id: effective.publishingGrant.integrationPolicy.policyId,
        version: effective.publishingGrant.integrationPolicy.version,
      }
    : null;
  const result = await dbClient.execute({
    sql: `SELECT o.opportunity_id,o.agent_id,o.agent_version_id,o.policy_id,o.policy_version,
                 o.human_review_binding_id,o.human_review_binding_version,
                 o.request_profile_id,o.request_profile_version,o.request_profile_hash,o.decision,
                 o.source_evidence_hash,o.suggestion_commitment,o.created_at,
                 l.state AS lifecycle_state,l.state_revision AS lifecycle_revision,l.terminal_at,
                 s.workflow_key,
                 pp.allowed_project_ids_json,pp.allowed_reviewer_sources_json,
                 pp.allowed_data_classifications_json,pp.max_retention_days
          FROM tokenless_agent_review_opportunities o
          JOIN tokenless_agent_review_opportunity_lifecycles l
            ON l.workspace_id=o.workspace_id AND l.opportunity_id=o.opportunity_id
          JOIN tokenless_agent_evaluation_scopes s
            ON s.workspace_id=o.workspace_id AND s.scope_id=o.scope_id
          LEFT JOIN tokenless_agent_publishing_policies pp
            ON pp.workspace_id=o.workspace_id AND pp.policy_id=? AND pp.version=?
          WHERE o.workspace_id=? AND o.opportunity_id=?
            AND o.agent_id=? AND o.agent_version_id=?
          LIMIT 1`,
    args: [
      configuredPolicy?.id ?? null,
      configuredPolicy?.version ?? null,
      principal.integration.workspaceId,
      opportunityId,
      principal.integration.agentId,
      principal.integration.agentVersionId,
    ],
  });
  const row = result.rows[0] as Row | undefined;
  const workflowKey = text(row, "workflow_key");
  const state = text(row, "lifecycle_state");
  if (!row || !workflowKey || !state) {
    throw new TokenlessServiceError("Review opportunity not found.", 404, "review_opportunity_not_found");
  }
  const exactBinding =
    text(row, "agent_id") === principal.integration.agentId &&
    text(row, "agent_version_id") === principal.integration.agentVersionId &&
    text(row, "policy_id") === effective.reviewPolicy.policyId &&
    positiveInteger(row, "policy_version") === effective.reviewPolicy.version &&
    text(row, "human_review_binding_id") === effective.humanReview.binding.bindingId &&
    positiveInteger(row, "human_review_binding_version") === effective.humanReview.binding.version &&
    text(row, "request_profile_id") === profile.profileId &&
    positiveInteger(row, "request_profile_version") === profile.version &&
    text(row, "request_profile_hash") === profile.hash &&
    effective.allowedWorkflowKeys.includes(workflowKey) &&
    principal.integration.allowedWorkflowKeys.includes(workflowKey) &&
    sameStrings(effective.allowedWorkflowKeys, principal.integration.allowedWorkflowKeys);
  if (!exactBinding || row.terminal_at !== null || !ACTIVE_OPPORTUNITY_STATES.has(state)) {
    throw new TokenlessServiceError(
      "The opportunity no longer matches the exact active review binding.",
      409,
      "review_routing_binding_mismatch",
    );
  }
  const principalPolicyMatches =
    principal.integration.publishingPolicyId === (integrationPolicy?.id ?? null) &&
    principal.integration.publishingPolicyVersion === (integrationPolicy?.version ?? null);
  const automaticPolicyMatches =
    effective.humanReview.authority !== "ask_automatically" ||
    (configuredPolicy !== null &&
      integrationPolicy !== null &&
      configuredPolicy.id === integrationPolicy.id &&
      configuredPolicy.version === integrationPolicy.version);
  if (!principalPolicyMatches || !automaticPolicyMatches) {
    throw new TokenlessServiceError(
      "The integration publishing grant does not match the exact review binding.",
      409,
      "review_routing_grant_mismatch",
    );
  }
  const privateGroup = profile.audience.privateGroup;
  if (!HASH_PATTERN.test(profile.hash) || (privateGroup && !HASH_PATTERN.test(privateGroup.policyHash))) {
    throw new TokenlessServiceError(
      "Stored request-profile hashes are invalid.",
      500,
      "review_routing_configuration_invalid",
    );
  }
  const policyCaps = configuredPolicy
    ? {
        allowedProjectIds: stringArray(row.allowed_project_ids_json, "publishing project IDs"),
        allowedReviewerSources: stringArray(row.allowed_reviewer_sources_json, "publishing reviewer sources"),
        allowedDataClassifications: stringArray(
          row.allowed_data_classifications_json,
          "publishing data classifications",
        ),
        maxRetentionDays: optionalPositiveInteger(row, "max_retention_days"),
      }
    : null;
  return {
    workspaceId: principal.integration.workspaceId,
    integrationId: principal.integration.integrationId,
    opportunityId: text(row, "opportunity_id")!,
    createdAt: new Date(String(row.created_at)),
    workflowKey,
    agent: { id: principal.integration.agentId, versionId: principal.integration.agentVersionId },
    selectionPolicy: {
      id: effective.reviewPolicy.policyId,
      version: effective.reviewPolicy.version,
      audiencePolicyHash: effective.reviewPolicy.audiencePolicyHash as `sha256:${string}`,
    },
    contentCommitments: {
      source: text(row, "source_evidence_hash") as `sha256:${string}`,
      suggestion: text(row, "suggestion_commitment") as `sha256:${string}`,
    },
    decision: exactDecision(text(row, "decision")),
    lifecycle: { state, revision: positiveInteger(row, "lifecycle_revision") },
    binding: {
      id: effective.humanReview.binding.bindingId,
      version: effective.humanReview.binding.version,
      hash: effective.humanReview.binding.hash,
      authority: effective.humanReview.authority,
    },
    requestProfile: {
      id: profile.profileId,
      version: profile.version,
      hash: profile.hash as `sha256:${string}`,
      lane,
      audience: profile.audience.type,
      contentBoundary: profile.audience.contentBoundary,
      privateSensitivity: profile.audience
        .privateSensitivity as FrozenHumanReviewRoutingContext["requestProfile"]["privateSensitivity"],
      privateGroup: privateGroup
        ? {
            id: privateGroup.groupId,
            policyVersion: privateGroup.policyVersion,
            policyHash: privateGroup.policyHash as `sha256:${string}`,
          }
        : null,
      requiredExpertiseKeys: profile.audience.requiredExpertiseKeys,
      expertiseRequirements: profile.audience.expertiseRequirements,
      responseWindowSeconds: profile.responseWindowSeconds!,
      panelSize: profile.panelSize!,
      compensationMode: profile.compensation.mode,
      bountyPerSeatAtomic: profile.compensation.bountyPerSeatAtomic,
      feedbackBonusEnabled: profile.feedbackBonus.enabled,
      feedbackBonusPoolAtomic: profile.feedbackBonus.poolAtomic,
      feedbackBonusAwarderKind: profile.feedbackBonus.awarderKind,
      feedbackBonusAwarderAccount: profile.feedbackBonus.awarderAccount,
      feedbackBonusAwardWindowSeconds: profile.feedbackBonus.awardWindowSeconds,
      questionAuthority: profile.questionAuthority,
      resultSemantics: profile.resultSemantics,
      criterion: profile.criterion,
      positiveLabel: profile.labels.positive,
      negativeLabel: profile.labels.negative,
      rationaleMode: profile.rationaleMode,
    },
    grant: {
      active:
        effective.publishingGrant.active &&
        effective.publishingGrant.exactBinding === true &&
        effective.publishingGrant.policyActive === true,
      configuredPolicy,
      integrationPolicy,
      activationMode: effective.publishingGrant.activationMode,
      grantedScopes: [...effective.publishingGrant.grantedScopes],
      credentialScopes: [...effective.publishingGrant.credentialScopes],
      allowedWorkflowKeys: [...effective.publishingGrant.allowedWorkflowKeys],
      policyCaps,
    },
  };
}

function parseAllowedProjects(value: unknown) {
  return stringArray(value, "private membership project IDs");
}

async function resolveExactPrivateBinding(
  _principal: IntegrationPrincipal,
  context: FrozenHumanReviewRoutingContext,
  now: Date,
): Promise<ExactPrivateReviewBinding | null> {
  const profile = context.requestProfile;
  const group = profile.privateGroup;
  const caps = context.grant.policyCaps;
  if (
    (profile.lane !== "private_invited_unpaid" && profile.lane !== "private_invited_paid") ||
    profile.audience !== "private_invited" ||
    profile.contentBoundary !== "private_workspace" ||
    profile.privateSensitivity === null ||
    !group ||
    (profile.lane === "private_invited_unpaid"
      ? profile.compensationMode !== "unpaid" || profile.bountyPerSeatAtomic !== null
      : profile.compensationMode !== "usdc" ||
        profile.bountyPerSeatAtomic === null ||
        !/^[1-9][0-9]*$/u.test(profile.bountyPerSeatAtomic)) ||
    !caps ||
    !caps.allowedReviewerSources.includes("customer_invited") ||
    (caps.allowedDataClassifications.length > 0 &&
      !caps.allowedDataClassifications.includes(profile.privateSensitivity))
  ) {
    return null;
  }
  const responseDeadline = new Date(now.getTime() + profile.responseWindowSeconds * 1_000);
  const requiredExpertise = profile.requiredExpertiseKeys ?? [];
  const exactExpertiseRequirements = profile.expertiseRequirements ?? [];
  const result = await dbClient.execute({
    sql: `SELECT p.project_id,p.retention_days,c.cohort_id,c.capacity,c.active_reservations,
                 cr.reviewer_account_address,cr.qualification_provenance_json,m.allowed_project_ids_json,
                 q.expertise_definition_id,q.expertise_definition_version,q.expertise_definition_hash
          FROM tokenless_assurance_projects p
          JOIN tokenless_assurance_cohorts c
            ON c.project_id=p.project_id AND c.private_group_id=?
           AND c.source='customer_invited' AND c.selection='customer_named' AND c.status='active'
          JOIN tokenless_private_groups g
            ON g.group_id=c.private_group_id AND g.workspace_id=p.workspace_id
           AND g.status='active' AND g.current_policy_version=?
          JOIN tokenless_private_group_policy_versions gp
            ON gp.group_id=g.group_id AND gp.version=g.current_policy_version AND gp.policy_hash=?
          JOIN tokenless_assurance_cohort_reviewers cr
            ON cr.project_id=p.project_id AND cr.cohort_id=c.cohort_id AND cr.status='active'
           AND cr.active_reservations<cr.maximum_active_assignments
           AND (cr.qualification_expires_at IS NULL OR cr.qualification_expires_at>?)
          JOIN tokenless_private_group_memberships m
            ON m.group_id=g.group_id AND m.principal_address=cr.reviewer_account_address
           AND m.status='active' AND m.joined_at<=?
           AND (m.membership_expires_at IS NULL OR m.membership_expires_at>?)
          LEFT JOIN tokenless_reviewer_qualifications q
            ON q.workspace_id=p.workspace_id AND q.reviewer_account_address=cr.reviewer_account_address
           AND q.reviewer_source='customer_invited' AND q.qualification_kind='expertise'
           AND q.expertise_record_schema_version=2 AND q.status='active' AND q.expires_at>=?
          WHERE p.workspace_id=? AND p.status='active' AND p.visibility='private'
            AND p.data_classification=? AND p.private_sensitivity=?
          ORDER BY p.project_id,c.cohort_id,cr.reviewer_account_address`,
    args: [
      group.id,
      group.policyVersion,
      group.policyHash,
      responseDeadline,
      now,
      responseDeadline,
      responseDeadline,
      context.workspaceId,
      profile.privateSensitivity,
      profile.privateSensitivity,
    ],
  });
  const candidates = new Map<
    string,
    {
      projectId: string;
      cohortId: string;
      retentionDays: number;
      capacity: number;
      reservations: number;
      reviewers: Map<string, Set<string>>;
    }
  >();
  for (const value of result.rows) {
    const row = value as Row;
    const projectId = text(row, "project_id");
    const cohortId = text(row, "cohort_id");
    const reviewer = text(row, "reviewer_account_address");
    if (!projectId || !cohortId || !reviewer) continue;
    if (
      !qualificationProvenanceSatisfiesExpertise(row.qualification_provenance_json, requiredExpertise, responseDeadline)
    ) {
      continue;
    }
    const allowedProjects = parseAllowedProjects(row.allowed_project_ids_json);
    if (allowedProjects.length > 0 && !allowedProjects.includes(projectId)) continue;
    const key = `${projectId}\0${cohortId}`;
    const candidate = candidates.get(key) ?? {
      projectId,
      cohortId,
      retentionDays: positiveInteger(row, "retention_days"),
      capacity: positiveInteger(row, "capacity"),
      reservations: Number(row.active_reservations),
      reviewers: new Map<string, Set<string>>(),
    };
    if (!Number.isSafeInteger(candidate.reservations) || candidate.reservations < 0) continue;
    const reviewerExpertise = candidate.reviewers.get(reviewer) ?? new Set<string>();
    const definitionId = text(row, "expertise_definition_id");
    const definitionVersion = Number(row.expertise_definition_version);
    const definitionHash = text(row, "expertise_definition_hash");
    if (
      definitionId &&
      Number.isSafeInteger(definitionVersion) &&
      definitionVersion > 0 &&
      definitionHash &&
      HASH_PATTERN.test(definitionHash)
    ) {
      reviewerExpertise.add(
        exactReviewerExpertiseDefinitionKey({
          definitionId,
          definitionVersion,
          definitionHash: definitionHash as `sha256:${string}`,
        }),
      );
    }
    candidate.reviewers.set(reviewer, reviewerExpertise);
    candidates.set(key, candidate);
  }
  const exact = [...candidates.values()].flatMap(candidate => {
    const projectAllowed = caps.allowedProjectIds.length === 0 || caps.allowedProjectIds.includes(candidate.projectId);
    const retentionAllowed = caps.maxRetentionDays === null || candidate.retentionDays <= caps.maxRetentionDays;
    if (
      !projectAllowed ||
      !retentionAllowed ||
      candidate.reviewers.size < profile.panelSize ||
      candidate.capacity - candidate.reservations < profile.panelSize
    ) {
      return [];
    }
    const reviewerAccountAddresses = exactExpertiseRequirements.length
      ? chooseExpertiseCoveredPanel(
          [...candidate.reviewers.entries()].map(([id, expertiseKeys]) => ({ id, expertiseKeys: [...expertiseKeys] })),
          profile.panelSize,
          exactExpertiseRequirements.map(requirement => ({
            key: exactReviewerExpertiseDefinitionKey(requirement),
            minimumSeats: requirement.minimumSeats,
          })),
        )
      : candidate.reviewers.size === profile.panelSize
        ? [...candidate.reviewers.keys()].sort()
        : null;
    return reviewerAccountAddresses ? [{ ...candidate, reviewerAccountAddresses }] : [];
  });
  if (exact.length !== 1) return null;
  return {
    projectId: exact[0]!.projectId,
    cohortId: exact[0]!.cohortId,
    reviewerAccountAddresses: exact[0]!.reviewerAccountAddresses,
  };
}

async function activateExactAutonomousLane(
  context: FrozenHumanReviewRoutingContext,
  privateBinding: ExactPrivateReviewBinding | null,
  frozenQuestion: FrozenHumanReviewOpportunityQuestion,
  now: Date,
) {
  if (context.lifecycle.state === "request_ready" || context.lifecycle.state === "pending") return;
  if (context.lifecycle.state !== "approval_required" && context.lifecycle.state !== "blocked") {
    throw new TokenlessServiceError(
      "The human-review opportunity is not ready for autonomous activation.",
      409,
      "human_review_lifecycle_not_activatable",
    );
  }
  await transitionHumanReviewOpportunityLifecycle({
    workspaceId: context.workspaceId,
    opportunityId: context.opportunityId,
    transitionKey: deterministicActivationKey(context, privateBinding, frozenQuestion.questionHash),
    expectedState: context.lifecycle.state,
    expectedRevision: context.lifecycle.revision,
    toState: "request_ready",
    reasonCodes: [`${context.requestProfile.lane}_ready`, "exact_owner_grant_active"],
    actor: { kind: "lane_adapter", reference: "human-review-router-v1" },
    details: {
      workflowKey: context.workflowKey,
      bindingId: context.binding.id,
      bindingVersion: context.binding.version,
      bindingHash: context.binding.hash,
      requestProfileId: context.requestProfile.id,
      requestProfileVersion: context.requestProfile.version,
      requestProfileHash: context.requestProfile.hash,
      lane: context.requestProfile.lane,
      questionHash: frozenQuestion.questionHash,
      questionAuthority: frozenQuestion.question.questionAuthority,
      resultSemantics: frozenQuestion.question.resultSemantics,
      publishingPolicy: context.grant.configuredPolicy,
      ...(privateBinding
        ? {
            privateBinding: {
              projectId: privateBinding.projectId,
              cohortId: privateBinding.cohortId,
              reviewerCount: privateBinding.reviewerAccountAddresses.length,
            },
          }
        : {}),
    },
    occurredAt: now,
  });
}

function requiredMaterial(context: FrozenHumanReviewRoutingContext, material: HumanReviewRoutingMaterial | undefined) {
  const expectedKind = context.requestProfile.lane.startsWith("private_invited_") ? "private" : "public";
  if (!material || material.kind !== expectedKind) {
    throw new TokenlessServiceError(
      `The frozen ${context.requestProfile.lane} lane requires ${expectedKind} review material.`,
      409,
      "review_material_lane_mismatch",
    );
  }
  return material;
}

function hasExactAutonomousGrant(context: FrozenHumanReviewRoutingContext) {
  if (
    !context.grant.active ||
    context.grant.activationMode !== "owner_approved" ||
    !context.grant.configuredPolicy ||
    !context.grant.integrationPolicy ||
    context.grant.configuredPolicy.id !== context.grant.integrationPolicy.id ||
    context.grant.configuredPolicy.version !== context.grant.integrationPolicy.version ||
    !context.grant.allowedWorkflowKeys.includes(context.workflowKey) ||
    !context.grant.grantedScopes.includes("panel:publish") ||
    !context.grant.credentialScopes.includes("panel:publish")
  ) {
    return false;
  }
  if (
    (context.requestProfile.compensationMode === "usdc" || context.requestProfile.feedbackBonusEnabled) &&
    (!context.grant.grantedScopes.includes("payment:submit") ||
      !context.grant.credentialScopes.includes("payment:submit"))
  ) {
    return false;
  }
  return true;
}

function prepareFrozenRoutingRequest(
  context: FrozenHumanReviewRoutingContext,
  input: HumanReviewRoutingRequest,
  frozenQuestion: FrozenHumanReviewOpportunityQuestion,
  now: Date,
) {
  const profile = context.requestProfile;
  const preparedAt = profile.lane === "public_paid_network" ? context.createdAt : now;
  return prepareHumanReviewRequest({
    opportunityId: context.opportunityId,
    workflowKey: context.workflowKey,
    requestProfile: {
      id: profile.id,
      version: profile.version,
      hash: profile.hash,
      agentId: context.agent.id,
      agentVersionId: context.agent.versionId,
      questionAuthority: profile.questionAuthority ?? "owner_fixed",
      resultSemantics: profile.resultSemantics ?? "assurance",
      criterion: profile.criterion,
      positiveLabel: profile.positiveLabel,
      negativeLabel: profile.negativeLabel,
      rationaleMode: profile.rationaleMode,
      audience: profile.audience,
      contentBoundary: profile.contentBoundary,
      privateSensitivity: profile.privateSensitivity,
      privateGroupId: profile.privateGroup?.id ?? null,
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
    },
    selectionPolicy: { id: context.selectionPolicy.id, version: context.selectionPolicy.version },
    contentCommitments: context.contentCommitments,
    preparedAt,
    expiresAt: new Date(preparedAt.getTime() + profile.responseWindowSeconds * 1_000),
    sourcePayload: input.sourcePayload,
    suggestionPayload: input.suggestionPayload,
    effectiveQuestion: frozenQuestion.question,
    effectiveQuestionHash: frozenQuestion.questionHash,
  });
}

async function freezeRoutingQuestion(
  dependencies: RouterDependencies,
  context: FrozenHumanReviewRoutingContext,
  input: HumanReviewRoutingRequest,
  now: Date,
) {
  if (dependencies.freezeQuestion) {
    return dependencies.freezeQuestion({
      workspaceId: context.workspaceId,
      opportunityId: context.opportunityId,
      integrationId: context.integrationId,
      ...(input.question === undefined ? {} : { callerQuestion: input.question }),
      now,
    });
  }
  if (context.requestProfile.questionAuthority === "agent_per_request") {
    throw new TokenlessServiceError(
      "Agent-written review questions require immutable question storage.",
      503,
      "review_question_freezer_unavailable",
      true,
    );
  }
  const question = resolveHumanReviewQuestion({
    policy: {
      questionAuthority: "owner_fixed",
      resultSemantics: "assurance",
      criterion: context.requestProfile.criterion,
      positiveLabel: context.requestProfile.positiveLabel,
      negativeLabel: context.requestProfile.negativeLabel,
      rationaleMode: context.requestProfile.rationaleMode,
    },
    ...(input.question === undefined ? {} : { callerQuestion: input.question }),
  });
  return Object.freeze({
    question,
    questionHash: hashFrozenBinaryReviewQuestion(question),
    contentBoundary: context.requestProfile.contentBoundary,
    persisted: false,
    replayed: false,
  });
}

async function ensureRoutingFeedbackBonus(
  dependencies: RouterDependencies,
  context: FrozenHumanReviewRoutingContext,
  input: HumanReviewRoutingRequest,
  frozenQuestion: FrozenHumanReviewOpportunityQuestion,
  now: Date,
  reviewerAccounts: readonly string[] = [],
): Promise<FeedbackBonusPoolBinding | null> {
  if (!context.requestProfile.feedbackBonusEnabled) return null;
  if (!dependencies.ensureFeedbackBonus) {
    throw new TokenlessServiceError(
      "Feedback Bonus delivery is unavailable without exact pool execution.",
      503,
      "feedback_bonus_pool_execution_unavailable",
      true,
    );
  }
  if (reviewerAccounts.length > 0) {
    if (!dependencies.requireFeedbackBonusEligibility) {
      throw new TokenlessServiceError(
        "Feedback Bonus delivery requires paid eligibility before funding.",
        503,
        "feedback_bonus_eligibility_unavailable",
        true,
      );
    }
    for (const account of [...new Set(reviewerAccounts.map(value => value.toLowerCase()))].sort()) {
      await dependencies.requireFeedbackBonusEligibility(account, now);
    }
  }
  const preparation = prepareFrozenRoutingRequest(context, input, frozenQuestion, now);
  const feedbackDeadline = new Date(preparation.preparedRequest.timing.expiresAt);
  return dependencies.ensureFeedbackBonus({
    workspaceId: context.workspaceId,
    agentId: context.agent.id,
    opportunityId: context.opportunityId,
    admissionPolicyHash: context.selectionPolicy.audiencePolicyHash,
    preparation,
    feedbackDeadline,
  });
}

const DEFAULT_DEPENDENCIES: RouterDependencies = {
  isWorkspaceStopped: isWorkspaceStopEngaged,
  loadContext: loadFrozenContext,
  freezeQuestion: freezeHumanReviewOpportunityQuestion,
  prepareApproval: prepareHumanReviewForOwnerApproval,
  publishPublicPaid: requestPublicPaidHumanReview,
  resolvePrivateBinding: resolveExactPrivateBinding,
  activateAutonomousLane: activateExactAutonomousLane,
  preparePrivateFoundation: preparePrivateReviewFoundation,
  assignPrivateUnpaid: requestPrivateUnpaidHumanReview,
  assignPrivatePaid: requestPrivatePaidHumanReview,
  ensureFeedbackBonus: ensureFeedbackBonusPoolForDelivery,
  requireFeedbackBonusEligibility: requirePaidReviewEligibility,
};

export function createHumanReviewRequestRouter(dependencies: RouterDependencies = DEFAULT_DEPENDENCIES) {
  return async function routeHumanReviewRequest(input: HumanReviewRoutingRequest): Promise<HumanReviewRoutingResult> {
    const now = input.now ?? new Date();
    if (!Number.isFinite(now.getTime())) {
      throw new TokenlessServiceError("Routing time is invalid.", 400, "invalid_review_routing_time");
    }
    const context = await dependencies.loadContext(input.principal, input.opportunityId, now);
    const common = {
      schemaVersion: "rateloop.human-review-route.v1" as const,
      opportunityId: context.opportunityId,
      authority: context.binding.authority,
      lane: context.requestProfile.lane,
    };
    if (await (dependencies.isWorkspaceStopped ?? isWorkspaceStopEngaged)(context.workspaceId)) {
      // The workspace stop control halts every review-triggered release path
      // until a manager releases the stop and re-grants agents individually.
      return {
        ...common,
        action: "blocked",
        code: "workspace_stopped",
        retryable: true,
        sideEffects: NO_SIDE_EFFECTS,
      };
    }
    if (context.decision !== "required") {
      return { ...common, action: "no_review_required", sideEffects: NO_SIDE_EFFECTS };
    }
    if (context.binding.authority === "check_only") {
      return { ...common, action: "requirement_recorded", sideEffects: NO_SIDE_EFFECTS };
    }
    if (
      context.requestProfile.lane !== "public_paid_network" &&
      context.requestProfile.lane !== "private_invited_unpaid" &&
      context.requestProfile.lane !== "private_invited_paid" &&
      context.requestProfile.lane !== "hybrid_public_safe"
    ) {
      return {
        ...common,
        action: "blocked",
        code: "lane_not_implemented",
        retryable: false,
        sideEffects: NO_SIDE_EFFECTS,
      };
    }
    if (context.binding.authority === "prepare_for_approval") {
      const frozenQuestion = await freezeRoutingQuestion(dependencies, context, input, now);
      const approval = await dependencies.prepareApproval({
        principal: input.principal,
        opportunityId: context.opportunityId,
        sourcePayload: input.sourcePayload,
        suggestionPayload: input.suggestionPayload,
        effectiveQuestion: frozenQuestion.question,
        effectiveQuestionHash: frozenQuestion.questionHash,
        now,
      });
      return {
        ...common,
        authority: "prepare_for_approval",
        action: "owner_approval_required",
        approval,
        sideEffects: {
          prepared: true,
          published: false,
          assigned: false,
          fundsReserved: false,
          spent: false,
        },
      };
    }
    requiredMaterial(context, input.material);
    if (!hasExactAutonomousGrant(context)) {
      return {
        ...common,
        action: "blocked",
        code: "automatic_grant_inactive",
        retryable: true,
        sideEffects: NO_SIDE_EFFECTS,
      };
    }
    if (context.requestProfile.lane === "hybrid_public_safe") {
      const material = input.material!;
      const split = material.kind === "public" ? material.hybridSplit : undefined;
      if (!dependencies.assignHybrid || !split || split.opportunityId !== context.opportunityId) {
        return {
          ...common,
          action: "blocked",
          code: "lane_not_implemented",
          retryable: true,
          sideEffects: NO_SIDE_EFFECTS,
        };
      }
    }
    const frozenQuestion = await freezeRoutingQuestion(dependencies, context, input, now);
    if (context.requestProfile.lane === "hybrid_public_safe") {
      const material = input.material!;
      const split = material.kind === "public" ? material.hybridSplit : undefined;
      if (!dependencies.assignHybrid || !split) throw new Error("Hybrid material was checked before routing.");
      await ensureRoutingFeedbackBonus(
        dependencies,
        context,
        input,
        frozenQuestion,
        now,
        [...split.invited.candidates, ...split.network.candidates].map(candidate => candidate.accountAddress),
      );
      await dependencies.activateAutonomousLane(context, null, frozenQuestion, now);
      return {
        schemaVersion: "rateloop.human-review-route.v1",
        action: "hybrid_review_requested",
        opportunityId: context.opportunityId,
        authority: "ask_automatically",
        lane: "hybrid_public_safe",
        delivery: await dependencies.assignHybrid(split),
      };
    }
    if (context.requestProfile.lane === "public_paid_network") {
      const material = input.material!;
      if (material.kind !== "public") throw new Error("Public material was checked before routing.");
      await ensureRoutingFeedbackBonus(dependencies, context, input, frozenQuestion, now);
      await dependencies.activateAutonomousLane(context, null, frozenQuestion, now);
      const requested = await dependencies.publishPublicPaid({
        principal: input.principal,
        opportunityId: context.opportunityId,
        sourcePayload: input.sourcePayload,
        suggestionPayload: input.suggestionPayload,
        publication: material.publication,
        appOrigin: material.appOrigin,
        effectiveQuestion: frozenQuestion.question,
        effectiveQuestionHash: frozenQuestion.questionHash,
      });
      return {
        schemaVersion: "rateloop.human-review-route.v1",
        action: "public_review_requested",
        opportunityId: context.opportunityId,
        authority: "ask_automatically",
        lane: "public_paid_network",
        ask: requested.ask,
      };
    }
    const material = input.material!;
    if (material.kind !== "private") throw new Error("Private material was checked before routing.");
    const privateBinding = await dependencies.resolvePrivateBinding(input.principal, context, now);
    if (!privateBinding) {
      return {
        ...common,
        action: "blocked",
        code: "private_routing_configuration_required",
        retryable: true,
        sideEffects: NO_SIDE_EFFECTS,
      };
    }
    await ensureRoutingFeedbackBonus(
      dependencies,
      context,
      input,
      frozenQuestion,
      now,
      privateBinding.reviewerAccountAddresses,
    );
    await dependencies.activateAutonomousLane(context, privateBinding, frozenQuestion, now);
    const request: HumanAssurancePrivateReviewCreateRequest = {
      idempotencyKey: deterministicPrivateIdempotencyKey(context, privateBinding, frozenQuestion.questionHash),
      integrationId: context.integrationId,
      projectId: privateBinding.projectId,
      requestProfile: {
        id: context.requestProfile.id,
        version: context.requestProfile.version,
        hash: context.requestProfile.hash,
      },
      cohortId: privateBinding.cohortId,
      dataClassification: context.requestProfile.privateSensitivity!,
      source: {
        contentType: material.sourceContentType,
        bytesBase64: Buffer.from(input.sourcePayload, "utf8").toString("base64"),
      },
      suggestion: {
        contentType: material.suggestionContentType,
        bytesBase64: Buffer.from(input.suggestionPayload, "utf8").toString("base64"),
      },
    };
    const foundation = await dependencies.preparePrivateFoundation({
      principal: input.principal.principal,
      request,
      externalContentCommitments: {
        sourceEvidenceHash: context.contentCommitments.source,
        suggestionCommitment: context.contentCommitments.suggestion,
      },
      now,
    });
    if (foundation.schemaVersion !== HUMAN_ASSURANCE_SCHEMA_VERSION || foundation.status !== "ready_for_assignment") {
      throw new TokenlessServiceError(
        "The exact private review binding requires owner configuration.",
        409,
        "private_routing_configuration_required",
      );
    }
    if (context.requestProfile.lane === "private_invited_paid") {
      const prepared = prepareFrozenRoutingRequest(context, input, frozenQuestion, now);
      const delivery = await dependencies.assignPrivatePaid({
        principal: input.principal.principal,
        integrationId: context.integrationId,
        opportunityId: context.opportunityId,
        privateReviewId: foundation.privateReviewId,
        projectId: privateBinding.projectId,
        cohortId: privateBinding.cohortId,
        privateGroup: context.requestProfile.privateGroup!,
        reviewerAccountAddresses: privateBinding.reviewerAccountAddresses,
        audiencePolicyHash: context.selectionPolicy.audiencePolicyHash,
        publishingPolicy: context.grant.configuredPolicy!,
        preparedRequest: prepared.preparedRequest,
        preparedRequestHash: prepared.preparedRequestHash,
        economics: prepared.derivedEconomics,
        economicsHash: prepared.derivedEconomicsHash,
        now,
      });
      return {
        schemaVersion: "rateloop.human-review-route.v1",
        action: "private_paid_review_assigned",
        opportunityId: context.opportunityId,
        authority: "ask_automatically",
        lane: "private_invited_paid",
        foundation,
        delivery,
      };
    }
    const delivery = await dependencies.assignPrivateUnpaid({
      principal: input.principal.principal,
      opportunityId: context.opportunityId,
      privateReviewId: foundation.privateReviewId,
      reviewerAccountAddresses: privateBinding.reviewerAccountAddresses,
      now,
    });
    return {
      schemaVersion: "rateloop.human-review-route.v1",
      action: "private_review_assigned",
      opportunityId: context.opportunityId,
      authority: "ask_automatically",
      lane: "private_invited_unpaid",
      foundation,
      delivery,
    };
  };
}

export const routeHumanReviewRequest = createHumanReviewRequestRouter();

export const __humanReviewRequestRouterTestUtils = {
  deterministicActivationKey,
  deterministicPrivateIdempotencyKey,
  hasExactAutonomousGrant,
};
