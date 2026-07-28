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
    assert.ok(view.getByText("Last 30 days"));
    assert.ok(view.getByText("75.0% endorsed"));
    assert.ok(view.getByText(/61\.0%–86\.0% · n = 12 · too few cases to be reliable/));
    assert.ok(view.getByText("3.0 sec"));
    assert.ok(view.getByText("Cost is recorded for 8 of 12 decisions."));
    assert.ok(view.getByText(/Lifetime by scope.*never an average/));
    assert.ok(view.getByText("65.0%"));
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
