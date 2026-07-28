import React, { useState } from "react";
import assert from "node:assert/strict";
import test from "node:test";
import { installTestDom } from "~~/components/tokenless/testing/dom";

test("confirmation keeps focus inside, defaults to cancel, and restores the opener", async () => {
  const restoreDom = installTestDom();
  const { act, cleanup, render, waitFor, within } = await import("@testing-library/react");
  const userEvent = (await import("@testing-library/user-event")).default;
  const { ConfirmDialog } = await import("./ConfirmDialog");
  let confirms = 0;

  function Harness() {
    const [open, setOpen] = useState(false);
    return (
      <>
        <button type="button" onClick={() => setOpen(true)}>
          Remove member
        </button>
        <ConfirmDialog
          open={open}
          title="Remove this member?"
          description="Their workspace access ends immediately."
          confirmLabel="Remove member"
          onCancel={() => setOpen(false)}
          onConfirm={() => {
            confirms += 1;
            setOpen(false);
          }}
        />
      </>
    );
  }

  try {
    const view = render(<Harness />);
    const user = userEvent.setup({ document });
    const opener = view.getByRole("button", { name: "Remove member" });
    await user.click(opener);
    const dialog = view.getByRole("alertdialog");
    const cancel = view.getByRole("button", { name: "Cancel" });
    const confirm = within(dialog).getByRole("button", { name: "Remove member" });
    assert.equal(document.activeElement, cancel);
    assert.equal(dialog.getAttribute("aria-modal"), "true");

    confirm.focus();
    await user.tab();
    assert.equal(document.activeElement, cancel);
    await user.keyboard("{Escape}");
    await waitFor(() => assert.equal(view.queryByRole("alertdialog"), null));
    assert.equal(document.activeElement, opener);
    assert.equal(confirms, 0);

    await user.click(opener);
    await user.click(within(view.getByRole("alertdialog")).getByRole("button", { name: "Remove member" }));
    assert.equal(confirms, 1);
  } finally {
    await act(async () => cleanup());
    restoreDom();
  }
});
