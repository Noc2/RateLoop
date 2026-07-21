import type { HumanAssurancePrivateReviewCreateResponse, TokenlessAskResponse } from "@rateloop/sdk";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { freezeAdmissionPolicy } from "~~/lib/tokenless/admissionPolicy";
import type { AgentMcpPrincipal } from "~~/lib/tokenless/agentIntegrations";
import type { PreparedOwnerApproval } from "~~/lib/tokenless/humanReviewApprovalPreparation";
import { hashFrozenBinaryReviewQuestion, resolveHumanReviewQuestion } from "~~/lib/tokenless/humanReviewQuestions";
import {
  type ExactPrivateReviewBinding,
  type FrozenHumanReviewRoutingContext,
  __humanReviewRequestRouterTestUtils,
  createHumanReviewRequestRouter,
} from "~~/lib/tokenless/humanReviewRequestRouter";
import type { HumanReviewLaneReadiness } from "~~/lib/tokenless/reviewCapabilities";
import { TokenlessServiceError } from "~~/lib/tokenless/server";
import { workspacePrivateReviewRoutingIds } from "~~/lib/tokenless/workspacePrivateReviewRouting";

type IntegrationPrincipal = Extract<AgentMcpPrincipal, { kind: "integration" }>;

const NOW = new Date("2026-07-16T12:00:00.000Z");
const HASH = `sha256:${"1a".repeat(32)}` as const;
const POLICY = { id: "agpol_router", version: 3 };
const PRIVATE_ROUTING_IDS = workspacePrivateReviewRoutingIds({
  workspaceId: "workspace_router",
  profileId: "profile_router",
  profileVersion: 7,
  profileHash: HASH,
  privateGroupId: "group_router",
});
const payloadHash = (value: string) =>
  `sha256:${createHash("sha256").update(value).digest("hex")}` as `sha256:${string}`;

function audiencePolicy(privateLane: boolean) {
  return {
    schemaVersion: "rateloop.human-assurance.v2" as const,
    policyId: privateLane ? "audience_router_invited" : "audience_router_network",
    version: 1,
    reviewerSource: privateLane ? ("customer_invited" as const) : ("rateloop_network" as const),
    compensation: "paid" as const,
    cohorts: privateLane ? [{ cohortId: PRIVATE_ROUTING_IDS.cohortId, minimumReviewers: 2, maximumReviewers: 2 }] : [],
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
            epochId: "integrity:router:1",
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
    apiKeyId: "oauth_family_router",
    workspaceId: "workspace_router",
    role: "member",
    scopes: ["evaluation:read", "review:decide", "panel:publish", "payment:submit", "result:read"],
    policyId: POLICY.id,
  },
  integration: {
    integrationId: "integration_router",
    workspaceId: "workspace_router",
    agentId: "agent_router",
    agentVersionId: "agent_version_router",
    reviewPolicyId: "review_policy_router",
    reviewPolicyVersion: 4,
    publishingPolicyId: POLICY.id,
    publishingPolicyVersion: POLICY.version,
    status: "active",
    enforcementMode: "advisory",
    allowedWorkflowKeys: ["support-reply"],
    lastSeenAt: NOW.toISOString(),
  },
};

