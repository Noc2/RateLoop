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

function installFetch(dashboardBody: Record<string, unknown>) {
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async input => {
    const url = String(input);
    if (url === "/api/account/workspaces") {
      return Response.json({ workspaces: [{ workspaceId: "workspace-1", name: "Release team", role: "member" }] });
    }
    if (url.endsWith("/evaluations")) return Response.json(dashboardBody);
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
