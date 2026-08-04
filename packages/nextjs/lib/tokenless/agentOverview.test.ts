import assert from "node:assert/strict";
import test from "node:test";
import {
  AGENT_OVERVIEW_PARENT_PAGE_SIZE,
  MAX_AGENT_OVERVIEW_SCOPES_PER_PARENT,
  projectAgentOverview,
} from "~~/lib/tokenless/agentOverview";
import type { AgentAssuranceScopeSummary } from "~~/lib/tokenless/agentRegistry";

type SourceAgent = Parameters<typeof projectAgentOverview>[0]["agents"][number];
type HumanReviewSource = NonNullable<SourceAgent["humanReview"]>;

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

function agent(index: number, scopes: AgentAssuranceScopeSummary[] = [], humanReview?: HumanReviewSource): SourceAgent {
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
    ...(humanReview ? { humanReview } : {}),
  };
}

function humanReview(input: { blockedCount?: number; agreementThresholdBps?: number } = {}): HumanReviewSource {
  return {
    workload: {
      openCount: input.blockedCount ?? 0,
      approvalRequiredCount: 0,
      requestReadyCount: 0,
      activeReviewCount: 0,
      blockedCount: input.blockedCount ?? 0,
      ownerActionCount: 0,
    },
    management: {
      binding: null,
      selectionPolicy: {
        id: "policy-overview",
        version: 1,
        agreementThresholdBps: input.agreementThresholdBps ?? 7_500,
        productionFloorBps: 1_000,
        requiredRiskTiers: [],
        criticalRiskTiers: [],
        minimumConfidenceBps: null,
        maximumLatencyMs: null,
      },
      requestProfile: null,
      privateGroup: null,
      delegation: null,
      lastTerminalDetails: null,
      audit: { eventCount: 0, latest: null },
    },
  };
}