function context(input?: {
  authority?: FrozenHumanReviewRoutingContext["binding"]["authority"];
  decision?: FrozenHumanReviewRoutingContext["decision"];
  grantActive?: boolean;
  feedbackBonus?: boolean;
  requiredExpertiseKeys?: FrozenHumanReviewRoutingContext["requestProfile"]["requiredExpertiseKeys"];
  lane?: FrozenHumanReviewRoutingContext["requestProfile"]["lane"];
  lifecycleState?: string;
  questionAuthority?: "owner_fixed" | "agent_per_request";
  sourcePayload?: string;
  suggestionPayload?: string;
}): FrozenHumanReviewRoutingContext {
  const lane = input?.lane ?? "public_paid_network";
  const privateLane = lane === "private_invited_unpaid" || lane === "private_invited_paid";
  const frozenAudiencePolicy = freezeAdmissionPolicy(audiencePolicy(privateLane));
  const grantActive = input?.grantActive ?? true;
  const questionAuthority = input?.questionAuthority ?? "owner_fixed";
  return {
    workspaceId: "workspace_router",
    integrationId: "integration_router",
    opportunityId: "opportunity_router",
    createdAt: NOW,
    workflowKey: "support-reply",
    agent: { id: "agent_router", versionId: "agent_version_router" },
    selectionPolicy: {
      id: "review_policy_router",
      version: 4,
      audiencePolicyHash: frozenAudiencePolicy.policyHash,
      audiencePolicy: frozenAudiencePolicy.policy,
    },
    contentCommitments: {
      source: payloadHash(input?.sourcePayload ?? "private source"),
      suggestion: payloadHash(input?.suggestionPayload ?? "private suggestion"),
    },
    decision: input?.decision ?? "required",
    lifecycle: { state: input?.lifecycleState ?? "approval_required", revision: 2 },
    binding: {
      id: "binding_router",
      version: 5,
      hash: HASH,
      authority: input?.authority ?? "ask_automatically",
    },
    requestProfile: {
      id: "profile_router",
      version: 7,
      hash: HASH,
      lane,
      audience: lane === "hybrid_public_safe" ? "hybrid" : privateLane ? "private_invited" : "public_network",
      contentBoundary: privateLane ? "private_workspace" : "public_or_test",
      privateSensitivity: privateLane ? "confidential" : null,
      privateGroup: privateLane ? { id: "group_router", policyVersion: 2, policyHash: HASH } : null,
      requiredExpertiseKeys: input?.requiredExpertiseKeys ?? [],
      responseWindowSeconds: 3_600,
      panelSize: privateLane ? 2 : 3,
      compensationMode: lane === "private_invited_unpaid" ? "unpaid" : "usdc",
      bountyPerSeatAtomic: lane === "private_invited_unpaid" ? null : "1000000",
      feedbackBonusEnabled: input?.feedbackBonus ?? false,
      feedbackBonusPoolAtomic: input?.feedbackBonus ? "5000000" : null,
      feedbackBonusAwarderKind: "requester",
      feedbackBonusAwarderAccount: null,
      feedbackBonusAwardWindowSeconds: input?.feedbackBonus ? 604_800 : null,
      questionAuthority,
      resultSemantics: questionAuthority === "owner_fixed" ? "assurance" : "feedback",
      criterion: questionAuthority === "owner_fixed" ? "Is the reply accurate?" : null,
      positiveLabel: questionAuthority === "owner_fixed" ? "Accurate" : null,
      negativeLabel: questionAuthority === "owner_fixed" ? "Needs changes" : null,
      rationaleMode: "required",
    },
    grant: {
      active: grantActive,
      configuredPolicy: POLICY,
      integrationPolicy: POLICY,
      activationMode: "owner_approved",
      grantedScopes: ["panel:publish", "payment:submit"],
      credentialScopes: ["panel:publish", "payment:submit"],
      allowedWorkflowKeys: ["support-reply"],
      policyCaps: {
        allowedProjectIds: ["project_router"],
        allowedReviewerSources: ["customer_invited", "rateloop_network"],
        allowedDataClassifications: ["public", "confidential"],
        maxRetentionDays: 30,
      },
    },
  };
}

const approval = {
  approvalId: "approval_router",
  schemaVersion: "rateloop.human-review-owner-approval.v1",
  action: "owner_approval_required",
} as unknown as PreparedOwnerApproval;

test("private routing selects the one cohort frozen into the admission policy", () => {
  const frozen = context({ lane: "private_invited_unpaid" });
  const legacy = { projectId: "hap_legacy", cohortId: "hacoh_legacy" };
  const current = { ...PRIVATE_ROUTING_IDS };
  assert.equal(
    __humanReviewRequestRouterTestUtils.selectPrivatePolicyRoutingCandidate(frozen, [legacy, current]),
    current,
  );
  assert.equal(__humanReviewRequestRouterTestUtils.selectPrivatePolicyRoutingCandidate(frozen, [legacy]), null);
});

test("private routing selects a deterministic panel from a larger invited reviewer pool", () => {
  const selected = __humanReviewRequestRouterTestUtils.selectDeterministicReviewerPanel(
    ["rlp_e4829e", "rlp_9a99d1", "rlp_b7c203"],
    2,
  );
  assert.deepEqual(selected, ["rlp_9a99d1", "rlp_b7c203"]);
  assert.equal(__humanReviewRequestRouterTestUtils.selectDeterministicReviewerPanel(["rlp_b7c203"], 2), null);
});

const ask = {
  schemaVersion: "rateloop.tokenless.v2",
  idempotencyKey: "ask_router",
  operationKey: "operation_router",
  roundId: "round_router",
  status: "open",
  responseWindowSeconds: 3_600,
  commitDeadline: "2026-07-16T13:00:00.000Z",
  requestProfile: { id: "profile_router", version: 7, hash: HASH },
  reviewEconomics: null,
  continuation: {
    cursor: "1",
    expiresAt: "2026-07-16T13:00:00.000Z",
    pollUrl: "https://rateloop-tokenless.vercel.app/wait",
    retryAfterMs: 1_000,
  },
} satisfies TokenlessAskResponse;

const privateBinding: ExactPrivateReviewBinding = {
  projectId: "project_router",
  cohortId: "cohort_router",
  reviewerAccountAddresses: [
    "0x1111111111111111111111111111111111111111",
    "0x2222222222222222222222222222222222222222",
  ],
  paidReviewers: [
    { principalId: `rlp_${"1".repeat(24)}`, payoutAccount: "0x1111111111111111111111111111111111111111" },
    { principalId: `rlp_${"2".repeat(24)}`, payoutAccount: "0x2222222222222222222222222222222222222222" },
  ],
};

