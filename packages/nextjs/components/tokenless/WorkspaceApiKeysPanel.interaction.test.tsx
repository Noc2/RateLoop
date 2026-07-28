import React from "react";
import assert from "node:assert/strict";
import test from "node:test";
import { installTestDom } from "~~/components/tokenless/testing/dom";

test("API key revocation waits for explicit confirmation and keeps the dialog busy during deletion", async () => {
  const restoreDom = installTestDom();
  const { act, cleanup, render, waitFor, within } = await import("@testing-library/react");
  const userEvent = (await import("@testing-library/user-event")).default;
  const { WorkspaceApiKeysPanel } = await import("./WorkspaceApiKeysPanel");
  const previousFetch = globalThis.fetch;
  const deletes: string[] = [];
  let resolveDelete!: (response: Response) => void;
  const pendingDelete = new Promise<Response>(resolve => {
    resolveDelete = resolve;
  });

  globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (init?.method === "DELETE") {
      deletes.push(url);
      return pendingDelete;
    }
    return Response.json({
      apiKeys: [
        {
          apiKeyId: "api-key-1",
          name: "Production agent",
          keyPrefix: "rlk_live",
          scopes: ["quote:read", "result:read"],
          expiresAt: "2026-10-01T00:00:00.000Z",
          revokedAt: null,
          lastUsedAt: null,
          createdAt: "2026-07-01T00:00:00.000Z",
        },
      ],
    });
  };

  try {
    const view = render(<WorkspaceApiKeysPanel workspaceId="workspace-1" />);
    const user = userEvent.setup({ document });
    const revoke = await view.findByRole("button", { name: "Revoke" });
    await user.click(revoke);
    let dialog = view.getByRole("alertdialog");
    assert.ok(within(dialog).getByRole("heading", { name: "Revoke “Production agent”?" }));
    assert.ok(within(dialog).getByText("Existing integrations using it will stop working."));
    assert.equal(deletes.length, 0);
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    assert.equal(view.queryByRole("alertdialog"), null);
    assert.equal(deletes.length, 0);

    await user.click(revoke);
    dialog = view.getByRole("alertdialog");
    await user.click(within(dialog).getByRole("button", { name: "Revoke API key" }));
    await waitFor(() => assert.deepEqual(deletes, ["/api/account/workspaces/workspace-1/api-keys/api-key-1"]));
    assert.ok(within(dialog).getByRole("button", { name: "Working…" }).hasAttribute("disabled"));
    assert.ok(within(dialog).getByRole("button", { name: "Cancel" }).hasAttribute("disabled"));

    await act(async () => {
      resolveDelete(Response.json({ ok: true }));
      await pendingDelete;
    });
    await waitFor(() => assert.equal(view.queryByRole("alertdialog"), null));
    assert.ok(view.getByText("Revoked"));
  } finally {
    await act(async () => cleanup());
    globalThis.fetch = previousFetch;
    restoreDom();
  }
});
