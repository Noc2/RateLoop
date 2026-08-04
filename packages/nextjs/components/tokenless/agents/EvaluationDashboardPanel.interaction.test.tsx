import React from "react";
import assert from "node:assert/strict";
import test from "node:test";
import { EnglishAgentTestProviders } from "~~/components/tokenless/testing/AgentTestProviders";
import { installTestDom } from "~~/components/tokenless/testing/dom";

function run(overrides: Record<string, unknown> = {}) {
  return {
    runId: "run_evaluation_1",
    projectName: "Release gate",
    suiteName: "Support replies",
    status: "completed",
    clientDecision: null,
    explanationRequired: false,
    evidencePacketAvailable: true,
    candidateSelectionShareBps: 6_200,
    candidateSelectionIntervalBps: null,
    distinctReviewers: 12,
    validResponses: 12,
    sampleStatus: "sufficient",
    minimumAggregationSize: 3,
    caseCount: 8,
    calibrationCaseCount: 2,
    reviewerSource: "rateloop_network",
    compensation: "paid",
    mechanismHealth: null,
    attribution: { status: "unattributed", agentId: null, versionId: null },
    completedAt: "2026-07-20T00:00:00.000Z",
    createdAt: "2026-07-19T00:00:00.000Z",
    ...overrides,
  };
}

function dashboard(overrides: Record<string, unknown> = {}) {
  return {
    callerRole: "member",
    canViewPublishingPolicies: false,
    publishingPolicies: [],
    modelProfiles: [],
    agents: [],
    runs: [run()],
    summary: { totalRuns: 1, completedRuns: 1, evidenceBackedRuns: 1, validResponses: 12 },
    ...overrides,
  };
}

async function mount() {
  const { render } = await import("@testing-library/react");
  const { EvaluationDashboardPanel } = await import("./EvaluationDashboardPanel");
  return render(<EvaluationDashboardPanel initialWorkspaceId="workspace-1" />, {
    wrapper: EnglishAgentTestProviders,
  });
}

function installFetch(dashboardBody: Record<string, unknown>, caseView?: Record<string, unknown>) {
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (url === "/api/account/workspaces") {
      return Response.json({ workspaces: [{ workspaceId: "workspace-1", name: "Release team", role: "member" }] });
    }
    if (url.includes("/evaluations")) return Response.json(dashboardBody);
    if (url.endsWith("/evidence/decision") && init?.method === "POST") {
      return Response.json({ decisionId: "decision-1" }, { status: 201 });
    }
    if (caseView && url.endsWith("/cases")) return Response.json(caseView);
    throw new Error(`Unexpected evaluation request: ${url}`);
  };
  return () => {
    globalThis.fetch = previousFetch;
  };
}

test("the ten-character reason rule stays visible while the decider types", async () => {
  const restoreDom = installTestDom();
  const { act, cleanup } = await import("@testing-library/react");
  const userEvent = (await import("@testing-library/user-event")).default;
  const restoreFetch = installFetch(dashboard());

  try {
    const view = await mount();
    await userEvent.setup({ document }).click(await view.findByRole("button", { name: "Record outcome" }));
    const reasons = (await view.findAllByRole("textbox", { name: /Reasons/ }))[0]!;
    const accepted = view.getByRole("button", { name: "Accepted" });

    assert.ok(view.getByText("At least 10 characters are required before you can record an outcome — 10 to go."));
    assert.equal(accepted.hasAttribute("disabled"), true);

    await userEvent.setup({ document }).type(reasons, "Too short");
    assert.ok(view.getByText("At least 10 characters are required before you can record an outcome — 1 to go."));
    assert.equal(accepted.hasAttribute("disabled"), true);

    await userEvent.setup({ document }).type(reasons, " but now long enough");
    assert.equal(view.queryByText("Long enough to record an outcome."), null);
    assert.equal(accepted.hasAttribute("disabled"), false);
  } finally {
    await act(async () => cleanup());
    restoreFetch();
    restoreDom();
  }
});

