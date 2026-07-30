import React from "react";
import assert from "node:assert/strict";
import test from "node:test";
import { installTestDom } from "~~/components/tokenless/testing/dom";

test("guided setup is the only connection surface until it is complete", async () => {
  const restoreDom = installTestDom();
  const { cleanup, render, within } = await import("@testing-library/react");
  const { AfterGuidedAgentSetup } = await import("./AgentWorkspacePanels");

  try {
    const view = render(
      <AfterGuidedAgentSetup setupIncomplete={true}>
        <div>Standalone connection panel</div>
      </AfterGuidedAgentSetup>,
    );
    const screen = within(document.body);
    assert.equal(screen.queryByText("Standalone connection panel"), null);

    view.rerender(
      <AfterGuidedAgentSetup setupIncomplete={false}>
        <div>Standalone connection panel</div>
      </AfterGuidedAgentSetup>,
    );
    assert.ok(screen.getByText("Standalone connection panel"));
  } finally {
    cleanup();
    restoreDom();
  }
});