const foundation = {
  schemaVersion: "rateloop.human-assurance.v2",
  privateReviewId: "private_review_router",
  status: "ready_for_assignment",
} as unknown as HumanAssurancePrivateReviewCreateResponse;

function dependencies(
  frozen: FrozenHumanReviewRoutingContext,
  options: {
    privateBinding?: ExactPrivateReviewBinding | null;
    privateRoutingReady?: boolean;
    workspaceStopped?: boolean;
    approvalStatus?: "pending" | "approved" | "consumed";
    laneImplementation?: HumanReviewLaneReadiness;
    loadError?: unknown;
  } = {},
) {
  const calls = {
    prepare: 0,
    consumeApproval: 0,
    activate: 0,
    public: 0,
    reconcilePrivate: 0,
    resolvePrivate: 0,
    foundation: 0,
    assign: 0,
    assignPaid: 0,
    hybrid: 0,
    feedbackBonus: 0,
    feedbackBonusEligibility: 0,
    freeze: 0,
    block: 0,
    order: [] as string[],
    foundationInput: null as null | Record<string, unknown>,
    assignmentInput: null as null | Record<string, unknown>,
    paidAssignmentInput: null as null | Record<string, unknown>,
  };
  const deps = {
    isWorkspaceStopped: async () => options.workspaceStopped ?? false,
    laneImplementation: options.laneImplementation ?? {
      privateInvitedUnpaid: true,
      privateInvitedPaid: true,
      publicPaidNetwork: true,
      hybridPublicSafe: true,
    },
    loadContext: async () => {
      if (options.loadError) throw options.loadError;
      return frozen;
    },
    freezeQuestion: async (input: { callerQuestion?: unknown }) => {
      calls.freeze += 1;
      const question = resolveHumanReviewQuestion({
        policy: {
          questionAuthority: frozen.requestProfile.questionAuthority ?? "owner_fixed",
          resultSemantics: frozen.requestProfile.resultSemantics ?? "assurance",
          criterion: frozen.requestProfile.criterion,
          positiveLabel: frozen.requestProfile.positiveLabel,
          negativeLabel: frozen.requestProfile.negativeLabel,
          rationaleMode: frozen.requestProfile.rationaleMode,
        },
        ...(input.callerQuestion === undefined ? {} : { callerQuestion: input.callerQuestion }),
      });
      return {
        question,
        questionHash: hashFrozenBinaryReviewQuestion(question),
        contentBoundary: frozen.requestProfile.contentBoundary,
        persisted: question.questionAuthority === "agent_per_request",
        replayed: false,
      };
    },
    prepareApproval: async () => {
      calls.prepare += 1;
      calls.order.push("prepare");
      return { ...approval, status: options.approvalStatus ?? "approved" };
    },
    consumePublicationApproval: async () => {
      calls.consumeApproval += 1;
      calls.order.push("consume_approval");
      return { approvalId: approval.approvalId, status: "consumed", replayed: false };
    },
    activateAutonomousLane: async () => {
      calls.activate += 1;
      calls.order.push("activate");
    },
    blockRetryablePrerequisite: async (_context: unknown, code: string) => {
      if (frozen.lifecycle.state !== "approval_required" && frozen.lifecycle.state !== "request_ready") return;
      calls.block += 1;
      calls.order.push(`block:${code}`);
    },
    publishPublicPaid: async () => {
      calls.public += 1;
      calls.order.push("public");
      return {
        schemaVersion: "rateloop.adaptive-review-request.v1" as const,
        opportunityId: frozen.opportunityId,
        ask,
      };
    },
    reconcilePrivateRouting: async () => {
      calls.reconcilePrivate += 1;
      calls.order.push("reconcile_private");
      return {
        schemaVersion: "rateloop.workspace-private-review-routing-readiness.v1" as const,
        ready: options.privateRoutingReady ?? true,
        reason: options.privateRoutingReady === false ? ("cohort_capacity_insufficient" as const) : ("ready" as const),
        projectId: PRIVATE_ROUTING_IDS.projectId,
        cohortId: PRIVATE_ROUTING_IDS.cohortId,
        privateGroupId: "group_router",
        panelSize: 2,
        syncedReviewerCount: 2,
        eligibleReviewerCount: 2,
        selectedReviewerCount: options.privateRoutingReady === false ? 0 : 2,
        availableCapacity: options.privateRoutingReady === false ? 1 : 2,
        responseDeadline: "2026-07-16T13:00:00.000Z",
      };
    },
    resolvePrivateBinding: async () => {
      calls.resolvePrivate += 1;
      calls.order.push("resolve_private");
      return options.privateBinding === undefined ? privateBinding : options.privateBinding;
    },
    preparePrivateFoundation: async (input: unknown) => {
      calls.foundation += 1;
      calls.order.push("foundation");
      calls.foundationInput = input as Record<string, unknown>;
      return foundation;
    },
    assignPrivateUnpaid: async (input: unknown) => {
      calls.assign += 1;
      calls.order.push("assign");
      calls.assignmentInput = input as Record<string, unknown>;
      return { deliveryId: "delivery_router" } as never;
    },
    assignPrivatePaid: async (input: unknown) => {
      calls.assignPaid += 1;
      calls.order.push("assign_paid");
      calls.paidAssignmentInput = input as Record<string, unknown>;
      return {
        schemaVersion: "rateloop.private-paid-human-review.v1",
        opportunityId: frozen.opportunityId,
        privateReviewId: "private_review_router",
        lane: "private_invited_paid",
      } as never;
    },
    assignHybrid: async () => {
      calls.hybrid += 1;
      calls.order.push("hybrid");
      return {
        schemaVersion: "rateloop.hybrid-human-review.v1",
        opportunityId: frozen.opportunityId,
        lane: "hybrid_public_safe",
        deduplicationRule: "invited_wins",
        invited: {
          subpanelReference: "hybrid:invited",
          bindingHash: HASH,
          status: "ready",
          replayed: false,
          reviewerCount: 1,
        },
        network: {
          subpanelReference: "hybrid:network",
          bindingHash: HASH,
          status: "ready",
          replayed: false,
          reviewerCount: 2,
          removedDuplicateCount: 0,
        },
        splitBindingHash: HASH,
      } as const;
    },
    ensureFeedbackBonus: async () => {
      calls.feedbackBonus += 1;
      calls.order.push("feedback_bonus");
      return {
        schemaVersion: "rateloop.feedback-bonus-pool-binding.v1",
        workspaceId: frozen.workspaceId,
        opportunityId: frozen.opportunityId,
        chainId: 84_532,
        contractAddress: "0x3333333333333333333333333333333333333333",
        poolId: "7",
        reviewId: `0x${"44".repeat(32)}`,
        contentId: `0x${"55".repeat(32)}`,
        depositedAmountAtomic: "5000000",
        feedbackDeadline: "2026-07-16T13:00:00.000Z",
        awardDeadline: "2026-07-23T13:00:00.000Z",
        replayed: false,
      } as const;
    },
    requireFeedbackBonusEligibility: async (principalId: string) => {
      const reviewer = privateBinding.paidReviewers!.find(value => value.principalId === principalId)!;
      calls.feedbackBonusEligibility += 1;
      calls.order.push(`eligibility:${principalId}`);
      return {
        principalId,
        payoutAccount: reviewer.payoutAccount,
      } as never;
    },
  } as unknown as Parameters<typeof createHumanReviewRequestRouter>[0];
  return { calls, router: createHumanReviewRequestRouter(deps) };
}

