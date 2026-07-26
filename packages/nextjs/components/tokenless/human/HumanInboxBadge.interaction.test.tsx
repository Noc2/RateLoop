import React from "react";
import assert from "node:assert/strict";
import { test } from "node:test";
import { HumanInboxBadge } from "~~/components/tokenless/human/HumanInboxBadge";
import { installTestDom } from "~~/components/tokenless/testing/dom";

test("Human inbox badge counts only unread assignment notifications", async () => {
  const restoreDom = installTestDom();
  const { cleanup, render, waitFor } = await import("@testing-library/react");
  const previousFetch = globalThis.fetch;
  const requests: string[] = [];
  globalThis.fetch = async input => {
    requests.push(String(input));
    return Response.json({
      unreadCount: 4,
      notifications: [
        { sourceType: "assignment.available", readAt: null },
        { sourceType: "assignment.available", readAt: null },
        { sourceType: "assignment.available", readAt: "2026-07-14T16:00:00.000Z" },
        { sourceType: "ask.result", readAt: null },
      ],
    });
  };
  try {
    const view = render(<HumanInboxBadge />);
    await waitFor(() => assert.equal(view.getByText("2").getAttribute("aria-label"), "2 unread review assignments"));
    assert.deepEqual(requests, ["/api/notifications/inbox?limit=100"]);
  } finally {
    globalThis.fetch = previousFetch;
    cleanup();
    restoreDom();
  }
});

test("Human inbox badge fails quietly for signed-out visitors", async () => {
  const restoreDom = installTestDom();
  const { cleanup, render, waitFor } = await import("@testing-library/react");
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async () => Response.json({ error: "unauthorized" }, { status: 401 });
  try {
    const view = render(<HumanInboxBadge />);
    await waitFor(() => assert.equal(view.container.textContent, ""));
  } finally {
    globalThis.fetch = previousFetch;
    cleanup();
    restoreDom();
  }
});
