import type { HumanAssurancePrivateReviewCreateResponse, TokenlessAskResponse } from "@rateloop/sdk";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { freezeAdmissionPolicy } from "~~/lib/tokenless/admissionPolicy";
import type { AgentMcpPrincipal } from "~~/lib/tokenless/agentIntegrations";
import type { PreparedOwnerApproval } from "~~/lib/tokenless/humanReviewApprovalPreparation";
import {
  type FrozenHumanReviewRoutingContext,
  type HumanReviewRoutingMaterial,
  createHumanReviewRequestRouter,
} from "~~/lib/tokenless/humanReviewRequestRouter";
import type { FrozenHybridReviewSplit, HybridHumanReviewResult } from "~~/lib/tokenless/hybridHumanReviewAdapter";
import type { HumanReviewAuthorityLevel, HumanReviewLane } from "~~/lib/tokenless/reviewCapabilities";

type IntegrationPrincipal = Extract<AgentMcpPrincipal, { kind: "integration" }>;

const NOW = new Date("2026-07-16T12:00:00.000Z");
const HASH = `sha256:${"58".repeat(32)}` as const;
const SOURCE_PAYLOAD = "public or encrypted source";
const SUGGESTION_PAYLOAD = "candidate suggestion";
const SOURCE_PAYLOAD_HASH = `sha256:${createHash("sha256").update(SOURCE_PAYLOAD).digest("hex")}` as const;
const SUGGESTION_PAYLOAD_HASH = `sha256:${createHash("sha256").update(SUGGESTION_PAYLOAD).digest("hex")}` as const;
const REVIEWERS = ["0x1111111111111111111111111111111111111111", "0x2222222222222222222222222222222222222222"];
const PAID_REVIEWERS = REVIEWERS.map(payoutAccount => ({
  principalId: `rlp_${payoutAccount.slice(2, 26)}`,
  payoutAccount,
}));

function audiencePolicy(privateLane: boolean) {
  return {
    schemaVersion: "rateloop.human-assurance.v2" as const,
    policyId: privateLane ? "audience_agent_flow_invited" : "audience_agent_flow_network",
    version: 1,
    reviewerSource: privateLane ? ("customer_invited" as const) : ("rateloop_network" as const),
    compensation: "paid" as const,
    cohorts: privateLane ? [{ cohortId: "cohort_agent_flow", minimumReviewers: 1, maximumReviewers: 100 }] : [],
    selection: privateLane ? ("customer_named" as const) : ("randomized" as const),
    fallbacks: { allowed: false, sources: [] },
    requiredQualifications: [],
    assurance: {
      requirements: privateLane
        ? [
            {
              capability: "customer_invitation" as const,
              reviewerSources: ["customer_invited" as const],
              allowedProviders: ["workspace-invitation"],
            },
          ]
        : [
            {
              capability: "unique_human" as const,
              reviewerSources: ["rateloop_network" as const],
              allowedProviders: ["world:poh"],
            },
          ],
    },
    ...(privateLane
      ? {}
      : {
          integrity: {
            schemaVersion: "rateloop.integrity-assignment.v1" as const,
            epochId: "integrity:agent-flow:1",
            epochManifestHash: HASH,
            maxClusterShareBps: 2_000,
            allowedRiskBands: ["low" as const],
            recentCoassignmentWindowSeconds: 86_400,
            maxRecentCoassignments: 1,
            maxPerCustomer: 3,
            onePerProviderSubject: true as const,
          },
        }),
    buyerPrivacy: { visibleFields: ["reviewer_source" as const], minimumAggregationSize: 3, suppressSmallCells: true },
    legalEligibilityRequired: true,
  };
}

const principal: IntegrationPrincipal = {
  kind: "integration",
  principal: {
    kind: "api_key",
    apiKeyId: "oauth_family_agent_flow_e2e",
    workspaceId: "workspace_agent_flow_e2e",
    role: "member",
    scopes: ["evaluation:read", "review:decide", "panel:publish", "payment:submit", "result:read"],
    policyId: "publishing_policy_agent_flow_e2e",
  },
  integration: {
    integrationId: "integration_agent_flow_e2e",
    workspaceId: "workspace_agent_flow_e2e",
    agentId: "agent_agent_flow_e2e",
    agentVersionId: "agent_version_agent_flow_e2e",
    reviewPolicyId: "review_policy_agent_flow_e2e",
    reviewPolicyVersion: 1,
    publishingPolicyId: "publishing_policy_agent_flow_e2e",
    publishingPolicyVersion: 1,
    status: "active",
    enforcementMode: "advisory",
    allowedWorkflowKeys: ["support-reply"],
    lastSeenAt: NOW.toISOString(),
  },
};

