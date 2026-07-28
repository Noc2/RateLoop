import React from "react";
import assert from "node:assert/strict";
import test from "node:test";
import { installTestDom } from "~~/components/tokenless/testing/dom";

test("a zero-agent workspace can start one focused reviewer invitation without management surfaces", async () => {
  const restoreDom = installTestDom();
  const { act, cleanup, render, waitFor } = await import("@testing-library/react");
  const userEvent = (await import("@testing-library/user-event")).default;
  const { ReviewerInvitationStart } = await import("./ReviewerInvitationStart");
  const previousFetch = globalThis.fetch;
  const requests: Array<{ body: Record<string, unknown> | null; method: string; url: string }> = [];

  globalThis.fetch = async (input, init) => {
    const body = typeof init?.body === "string" ? (JSON.parse(init.body) as Record<string, unknown>) : null;
    requests.push({ body, method: init?.method ?? "GET", url: String(input) });
    if (String(input).endsWith("/prepare")) return Response.json({ ready: true });
    return Response.json({
      invitation: {
        destinationUrl: "/human/review?invite=1#invite=rlri_early",
      },
    });
  };

  try {
    const view = render(<ReviewerInvitationStart workspaceId="workspace zero" />);
    const user = userEvent.setup({ document });

    assert.ok(view.getByRole("button", { name: "Invite reviewers" }));
    assert.equal(view.queryByRole("heading", { name: "Invite a reviewer" }), null);
    assert.equal(view.queryByText("Invite member"), null);
    assert.equal(view.queryByText("Active reviewers"), null);
    assert.equal(view.queryByText("Pending invitations"), null);

    await user.click(view.getByRole("button", { name: "Invite reviewers" }));
    const email = await view.findByRole("textbox", { name: "Email (optional)" });
    await waitFor(() => assert.equal(document.activeElement, email));
    assert.deepEqual(requests, [
      {
        body: null,
        method: "POST",
        url: "/api/account/workspaces/workspace%20zero/reviewer-invitations/prepare",
      },
    ]);

    await user.type(email, "reviewer@example.test");
    await user.click(view.getByRole("button", { name: "Create invitation" }));
    await waitFor(() => assert.equal(requests.length, 2));
    assert.deepEqual(requests[1], {
      body: {
        intendedEmail: "reviewer@example.test",
        maxPrivateSensitivity: "confidential",
        paidAdulthoodAttested: false,
        useDefaultReviewerGroup: true,
      },
      method: "POST",
      url: "/api/account/workspaces/workspace%20zero/reviewer-invitations",
    });
    assert.ok(await view.findByDisplayValue("/human/review?invite=1#invite=rlri_early"));
  } finally {
    await act(async () => cleanup());
    globalThis.fetch = previousFetch;
    restoreDom();
  }
});