test("overview projection derives four distinct 30-day answers from decision evidence", () => {
  const overview = projectAgentOverview({
    agents: [agent(0)],
    observations: [
      {
        agreement: "agree",
        comparable: true,
        latencyMs: 1_000,
        costAtomic: "1000000",
        finalizedAt: "2026-07-26T10:00:00.000Z",
      },
      {
        agreement: "agree",
        comparable: true,
        latencyMs: 3_000,
        costAtomic: "2000000",
        finalizedAt: "2026-07-26T11:00:00.000Z",
      },
      {
        agreement: "agree",
        comparable: true,
        latencyMs: 9_000,
        costAtomic: "3000000",
        finalizedAt: "2026-07-27T10:00:00.000Z",
      },
      {
        agreement: "disagree",
        comparable: true,
        latencyMs: null,
        costAtomic: "2000000",
        finalizedAt: "2026-07-27T11:00:00.000Z",
      },
    ],
    now: new Date("2026-07-28T12:00:00.000Z"),
  });

  assert.deepEqual(overview.window, {
    period: "30",
    days: 30,
    label: "Last 30 days",
    startsAt: "2026-06-28T12:00:00.000Z",
    endsAt: "2026-07-28T12:00:00.000Z",
  });
  assert.equal(overview.hasAnyDecisions, true);
  assert.deepEqual(overview.headline.completedDecisions, { available: true, count: 4 });
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
  assert.equal(overview.trends.periodLabel, "Last 30 days");
  assert.equal(overview.trends.outcomes.available, true);
  if (overview.trends.outcomes.available) {
    assert.equal(overview.trends.outcomes.points.length, 30);
    assert.deepEqual(
      overview.trends.outcomes.points.find(point => point.date === "2026-07-26"),
      {
        date: "2026-07-26",
        completedCount: 2,
        endorsedCount: 2,
        rejectedCount: 0,
        inconclusiveCount: 0,
      },
    );
    assert.deepEqual(
      {
        completedCount: overview.trends.outcomes.completedCount,
        endorsedCount: overview.trends.outcomes.endorsedCount,
        rejectedCount: overview.trends.outcomes.rejectedCount,
        inconclusiveCount: overview.trends.outcomes.inconclusiveCount,
      },
      { completedCount: 4, endorsedCount: 3, rejectedCount: 1, inconclusiveCount: 0 },
    );
  }
  assert.equal(overview.trends.decisionTime.available, true);
  if (overview.trends.decisionTime.available) {
    assert.deepEqual(
      overview.trends.decisionTime.points.find(point => point.date === "2026-07-26"),
      { date: "2026-07-26", medianMilliseconds: 2_000, sampleSize: 2 },
    );
    assert.equal(overview.trends.decisionTime.sampleSize, 3);
  }
  assert.deepEqual(overview.attention, {
    periodLabel: "Current evidence state",
    items: [],
    totalItemCount: 0,
    itemsTruncated: false,
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
    ...Array.from({ length: AGENT_OVERVIEW_PARENT_PAGE_SIZE }, (_, index) => agent(index + 1)),
  ];
  const overview = projectAgentOverview({
    agents,
    observations: [
      {
        agreement: "agree",
        comparable: true,
        latencyMs: 500,
        costAtomic: null,
        finalizedAt: "2026-07-27T11:00:00.000Z",
      },
    ],
    now: new Date("2026-07-28T12:00:00.000Z"),
  });

  assert.equal(overview.agentVersions.periodLabel, "Lifetime by scope");
  assert.equal(overview.agentVersions.totalParentCount, AGENT_OVERVIEW_PARENT_PAGE_SIZE + 1);
  assert.equal(overview.agentVersions.parents.length, AGENT_OVERVIEW_PARENT_PAGE_SIZE);
  assert.equal(overview.agentVersions.page, 1);
  assert.equal(overview.agentVersions.totalPages, 2);
  assert.equal(overview.agentVersions.hasPreviousPage, false);
  assert.equal(overview.agentVersions.hasNextPage, true);
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

  const secondPage = projectAgentOverview({
    agents,
    observations: [],
    parentPage: 2,
    now: new Date("2026-07-28T12:00:00.000Z"),
  });
  assert.equal(secondPage.agentVersions.page, 2);
  assert.equal(secondPage.agentVersions.parents.length, 1);
  assert.equal(secondPage.agentVersions.parents[0]!.displayName, "Agent 20");
  assert.equal(secondPage.agentVersions.hasPreviousPage, true);
  assert.equal(secondPage.agentVersions.hasNextPage, false);
});

test("attention is limited to current blocked, low-confidence, and insufficient evidence", () => {
  const attentionScopes = [
    scope("low-confidence", 6_500, {
      workflowKey: "refund-review",
      riskTier: "high",
      comparableCount: 40,
      agreementCount: 32,
    }),
    scope("insufficient", 6_000, {
      workflowKey: "account-change",
      comparableCount: 12,
      agreementCount: 10,
    }),
    ...Array.from({ length: 4 }, (_, index) =>
      scope(`empty-${index}`, null, {
        comparableCount: 0,
        agreementCount: 0,
      }),
    ),
    scope("historical-insufficient", null, {
      agentVersionId: "version-old",
      comparableCount: 0,
      agreementCount: 0,
    }),
    scope("stale-policy-insufficient", null, {
      policyId: "policy-old",
      comparableCount: 0,
      agreementCount: 0,
    }),
  ];
  const overview = projectAgentOverview({
    agents: [agent(0, attentionScopes, humanReview({ blockedCount: 2 }))],
    observations: [],
    now: new Date("2026-07-28T12:00:00.000Z"),
  });

  assert.equal(overview.attention.periodLabel, "Current evidence state");
  assert.equal(overview.attention.totalItemCount, 7);
  assert.equal(overview.attention.items.length, 5);
  assert.equal(overview.attention.itemsTruncated, true);
  assert.deepEqual(overview.attention.items[0], {
    itemId: "blocked:agent-0",
    kind: "blocked",
    agentId: "agent-0",
    displayName: "Agent 0",
    blockedCount: 2,
  });
  assert.deepEqual(overview.attention.items[1], {
    itemId: "low-confidence:low-confidence",
    kind: "low_confidence",
    agentId: "agent-0",
    displayName: "Agent 0",
    scopeId: "low-confidence",
    workflowKey: "refund-review",
    riskTier: "high",
    comparableCount: 40,
    rejectedCount: 8,
    lower95Bps: 6_500,
    policyThresholdBps: 7_500,
  });
  assert.ok(overview.attention.items.slice(2).every(item => item.kind === "insufficient"));
  assert.ok(overview.attention.items.every(item => !item.itemId.includes("historical")));
  assert.ok(overview.attention.items.every(item => !item.itemId.includes("stale-policy")));
});

test("period selection never widens and lifetime reports unsupported trends honestly", () => {
  const now = new Date("2026-07-28T12:00:00.000Z");
  const observations = [
    {
      agreement: "agree" as const,
      comparable: true,
      latencyMs: 500,
      costAtomic: "1",
      finalizedAt: "2026-07-26T12:00:00.000Z",
    },
    {
      agreement: "disagree" as const,
      comparable: true,
      latencyMs: 800,
      costAtomic: "1",
      finalizedAt: "2026-07-10T12:00:00.000Z",
    },
  ];
  const sevenDays = projectAgentOverview({ agents: [], observations, period: "7", now });
  assert.equal(sevenDays.window.period, "7");
  assert.equal(sevenDays.window.startsAt, "2026-07-21T12:00:00.000Z");
  assert.deepEqual(sevenDays.headline.completedDecisions, { available: true, count: 1 });
  assert.equal(sevenDays.trends.outcomes.available && sevenDays.trends.outcomes.points.length, 7);

  const lifetime = projectAgentOverview({ agents: [], observations, period: "lifetime", now });
  assert.deepEqual(lifetime.window, {
    period: "lifetime",
    days: null,
    label: "Lifetime",
    startsAt: null,
    endsAt: "2026-07-28T12:00:00.000Z",
  });
  assert.deepEqual(lifetime.headline.completedDecisions, { available: true, count: 2 });
  assert.equal(lifetime.trends.outcomes.available, false);
  assert.match(lifetime.trends.outcomes.reason, /Choose 7, 30, or 90 days/u);
  assert.equal(lifetime.reviewQuality.availability, "empty");
  assert.equal(lifetime.reviewQuality.consensus.available, false);
  assert.match(lifetime.reviewQuality.consensus.reason, /Lifetime review quality is unavailable/u);
});
