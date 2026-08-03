import React from "react";
import assert from "node:assert/strict";
import test from "node:test";
import { AgentTestProviders, withEnglishAppTestProviders } from "~~/components/tokenless/testing/AgentTestProviders";
import { installTestDom } from "~~/components/tokenless/testing/dom";

test("the reviewer inbox separates urgent actions and marks notifications read only on request", async () => {
  const restoreDom = installTestDom();
  const { act, cleanup, render: baseRender, waitFor } = await import("@testing-library/react");
  const render = withEnglishAppTestProviders(baseRender);
  const userEvent = (await import("@testing-library/user-event")).default;
  const { ReviewerNotificationInbox } = await import("./ReviewerNotificationInbox");
  const previousFetch = globalThis.fetch;
  const requests: Array<{ method: string; body?: string }> = [];
  globalThis.fetch = async (_input, init) => {
    requests.push({ method: init?.method ?? "GET", body: String(init?.body ?? "") || undefined });
    if (init?.method === "POST") return Response.json({ marked: 1 });
    return Response.json({
      unreadCount: 2,
      notifications: [
        {
          notificationId: "notification-claim",
          kind: "paymentUpdates",
          title: "Review payment expiring",
          body: "Claim this payment before its deadline.",
          href: "/human?tab=profile&section=paid-settlement",
          sourceType: "settlement.claim_expiring",
          createdAt: "2026-07-28T09:00:00.000Z",
          readAt: null,
        },
        {
          notificationId: "notification-assignment",
          kind: "assignmentAvailable",
          title: "Assignment available",
          body: "A review is ready.",
          href: "/human?tab=discover",
          sourceType: "assignment.available",
          createdAt: "2026-07-28T08:00:00.000Z",
          readAt: null,
        },
      ],
    });
  };

  try {
    const view = render(<ReviewerNotificationInbox />);
    assert.ok(await view.findByRole("heading", { name: "Deadline and payment actions" }));
    assert.ok(view.getByRole("heading", { name: "Review updates" }));
    assert.ok(view.getByText("Payment deadline"));
    assert.equal(requests.filter(request => request.method === "POST").length, 0);

    await userEvent.setup({ document }).click(view.getByRole("button", { name: "Mark read: Review payment expiring" }));
    await waitFor(() => assert.equal(requests.filter(request => request.method === "POST").length, 1));
    assert.deepEqual(JSON.parse(requests.find(request => request.method === "POST")?.body ?? "{}"), {
      notificationIds: ["notification-claim"],
    });
    assert.equal(view.queryByRole("button", { name: "Mark read: Review payment expiring" }), null);
  } finally {
    await act(async () => cleanup());
    globalThis.fetch = previousFetch;
    restoreDom();
  }
});

test("the reviewer inbox localizes persisted notification copy from its source type", async () => {
  const restoreDom = installTestDom();
  const { act, cleanup, render } = await import("@testing-library/react");
  const { ReviewerNotificationInbox } = await import("./ReviewerNotificationInbox");
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    Response.json({
      unreadCount: 1,
      notifications: [
        {
          notificationId: "notification-completed",
          kind: "assignmentCompleted",
          title: "stale stored title",
          body: "stale stored body",
          href: "/human/review",
          sourceType: "assignment.completed",
          createdAt: "2026-07-28T08:00:00.000Z",
          readAt: null,
        },
      ],
    });

  try {
    const view = render(
      <AgentTestProviders locale="de">
        <ReviewerNotificationInbox />
      </AgentTestProviders>,
    );
    assert.ok(await view.findByText("Antwort erfasst"));
    assert.ok(view.getByText("Deine Antwort zur menschlichen Prüfung wurde erfasst."));
    assert.equal(view.queryByText("stale stored title"), null);
    assert.equal(view.queryByText("stale stored body"), null);
    assert.ok(view.getByRole("link", { name: "Öffnen: Antwort erfasst" }));
  } finally {
    await act(async () => cleanup());
    globalThis.fetch = previousFetch;
    restoreDom();
  }
});