test("the explained-decision rule stays visible while the decider types", async () => {
  const restoreDom = installTestDom();
  const { act, cleanup } = await import("@testing-library/react");
  const userEvent = (await import("@testing-library/user-event")).default;
  const restoreFetch = installFetch(dashboard({ runs: [run({ explanationRequired: true })] }));

  try {
    const view = await mount();
    // The explained-decision note renders above the append-only override record in the run card.
    const explanation = (await view.findAllByRole("textbox", { name: /Reasons/ }))[0]!;
    const go = view.getByRole("button", { name: "Go" });

    assert.ok(view.getByText("At least 10 characters are required before you can sign off — 10 to go."));
    assert.equal(go.hasAttribute("disabled"), true);

    await userEvent.setup({ document }).type(explanation, "Signed off after review");
    assert.equal(view.queryByText("Long enough to sign off."), null);
    assert.equal(go.hasAttribute("disabled"), false);
  } finally {
    await act(async () => cleanup());
    restoreFetch();
    restoreDom();
  }
});

test("the panel renders no workspace selector of its own", async () => {
  const restoreDom = installTestDom();
  const { act, cleanup } = await import("@testing-library/react");
  const restoreFetch = (() => {
    const previousFetch = globalThis.fetch;
    globalThis.fetch = async input => {
      const url = String(input);
      if (url === "/api/account/workspaces") {
        return Response.json({
          workspaces: [
            { workspaceId: "workspace-1", name: "Release team", role: "member" },
            { workspaceId: "workspace-2", name: "Support team", role: "member" },
          ],
        });
      }
      if (url.includes("/evaluations")) return Response.json(dashboard({ runs: [] }));
      throw new Error(`Unexpected evaluation request: ${url}`);
    };
    return () => {
      globalThis.fetch = previousFetch;
    };
  })();

  try {
    const view = await mount();
    await view.findByRole("heading", { name: "No evaluations yet" });
    assert.ok(view.queryByRole("combobox") === null, "the panel should render no workspace selector");
  } finally {
    await act(async () => cleanup());
    restoreFetch();
    restoreDom();
  }
});

test("suppressed results distinguish an active wait from a terminal shortfall", async () => {
  const restoreDom = installTestDom();
  const { act, cleanup } = await import("@testing-library/react");
  const restoreFetch = installFetch(
    dashboard({
      runs: [
        run({
          runId: "run_waiting",
          status: "review_requested",
          evidencePacketAvailable: false,
          sampleStatus: "suppressed",
          validResponses: 1,
          distinctReviewers: 1,
        }),
        run({
          runId: "run_terminal",
          evidencePacketAvailable: false,
          sampleStatus: "suppressed",
          validResponses: 1,
          distinctReviewers: 1,
        }),
      ],
    }),
  );

  try {
    const view = await mount();
    assert.equal(view.queryByText("Current result"), null);
    assert.ok(await view.findByText("Result hidden until 3 reviewers respond."));
    assert.ok(view.getByText("Result remains hidden because fewer than 3 reviewers responded."));
    assert.equal(view.queryByText("Showing 2 of 2 results"), null);
  } finally {
    await act(async () => cleanup());
    restoreFetch();
    restoreDom();
  }
});

test("decision signals omit unavailable placeholders and disappear when empty", async () => {
  const restoreDom = installTestDom();
  const { act, cleanup } = await import("@testing-library/react");
  const restoreFetch = installFetch(
    dashboard({
      runs: [run({ candidateSelectionShareBps: null, mechanismHealth: null })],
    }),
  );

  try {
    const view = await mount();
    await view.findByText("Release gate");
    assert.equal(view.queryByText("Before you decide"), null);
    assert.equal(view.queryByText("Suppressed"), null);
    assert.equal(view.queryByText("No calibration data"), null);
    assert.equal(view.queryByText("No data"), null);
  } finally {
    await act(async () => cleanup());
    restoreFetch();
    restoreDom();
  }
});

test("decision signals retain available disagreement and mechanism evidence", async () => {
  const restoreDom = installTestDom();
  const { act, cleanup, within } = await import("@testing-library/react");
  const restoreFetch = installFetch(
    dashboard({
      runs: [
        run({
          candidateSelectionShareBps: 6_200,
          mechanismHealth: { goldFailureRateBps: 500, unanimityRateBps: 7_500 },
        }),
      ],
    }),
  );

  try {
    const view = await mount();
    const signals = await view.findByRole("note");
    assert.ok(within(signals).getByText("Before you decide"));
    assert.ok(within(signals).getByText("Reviewer dissent"));
    assert.ok(within(signals).getByText("Calibration failure rate"));
    assert.ok(within(signals).getByText("Quorum-case unanimity"));
    for (const value of ["38.0%", "5.0%", "75.0%"]) {
      assert.ok(within(signals).getByText(value));
    }
  } finally {
    await act(async () => cleanup());
    restoreFetch();
    restoreDom();
  }
});

