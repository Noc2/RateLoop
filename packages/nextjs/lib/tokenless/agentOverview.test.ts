import assert from "node:assert/strict";
import test from "node:test";
import {
  MAX_AGENT_OVERVIEW_PARENTS,
  MAX_AGENT_OVERVIEW_SCOPES_PER_PARENT,
  projectAgentOverview,
} from "~~/lib/tokenless/agentOverview";
import type { AgentAssuranceScopeSummary } from "~~/lib/tokenless/agentRegistry";

type SourceAgent = Parameters<typeof projectAgentOverview>[0]["agents"][number];

function scope(
  scopeId: string,
  lower95Bps: number | null,
  overrides: Partial<AgentAssuranceScopeSummary> = {},
): AgentAssuranceScopeSummary {
  return {
    scopeId,
    agentVersionId: "version-current",
    policyId: "policy-overview",
    policyVersion: 1,
    workflowKey: `workflow-${scopeId}`,
    riskTier: "normal",
    stage: "monitoring",
    reviewRateBps: 1_000,
    completedComparableCases: 40,
    stableCasesSinceStage: 30,
    reviewedOpportunityCount: 40,
    skippedOpportunityCount: 10,
    comparableCount: 40,
    agreementCount: 32,
    humanAgreementBps: 8_000,
    humanAgreementLower95Bps: lower95Bps,
    executionProfileHash: `sha256:${"a".repeat(64)}`,
    executionProfile: {
      available: false,
      orchestrationMode: null,
      primary: null,
      contributors: [],
    },
    executionCount: 50,
    averageTotalDurationMs: 1_500,
    averageInputTokenTotal: 800,
    averageOutputTokenTotal: 200,
    averageReasoningOutputTokenTotal: null,
    nextReassessmentAfter: 10,
    lastTransition: null,
    updatedAt: "2026-07-20T10:00:00.000Z",
    ...overrides,
  };
}

function agent(index: number, scopes: AgentAssuranceScopeSummary[] = []): SourceAgent {
  return {
    agentId: `agent-${index}`,
    status: "active",
    currentVersion: {
      versionId: "version-current",
      versionNumber: index + 1,
      displayName: `Agent ${index}`,
      description: null,
      declaredProvider: "OpenAI",
      declaredModel: "gpt-5",
      declaredModelVersion: null,
      environment: "production",
      configurationCommitment: "configuration",
      createdBy: null,
      createdAt: "2026-07-01T00:00:00.000Z",
    },
    assuranceScopes: scopes,
  };
}

test("overview projection derives four distinct 30-day answers from decision evidence", () => {
  const overview = projectAgentOverview({
    agents: [agent(0)],
    metrics: { reviewsCompleted: 4 },
    observations: [
      { agreement: "agree", comparable: true, latencyMs: 1_000, costAtomic: "1000000" },
      { agreement: "agree", comparable: true, latencyMs: 3_000, costAtomic: "2000000" },
      { agreement: "agree", comparable: true, latencyMs: 9_000, costAtomic: "3000000" },
      { agreement: "disagree", comparable: true, latencyMs: null, costAtomic: "2000000" },
    ],
    now: new Date("2026-07-28T12:00:00.000Z"),
  });

  assert.deepEqual(overview.window, {
    days: 30,
    label: "Last 30 days",
    startsAt: "2026-06-28T12:00:00.000Z",
    endsAt: "2026-07-28T12:00:00.000Z",
  });
  assert.equal(overview.headline.completedDecisions, 4);
  assert.deepEqual(overview.headline.reviewerEndorsement, {
    available: true,
    rateBps: 7_500,
    intervalBps: { lower: 3_006, upper: 9_545 },
    endorsedCount: 3,
    sampleSize: 4,
    limitedSample: true,
  });
  assert.deepEqual(overview.headline.medianDecisionLatency, {
    available: true,
    milliseconds: 3_000,
    sampleSize: 3,
  });
  assert.deepEqual(overview.headline.costPerDecision, {
    available: true,
    averageAtomic: "2000000",
    sampleSize: 4,
  });
});

test("agent-version parents are bounded, retain scope rows, and use the lowest observed bound instead of an average", () => {
  const scopes = Array.from({ length: MAX_AGENT_OVERVIEW_SCOPES_PER_PARENT + 2 }, (_, index) =>
    scope(`scope-${index}`, index === 1 ? 4_200 : 8_000, {
      workflowKey: index === 1 ? "refund-review" : `workflow-${index}`,
      riskTier: index === 1 ? "high" : "normal",
      updatedAt: new Date(Date.UTC(2026, 6, 20, 10, index)).toISOString(),
    }),
  );
  scopes.push(scope("historical-scope", 1_000, { agentVersionId: "version-old" }));
  const agents = [
    agent(0, scopes),
    ...Array.from({ length: MAX_AGENT_OVERVIEW_PARENTS }, (_, index) => agent(index + 1)),
  ];
  const overview = projectAgentOverview({
    agents,
    metrics: { reviewsCompleted: 0 },
    observations: [{ agreement: "agree", comparable: true, latencyMs: 500, costAtomic: null }],
    now: new Date("2026-07-28T12:00:00.000Z"),
  });

  assert.equal(overview.agentVersions.periodLabel, "Lifetime by scope");
  assert.equal(overview.agentVersions.totalParentCount, MAX_AGENT_OVERVIEW_PARENTS + 1);
  assert.equal(overview.agentVersions.parents.length, MAX_AGENT_OVERVIEW_PARENTS);
  assert.equal(overview.agentVersions.parentsTruncated, true);
  const first = overview.agentVersions.parents[0]!;
  assert.equal(first.scopeCount, MAX_AGENT_OVERVIEW_SCOPES_PER_PARENT + 2);
  assert.equal(first.scopes.length, MAX_AGENT_OVERVIEW_SCOPES_PER_PARENT);
  assert.equal(first.scopesTruncated, true);
  assert.deepEqual(first.lowestEndorsement, {
    lower95Bps: 4_200,
    workflowKey: "refund-review",
    riskTier: "high",
  });
  assert.ok(first.scopes.every(item => item.scopeId !== "historical-scope"));
  assert.deepEqual(overview.headline.costPerDecision, {
    available: false,
    reason: "Cost is recorded for 0 of 1 decisions.",
    recordedCount: 0,
    decisionCount: 1,
  });
});
