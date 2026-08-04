import React from "react";
import assert from "node:assert/strict";
import { test } from "node:test";
import { HumanInboxBadge } from "~~/components/tokenless/human/HumanInboxBadge";
import { withEnglishAppTestProviders } from "~~/components/tokenless/testing/AgentTestProviders";
import { installTestDom } from "~~/components/tokenless/testing/dom";

const LOADED_SUITE_TIMEOUT_MS = 5_000;

test("Human inbox badge counts only unread reviewer notifications", async () => {
  const restoreDom = installTestDom();
  const { cleanup, render: baseRender, waitFor } = await import("@testing-library/react");
  const render = withEnglishAppTestProviders(baseRender);
  const previousFetch = globalThis.fetch;
  const requests: string[] = [];
  globalThis.fetch = async input => {
    requests.push(String(input));
    if (String(input) === "/api/auth/session") return Response.json({ authenticated: true });
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
    await waitFor(
      () => assert.equal(view.getByText("2").getAttribute("aria-label"), "2 unread reviewer notifications"),
      { timeout: LOADED_SUITE_TIMEOUT_MS },
    );
    assert.deepEqual(requests, ["/api/auth/session", "/api/notifications/inbox?scope=reviewer&limit=100"]);
  } finally {
    globalThis.fetch = previousFetch;
    cleanup();
    restoreDom();
  }
});

test("Human inbox badge fails quietly for signed-out visitors", async () => {
  const restoreDom = installTestDom();
  const { cleanup, render: baseRender, waitFor } = await import("@testing-library/react");
  const render = withEnglishAppTestProviders(baseRender);
  const previousFetch = globalThis.fetch;
  const requests: string[] = [];
  globalThis.fetch = async input => {
    requests.push(String(input));
    return Response.json({ authenticated: false });
  };
  try {
    const view = render(<HumanInboxBadge />);
    await waitFor(() => assert.deepEqual(requests, ["/api/auth/session"]), {
      timeout: LOADED_SUITE_TIMEOUT_MS,
    });
    assert.equal(view.container.textContent, "");
  } finally {
    globalThis.fetch = previousFetch;
    cleanup();
    restoreDom();
  }
});

test("opening Human navigation never marks reviewer notifications read", async () => {
  const restoreDom = installTestDom();
  const { cleanup, render: baseRender, waitFor } = await import("@testing-library/react");
  const render = withEnglishAppTestProviders(baseRender);
  const previousFetch = globalThis.fetch;
  const requests: Array<{ body?: string; method: string; url: string }> = [];
  globalThis.fetch = async (input, init) => {
    requests.push({
      body: init?.body ? String(init.body) : undefined,
      method: init?.method ?? "GET",
      url: String(input),
    });
    if (String(input) === "/api/auth/session") return Response.json({ authenticated: true });
    return Response.json({
      notifications: [
        { notificationId: "tn_assignment_1", sourceType: "assignment.available", readAt: null },
        { notificationId: "tn_assignment_2", sourceType: "assignment.available", readAt: null },
        { notificationId: "tn_result", sourceType: "ask.result", readAt: null },
      ],
    });
  };
  try {
    const view = render(<HumanInboxBadge />);
    await waitFor(
      () => assert.equal(view.getByText("2").getAttribute("aria-label"), "2 unread reviewer notifications"),
      { timeout: LOADED_SUITE_TIMEOUT_MS },
    );
    assert.deepEqual(requests, [
      { body: undefined, method: "GET", url: "/api/auth/session" },
      { body: undefined, method: "GET", url: "/api/notifications/inbox?scope=reviewer&limit=100" },
    ]);
    assert.equal(
      requests.some(request => request.method === "POST"),
      false,
    );
  } finally {
    globalThis.fetch = previousFetch;
    cleanup();
    restoreDom();
  }
});