const publicMaterial = {
  kind: "public" as const,
  appOrigin: "https://rateloop-tokenless.vercel.app",
  publication: {
    visibility: "public" as const,
    dataClassification: "public" as const,
    confirmedNoSensitiveData: true as const,
  },
};

const redactedPublicMaterial = {
  ...publicMaterial,
  publication: {
    visibility: "public" as const,
    dataClassification: "redacted" as const,
    confirmedNoSensitiveData: true as const,
    redactionSummary: "Customer identifiers were removed from the public review copy.",
  },
};

for (const code of ["55P03", "57014"]) {
  test(`request routing maps PostgreSQL ${code} to a retryable stable error`, async () => {
    const { router } = dependencies(context(), {
      loadError: Object.assign(new Error("database wait ended"), { code }),
    });
    await assert.rejects(
      router({
        principal,
        opportunityId: "opportunity_router",
        sourcePayload: "source",
        suggestionPayload: "suggestion",
        material: publicMaterial,
        now: NOW,
      }),
      (error: unknown) =>
        error instanceof TokenlessServiceError &&
        error.code === "review_request_temporarily_unavailable" &&
        error.retryable === true &&
        error.status === 503,
    );
  });
}

test("an engaged workspace stop blocks every release path before any preparation or delivery side effect", async () => {
  const { calls, router } = dependencies(context({ questionAuthority: "agent_per_request" }), {
    workspaceStopped: true,
  });
  const result = await router({
    principal,
    opportunityId: "opportunity_router",
    sourcePayload: "source",
    suggestionPayload: "suggestion",
    now: NOW,
  });
  assert.equal(result.action, "blocked");
  assert.equal(result.action === "blocked" && result.code, "workspace_stopped");
  assert.equal(result.action === "blocked" && result.retryable, true);
  assert.deepEqual(result.sideEffects, {
    prepared: false,
    published: false,
    assigned: false,
    fundsReserved: false,
    spent: false,
  });
  assert.deepEqual(calls.order, ["block:workspace_stopped"]);
  assert.equal(calls.block, 1);
  assert.equal(calls.freeze, 0);
});

