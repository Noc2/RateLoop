import React from "react";
import assert from "node:assert/strict";
import test from "node:test";
import { installTestDom } from "~~/components/tokenless/testing/dom";

const overview = {
  window: {
    days: 30,
    label: "Last 30 days",
    startsAt: "2026-06-28T12:00:00.000Z",
    endsAt: "2026-07-28T12:00:00.000Z",
  },
  headline: {
    completedDecisions: 12,
    reviewerEndorsement: {
      available: true,
      rateBps: 7_500,
      intervalBps: { lower: 6_100, upper: 8_600 },
      endorsedCount: 9,
      sampleSize: 12,
      limitedSample: true,
    },
    medianDecisionLatency: { available: true, milliseconds: 3_000, sampleSize: 10 },
    costPerDecision: {
      available: false,
      reason: "Cost is recorded for 8 of 12 decisions.",
      recordedCount: 8,
      decisionCount: 12,
    },
  },
  trends: {
    periodLabel: "Last 30 days",
    outcomes: {
      available: true,
      completedCount: 4,
      endorsedCount: 2,
      rejectedCount: 1,
      inconclusiveCount: 1,
      points: [
        {
          date: "2026-07-27",
          completedCount: 1,
          endorsedCount: 1,
          rejectedCount: 0,
          inconclusiveCount: 0,
        },
        {
          date: "2026-07-28",
          completedCount: 3,
          endorsedCount: 1,
          rejectedCount: 1,
          inconclusiveCount: 1,
        },
      ],
    },
    decisionTime: {
      available: true,
      sampleSize: 3,
      points: [
        { date: "2026-07-27", medianMilliseconds: 2_000, sampleSize: 1 },
        { date: "2026-07-28", medianMilliseconds: 4_000, sampleSize: 2 },
      ],
    },
  },
  agentVersions: {
    periodLabel: "Lifetime by scope",
    totalParentCount: 1,
    parentsTruncated: false,
    parents: [
      {
        agentId: "agent-support",
        agentStatus: "active",
        versionId: "version-support-3",
        versionNumber: 3,
        displayName: "Support agent",
        environment: "production",
        scopeCount: 2,
        scopesTruncated: false,
        stageCounts: { calibrating: 0, high_coverage: 1, medium_coverage: 0, monitoring: 1 },
        lowestEndorsement: { lower95Bps: 6_500, workflowKey: "refund-review", riskTier: "high" },
        scopes: [
          {
            scopeId: "scope-refunds-v3",
            workflowKey: "refund-review",
            riskTier: "high",
            stage: "high_coverage",
            reviewRateBps: 5_000,
            comparableCount: 40,
            agreementCount: 32,
            humanAgreementBps: 8_000,
            humanAgreementLower95Bps: 6_500,
            averageTotalDurationMs: 1_500,
            averageInputTokenTotal: 800,
            averageOutputTokenTotal: 200,
            lastTransition: null,
            updatedAt: "2026-07-20T10:00:00.000Z",
          },
        ],
      },
    ],
  },
  attention: {
    periodLabel: "Current evidence state",
    totalItemCount: 3,
    itemsTruncated: false,
    items: [
      {
        itemId: "blocked:agent-support",
        kind: "blocked",
        agentId: "agent-support",
        displayName: "Support agent",
        blockedCount: 2,
      },
      {
        itemId: "low-confidence:scope-refunds-v3",
        kind: "low_confidence",
        agentId: "agent-support",
        displayName: "Support agent",
        scopeId: "scope-refunds-v3",
        workflowKey: "refund-review",
        riskTier: "high",
        comparableCount: 40,
        rejectedCount: 8,
        lower95Bps: 6_500,
        policyThresholdBps: 7_500,
      },
      {
        itemId: "insufficient:scope-change-v3",
        kind: "insufficient",
        agentId: "agent-support",
        displayName: "Support agent",
        scopeId: "scope-change-v3",
        workflowKey: "account-change",
        riskTier: "normal",
        comparableCount: 12,
        targetComparableCount: 30,
      },
    ],
  },
};

test("the overview renders four fixed answers and expands lifetime scope evidence without a global score", async () => {
  const restoreDom = installTestDom();
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async input => {
    assert.match(String(input), /\/agents\/overview$/u);
    return Response.json(overview);
  };
  const { act, cleanup, render } = await import("@testing-library/react");
  const userEvent = (await import("@testing-library/user-event")).default;
  const { AgentOverviewMonitor } = await import("./AgentOverviewMonitor");

  try {
    const view = render(<AgentOverviewMonitor workspaceId="workspace-overview" />);
    assert.ok(await view.findByRole("heading", { name: "Agent monitor" }));
    for (const label of [
      "Completed decisions",
      "Reviewer endorsement",
      "Median time to decision",
      "Cost per decision",
    ]) {
      assert.ok(view.getByText(label));
    }
    assert.equal(view.getAllByText("Last 30 days").length, 2);
    assert.ok(view.getByText("75.0% endorsed"));
    assert.ok(view.getByText(/61\.0%–86\.0% · n = 12 · too few cases to be reliable/));
    assert.ok(view.getByText("3.0 sec"));
    assert.ok(view.getByText("Cost is recorded for 8 of 12 decisions."));
    assert.ok(view.getByRole("img", { name: /review outcome trend/i }));
    assert.ok(view.getByRole("img", { name: /decision-time trend/i }));
    assert.ok(view.getByText("2 endorsed · 1 rejected · 1 inconclusive"));
    assert.ok(view.getByText(/Lifetime by scope.*never an average/));
    assert.ok(view.getByText("65.0%"));
    assert.ok(view.getByRole("heading", { name: "Attention" }));
    assert.ok(view.getByText("2 blocked reviews cannot settle."));
    assert.ok(view.getByText(/95% lower bound 65\.0% is below the 75\.0% policy threshold/));
    assert.ok(view.getByText(/account-change · normal · n = 12 of 30 comparable decisions/));
    assert.match(view.getByRole("link", { name: "Open approvals" }).getAttribute("href") ?? "", /tab=inbox/);
    assert.match(view.getByRole("link", { name: "Open results" }).getAttribute("href") ?? "", /tab=evaluations/);
    assert.match(view.getByRole("link", { name: "Review setup" }).getAttribute("href") ?? "", /tab=registry/);
    assert.equal(view.queryByText("scope-refunds-v3"), null);

    await userEvent.setup({ document }).click(view.getByRole("button", { name: "View scopes" }));
    assert.ok(view.getByText("scope-refunds-v3"));
    assert.ok(view.getByText("80.0% · 65.0% · n=40"));
    assert.equal(view.queryByText(/global score/i), null);
  } finally {
    await act(async () => cleanup());
    globalThis.fetch = previousFetch;
    restoreDom();
  }
});
