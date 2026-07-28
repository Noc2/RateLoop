import React from "react";
import assert from "node:assert/strict";
import test from "node:test";
import { installTestDom } from "~~/components/tokenless/testing/dom";

test("workspace approvals show and mark only that workspace's alerts", async () => {
  const restoreDom = installTestDom();
  const { act, cleanup, render, waitFor } = await import("@testing-library/react");
  const userEvent = (await import("@testing-library/user-event")).default;
  const { OversightAlertsPanel } = await import("./OversightAlertsPanel");
  const previousFetch = globalThis.fetch;
  const markedBodies: unknown[] = [];
  let marked = false;
  const notification = (notificationId: string, title: string, href: string | null) => ({
    notificationId,
    kind: "oversightAlerts",
    title,
    body: `${title} body`,
    href,
    sourceType: "oversight.gate_blocked",
    createdAt: "2026-07-28T10:00:00.000Z",
    readAt: marked && notificationId === "alert-a" ? "2026-07-28T10:01:00.000Z" : null,
  });

  globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (url.endsWith("/oversight/alert-preferences")) {
      return Response.json({
        preferences: {
          workspaceId: "workspace-a",
          gateBlocked: true,
          reviewFailed: true,
          workspaceStop: true,
          coverageFloorHit: true,
          disagreementSpikeBps: 2_500,
          browserEnabled: false,
        },
      });
    }
    if (url.includes("/api/notifications/inbox") && init?.method === "POST") {
      markedBodies.push(JSON.parse(String(init.body)));
      marked = true;
      return Response.json({ updated: 1 });
    }
    if (url.includes("/api/notifications/inbox")) {
      return Response.json({
        unreadCount: 3,
        notifications: [
          notification("alert-a", "Workspace A alert", "/agents?tab=inbox&workspace=workspace-a"),
          notification("alert-b", "Workspace B alert", "/agents?tab=inbox&workspace=workspace-b"),
          notification("alert-legacy", "Unscoped legacy alert", null),
        ],
      });
    }
    throw new Error(`Unexpected request: ${url}`);
  };

  try {
    const view = render(<OversightAlertsPanel workspaceId="workspace-a" />);
    assert.ok(await view.findByText("Workspace A alert"));
    assert.equal(view.queryByText("Workspace B alert"), null);
    assert.equal(view.queryByText("Unscoped legacy alert"), null);
    assert.ok(view.getByText("1 unread"));

    await userEvent.setup({ document }).click(view.getByRole("button", { name: "Mark all read" }));
    await waitFor(() => assert.deepEqual(markedBodies, [{ notificationIds: ["alert-a"] }]));
  } finally {
    await act(async () => cleanup());
    globalThis.fetch = previousFetch;
    restoreDom();
  }
});