function context(input: {
  authority: HumanReviewAuthorityLevel;
  lane: HumanReviewLane;
  responseWindowSeconds: number;
}): FrozenHumanReviewRoutingContext {
  const privateLane = input.lane === "private_invited_unpaid" || input.lane === "private_invited_paid";
  const frozenAudiencePolicy = freezeAdmissionPolicy(audiencePolicy(privateLane));
  return {
    workspaceId: "workspace_agent_flow_e2e",
    integrationId: "integration_agent_flow_e2e",
    opportunityId: `opportunity_${input.lane}_${input.authority}`,
    createdAt: NOW,
    workflowKey: "support-reply",
    agent: { id: "agent_agent_flow_e2e", versionId: "agent_version_agent_flow_e2e" },
    selectionPolicy: {
      id: "review_policy_agent_flow_e2e",
      version: 1,
      audiencePolicyHash: frozenAudiencePolicy.policyHash,
      audiencePolicy: frozenAudiencePolicy.policy,
    },
    contentCommitments: { source: SOURCE_PAYLOAD_HASH, suggestion: SUGGESTION_PAYLOAD_HASH },
    decision: "required",
    lifecycle: { state: "approval_required", revision: 2 },
    binding: { id: "binding_agent_flow_e2e", version: 1, hash: HASH, authority: input.authority },
    requestProfile: {
      id: "profile_agent_flow_e2e",
      version: 1,
      hash: HASH,
      lane: input.lane,
      audience: input.lane === "hybrid_public_safe" ? "hybrid" : privateLane ? "private_invited" : "public_network",
      contentBoundary: privateLane ? "private_workspace" : "public_or_test",
      privateSensitivity: privateLane ? "confidential" : null,
      privateGroup: privateLane ? { id: "group_agent_flow_e2e", policyVersion: 1, policyHash: HASH } : null,
      responseWindowSeconds: input.responseWindowSeconds,
      panelSize: privateLane ? 2 : 3,
      compensationMode: input.lane === "private_invited_unpaid" ? "unpaid" : "usdc",
      bountyPerSeatAtomic: input.lane === "private_invited_unpaid" ? null : "1000000",
      feedbackBonusEnabled: false,
      feedbackBonusPoolAtomic: null,
      feedbackBonusAwarderKind: "requester",
      feedbackBonusAwarderAccount: null,
      feedbackBonusAwardWindowSeconds: null,
      criterion: "Is this response accurate and safe?",
      positiveLabel: "Approve",
      negativeLabel: "Reject",
      rationaleMode: "required",
    },
    grant: {
      active: true,
      configuredPolicy: { id: "publishing_policy_agent_flow_e2e", version: 1 },
      integrationPolicy: { id: "publishing_policy_agent_flow_e2e", version: 1 },
      activationMode: "owner_approved",
      grantedScopes: ["panel:publish", "payment:submit"],
      credentialScopes: ["panel:publish", "payment:submit"],
      allowedWorkflowKeys: ["support-reply"],
      policyCaps: {
        allowedProjectIds: ["project_agent_flow_e2e"],
        allowedReviewerSources: ["customer_invited", "rateloop_network"],
        allowedDataClassifications: ["public", "confidential"],
        maxRetentionDays: 30,
      },
    },
  };
}

function hybridSplit(context: FrozenHumanReviewRoutingContext): FrozenHybridReviewSplit {
  return {
    schemaVersion: "rateloop.hybrid-review-split.v1",
    opportunityId: context.opportunityId,
    audiencePolicyHash: context.selectionPolicy.audiencePolicyHash,
    requestProfileHash: context.requestProfile.hash,
    contentCommitments: context.contentCommitments,
    publication: { visibility: "public", dataClassification: "public", confirmedNoSensitiveData: true },
    economics: { asset: "USDC", invitedMaximumChargeAtomic: "1000000", networkMaximumChargeAtomic: "1000000" },
    invited: {
      requestedCount: 1,
      candidates: [{ ...PAID_REVIEWERS[0]!, assignmentReference: "invited/1", assignmentHash: HASH }],
    },
    network: {
      requestedCount: 1,
      candidates: [{ ...PAID_REVIEWERS[1]!, assignmentReference: "network/1", assignmentHash: HASH }],
    },
  };
}

