import React from "react";
import assert from "node:assert/strict";
import test from "node:test";
import { installTestDom } from "~~/components/tokenless/testing/dom";

const preferences = {
  assignmentAvailable: true,
  assignmentCompleted: true,
  paymentUpdates: true,
  askResults: true,
  accountSecurity: true,
  oversightAlerts: false,
};

function installNotificationFetch({ paid = false, workspace = false }: { paid?: boolean; workspace?: boolean }) {
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async input => {
    const url = String(input);
    if (url === "/api/notifications/preferences") return Response.json(preferences);
    if (url === "/api/notifications/email") {
      return Response.json({ ...preferences, deliveryConfigured: false, email: "", verified: false });
    }
    if (url === "/api/account/workspaces") {
      return Response.json({ workspaces: workspace ? [{ workspaceId: "ws_test" }] : [] });
    }
    if (url === "/api/rater/earnings") {
      return Response.json({
        items: paid ? [{ commitId: "commit_test" }] : [],
        totals: {
          earnedAtomic: paid ? "1000000" : "0",
          claimedAtomic: "0",
          claimableAtomic: paid ? "1000000" : "0",
        },
      });
    }
    throw new Error(`Unexpected notification request: ${url}`);
  };
  return () => {
    globalThis.fetch = previousFetch;
  };
}

test("reviewer settings omit workspace and payment notifications when they do not apply", async () => {
  const restoreDom = installTestDom();
  const { cleanup, render, waitFor, within } = await import("@testing-library/react");
  const { NotificationSettingsPanel } = await import("./NotificationSettingsPanel");
  const restoreFetch = installNotificationFetch({});

  try {
    render(<NotificationSettingsPanel />);
    const screen = within(document.body);
    await waitFor(() => assert.ok(screen.getByRole("heading", { name: "Review work" })));

    assert.ok(screen.getByRole("heading", { name: "Account" }));
    assert.equal(screen.queryByRole("heading", { name: "Payments" }), null);
    assert.equal(screen.queryByRole("heading", { name: "Workspace" }), null);
    assert.ok(screen.getByText("Email notifications unavailable"));
    assert.equal(screen.queryByRole("textbox", { name: "Delivery email" }), null);
  } finally {
    cleanup();
    restoreFetch();
    restoreDom();
  }
});

test("workspace and payment notifications appear when the account has those capabilities", async () => {
  const restoreDom = installTestDom();
  const { cleanup, render, waitFor, within } = await import("@testing-library/react");
  const { NotificationSettingsPanel } = await import("./NotificationSettingsPanel");
  const restoreFetch = installNotificationFetch({ paid: true, workspace: true });

  try {
    render(<NotificationSettingsPanel />);
    const screen = within(document.body);
    await waitFor(() => assert.ok(screen.getByRole("heading", { name: "Payments" })));

    assert.ok(screen.getByRole("heading", { name: "Workspace" }));
    assert.ok(screen.getByText("Payment updates"));
    assert.ok(screen.getByText("Workspace results"));
    assert.ok(screen.getByText("Workspace alerts"));
  } finally {
    cleanup();
    restoreFetch();
    restoreDom();
  }
});
