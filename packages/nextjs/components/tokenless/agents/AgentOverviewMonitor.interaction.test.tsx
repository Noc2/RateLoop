import React from "react";
import assert from "node:assert/strict";
import test from "node:test";
import { EnglishAgentTestProviders } from "~~/components/tokenless/testing/AgentTestProviders";
import { installTestDom } from "~~/components/tokenless/testing/dom";

const overview = {
  window: {
    period: "30",
    days: 30,
    label: "Last 30 days",
    startsAt: "2026-06-28T12:00:00.000Z",
    endsAt: "2026-07-28T12:00:00.000Z",
  },
  facets: {
    selected: {
      workflow: null,
      riskTier: null,
      stage: null,
      versionId: null,
    },
    workflows: [
      { value: "account-change", label: "account-change" },
      { value: "refund-review", label: "refund-review" },
    ],
    riskTiers: [
      { value: "high", label: "high" },
      { value: "normal", label: "normal" },
    ],
    stages: [
      { value: "high_coverage", label: "High coverage" },
      { value: "monitoring", label: "Monitoring" },
    ],
    versions: [{ value: "version-support-3", label: "Support agent · v3" }],
    optionsTruncated: false,
  },
  headline: {
    completedDecisions: { available: true, count: 12 },
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
  reviewQuality: {
    periodLabel: "Last 30 days",
    availability: "available",
    privacyThreshold: { minimum: 3, maximum: 3 },
    consensus: {
      available: true,
      unanimityRateBps: 6_000,
      unanimousCaseCount: 6,
      caseCount: 10,
      limitedSample: true,
    },
    reviewerConsistency: {
      available: true,
      alphaMilli: 396,
      caseCount: 10,
      ratingCount: 30,
      limitedSample: true,
    },
    panelSplit: {
      available: true,
      splitCaseCount: 4,
      caseCount: 10,
      buckets: [
        { key: "unanimous", label: "Unanimous", caseCount: 6, shareBps: 6_000 },
        { key: "low", label: "Under 25% dissent", caseCount: 1, shareBps: 1_000 },
        { key: "moderate", label: "25–50% dissent", caseCount: 2, shareBps: 2_000 },
        { key: "high", label: "50%+ dissent", caseCount: 1, shareBps: 1_000 },
      ],
    },
    hotspots: {
      workflows: [
        {
          key: "refund-review",
          label: "refund-review",
          caseCount: 5,
          splitCaseCount: 3,
          splitRateBps: 6_000,
          dissentRateBps: 2_500,
        },
      ],
      riskTiers: [
        {
          key: "high",
          label: "high",
          caseCount: 4,
          splitCaseCount: 2,
          splitRateBps: 5_000,
          dissentRateBps: 2_000,
        },
      ],
      cases: [
        {
          key: "case-refund",
          label: "Ambiguous refund",
          caseCount: 2,
          splitCaseCount: 2,
          splitRateBps: 10_000,
          dissentRateBps: 3_333,
        },
      ],
    },
    decisionTime: {
      available: true,
      medianMilliseconds: 600_000,
      p95Milliseconds: 7_200_000,
      sampleSize: 10,
      limitedSample: true,
      buckets: [
        { key: "under_5m", label: "Under 5 min", decisionCount: 2, shareBps: 2_000 },
        { key: "5m_to_15m", label: "5–15 min", decisionCount: 3, shareBps: 3_000 },
        { key: "15m_to_1h", label: "15–60 min", decisionCount: 3, shareBps: 3_000 },
        { key: "1h_to_4h", label: "1–4 hours", decisionCount: 2, shareBps: 2_000 },
        { key: "over_4h", label: "Over 4 hours", decisionCount: 0, shareBps: 0 },
      ],
    },
  },
  agentVersions: {
    periodLabel: "Lifetime by scope",
    totalParentCount: 21,
    page: 1,
    pageSize: 20,
    totalPages: 2,
    hasPreviousPage: false,
    hasNextPage: true,
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

const secondPageOverview = {
  ...overview,
  agentVersions: {
    ...overview.agentVersions,
    page: 2,
    hasPreviousPage: true,
    hasNextPage: false,
    parents: [
      {
        ...overview.agentVersions.parents[0],
        agentId: "agent-billing",
        versionId: "version-billing-1",
        displayName: "Billing agent",
        scopeCount: 0,
        scopes: [],
        stageCounts: { calibrating: 0, high_coverage: 0, medium_coverage: 0, monitoring: 0 },
        lowestEndorsement: null,
      },
    ],
  },
};

test("the overview renders four fixed answers and expands lifetime scope evidence without a global score", async () => {
  const restoreDom = installTestDom();
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async input => {
    assert.match(String(input), /\/agents\/overview(?:\?|$)/u);
    const url = new URL(String(input), "https://rateloop.test");
    const source = url.searchParams.get("page") === "2" ? secondPageOverview : overview;
    const period = url.searchParams.get("period") ?? "30";
    return Response.json({
      ...source,
      window: {
        ...source.window,
        period,
        days: period === "lifetime" ? null : Number(period),
        label: period === "lifetime" ? "Lifetime" : `Last ${period} days`,
        startsAt: period === "lifetime" ? null : source.window.startsAt,
      },
      facets: {
        ...source.facets,
        selected: {
          ...source.facets.selected,
          workflow: url.searchParams.get("overviewWorkflow"),
          riskTier: url.searchParams.get("overviewRisk"),
          stage: url.searchParams.get("overviewStage"),
          versionId: url.searchParams.get("overviewVersion"),
        },
      },
    });
  };
  const { act, cleanup, render } = await import("@testing-library/react");
  const userEvent = (await import("@testing-library/user-event")).default;
  const { AgentOverviewMonitor } = await import("./AgentOverviewMonitor");

  try {
    const view = render(<AgentOverviewMonitor workspaceId="workspace-overview" />, {
      wrapper: EnglishAgentTestProviders,
    });
    assert.ok(await view.findByLabelText("Period"));
    assert.equal(view.queryByRole("heading", { name: "Agent monitor" }), null);
    for (const label of [
      "Completed decisions",
      "Reviewer endorsement",
      "Median time to decision",
      "Cost per decision",
    ]) {
      assert.ok(view.getByText(label));
    }
    assert.equal(view.getAllByText("Last 30 days").length, 1);
    assert.ok(view.getByText("75.0% endorsed"));
    assert.ok(view.getByText(/61\.0%–86\.0% · n = 12 · too few cases to be reliable/));
    assert.ok(view.getByText("3.0 sec"));
    assert.ok(view.getByText("Cost is recorded for 8 of 12 decisions."));
    assert.ok(view.getByRole("img", { name: /review outcome trend/i }));
    assert.ok(view.getByRole("img", { name: /decision-time trend/i }));
    assert.ok(view.getByText("2 endorsed · 1 rejected · 1 inconclusive"));
    assert.ok(view.getByRole("heading", { name: "Review quality" }));
    assert.ok(view.getByText("60.0% unanimous"));
    assert.ok(view.getByRole("heading", { name: "Reviewer consistency (α)" }));
    assert.equal(view.queryByText("Agreement beyond chance across baseline, candidate, and tie."), null);
    await userEvent.setup({ document }).click(view.getByRole("button", { name: "About reviewer consistency" }));
    assert.ok(view.getByText("Agreement beyond chance across baseline, candidate, and tie."));
    assert.ok(view.getByText("α = 0.396"));
    assert.ok(view.getByRole("heading", { name: "Panel-split distribution" }));
    assert.ok(view.getByText("Ambiguous refund"));
    assert.ok(view.getByText("95th percentile"));
    assert.ok(view.getByText(/Each included case met its frozen privacy threshold \(3 reviewers\)/));
    assert.equal(view.queryByText(/reviewer-[0-9a-f]+/iu), null);
    assert.equal(view.queryByText("Lifetime by scope"), null);
    assert.ok(view.getByText("65.0%"));
    assert.ok(view.getByRole("heading", { name: "Attention" }));
    assert.ok(view.getByText("2 blocked reviews cannot settle."));
    assert.ok(view.getByText(/95% lower bound 65\.0% is below the 75\.0% policy threshold/));
    assert.ok(view.getByText(/account-change · normal · n = 12 of 30 comparable decisions/));
    assert.match(view.getByRole("link", { name: "Open approvals" }).getAttribute("href") ?? "", /\/agents\/approvals/);
    assert.match(view.getByRole("link", { name: "Open results" }).getAttribute("href") ?? "", /\/agents\/results/);
    assert.match(view.getByRole("link", { name: "Review setup" }).getAttribute("href") ?? "", /\/agents\/review-setup/);
    assert.equal(view.queryByText("scope-refunds-v3"), null);

    await userEvent.setup({ document }).click(view.getByRole("button", { name: "View scopes" }));
    assert.ok(view.getByText("scope-refunds-v3"));
    assert.ok(view.getByText("80.0% · 65.0% · n=40"));
    assert.equal(view.queryByText(/global score/i), null);

    await userEvent.setup({ document }).selectOptions(view.getByLabelText("Period"), "90");
    assert.equal(new URL(window.location.href).searchParams.get("period"), "90");
    assert.equal((view.getByLabelText("Period") as HTMLSelectElement).value, "90");
    await userEvent.setup({ document }).selectOptions(view.getByLabelText("Risk tier"), "high");
    assert.equal(new URL(window.location.href).searchParams.get("overviewRisk"), "high");

    await userEvent.setup({ document }).click(view.getByRole("button", { name: "Next" }));
    assert.ok(await view.findByText("Billing agent"));
    assert.ok(view.getByText("Page 2 of 2"));
    assert.equal(new URL(window.location.href).searchParams.get("overviewPage"), "2");
    assert.equal((view.getByRole("button", { name: "Next" }) as HTMLButtonElement).disabled, true);
    assert.equal((view.getByRole("button", { name: "Previous" }) as HTMLButtonElement).disabled, false);

    await userEvent.setup({ document }).click(view.getByRole("button", { name: "Previous" }));
    assert.ok(await view.findByText("Page 1 of 2"));
    assert.ok(view.getAllByText("Support agent").length > 0);
    assert.equal(new URL(window.location.href).searchParams.has("overviewPage"), false);
  } finally {
    await act(async () => cleanup());
    globalThis.fetch = previousFetch;
    restoreDom();
  }
});
