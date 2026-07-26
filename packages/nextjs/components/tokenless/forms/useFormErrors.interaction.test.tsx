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
