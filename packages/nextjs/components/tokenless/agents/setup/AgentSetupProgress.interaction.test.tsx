import React from "react";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { installTestDom } from "~~/components/tokenless/testing/dom";

const progressSource = readFileSync(new URL("./AgentSetupProgress.tsx", import.meta.url), "utf8");

test("setup progress reuses the canonical homepage spectrum without local colors", () => {
  for (const token of [
    "--rateloop-blue",
    "--rateloop-green",
    "--rateloop-yellow",
    "--rateloop-pink",
    "--rateloop-spectrum-gradient",
  ]) {
    assert.match(progressSource, new RegExp(token));
  }
  assert.doesNotMatch(progressSource, /#[\da-f]{3,8}/iu);
});

test("completed setup steps navigate with a real click", async () => {
  const restoreDom = installTestDom();
  const { cleanup, render, screen } = await import("@testing-library/react");
  const userEvent = (await import("@testing-library/user-event")).default;
  const { AgentSetupProgress } = await import("./AgentSetupProgress");
  const navigated: string[] = [];

  try {
    const { container } = render(
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

    const user = userEvent.setup();
    const completedStep = screen.getByRole("button", {
      name: name => name.includes("Workspace") && name.includes("Complete"),
    });
    assert.equal(screen.getByRole("navigation", { name: "Workspace setup progress" }).tagName, "NAV");
    assert.equal(container.querySelectorAll("ol > li").length, 5);
    assert.equal(container.querySelectorAll('[aria-current="step"]').length, 1);
    assert.equal(screen.getAllByRole("button").length, 1);
    completedStep.focus();
    await user.keyboard("{Enter}");
    completedStep.focus();
    await user.keyboard(" ");
    assert.deepEqual(navigated, ["workspace", "workspace"]);
    assert.equal(screen.getByText("Step 2 of 5").textContent, "Step 2 of 5");
    cleanup();
    const { container: readOnlyContainer } = render(
      <AgentSetupProgress
        currentStep="workspace"
        stages={[
          { key: "workspace", status: "current" },
          { key: "connect", status: "not_started" },
          { key: "agent", status: "not_started" },
          { key: "reviews", status: "not_started" },
          { key: "people", status: "not_started" },
        ]}
        onNavigate={() => undefined}
        allowNavigation={false}
      />,
    );

    assert.equal(screen.queryAllByRole("button").length, 0);
    assert.equal(readOnlyContainer.querySelectorAll('[aria-current="step"]').length, 1);
    assert.equal(screen.getByText("Current").className, "sr-only");
    assert.equal(screen.getAllByText("Not started").length, 4);
  } finally {
    cleanup();
    restoreDom();
  }
});
