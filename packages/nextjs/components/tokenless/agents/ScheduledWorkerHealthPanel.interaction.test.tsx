import React from "react";
import assert from "node:assert/strict";
import { test } from "node:test";
import { ScheduledWorkerHealthPanel } from "~~/components/tokenless/agents/ScheduledWorkerHealthPanel";
import { installTestDom } from "~~/components/tokenless/testing/dom";

test("workspace maintenance health renders actionable redacted signals", async () => {
  const restoreDom = installTestDom();
  const { cleanup, render, waitFor } = await import("@testing-library/react");
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async input => {
    assert.equal(String(input), "/api/account/workspaces/workspace_health/operations/health");
    return Response.json({
      state: "degraded",
      currentRun: "idle",
      lastCompletedAt: "2026-07-26T11:59:00.000Z",
      signals: [{ key: "notifications.parked", label: "Parked notifications", count: 2 }],
    });
  };
  try {
    const view = render(<ScheduledWorkerHealthPanel workspaceId="workspace_health" />);
    await waitFor(() => assert.ok(view.getByText("Maintenance needs attention")));
    assert.ok(view.getByText("Parked notifications: 2"));
    assert.doesNotMatch(view.container.textContent ?? "", /delivery[_-]id|last_error/u);
    await new Promise(resolve => window.setTimeout(resolve, 0));
  } finally {
    globalThis.fetch = previousFetch;
    cleanup();
    restoreDom();
  }
});

test("workspace maintenance health renders an explicit unavailable state when its request fails", async () => {
  const restoreDom = installTestDom();
  const { cleanup, render, waitFor } = await import("@testing-library/react");
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(null, { status: 503 });
  try {
    const view = render(<ScheduledWorkerHealthPanel workspaceId="workspace_health" />);
    await waitFor(() => assert.ok(view.getByText("Maintenance status unavailable")));
    assert.ok(view.getByText("Health telemetry could not be loaded. Try again later."));
    await new Promise(resolve => window.setTimeout(resolve, 0));
  } finally {
    globalThis.fetch = previousFetch;
    cleanup();
    restoreDom();
  }
});