function material(frozen: FrozenHumanReviewRoutingContext): HumanReviewRoutingMaterial {
  if (frozen.requestProfile.lane.startsWith("private_invited_")) {
    return { kind: "private", sourceContentType: "text/plain", suggestionContentType: "text/plain" };
  }
  return {
    kind: "public",
    appOrigin: "https://rateloop-tokenless.vercel.app",
    publication: {
      visibility: "public",
      dataClassification: "public",
      confirmedNoSensitiveData: true,
      admissionPolicyHash: `0x${"58".repeat(32)}`,
    } as never,
    ...(frozen.requestProfile.lane === "hybrid_public_safe" ? { hybridSplit: hybridSplit(frozen) } : {}),
  };
}

function routeFixture(frozen: FrozenHumanReviewRoutingContext) {
  const calls = { approval: 0, activate: 0, public: 0, resolvePrivate: 0, foundation: 0, unpaid: 0, hybrid: 0 };
  const ask = {
    schemaVersion: "rateloop.tokenless.v2",
    idempotencyKey: "ask_agent_flow_e2e",
    operationKey: "operation_agent_flow_e2e",
    roundId: "round_agent_flow_e2e",
    status: "open",
    responseWindowSeconds: frozen.requestProfile.responseWindowSeconds,
    commitDeadline: new Date(NOW.getTime() + frozen.requestProfile.responseWindowSeconds * 1_000).toISOString(),
    requestProfile: { id: frozen.requestProfile.id, version: 1, hash: HASH },
    reviewEconomics: null,
    continuation: {
      cursor: "1",
      expiresAt: new Date(NOW.getTime() + frozen.requestProfile.responseWindowSeconds * 1_000).toISOString(),
      pollUrl: "https://rateloop-tokenless.vercel.app/wait",
      retryAfterMs: 1_000,
    },
  } satisfies TokenlessAskResponse;
  const dependencies: Parameters<typeof createHumanReviewRequestRouter>[0] = {
    isWorkspaceStopped: async () => false,
    loadContext: async () => frozen,
    prepareApproval: async () => {
      calls.approval += 1;
      return {
        approvalId: "approval_agent_flow_e2e",
        schemaVersion: "rateloop.human-review-owner-approval.v1",
        action: "owner_approval_required",
      } as unknown as PreparedOwnerApproval;
    },
    activateAutonomousLane: async () => {
      calls.activate += 1;
    },
    publishPublicPaid: async () => {
      calls.public += 1;
      return { schemaVersion: "rateloop.adaptive-review-request.v1", opportunityId: frozen.opportunityId, ask };
    },
    resolvePrivateBinding: async () => {
      calls.resolvePrivate += 1;
      return {
        projectId: "project_agent_flow_e2e",
        cohortId: "cohort_agent_flow_e2e",
        reviewerAccountAddresses: REVIEWERS,
        paidReviewers: PAID_REVIEWERS,
      };
    },
    preparePrivateFoundation: async () => {
      calls.foundation += 1;
      return {
        schemaVersion: "rateloop.human-assurance.v2",
        privateReviewId: "private_review_agent_flow_e2e",
        status: "ready_for_assignment",
      } as unknown as HumanAssurancePrivateReviewCreateResponse;
    },
    assignPrivateUnpaid: async () => {
      calls.unpaid += 1;
      return { deliveryId: "delivery_agent_flow_e2e" } as never;
    },
    assignPrivatePaid: async () => ({ deliveryId: "paid_delivery_agent_flow_e2e" }) as never,
    laneImplementation: {
      privateInvitedUnpaid: true,
      privateInvitedPaid: true,
      publicPaidNetwork: true,
      hybridPublicSafe: true,
    },
    assignHybrid: async () => {
      calls.hybrid += 1;
      return {
        schemaVersion: "rateloop.hybrid-human-review.v1",
        opportunityId: frozen.opportunityId,
        lane: "hybrid_public_safe",
        deduplicationRule: "invited_wins",
        invited: {
          subpanelReference: "invited/1",
          bindingHash: HASH,
          status: "ready",
          replayed: false,
          reviewerCount: 1,
        },
        network: {
          subpanelReference: "network/1",
          bindingHash: HASH,
          status: "ready",
          replayed: false,
          reviewerCount: 1,
          removedDuplicateCount: 0,
        },
        splitBindingHash: HASH,
      } satisfies HybridHumanReviewResult;
    },
  };
  return { calls, route: createHumanReviewRequestRouter(dependencies) };
}

