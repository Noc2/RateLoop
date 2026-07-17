import React from "react";
import assert from "node:assert/strict";
import test from "node:test";
import { installTestDom } from "~~/components/tokenless/testing/dom";

test("completed setup steps navigate with a real click", async () => {
  const restoreDom = installTestDom();
  const { cleanup, render, screen } = await import("@testing-library/react");
  const userEvent = (await import("@testing-library/user-event")).default;
  const { AgentSetupProgress } = await import("./AgentSetupProgress");
  const navigated: string[] = [];

  try {
    render(
      <AgentSetupProgress
        currentStep="connect"
        stages={[
          { key: "workspace", status: "complete" },
          { key: "connect", status: "current" },
          { key: "agent", status: "not_started" },
          { key: "reviews", status: "not_started" },
          { key: "people", status: "not_started" },
        ]}
        onNavigate={step => navigated.push(step)}
      />,
    );

    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: name => name.includes("Workspace") && name.includes("Complete") }));
    assert.deepEqual(navigated, ["workspace"]);
    assert.equal(screen.getByText("Step 2 of 5").textContent, "Step 2 of 5");
  } finally {
    cleanup();
    restoreDom();
  }
});
