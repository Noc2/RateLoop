import React from "react";
import assert from "node:assert/strict";
import test from "node:test";
import { installTestDom } from "~~/components/tokenless/testing/dom";

test("a server field error focuses and reveals the first invalid control", async () => {
  const restoreDom = installTestDom();
  const { act, cleanup, render, waitFor } = await import("@testing-library/react");
  const userEvent = (await import("@testing-library/user-event")).default;
  const { useFormErrors } = await import("./useFormErrors");
  const scrollCalls: ScrollIntoViewOptions[] = [];
  const previousScrollIntoView = HTMLElement.prototype.scrollIntoView;
  HTMLElement.prototype.scrollIntoView = function scrollIntoView(options?: boolean | ScrollIntoViewOptions) {
    if (options && typeof options === "object") scrollCalls.push(options);
  };

  function Example() {
    const { capture, fieldErrors } = useFormErrors();
    return (
      <>
        <input name="email" aria-invalid={fieldErrors.email ? true : undefined} />
        <button type="button" onClick={() => capture({ field: "email", message: "Check this email." }, "Failed.")}>
          Submit
        </button>
      </>
    );
  }

  try {
    const view = render(<Example />);
    await userEvent.setup({ document }).click(view.getByRole("button", { name: "Submit" }));
    const email = view.getByRole("textbox");
    await waitFor(() => assert.equal(document.activeElement, email));
    assert.equal(email.getAttribute("aria-invalid"), "true");
    assert.deepEqual(scrollCalls, [{ behavior: "smooth", block: "center" }]);
  } finally {
    await act(async () => cleanup());
    HTMLElement.prototype.scrollIntoView = previousScrollIntoView;
    restoreDom();
  }
});

test("a field primitive with a generated id is still focused and revealed", async () => {
  const restoreDom = installTestDom();
  const { act, cleanup, render, waitFor } = await import("@testing-library/react");
  const userEvent = (await import("@testing-library/user-event")).default;
  const { useFormErrors } = await import("./useFormErrors");
  const { Field, TextareaField } = await import("./Field");
  const scrollCalls: ScrollIntoViewOptions[] = [];
  const previousScrollIntoView = HTMLElement.prototype.scrollIntoView;
  HTMLElement.prototype.scrollIntoView = function scrollIntoView(options?: boolean | ScrollIntoViewOptions) {
    if (options && typeof options === "object") scrollCalls.push(options);
  };

  // No consumer of the shared primitives passes `id` or `name`: the ids come from `useId()`.
  function Example() {
    const { capture, fieldErrors } = useFormErrors();
    return (
      <>
        <Field label="Legal business name" error={fieldErrors.legalName} />
        <TextareaField label="Registered address" error={fieldErrors.registeredAddress} />
        <button
          type="button"
          onClick={() => capture({ field: "registeredAddress", message: "Enter a registered address." }, "Failed.")}
        >
          Save
        </button>
      </>
    );
  }

  try {
    const view = render(<Example />);
    await userEvent.setup({ document }).click(view.getByRole("button", { name: "Save" }));
    const address = view.getByRole("textbox", { name: /Registered address/ });
    // Identity is compared with `===` so a regression fails immediately instead of asking
    // node:assert to inspect two whole DOM trees for a diff.
    await waitFor(() => assert.ok(document.activeElement === address, "the invalid control should hold focus"));
    assert.equal(address.getAttribute("aria-invalid"), "true");
    assert.deepEqual(scrollCalls, [{ behavior: "smooth", block: "center" }]);
  } finally {
    await act(async () => cleanup());
    HTMLElement.prototype.scrollIntoView = previousScrollIntoView;
    restoreDom();
  }
});
