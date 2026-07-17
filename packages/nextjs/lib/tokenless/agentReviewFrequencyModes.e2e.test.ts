import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { __setDatabaseResourcesForTests } from "~~/lib/db";
import { createMemoryDatabaseResources } from "~~/lib/db/testing/testMemory";
import {
  __adaptiveReviewServiceTestUtils,
  authenticateAdaptiveReviewPrincipal,
  evaluateAdaptiveReviewRequirement,
} from "~~/lib/tokenless/adaptiveReviewService";
import { createWorkspaceAgent } from "~~/lib/tokenless/agentRegistry";
import { saveHumanReviewConfiguration } from "~~/lib/tokenless/humanReviewConfiguration";
import { createWorkspace, createWorkspaceApiKey } from "~~/lib/tokenless/productCore";
import { type ReviewPolicyMode, createManagedReviewPolicy } from "~~/lib/tokenless/reviewPolicyManagement";
import { createReviewRequestProfile } from "~~/lib/tokenless/reviewRequestProfiles";

const OWNER = "0x1111111111111111111111111111111111111111";
const originalSamplerKey = process.env.TOKENLESS_ADAPTIVE_REVIEW_SAMPLER_KEY;
const originalSamplerVersion = process.env.TOKENLESS_ADAPTIVE_REVIEW_SAMPLER_KEY_VERSION;

beforeEach(() => {
  process.env.TOKENLESS_ADAPTIVE_REVIEW_SAMPLER_KEY = "58".repeat(32);
  process.env.TOKENLESS_ADAPTIVE_REVIEW_SAMPLER_KEY_VERSION = "agent-flow-e2e-v1";
  __setDatabaseResourcesForTests(createMemoryDatabaseResources());
});

afterEach(() => {
  __setDatabaseResourcesForTests(null);
  if (originalSamplerKey === undefined) delete process.env.TOKENLESS_ADAPTIVE_REVIEW_SAMPLER_KEY;
  else process.env.TOKENLESS_ADAPTIVE_REVIEW_SAMPLER_KEY = originalSamplerKey;
  if (originalSamplerVersion === undefined) delete process.env.TOKENLESS_ADAPTIVE_REVIEW_SAMPLER_KEY_VERSION;
  else process.env.TOKENLESS_ADAPTIVE_REVIEW_SAMPLER_KEY_VERSION = originalSamplerVersion;
});

async function configuredAgent(input: { mode: ReviewPolicyMode; index: number }) {
  const { workspaceId } = await createWorkspace({
    name: `Frequency ${input.mode} E2E`,
    ownerAddress: OWNER,
  });
  const agent = await createWorkspaceAgent({
    accountAddress: OWNER,
    workspaceId,
    externalId: `agent-flow-${input.mode}-${input.index}`,
    version: {
      displayName: `${input.mode} review agent`,
      provider: "OpenAI",
      model: "gpt-5",
      modelVersion: "2026-07-16",
      environment: "production",
    },
  });
  const policy = await createManagedReviewPolicy({
    accountAddress: OWNER,
    workspaceId,
    policy: {
      agentId: agent.agentId,
      agentVersionId: agent.currentVersion.versionId,
      mode: input.mode,
      enforcementMode: "advisory",
      agreementThresholdBps: 8_000,
      productionFloorBps: input.mode === "adaptive" ? 1_000 : 0,
      fixedRateBps: input.mode === "fixed" ? 2_500 : null,
      maximumUnreviewedGap: 20,
      requiredRiskTiers: input.mode === "rules" ? ["high"] : [],
      criticalRiskTiers: ["critical"],
      minimumConfidenceBps: input.mode === "rules" ? 7_000 : null,
      maximumLatencyMs: null,
      audience: "public_network",
    },
  });
  const profile = await createReviewRequestProfile({
    accountAddress: OWNER,
    workspaceId,
    profile: {
      agentId: agent.agentId,
      agentVersionId: agent.currentVersion.versionId,
      questionAuthority: "owner_fixed",
      criterion: "Is this answer correct and safe to use?",
      positiveLabel: "Approve",
      negativeLabel: "Reject",
      rationaleMode: "optional",
      audience: "public_network",
      contentBoundary: "public_or_test",
      privateSensitivity: null,
      privateGroupId: null,
      privateGroupPolicyVersion: null,
      privateGroupPolicyHash: null,
      responseWindowSeconds: 3_600,
      panelSize: 3,
      compensationMode: "usdc",
      bountyPerSeatAtomic: "1000000",
      feedbackBonusEnabled: false,
      feedbackBonusPoolAtomic: null,
      feedbackBonusAwarderKind: "requester",
      feedbackBonusAwarderAccount: null,
      feedbackBonusAwardWindowSeconds: null,
    },
  });
  await saveHumanReviewConfiguration({
    accountAddress: OWNER,
    workspaceId,
    agentId: agent.agentId,
    agentVersionId: agent.currentVersion.versionId,
    expectedBindingVersion: null,
    selectionPolicy: { id: policy.policyId, version: policy.version },
    requestProfile: { id: profile.profileId, version: profile.version },
    authority: "check_only",
  });
  const apiKey = await createWorkspaceApiKey({
    workspaceId,
    name: `${input.mode} flow evaluator`,
    scopes: ["evaluation:read", "review:decide"],
  });
  const principal = await authenticateAdaptiveReviewPrincipal(`Bearer ${apiKey.token}`, "review:decide");
  return { workspaceId, agent, policy, profile, principal };
}

