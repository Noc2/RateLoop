import React from "react";
import assert from "node:assert/strict";
import test from "node:test";
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
    sampleStatus: "ok",
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
  return render(<EvaluationDashboardPanel initialWorkspaceId="workspace-1" />);
}

function installFetch(dashboardBody: Record<string, unknown>, caseView?: Record<string, unknown>) {
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async input => {
    const url = String(input);
    if (url === "/api/account/workspaces") {
      return Response.json({ workspaces: [{ workspaceId: "workspace-1", name: "Release team", role: "member" }] });
    }
    if (url.endsWith("/evaluations")) return Response.json(dashboardBody);
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
    await userEvent
      .setup({ document })
      .click(await view.findByRole("button", { name: "Record override or corrective action" }));
    const reasons = (await view.findAllByRole("textbox", { name: /Reasons/ }))[0]!;
    const accepted = view.getByRole("button", { name: "accepted" });

    assert.ok(view.getByText("At least 10 characters are required before you can record an outcome — 10 to go."));
    assert.equal(accepted.hasAttribute("disabled"), true);

    await userEvent.setup({ document }).type(reasons, "Too short");
    assert.ok(view.getByText("At least 10 characters are required before you can record an outcome — 1 to go."));
    assert.equal(accepted.hasAttribute("disabled"), true);

    await userEvent.setup({ document }).type(reasons, " but now long enough");
    assert.ok(view.getByText("Long enough to record an outcome."));
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
    assert.ok(view.getByText("Long enough to sign off."));
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
      if (url.endsWith("/evaluations")) return Response.json(dashboard({ runs: [] }));
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
    assert.ok(await view.findByText("agent_support"));
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
    await userEvent.setup({ document }).click(await view.findByText("Case detail and reviewer reasons"));
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
    assert.ok(view.getByText("1 review case stopped before the run could settle."));
    await userEvent.setup({ document }).click(view.getByText("Why this failed: case detail and reviewer reasons"));
    assert.ok(await view.findByText("The candidate did not answer the question."));
  } finally {
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
    await userEvent.setup({ document }).click(await view.findByText("Case detail and reviewer reasons"));
    assert.ok(await view.findByText(aggregateNote));
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