test("check-only returns the recorded requirement without any preparation or delivery side effect", async () => {
  const { calls, router } = dependencies(context({ authority: "check_only", questionAuthority: "agent_per_request" }));
  const result = await router({
    principal,
    opportunityId: "opportunity_router",
    sourcePayload: "source",
    suggestionPayload: "suggestion",
    now: NOW,
  });
  assert.equal(result.action, "requirement_recorded");
  assert.deepEqual(result.sideEffects, {
    prepared: false,
    published: false,
    assigned: false,
    fundsReserved: false,
    spent: false,
  });
  assert.deepEqual(calls.order, []);
  assert.equal(calls.freeze, 0);
});

test("a skipped opportunity never requires or freezes a per-request question", async () => {
  const { calls, router } = dependencies(context({ decision: "skip", questionAuthority: "agent_per_request" }));
  const result = await router({
    principal,
    opportunityId: "opportunity_router",
    sourcePayload: "source",
    suggestionPayload: "suggestion",
    now: NOW,
  });
  assert.equal(result.action, "no_review_required");
  assert.equal(calls.freeze, 0);
});

test("prepare-for-approval uses only the immutable approval service and needs no publication declaration", async () => {
  const { calls, router } = dependencies(context({ authority: "prepare_for_approval" }));
  const result = await router({
    principal,
    opportunityId: "opportunity_router",
    sourcePayload: "source",
    suggestionPayload: "suggestion",
    now: NOW,
  });
  assert.equal(result.action, "owner_approval_required");
  assert.equal(result.action === "owner_approval_required" ? result.approval.approvalId : null, "approval_router");
  assert.deepEqual(calls.order, ["prepare"]);
  assert.equal(calls.freeze, 1);
});

test("inactive automatic grants block before activation, publication, assignment, reservation, or spending", async () => {
  const { calls, router } = dependencies(context({ grantActive: false }));
  const result = await router({
    principal,
    opportunityId: "opportunity_router",
    sourcePayload: "source",
    suggestionPayload: "suggestion",
    material: publicMaterial,
    now: NOW,
  });
  assert.equal(result.action, "blocked");
  assert.equal(result.action === "blocked" ? result.code : null, "automatic_grant_inactive");
  assert.deepEqual(calls.order, ["block:automatic_grant_inactive"]);
  assert.equal(calls.block, 1);
  assert.equal(calls.freeze, 0);
});

test("an actionable dynamic public review requires one exact agent-written question", async () => {
  const { calls, router } = dependencies(context({ questionAuthority: "agent_per_request" }));
  await assert.rejects(
    router({
      principal,
      opportunityId: "opportunity_router",
      sourcePayload: "source",
      suggestionPayload: "suggestion",
      material: publicMaterial,
      now: NOW,
    }),
    (error: unknown) => error instanceof TokenlessServiceError && error.code === "review_question_required",
  );
  assert.equal(calls.freeze, 1);
  assert.deepEqual(calls.order, []);
});

test("public paid automatic routing activates the exact frozen opportunity before calling only the public adapter", async () => {
  const { calls, router } = dependencies(context({ lifecycleState: "approval_required" }));
  const result = await router({
    principal,
    opportunityId: "opportunity_router",
    sourcePayload: "source",
    suggestionPayload: "suggestion",
    material: publicMaterial,
    now: NOW,
  });
  assert.equal(result.action, "public_review_requested");
  assert.equal(result.action === "public_review_requested" ? result.ask.operationKey : null, "operation_router");
  assert.deepEqual(calls.order, ["activate", "public"]);
});

test("redacted automatic publication stops at exact owner approval before activation or publication", async () => {
  const { calls, router } = dependencies(context({ lifecycleState: "approval_required" }), {
    approvalStatus: "pending",
  });
  const result = await router({
    principal,
    opportunityId: "opportunity_router",
    sourcePayload: "source",
    suggestionPayload: "suggestion",
    material: redactedPublicMaterial,
    now: NOW,
  });
  assert.equal(result.action, "owner_approval_required");
  assert.equal(result.authority, "ask_automatically");
  assert.deepEqual(calls.order, ["prepare"]);
  assert.equal(calls.public, 0);
  assert.equal(calls.activate, 0);
});

test("the exact approved redacted replay reaches the public adapter once", async () => {
  const { calls, router } = dependencies(context({ lifecycleState: "request_ready" }), {
    approvalStatus: "approved",
  });
  const result = await router({
    principal,
    opportunityId: "opportunity_router",
    sourcePayload: "source",
    suggestionPayload: "suggestion",
    material: redactedPublicMaterial,
    now: NOW,
  });
  assert.equal(result.action, "public_review_requested");
  assert.deepEqual(calls.order, ["prepare", "activate", "public"]);
  assert.equal(calls.public, 1);
});

