import React from "react";
import assert from "node:assert/strict";
import test from "node:test";
import { installTestDom } from "~~/components/tokenless/testing/dom";

test("runtime error actions retry the boundary or return through browser history", async () => {
  const restoreDom = installTestDom();
  const { act, cleanup, render } = await import("@testing-library/react");
  const userEvent = (await import("@testing-library/user-event")).default;
  const { RuntimeErrorActions } = await import("./RuntimeErrorActions");
  const previousBack = window.history.back;
  let resetCalls = 0;
  let backCalls = 0;
  window.history.back = () => {
    backCalls += 1;
  };

  try {
    const view = render(
      <RuntimeErrorActions
        reset={() => {
          resetCalls += 1;
        }}
      />,
    );
    const user = userEvent.setup({ document });

    await user.click(view.getByRole("button", { name: "Try again" }));
    await user.click(view.getByRole("button", { name: "Go back" }));

    assert.equal(resetCalls, 1);
    assert.equal(backCalls, 1);
  } finally {
    await act(async () => cleanup());
    window.history.back = previousBack;
    restoreDom();
  }
});