test("check-only, owner-approval, and automatic authority route each supported audience without authority leakage", async () => {
  const lanes = [
    ["public_paid_network", 1_200],
    ["private_invited_unpaid", 3_600],
    ["hybrid_public_safe", 86_400],
  ] as const;
  for (const authority of ["check_only", "prepare_for_approval", "ask_automatically"] as const) {
    for (const [lane, responseWindowSeconds] of lanes) {
      const frozen = context({ authority, lane, responseWindowSeconds });
      const { calls, route } = routeFixture(frozen);
      const result = await route({
        principal,
        opportunityId: frozen.opportunityId,
        sourcePayload: SOURCE_PAYLOAD,
        suggestionPayload: SUGGESTION_PAYLOAD,
        material: material(frozen),
        now: NOW,
      });
      assert.equal(result.authority, authority);
      assert.equal(result.lane, lane);
      if (authority === "check_only") {
        assert.equal(result.action, "requirement_recorded");
        assert.deepEqual(calls, {
          approval: 0,
          activate: 0,
          public: 0,
          resolvePrivate: 0,
          foundation: 0,
          unpaid: 0,
          hybrid: 0,
        });
      } else if (authority === "prepare_for_approval") {
        assert.equal(result.action, "owner_approval_required");
        assert.equal(calls.approval, 1);
        assert.equal(
          calls.activate + calls.public + calls.resolvePrivate + calls.foundation + calls.unpaid + calls.hybrid,
          0,
        );
      } else if (lane === "public_paid_network") {
        assert.equal(result.action, "public_review_requested");
        assert.equal(result.ask.responseWindowSeconds, responseWindowSeconds);
        assert.deepEqual({ activate: calls.activate, public: calls.public }, { activate: 1, public: 1 });
      } else if (lane === "private_invited_unpaid") {
        assert.equal(result.action, "private_review_assigned");
        assert.deepEqual(
          {
            activate: calls.activate,
            resolvePrivate: calls.resolvePrivate,
            foundation: calls.foundation,
            unpaid: calls.unpaid,
          },
          { activate: 1, resolvePrivate: 1, foundation: 1, unpaid: 1 },
        );
      } else {
        assert.equal(result.action, "hybrid_review_requested");
        assert.deepEqual({ activate: calls.activate, hybrid: calls.hybrid }, { activate: 1, hybrid: 1 });
      }
    }
  }
});

test("private unpaid routing needs publish scope only while a Feedback Bonus also needs payment scope", async () => {
  const unpaid = context({
    authority: "ask_automatically",
    lane: "private_invited_unpaid",
    responseWindowSeconds: 3_600,
  });
  unpaid.grant.grantedScopes = ["panel:publish"];
  unpaid.grant.credentialScopes = ["panel:publish"];
  const unpaidFixture = routeFixture(unpaid);
  const assigned = await unpaidFixture.route({
    principal,
    opportunityId: unpaid.opportunityId,
    sourcePayload: SOURCE_PAYLOAD,
    suggestionPayload: SUGGESTION_PAYLOAD,
    material: material(unpaid),
    now: NOW,
  });
  assert.equal(assigned.action, "private_review_assigned");

  const bonus = context({
    authority: "ask_automatically",
    lane: "private_invited_unpaid",
    responseWindowSeconds: 3_600,
  });
  bonus.requestProfile.feedbackBonusEnabled = true;
  bonus.requestProfile.feedbackBonusPoolAtomic = "1000000";
  bonus.requestProfile.feedbackBonusAwardWindowSeconds = 86_400;
  bonus.grant.grantedScopes = ["panel:publish"];
  bonus.grant.credentialScopes = ["panel:publish"];
  const bonusFixture = routeFixture(bonus);
  const blocked = await bonusFixture.route({
    principal,
    opportunityId: bonus.opportunityId,
    sourcePayload: SOURCE_PAYLOAD,
    suggestionPayload: SUGGESTION_PAYLOAD,
    material: material(bonus),
    now: NOW,
  });
  assert.equal(blocked.action, "blocked");
  assert.equal(blocked.action === "blocked" ? blocked.code : null, "automatic_grant_inactive");
  assert.equal(bonusFixture.calls.activate, 0);
});
