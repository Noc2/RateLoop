import React from "react";
import assert from "node:assert/strict";
import test from "node:test";
import { installTestDom } from "~~/components/tokenless/testing/dom";

test("workspace invitation errors land beside the exact field and clear when edited", async () => {
  const restoreDom = installTestDom();
  const { act, cleanup, render, screen } = await import("@testing-library/react");
  const userEvent = (await import("@testing-library/user-event")).default;
  const { WorkspaceMembersPanel } = await import("./WorkspaceMembersPanel");
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async (_input, init) => {
    if (init?.method === "POST") {
      return Response.json(
        {
          code: "invalid_invite",
          field: "intendedEmail",
          message: "Enter a valid email address.",
          retryable: false,
        },
        { status: 400 },
      );
    }
    return Response.json({ viewerPrincipalId: "principal-owner", members: [], invitations: [] });
  };

  try {
    render(<WorkspaceMembersPanel canManage workspaceId="workspace-1" />);
    const email = await screen.findByRole("textbox", { name: "Email" });
    const user = userEvent.setup({ document });
    await user.type(email, "rejected@example.com");
    await user.click(screen.getByRole("button", { name: "Create invitation" }));
    assert.equal((await screen.findByRole("alert")).textContent, "Enter a valid email address.");
    assert.equal(email.getAttribute("aria-invalid"), "true");

    await user.type(email, ".example");
    assert.equal(screen.queryByRole("alert"), null);
    assert.equal(email.getAttribute("aria-invalid"), null);
  } finally {
    await act(async () => cleanup());
    globalThis.fetch = previousFetch;
    restoreDom();
  }
});

test("member removal and invitation revocation mutate only after explicit dialog confirmation", async () => {
  const restoreDom = installTestDom();
  const { act, cleanup, render, waitFor, within } = await import("@testing-library/react");
  const userEvent = (await import("@testing-library/user-event")).default;
  const { WorkspaceMembersPanel } = await import("./WorkspaceMembersPanel");
  const previousFetch = globalThis.fetch;
  const deletes: string[] = [];
  let memberRemoved = false;
  let invitationRevoked = false;

  globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (init?.method === "DELETE") {
      deletes.push(url);
      if (url.includes("/member-invitations/")) invitationRevoked = true;
      else memberRemoved = true;
      return Response.json({ ok: true });
    }
    return Response.json({
      viewerPrincipalId: "principal-owner",
      members: [
        {
          principalId: "principal-owner",
          displayName: "Owner",
          email: "owner@example.test",
          accessRole: "owner",
          managedBy: null,
          joinedAt: "2026-07-01T00:00:00.000Z",
        },
        ...(memberRemoved
          ? []
          : [
              {
                principalId: "principal-member",
                displayName: "Ada",
                email: "ada@example.test",
                accessRole: "member",
                managedBy: null,
                joinedAt: "2026-07-02T00:00:00.000Z",
              },
            ]),
      ],
      invitations: invitationRevoked
        ? []
        : [
            {
              inviteId: "invite-1",
              tokenPrefix: "rli_123",
              accessRole: "member",
              hasAccountBinding: false,
              hasEmailBinding: true,
              status: "pending",
              expiresAt: "2026-08-01T00:00:00.000Z",
            },
          ],
    });
  };

  try {
    const view = render(<WorkspaceMembersPanel canManage workspaceId="workspace-1" />);
    const user = userEvent.setup({ document });
    const remove = await view.findByRole("button", { name: "Remove" });
    await user.click(remove);
    let dialog = view.getByRole("alertdialog");
    assert.ok(within(dialog).getByRole("heading", { name: "Remove Ada from this workspace?" }));
    assert.equal(deletes.length, 0);
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    assert.equal(view.queryByRole("alertdialog"), null);
    assert.equal(deletes.length, 0);

    await user.click(remove);
    dialog = view.getByRole("alertdialog");
    await user.click(within(dialog).getByRole("button", { name: "Remove member" }));
    await waitFor(() => assert.deepEqual(deletes, ["/api/account/workspaces/workspace-1/members/principal-member"]));

    const revoke = await view.findByRole("button", { name: "Revoke" });
    await user.click(revoke);
    dialog = view.getByRole("alertdialog");
    assert.ok(within(dialog).getByText("The invitation code will stop working."));
    await user.click(within(dialog).getByRole("button", { name: "Revoke invitation" }));
    await waitFor(() =>
      assert.deepEqual(deletes, [
        "/api/account/workspaces/workspace-1/members/principal-member",
        "/api/account/workspaces/workspace-1/member-invitations/invite-1",
      ]),
    );
  } finally {
    await act(async () => cleanup());
    globalThis.fetch = previousFetch;
    restoreDom();
  }
});
