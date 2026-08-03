import React, { useState } from "react";
import { NextIntlClientProvider } from "next-intl";
import assert from "node:assert/strict";
import test from "node:test";
import { installTestDom } from "~~/components/tokenless/testing/dom";
import { getMessagesForLocale } from "~~/i18n/messages";

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
    const view = render(
      <NextIntlClientProvider locale="en" messages={getMessagesForLocale("en")} timeZone="UTC">
        <Harness />
      </NextIntlClientProvider>,
    );
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

test("direct and hook confirmations share the German default cancel and busy labels", async () => {
  const restoreDom = installTestDom();
  const { act, cleanup, render, waitFor, within } = await import("@testing-library/react");
  const userEvent = (await import("@testing-library/user-event")).default;
  const { ConfirmDialog } = await import("./ConfirmDialog");
  const { useConfirmDialog } = await import("./useConfirmDialog");
  const choices: boolean[] = [];

  function Harness({ showBusy }: { showBusy: boolean }) {
    const { confirm, confirmationDialog } = useConfirmDialog();
    return (
      <>
        <button
          type="button"
          onClick={() =>
            void confirm({
              title: "Mitglied entfernen?",
              description: "Der Zugriff endet sofort.",
              confirmLabel: "Mitglied entfernen",
            }).then(choice => choices.push(choice))
          }
        >
          Bestätigung öffnen
        </button>
        <ConfirmDialog
          open={showBusy}
          title="Änderung speichern?"
          description="Die Änderung wird verarbeitet."
          confirmLabel="Speichern"
          busy
          onCancel={() => undefined}
          onConfirm={() => undefined}
        />
        {confirmationDialog}
      </>
    );
  }

  const provider = (showBusy: boolean) => (
    <NextIntlClientProvider locale="de" messages={getMessagesForLocale("de")} timeZone="UTC">
      <Harness showBusy={showBusy} />
    </NextIntlClientProvider>
  );

  try {
    const view = render(provider(true));
    const busyDialog = view.getByRole("alertdialog");
    assert.ok(within(busyDialog).getByRole("button", { name: "Abbrechen" }).hasAttribute("disabled"));
    assert.ok(within(busyDialog).getByRole("button", { name: "Wird verarbeitet…" }).hasAttribute("disabled"));
    assert.doesNotMatch(busyDialog.textContent ?? "", /Cancel|Working/u);

    view.rerender(provider(false));
    await userEvent.setup({ document }).click(view.getByRole("button", { name: "Bestätigung öffnen" }));
    const hookDialog = view.getByRole("alertdialog");
    await userEvent.setup({ document }).click(within(hookDialog).getByRole("button", { name: "Abbrechen" }));
    await waitFor(() => assert.deepEqual(choices, [false]));
  } finally {
    await act(async () => cleanup());
    restoreDom();
  }
});