test("a bonus-enabled route binds the exact pool before reporting public delivery", async () => {
  const { calls, router } = dependencies(context({ feedbackBonus: true, lifecycleState: "approval_required" }));
  const result = await router({
    principal,
    opportunityId: "opportunity_router",
    sourcePayload: "private source",
    suggestionPayload: "private suggestion",
    material: publicMaterial,
    now: NOW,
  });
  assert.equal(result.action, "public_review_requested");
  assert.equal(calls.feedbackBonus, 1);
  assert.deepEqual(calls.order, ["feedback_bonus", "activate", "public"]);
});

test("a private material declaration cannot cross into the public lane", async () => {
  const { calls, router } = dependencies(context());
  await assert.rejects(
    router({
      principal,
      opportunityId: "opportunity_router",
      sourcePayload: "source",
      suggestionPayload: "suggestion",
      material: {
        kind: "private",
        sourceContentType: "text/plain",
        suggestionContentType: "text/plain",
      },
      now: NOW,
    }),
    (error: unknown) => error instanceof TokenlessServiceError && error.code === "review_material_lane_mismatch",
  );
  assert.deepEqual(calls.order, []);
});

test("private unpaid routing blocks without changing lifecycle when exact owner project, cohort, and reviewers are ambiguous", async () => {
  const { calls, router } = dependencies(context({ lane: "private_invited_unpaid", lifecycleState: "blocked" }), {
    privateBinding: null,
  });
  const result = await router({
    principal,
    opportunityId: "opportunity_router",
    sourcePayload: "private source",
    suggestionPayload: "private suggestion",
    material: { kind: "private", sourceContentType: "text/plain", suggestionContentType: "text/plain" },
    now: NOW,
  });
  assert.equal(result.action, "blocked");
  assert.equal(result.action === "blocked" ? result.code : null, "private_routing_configuration_required");
  assert.deepEqual(calls.order, ["reconcile_private", "resolve_private"]);
});

test("private routing stops before binding resolution when request-time seat reconciliation is not ready", async () => {
  const { calls, router } = dependencies(context({ lane: "private_invited_unpaid", lifecycleState: "blocked" }), {
    privateRoutingReady: false,
  });
  const result = await router({
    principal,
    opportunityId: "opportunity_router",
    sourcePayload: "private source",
    suggestionPayload: "private suggestion",
    material: { kind: "private", sourceContentType: "text/plain", suggestionContentType: "text/plain" },
    now: NOW,
  });
  assert.equal(result.action, "blocked");
  assert.equal(result.action === "blocked" ? result.code : null, "private_routing_configuration_required");
  assert.deepEqual(calls.order, ["reconcile_private"]);
  assert.equal(calls.resolvePrivate, 0);
});

test("request-ready private prerequisites durably block before recovery can reactivate the same opportunity", async () => {
  const blockedAttempt = dependencies(context({ lane: "private_invited_unpaid", lifecycleState: "request_ready" }), {
    privateRoutingReady: false,
  });
  const blocked = await blockedAttempt.router({
    principal,
    opportunityId: "opportunity_router",
    sourcePayload: "private source",
    suggestionPayload: "private suggestion",
    material: { kind: "private", sourceContentType: "text/plain", suggestionContentType: "text/plain" },
    now: NOW,
  });
  assert.equal(blocked.action, "blocked");
  assert.equal(blocked.action === "blocked" ? blocked.code : null, "private_routing_configuration_required");
  assert.deepEqual(blockedAttempt.calls.order, ["reconcile_private", "block:private_routing_configuration_required"]);
  assert.equal(blockedAttempt.calls.block, 1);

  const recoveredAttempt = dependencies(context({ lane: "private_invited_unpaid", lifecycleState: "blocked" }));
  const recovered = await recoveredAttempt.router({
    principal,
    opportunityId: "opportunity_router",
    sourcePayload: "private source",
    suggestionPayload: "private suggestion",
    material: { kind: "private", sourceContentType: "text/plain", suggestionContentType: "text/plain" },
    now: NOW,
  });
  assert.equal(recovered.action, "private_review_assigned");
  assert.deepEqual(recoveredAttempt.calls.order, [
    "reconcile_private",
    "resolve_private",
    "activate",
    "foundation",
    "assign",
  ]);
});

test("private routing rejects changed source or suggestion bytes before every side effect", async () => {
  for (const changed of ["source", "suggestion"] as const) {
    const { calls, router } = dependencies(
      context({ lane: "private_invited_unpaid", lifecycleState: "blocked", feedbackBonus: true }),
    );
    await assert.rejects(
      router({
        principal,
        opportunityId: "opportunity_router",
        sourcePayload: changed === "source" ? "private source " : "private source",
        suggestionPayload: changed === "suggestion" ? "private suggestion\n" : "private suggestion",
        material: { kind: "private", sourceContentType: "text/plain", suggestionContentType: "text/plain" },
        now: NOW,
      }),
      (error: unknown) =>
        error instanceof TokenlessServiceError && error.code === `${changed}_payload_commitment_mismatch`,
    );
    assert.deepEqual(calls.order, []);
    assert.equal(calls.freeze, 0);
    assert.equal(calls.resolvePrivate, 0);
    assert.equal(calls.feedbackBonus, 0);
    assert.equal(calls.activate, 0);
    assert.equal(calls.foundation, 0);
    assert.equal(calls.assign, 0);
  }
});

