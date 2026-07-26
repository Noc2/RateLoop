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