test("recording a decision immediately updates the active outcome filter", async () => {
  const restoreDom = installTestDom();
  const { act, cleanup, waitFor } = await import("@testing-library/react");
  const userEvent = (await import("@testing-library/user-event")).default;
  const restoreFetch = installFetch(dashboard());
  window.history.replaceState(null, "", "/agents/results?workspace=workspace-1&resultStatus=needs_action");

  try {
    const view = await mount();
    assert.ok(await view.findByText("Release gate"));
    assert.ok(view.getByText("Showing 1 of 1 results"));

    await userEvent.setup({ document }).click(view.getByRole("button", { name: "Go" }));

    await waitFor(() => assert.equal(view.queryByText("Release gate"), null));
    assert.ok(view.getByRole("heading", { name: "No results match these filters" }));
    assert.ok(view.getByText("Showing 0 of 1 results"));
  } finally {
    window.history.replaceState(null, "", "/agents/results");
    await act(async () => cleanup());
    restoreFetch();
    restoreDom();
  }
});

test("an attributed run shows its exact agent version without the legacy disclaimer", async () => {
  const restoreDom = installTestDom();
  const { act, cleanup } = await import("@testing-library/react");
  const restoreFetch = installFetch(
    dashboard({
      runs: [
        run({
          attribution: {
            status: "attributed",
            agentId: "agent_support",
            versionId: "agent_version_support_7",
          },
        }),
      ],
    }),
  );

  try {
    const view = await mount();
    assert.equal((await view.findAllByText("agent_support")).length, 2);
    assert.ok(view.getByText("agent_version_support_7"));
    assert.equal(
      view.queryByText(
        "This run has no immutable agent-version reference, so it is excluded from per-agent comparisons.",
      ),
      null,
    );
  } finally {
    await act(async () => cleanup());
    restoreFetch();
    restoreDom();
  }
});

test("per-response details explain run-specific reviewer pseudonyms without exposing roster identity", async () => {
  const restoreDom = installTestDom();
  const { act, cleanup } = await import("@testing-library/react");
  const userEvent = (await import("@testing-library/user-event")).default;
  const restoreFetch = installFetch(dashboard({ runs: [run({ reviewerSource: "customer_invited" })] }), {
    runId: "run_evaluation_1",
    projectId: "project_evaluation_1",
    lane: "customer_invited",
    detailAvailable: true,
    note: null,
    cases: [
      {
        caseId: "case_evaluation_1",
        position: 0,
        title: "Support response",
        instructions: "Compare the replies.",
        isCalibration: false,
        artifacts: [],
        responses: [
          {
            reviewerPseudonym: "reviewer-deadbeef",
            reviewerSource: "customer_invited",
            choice: "candidate",
            failureTagKeys: [],
            rationale: "The candidate resolves the issue.",
            submittedAt: "2026-07-20T00:00:00.000Z",
          },
        ],
        choiceCounts: { baseline: 0, candidate: 1 },
        disagreementBps: 0,
      },
    ],
    overrideDecisions: [],
  });

  try {
    const view = await mount();
    await userEvent.setup({ document }).click(await view.findByText("Reviewer responses"));
    assert.ok(
      await view.findByText(
        "Reviewer labels are run-specific pseudonyms by design. Responses are not linked here to roster identities.",
      ),
    );
    assert.ok(view.getByText(/reviewer-deadbeef · chose candidate/));
    assert.equal(view.queryByText(/@/), null);
  } finally {
    await act(async () => cleanup());
    restoreFetch();
    restoreDom();
  }
});

