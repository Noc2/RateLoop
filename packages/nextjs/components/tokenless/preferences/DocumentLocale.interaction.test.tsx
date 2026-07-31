import React from "react";
import assert from "node:assert/strict";
import test from "node:test";
import { installTestDom } from "~~/components/tokenless/testing/dom";

test("document language follows client-side locale navigation", async () => {
  const restoreDom = installTestDom();
  const { act, cleanup, render, waitFor } = await import("@testing-library/react");
  const { DocumentLocale } = await import("./DocumentLocale");

  try {
    document.documentElement.lang = "en";
    const view = render(<DocumentLocale locale="en" />);
    view.rerender(<DocumentLocale locale="de" />);

    await waitFor(() => assert.equal(document.documentElement.lang, "de"));
  } finally {
    await act(async () => cleanup());
    restoreDom();
  }
});
