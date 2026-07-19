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

test("only the explicitly active shell handles shortcuts and links keep Enter activation", async () => {
  const restoreDom = installTestDom();
  const { cleanup, render } = await import("@testing-library/react");
  const userEvent = (await import("@testing-library/user-event")).default;
  const { ReviewerShell } = await import("./ReviewerShell");
  const actions: string[] = [];

  try {
    const view = render(
      <>
        <ReviewerShell
          advanceDisabled={false}
          advanceLabel="Advance first"
          caseIndex={0}
          laneHeader={<p>First</p>}
          onAdvance={() => actions.push("first-advance")}
          onSelectFirst={() => actions.push("first-select")}
          onSelectSecond={() => undefined}
          totalCases={1}
        >
          <a href="#artifact">Open artifact</a>
        </ReviewerShell>
        <ReviewerShell
          advanceDisabled={false}
          advanceLabel="Advance second"
          caseIndex={0}
          laneHeader={<p>Second</p>}
          onAdvance={() => actions.push("second-advance")}
          onSelectFirst={() => actions.push("second-select")}
          onSelectSecond={() => undefined}
          shortcutsEnabled={false}
          totalCases={1}
        >
          <p>Second case</p>
        </ReviewerShell>
      </>,
    );

    const user = userEvent.setup({ document });
    await user.keyboard("1");
    assert.deepEqual(actions, ["first-select"]);

    const artifact = view.getByRole("link", { name: "Open artifact" });
    artifact.focus();
    const event = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "Enter" });
    artifact.dispatchEvent(event);
    assert.equal(event.defaultPrevented, false);
    assert.deepEqual(actions, ["first-select"]);
  } finally {
    cleanup();
    restoreDom();
  }
});