function opportunity(input: {
  configured: Awaited<ReturnType<typeof configuredAgent>>;
  externalOpportunityId: string;
  riskTier?: string;
  declaredConfidenceBps?: number;
}) {
  const { agent, policy } = input.configured;
  return {
    externalOpportunityId: input.externalOpportunityId,
    agentId: agent.agentId,
    agentVersionId: agent.currentVersion.versionId,
    policyId: policy.policyId,
    policyVersion: policy.version,
    workflowKey: "support-reply",
    riskTier: input.riskTier ?? "low",
    audiencePolicyHash: policy.audiencePolicyHash,
    suggestionCommitment: __adaptiveReviewServiceTestUtils.sha256({
      opportunity: input.externalOpportunityId,
      suggestion: "candidate",
    }),
    sourceEvidence: {
      reference: `cases/${input.externalOpportunityId}`,
      hash: __adaptiveReviewServiceTestUtils.sha256({ opportunity: input.externalOpportunityId, source: "case" }),
    },
    declaredConfidenceBps: input.declaredConfidenceBps ?? 8_500,
    criticalRisk: false,
    metadataComplete: true,
    execution: {
      externalExecutionId: `execution-${input.externalOpportunityId}`,
      status: "completed" as const,
      primarySpanId: "generation-primary",
      generationSpans: [
        {
          spanId: "generation-primary",
          role: "primary" as const,
          provider: "OpenAI",
          requestedModel: "gpt-5",
          resolvedModel: "gpt-5-2026-07-16",
          reasoningEffort: "medium",
          serviceTier: "standard",
        },
      ],
    },
  };
}

test("real persisted policies evaluate manual, always, rules, fixed, and adaptive frequencies end to end", async () => {
  const configured = new Map<ReviewPolicyMode, Awaited<ReturnType<typeof configuredAgent>>>();
  for (const [index, mode] of (["manual", "always", "rules", "fixed", "adaptive"] as const).entries()) {
    configured.set(mode, await configuredAgent({ mode, index }));
  }

  const evaluate = (
    mode: ReviewPolicyMode,
    externalOpportunityId: string,
    overrides?: Partial<{ riskTier: string }>,
  ) => {
    const modeConfiguration = configured.get(mode)!;
    return evaluateAdaptiveReviewRequirement({
      principal: modeConfiguration.principal,
      request: opportunity({
        configured: modeConfiguration,
        externalOpportunityId,
        ...overrides,
      }),
    });
  };

  const manual = await evaluate("manual", "manual-1");
  assert.equal(manual.decision, "recommended");
  assert.equal(manual.required, false);
  assert.equal(manual.reviewRateBps, 0);
  assert.deepEqual(manual.reasonCodes, ["manual_handoff"]);

  const always = await evaluate("always", "always-1");
  assert.equal(always.decision, "required");
  assert.equal(always.reviewRateBps, 10_000);
  assert.deepEqual(always.reasonCodes, ["always_review"]);

  const rulesSkipped = await evaluate("rules", "rules-low", { riskTier: "low" });
  const rulesRequired = await evaluate("rules", "rules-high", { riskTier: "high" });
  assert.equal(rulesSkipped.decision, "skip");
  assert.deepEqual(rulesSkipped.reasonCodes, ["no_rule_match"]);
  assert.equal(rulesRequired.decision, "required");
  assert.deepEqual(rulesRequired.reasonCodes, ["rules_match"]);

  const fixed = await evaluate("fixed", "fixed-1");
  const fixedReplay = await evaluate("fixed", "fixed-1");
  assert.deepEqual(fixedReplay, fixed);
  assert.equal(fixed.reviewRateBps, 2_500);
  assert.equal(fixed.selectionProbabilityBps, 2_500);
  assert.equal(fixed.required, fixed.sampleBucket < 2_500);
  assert.deepEqual(fixed.reasonCodes, [fixed.required ? "sampled" : "not_sampled"]);

  const adaptive = await evaluate("adaptive", "adaptive-1");
  assert.equal(adaptive.decision, "required");
  assert.equal(adaptive.stage, "calibrating");
  assert.equal(adaptive.reviewRateBps, 10_000);
  assert.deepEqual(adaptive.reasonCodes, ["calibrating"]);

  for (const result of [manual, always, rulesSkipped, rulesRequired, fixed, adaptive]) {
    assert.equal(result.policyFrozen, true);
    assert.match(result.metadataCommitment, /^sha256:[0-9a-f]{64}$/u);
  }
});