test("private routing preserves the exact committed UTF-8 payload bytes", async () => {
  const sourcePayload = "Customer request:\r\n  Send café hours ☕\n";
  const suggestionPayload = "Agent response:\nOpen 08:00–17:00.\n\0End";
  const { calls, router } = dependencies(
    context({
      lane: "private_invited_unpaid",
      lifecycleState: "blocked",
      sourcePayload,
      suggestionPayload,
    }),
  );
  const result = await router({
    principal,
    opportunityId: "opportunity_router",
    sourcePayload,
    suggestionPayload,
    material: { kind: "private", sourceContentType: "text/plain", suggestionContentType: "text/plain" },
    now: NOW,
  });
  assert.equal(result.action, "private_review_assigned");
  const foundationInput = calls.foundationInput as {
    request: { source: { bytesBase64: string }; suggestion: { bytesBase64: string } };
  };
  assert.deepEqual(Buffer.from(foundationInput.request.source.bytesBase64, "base64"), Buffer.from(sourcePayload));
  assert.deepEqual(
    Buffer.from(foundationInput.request.suggestion.bytesBase64, "base64"),
    Buffer.from(suggestionPayload),
  );
});

test("private unpaid automatic routing activates a blocked opportunity then freezes the resolved binding", async () => {
  const { calls, router } = dependencies(context({ lane: "private_invited_unpaid", lifecycleState: "blocked" }));
  const result = await router({
    principal,
    opportunityId: "opportunity_router",
    sourcePayload: "private source",
    suggestionPayload: "private suggestion",
    material: { kind: "private", sourceContentType: "text/plain", suggestionContentType: "application/json" },
    now: NOW,
  });
  assert.equal(result.action, "private_review_assigned");
  assert.deepEqual(calls.order, ["reconcile_private", "resolve_private", "activate", "foundation", "assign"]);
  const foundationInput = calls.foundationInput as {
    request: {
      idempotencyKey: string;
      projectId: string;
      cohortId: string;
      source: { bytesBase64: string };
      suggestion: { bytesBase64: string };
    };
  };
  assert.match(foundationInput.request.idempotencyKey, /^private-route-[a-f0-9]{64}$/u);
  assert.equal(foundationInput.request.projectId, privateBinding.projectId);
  assert.equal(foundationInput.request.cohortId, privateBinding.cohortId);
  assert.equal(Buffer.from(foundationInput.request.source.bytesBase64, "base64").toString("utf8"), "private source");
  assert.equal(
    Buffer.from(foundationInput.request.suggestion.bytesBase64, "base64").toString("utf8"),
    "private suggestion",
  );
  const assignmentInput = calls.assignmentInput as {
    opportunityId: string;
    privateReviewId: string;
    reviewerAccountAddresses: string[];
  };
  assert.equal(assignmentInput.opportunityId, "opportunity_router");
  assert.equal(assignmentInput.privateReviewId, "private_review_router");
  assert.deepEqual(assignmentInput.reviewerAccountAddresses, privateBinding.reviewerAccountAddresses);
});

test("private unpaid plus optional bonus preflights every invited human before pool funding and delivery", async () => {
  const { calls, router } = dependencies(
    context({ lane: "private_invited_unpaid", lifecycleState: "blocked", feedbackBonus: true }),
    { privateRoutingReady: false },
  );
  const result = await router({
    principal,
    opportunityId: "opportunity_router",
    sourcePayload: "private source",
    suggestionPayload: "private suggestion",
    material: { kind: "private", sourceContentType: "text/plain", suggestionContentType: "text/plain" },
    now: NOW,
  });
  assert.equal(result.action, "private_review_assigned");
  assert.equal(calls.reconcilePrivate, 0);
  assert.equal(calls.feedbackBonusEligibility, 2);
  assert.deepEqual(calls.order, [
    "resolve_private",
    `eligibility:${privateBinding.paidReviewers![0]!.principalId}`,
    `eligibility:${privateBinding.paidReviewers![1]!.principalId}`,
    "feedback_bonus",
    "activate",
    "foundation",
    "assign",
  ]);
});

