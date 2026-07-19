import React from "react";
import assert from "node:assert/strict";
import test from "node:test";
import { installTestDom } from "~~/components/tokenless/testing/dom";

test("account deletion starts from a visible action and loads its review on demand", async () => {
  const restoreDom = installTestDom();
  const { cleanup, render, waitFor } = await import("@testing-library/react");
  const userEvent = (await import("@testing-library/user-event")).default;
  const { AccountDeletionPanel } = await import("./AccountDeletionPanel");
  const previousFetch = globalThis.fetch;
  const calls: string[] = [];
  globalThis.fetch = async input => {
    calls.push(String(input));
    return Response.json({
      blockers: [],
      impact: {
        ownedWorkspaces: 0,
        sharedWorkspaces: 1,
        acceptedAssignments: 0,
        managedWallets: 0,
        retainedRecords: ["Tax records"],
      },
      warnings: [],
    });
  };

  try {
    const view = render(<AccountDeletionPanel />);
    const user = userEvent.setup({ document });
    assert.equal(view.container.querySelector("details"), null);
    assert.equal(view.queryByLabelText("Type DELETE to confirm"), null);

    await user.click(view.getByRole("button", { name: "Review account deletion" }));

    await waitFor(() => assert.ok(view.getByLabelText("Type DELETE to confirm")));
    assert.deepEqual(calls, ["/api/account/deletion"]);
    assert.ok(view.getByText("Tax records"));

    await user.click(view.getByRole("button", { name: "Cancel" }));
    assert.equal(view.queryByLabelText("Type DELETE to confirm"), null);
    assert.ok(view.getByRole("button", { name: "Review account deletion" }));
  } finally {
    cleanup();
    globalThis.fetch = previousFetch;
    restoreDom();
  }
});