test("a failed run explains the recorded failure and exposes its case reasons", async () => {
  const restoreDom = installTestDom();
  const { act, cleanup } = await import("@testing-library/react");
  const userEvent = (await import("@testing-library/user-event")).default;
  const restoreFetch = installFetch(
    dashboard({
      runs: [
        run({
          status: "failed",
          evidencePacketAvailable: false,
          failureSummary: {
            kind: "review_execution",
            message: "1 review case stopped before the run could settle.",
            affectedCaseCount: 1,
          },
        }),
      ],
    }),
    {
      runId: "run_evaluation_1",
      projectId: "project_evaluation_1",
      lane: "customer_invited",
      detailAvailable: true,
      note: null,
      cases: [
        {
          caseId: "case_evaluation_1",
          position: 0,
          title: "Support response",
          instructions: "Compare the replies.",
          isCalibration: false,
          artifacts: [],
          responses: [
            {
              reviewerPseudonym: "reviewer-deadbeef",
              reviewerSource: "customer_invited",
              choice: "baseline",
              failureTagKeys: ["incorrect"],
              rationale: "The candidate did not answer the question.",
              submittedAt: "2026-07-20T00:00:00.000Z",
            },
          ],
          choiceCounts: { baseline: 1, candidate: 0 },
          disagreementBps: 0,
        },
      ],
      overrideDecisions: [],
    },
  );

  try {
    const view = await mount();
    assert.ok(await view.findByRole("heading", { name: "Why this failed" }));
    assert.ok(view.getByText("The run failed. Open case detail for the available evidence and reviewer reasons."));
    await userEvent.setup({ document }).click(view.getByText("Failure details"));
    assert.ok(await view.findByText("The candidate did not answer the question."));
  } finally {
    await act(async () => cleanup());
    restoreFetch();
    restoreDom();
  }
});

test("result filters restore from the URL and every evidence-backed result links to its packet", async () => {
  const restoreDom = installTestDom();
  const { act, cleanup } = await import("@testing-library/react");
  const restoreFetch = installFetch(
    dashboard({
      runs: [
        run(),
        run({
          runId: "run_failed_2",
          projectName: "Failed release",
          suiteName: "Payment recovery",
          status: "failed",
          workflowKey: "checkout",
          evidencePacketAvailable: true,
          evidencePacketDigest: "0xpacket",
          completedAt: "2026-07-21T00:00:00.000Z",
        }),
      ],
      summary: { totalRuns: 2, completedRuns: 1, evidenceBackedRuns: 2, validResponses: 12 },
    }),
  );
  window.history.replaceState(null, "", "/agents/results?workspace=workspace-1&resultStatus=failed");

  try {
    const view = await mount();
    assert.ok(await view.findByText("Failed release"));
    assert.equal(view.queryByText("Release gate"), null);
    assert.ok(view.getByText("Showing 1 of 2 results"));
    assert.equal((view.getByRole("combobox", { name: "Status" }) as HTMLSelectElement).value, "failed");
    const evidence = view.getByRole("link", { name: "Open evidence" });
    const href = new URL(evidence.getAttribute("href") ?? "", "https://rateloop.local");
    assert.equal(href.pathname, "/agents/results");
    assert.equal(href.searchParams.get("workspace"), "workspace-1");
    assert.equal(href.searchParams.get("run"), "run_failed_2");
    assert.equal(href.searchParams.get("resultStatus"), "failed");
    assert.equal(href.hash, "#evidence-packets-heading");
  } finally {
    window.history.replaceState(null, "", "/agents/results");
    await act(async () => cleanup());
    restoreFetch();
    restoreDom();
  }
});

test("aggregate-only network detail does not render the per-response pseudonym explanation", async () => {
  const restoreDom = installTestDom();
  const { act, cleanup } = await import("@testing-library/react");
  const userEvent = (await import("@testing-library/user-event")).default;
  const aggregateNote =
    "This run used the RateLoop network lane. Reviewer submissions stay aggregate-only in this workspace.";
  const restoreFetch = installFetch(dashboard(), {
    runId: "run_evaluation_1",
    projectId: "project_evaluation_1",
    lane: "rateloop_network",
    detailAvailable: false,
    note: aggregateNote,
    cases: [],
    overrideDecisions: [],
  });

  try {
    const view = await mount();
    await userEvent.setup({ document }).click(await view.findByText("Reviewer responses"));
    assert.ok(await view.findByText("Case detail is unavailable. Check your access or try again later."));
    assert.equal(view.queryByText(aggregateNote), null);
    assert.equal(
      view.queryByText(
        "Reviewer labels are run-specific pseudonyms by design. Responses are not linked here to roster identities.",
      ),
      null,
    );
  } finally {
    await act(async () => cleanup());
    restoreFetch();
    restoreDom();
  }
});
