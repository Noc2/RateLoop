import React from "react";
import assert from "node:assert/strict";
import test from "node:test";
import { installTestDom } from "~~/components/tokenless/testing/dom";

test("workspace invitation codes use the workspace redemption path", async () => {
  const restoreDom = installTestDom();
  const { cleanup, render, waitFor } = await import("@testing-library/react");
  const userEvent = (await import("@testing-library/user-event")).default;
  const { InvitationRouterPanel } = await import("./InvitationRouterPanel");
  const previousFetch = globalThis.fetch;
  const calls: Array<{ body: string; url: string }> = [];
  const accepted: string[] = [];
  const code = "rlwi_example_secret";
  globalThis.fetch = async (input, init) => {
    calls.push({ body: String(init?.body), url: String(input) });
    return Response.json({ workspaceId: "workspace_1" });
  };

  try {
    const view = render(<InvitationRouterPanel onAccepted={kind => accepted.push(kind)} />);
    const user = userEvent.setup({ document });
    await user.type(view.getByLabelText("Invitation code"), code);
    await user.click(view.getByRole("button", { name: "Continue" }));

    await waitFor(() => assert.deepEqual(accepted, ["workspace"]));
    assert.deepEqual(calls, [
      {
        body: JSON.stringify({ token: code }),
        url: "/api/account/workspace-invitations/redeem",
      },
    ]);
    assert.equal(calls[0]?.url.includes(code), false);
    assert.ok(view.getByRole("status").textContent?.includes("Workspace invitation accepted"));
  } finally {
    cleanup();
    globalThis.fetch = previousFetch;
    restoreDom();
  }
});

test("workspace reviewer invitations are previewed, redeemed from the body, and notify the caller", async () => {
  const restoreDom = installTestDom();
  const { cleanup, render, waitFor } = await import("@testing-library/react");
  const userEvent = (await import("@testing-library/user-event")).default;
  const { InvitationRouterPanel } = await import("./InvitationRouterPanel");
  const previousFetch = globalThis.fetch;
  const calls: Array<{ body: string; url: string }> = [];
  const accepted: string[] = [];
  const code = "rlri_example_secret";
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    calls.push({ body: String(init?.body), url });
    if (url.endsWith("/preview")) {
      return Response.json({
        invitation: {
          accessExpiresAt: null,
          expiresAt: "2030-01-01T00:00:00.000Z",
          maxPrivateSensitivity: "confidential",
          workspaceName: "Example workspace",
        },
      });
    }
    return Response.json({ reviewer: { principalAddress: "rlp_reviewer" } });
  };

  try {
    const view = render(<InvitationRouterPanel onAccepted={kind => accepted.push(kind)} />);
    const user = userEvent.setup({ document });
    await user.type(view.getByLabelText("Invitation code"), code);
    await user.click(view.getByRole("button", { name: "Continue" }));
    assert.ok((await view.findByText("Reviewer invitation")).textContent);
    assert.ok(view.getByText("Review assigned private work without joining the workspace."));
    assert.ok(view.getByText("confidential"));
    assert.equal(accepted.length, 0);
    await user.click(view.getByRole("button", { name: "Accept invitation" }));

    await waitFor(() => assert.deepEqual(accepted, ["reviewer"]));
    assert.deepEqual(calls, [
      {
        body: JSON.stringify({ token: code }),
        url: "/api/account/reviewer-invitations/preview",
      },
      {
        body: JSON.stringify({ token: code }),
        url: "/api/account/reviewer-invitations/redeem",
      },
    ]);
    assert.ok(calls.every(call => !call.url.includes(code)));
    assert.ok(view.getByRole("status").textContent?.includes("Reviewer invitation accepted"));
  } finally {
    cleanup();
    globalThis.fetch = previousFetch;
    restoreDom();
  }
});

test("legacy private-group invitation codes are no longer accepted", async () => {
  const restoreDom = installTestDom();
  const { cleanup, render, waitFor } = await import("@testing-library/react");
  const userEvent = (await import("@testing-library/user-event")).default;
  const { InvitationRouterPanel } = await import("./InvitationRouterPanel");
  const previousFetch = globalThis.fetch;
  const calls: Array<{ body: string; url: string }> = [];
  const code = "rlgi_example_secret";
  globalThis.fetch = async (input, init) => {
    calls.push({ body: String(init?.body), url: String(input) });
    return Response.json({});
  };

  try {
    const view = render(<InvitationRouterPanel />);
    const user = userEvent.setup({ document });
    await user.type(view.getByLabelText("Invitation code"), code);
    await user.click(view.getByRole("button", { name: "Continue" }));
    await waitFor(() => assert.ok(view.getByRole("alert").textContent?.includes("valid RateLoop invitation code")));
    assert.deepEqual(calls, []);
    assert.equal(view.queryByRole("button", { name: "Accept invitation" }), null);
  } finally {
    cleanup();
    globalThis.fetch = previousFetch;
    restoreDom();
  }
});
