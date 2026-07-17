import React, { createRef } from "react";
import assert from "node:assert/strict";
import test from "node:test";
import { installTestDom } from "~~/components/tokenless/testing/dom";

test("reviewer shell supports 1, 2, R, and Enter without a pointer", async () => {
  const restoreDom = installTestDom();
  const { cleanup, render, screen } = await import("@testing-library/react");
  const userEvent = (await import("@testing-library/user-event")).default;
  const { ReviewerShell } = await import("./ReviewerShell");
  const actions: string[] = [];
  const rationaleRef = createRef<HTMLTextAreaElement>();

  try {
    render(
      <ReviewerShell
        advanceDisabled={false}
        advanceLabel="Next case"
        caseIndex={2}
        laneHeader={<p>Private assignment</p>}
        onAdvance={() => actions.push("advance")}
        onSelectFirst={() => actions.push("first")}
        onSelectSecond={() => actions.push("second")}
        rationaleRef={rationaleRef}
        totalCases={8}
      >
        <textarea ref={rationaleRef} aria-label="Rationale" />
      </ReviewerShell>,
    );

    const user = userEvent.setup();
    await user.keyboard("12r");
    assert.deepEqual(actions, ["first", "second"]);
    assert.equal(document.activeElement, screen.getByRole("textbox", { name: "Rationale" }));
    await user.tab();
    await user.keyboard("{Enter}");
    assert.deepEqual(actions, ["first", "second", "advance"]);
    assert.equal(screen.getByRole("progressbar").getAttribute("aria-valuenow"), "3");
  } finally {
    cleanup();
    restoreDom();
  }
});