test("private paid automatic routing uses the distinct paid adapter with frozen private economics", async () => {
  const { calls, router } = dependencies(
    context({
      lane: "private_invited_paid",
      lifecycleState: "blocked",
      requiredExpertiseKeys: ["code-review:security"],
    }),
    { privateRoutingReady: false },
  );
  const result = await router({
    principal,
    opportunityId: "opportunity_router",
    sourcePayload: "private source",
    suggestionPayload: "private suggestion",
    material: { kind: "private", sourceContentType: "text/plain", suggestionContentType: "text/plain" },
    now: NOW,
  });
  assert.equal(result.action, "private_paid_review_assigned");
  assert.deepEqual(calls.order, ["resolve_private", "activate", "foundation", "assign_paid"]);
  assert.equal(calls.reconcilePrivate, 0);
  assert.equal(calls.assign, 0);
  const paid = calls.paidAssignmentInput as {
    projectId: string;
    cohortId: string;
    reviewers: Array<{ principalId: string; payoutAccount: string }>;
    economics: { compensationMode: string; bountyPerSeatAtomic: string; panelSize: number };
    preparedRequest: {
      audience: { kind: string; contentBoundary: string; requiredExpertiseKeys?: string[] };
    };
  };
  assert.equal(paid.projectId, privateBinding.projectId);
  assert.equal(paid.cohortId, privateBinding.cohortId);
  assert.deepEqual(paid.reviewers, privateBinding.paidReviewers);
  assert.deepEqual(paid.economics, {
    ...paid.economics,
    compensationMode: "usdc",
    bountyPerSeatAtomic: "1000000",
    panelSize: 2,
  });
  assert.equal(paid.preparedRequest.audience.kind, "private_invited");
  assert.equal(paid.preparedRequest.audience.contentBoundary, "private_workspace");
  assert.deepEqual(paid.preparedRequest.audience.requiredExpertiseKeys, ["code-review:security"]);
});

test("the deployed lane gate blocks partial paid and hybrid adapters before any side effect", async () => {
  const laneImplementation = {
    privateInvitedUnpaid: true,
    privateInvitedPaid: false,
    publicPaidNetwork: true,
    hybridPublicSafe: false,
  } satisfies HumanReviewLaneReadiness;
  for (const entry of [
    {
      lane: "private_invited_paid" as const,
      material: { kind: "private" as const, sourceContentType: "text/plain", suggestionContentType: "text/plain" },
    },
    { lane: "hybrid_public_safe" as const, material: publicMaterial },
  ]) {
    const { calls, router } = dependencies(context({ lane: entry.lane }), { laneImplementation });
    const result = await router({
      principal,
      opportunityId: "opportunity_router",
      sourcePayload: "source",
      suggestionPayload: "suggestion",
      material: entry.material,
      now: NOW,
    });
    assert.equal(result.action, "blocked");
    assert.equal(result.action === "blocked" ? result.code : null, "lane_not_implemented");
    assert.deepEqual(calls.order, []);
    assert.equal(calls.freeze, 0);
    assert.equal(calls.assignPaid, 0);
    assert.equal(calls.hybrid, 0);
  }
});

test("unsupported hybrid routing remains blocked without falling back to either implemented lane", async () => {
  const { calls, router } = dependencies(context({ lane: "hybrid_public_safe" }));
  const result = await router({
    principal,
    opportunityId: "opportunity_router",
    sourcePayload: "source",
    suggestionPayload: "suggestion",
    material: publicMaterial,
    now: NOW,
  });
  assert.equal(result.action, "blocked");
  assert.equal(result.action === "blocked" ? result.code : null, "lane_not_implemented");
  assert.deepEqual(calls.order, []);
  assert.equal(calls.freeze, 0);
});

test("hybrid routing activates only with an exact frozen split and the dedicated adapter", async () => {
  const hybridContext = context({ lane: "hybrid_public_safe" });
  const { calls, router } = dependencies(hybridContext);
  const result = await router({
    principal,
    opportunityId: "opportunity_router",
    sourcePayload: "public source",
    suggestionPayload: "public suggestion",
    material: {
      ...publicMaterial,
      hybridSplit: {
        schemaVersion: "rateloop.hybrid-review-split.v1",
        opportunityId: "opportunity_router",
        audiencePolicyHash: hybridContext.selectionPolicy.audiencePolicyHash,
        requestProfileHash: hybridContext.requestProfile.hash,
        contentCommitments: hybridContext.contentCommitments,
        publication: publicMaterial.publication,
        economics: {
          asset: "USDC",
          invitedMaximumChargeAtomic: "1000000",
          networkMaximumChargeAtomic: "2000000",
        },
        invited: {
          requestedCount: 1,
          candidates: [
            {
              principalId: `rlp_${"1".repeat(24)}`,
              payoutAccount: "0x1111111111111111111111111111111111111111",
              assignmentReference: "assignment:invited",
              assignmentHash: HASH,
            },
          ],
        },
        network: {
          requestedCount: 1,
          candidates: [
            {
              principalId: `rlp_${"2".repeat(24)}`,
              payoutAccount: "0x2222222222222222222222222222222222222222",
              assignmentReference: "assignment:network",
              assignmentHash: HASH,
            },
          ],
        },
      },
    },
    now: NOW,
  });
  assert.equal(result.action, "hybrid_review_requested");
  assert.deepEqual(calls.order, ["activate", "hybrid"]);
  assert.equal(calls.public, 0);
  assert.equal(calls.assignPaid, 0);
});
