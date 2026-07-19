import React from "react";
import assert from "node:assert/strict";
import test from "node:test";
import { installTestDom } from "~~/components/tokenless/testing/dom";

test("reviewer invitation codes are redeemed from the form body and notify the caller", async () => {
  const restoreDom = installTestDom();
  const { cleanup, render, waitFor } = await import("@testing-library/react");
  const userEvent = (await import("@testing-library/user-event")).default;
  const { InvitationRouterPanel } = await import("./InvitationRouterPanel");
  const previousFetch = globalThis.fetch;
  const calls: Array<{ body: string; url: string }> = [];
  const accepted: string[] = [];
  const code = "rli_example_secret";
  globalThis.fetch = async (input, init) => {
    calls.push({ body: String(init?.body), url: String(input) });
    return Response.json({ invitationId: "invite_1" });
  };

  try {
    const view = render(<InvitationRouterPanel onAccepted={kind => accepted.push(kind)} />);
    const user = userEvent.setup({ document });
    await user.type(view.getByLabelText("Invitation code"), code);
    await user.click(view.getByRole("button", { name: "Continue" }));

    await waitFor(() => assert.deepEqual(accepted, ["reviewer"]));
    assert.deepEqual(calls, [
      {
        body: JSON.stringify({ token: code }),
        url: "/api/account/assurance/reviewer-invitations/redeem",
      },
    ]);
    assert.equal(calls[0]?.url.includes(code), false);
    assert.ok(view.getByRole("status").textContent?.includes("Invitation accepted"));
  } finally {
    cleanup();
    globalThis.fetch = previousFetch;
    restoreDom();
  }
});

test("private-group invitation codes are previewed before acceptance and notify the caller", async () => {
  const restoreDom = installTestDom();
  const { cleanup, render, waitFor } = await import("@testing-library/react");
  const userEvent = (await import("@testing-library/user-event")).default;
  const { InvitationRouterPanel } = await import("./InvitationRouterPanel");
  const previousFetch = globalThis.fetch;
  const calls: Array<{ body: string; url: string }> = [];
  const accepted: string[] = [];
  const code = "rlgi_example_secret";
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    calls.push({ body: String(init?.body), url });
    if (url.endsWith("/preview")) {
      return Response.json({
        invitation: {
          expiresAt: "2030-01-01T00:00:00.000Z",
          groupId: "group_1",
          groupName: "Safety reviewers",
          groupPurpose: "Review private safety cases.",
          membershipExpiresAt: null,
          role: "reviewer",
          workspaceName: "Example workspace",
        },
      });
    }
    return Response.json({ membership: { groupId: "group_1" } });
  };

  try {
    const view = render(<InvitationRouterPanel onAccepted={kind => accepted.push(kind)} />);
    const user = userEvent.setup({ document });
    await user.type(view.getByLabelText("Invitation code"), code);
    await user.click(view.getByRole("button", { name: "Continue" }));
    await user.click(await view.findByRole("button", { name: "Accept invitation" }));

    await waitFor(() => assert.deepEqual(accepted, ["private_group"]));
    assert.deepEqual(
      calls.map(call => call.url),
      ["/api/account/private-groups/invitations/preview", "/api/account/private-groups/invitations/redeem"],
    );
    assert.ok(calls.every(call => call.body === JSON.stringify({ token: code })));
    assert.ok(calls.every(call => !call.url.includes(code)));
    assert.ok(view.getByRole("status").textContent?.includes("Group invitation accepted"));
  } finally {
    cleanup();
    globalThis.fetch = previousFetch;
    restoreDom();
  }
});
