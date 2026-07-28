import React from "react";
import assert from "node:assert/strict";
import test from "node:test";
import { installTestDom } from "~~/components/tokenless/testing/dom";

test("the confirmation controller resolves only after an explicit dialog choice", async () => {
  const restoreDom = installTestDom();
  const { act, cleanup, render, waitFor } = await import("@testing-library/react");
  const userEvent = (await import("@testing-library/user-event")).default;
  const { useConfirmDialog } = await import("./useConfirmDialog");
  const choices: boolean[] = [];

  function Harness() {
    const { confirm, confirmationDialog } = useConfirmDialog();
    return (
      <>
        <button
          type="button"
          onClick={() =>
            void confirm({
              title: "Confirm paid review policy",
              description: "This can spend up to 3 USDC.",
              confirmLabel: "Save review policy",
              destructive: false,
            }).then(choice => choices.push(choice))
          }
        >
          Save
        </button>
        {confirmationDialog}
      </>
    );
  }

  try {
    const view = render(<Harness />);
    const user = userEvent.setup({ document });
    await user.click(view.getByRole("button", { name: "Save" }));
    assert.equal(choices.length, 0);
    assert.match(view.getByRole("alertdialog").textContent ?? "", /spend up to 3 USDC/);

    await user.click(view.getByRole("button", { name: "Cancel" }));
    await waitFor(() => assert.deepEqual(choices, [false]));

    await user.click(view.getByRole("button", { name: "Save" }));
    await user.click(view.getByRole("button", { name: "Save review policy" }));
    await waitFor(() => assert.deepEqual(choices, [false, true]));
  } finally {
    await act(async () => cleanup());
    restoreDom();
  }
});
