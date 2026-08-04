import React from "react";
import assert from "node:assert/strict";
import test from "node:test";
import { withEnglishAppTestProviders } from "~~/components/tokenless/testing/AgentTestProviders";
import { installTestDom } from "~~/components/tokenless/testing/dom";

test("API key permissions explain their tasks while the request keeps the raw scope contract", async () => {
  const restoreDom = installTestDom();
  const { act, cleanup, render: baseRender, waitFor } = await import("@testing-library/react");
  const render = withEnglishAppTestProviders(baseRender);
  const userEvent = (await import("@testing-library/user-event")).default;
  const { WorkspaceApiKeysPanel } = await import("./WorkspaceApiKeysPanel");
  const previousFetch = globalThis.fetch;
  const createdBodies: Record<string, unknown>[] = [];

  globalThis.fetch = async (_input, init) => {
    if (init?.method === "POST") {
      const body = JSON.parse(String(init.body)) as Record<string, unknown>;
      createdBodies.push(body);
      return Response.json({
        token: "rlk_new_secret",
        apiKey: {
          apiKeyId: "api-key-new",
          name: body.name,
          keyPrefix: "rlk_new",
          scopes: body.scopes,
          expiresAt: body.expiresAt,
          revokedAt: null,
          lastUsedAt: null,
          createdAt: "2026-07-28T00:00:00.000Z",
        },
      });
    }
    return Response.json({ apiKeys: [] });
  };

  try {
    const view = render(<WorkspaceApiKeysPanel workspaceId="workspace-1" />);
    const user = userEvent.setup({ document });
    const expectedPermissions = [
      ["Start review work", "Publish review panels and assignments for this workspace."],
      ["Spend workspace funds", "Reserve or submit payment when starting paid review work."],
      ["Read review results", "Retrieve completed review decisions and their supporting details."],
      ["Read evaluation state", "Inspect automated evaluation receipts, outcomes, and linked human-review results."],
      ["Check whether review is required", "Ask RateLoop whether a piece of work must be held for human review."],
      ["Send evaluation telemetry", "Upload agent traces and automated evaluation receipts."],
    ] as const;

    await view.findByText("No API keys yet.");
    for (const [label, description] of expectedPermissions) {
      assert.ok(view.getByText(label));
      assert.ok(view.getByText(description));
    }
    assert.equal(view.queryByText("payment:submit"), null);

    await user.click(view.getByRole("checkbox", { name: /Read evaluation state/ }));
    await user.click(view.getByRole("checkbox", { name: /Spend workspace funds/ }));
    await user.click(view.getByRole("checkbox", { name: /Send evaluation telemetry/ }));
    await user.type(view.getByRole("textbox", { name: "Key name" }), "Evaluation worker");
    await user.click(view.getByRole("button", { name: "Create API key" }));

    await waitFor(() => assert.equal(createdBodies.length, 1));
    assert.equal(createdBodies[0]?.name, "Evaluation worker");
    assert.deepEqual(createdBodies[0]?.scopes, ["result:read", "payment:submit", "telemetry:write"]);
    assert.match(String(createdBodies[0]?.expiresAt), /^\d{4}-\d{2}-\d{2}T/);
    assert.ok(await view.findByDisplayValue("rlk_new_secret"));
    assert.ok(view.getByText("payment:submit"));
    assert.ok(view.getByText("telemetry:write"));
  } finally {
    await act(async () => cleanup());
    globalThis.fetch = previousFetch;
    restoreDom();
  }
});

test("API key revocation waits for explicit confirmation and keeps the dialog busy during deletion", async () => {
  const restoreDom = installTestDom();
  const { act, cleanup, render: baseRender, waitFor, within } = await import("@testing-library/react");
  const render = withEnglishAppTestProviders(baseRender);
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
          scopes: ["result:read"],
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
