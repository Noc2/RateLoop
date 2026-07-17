import React from "react";
import assert from "node:assert/strict";
import test from "node:test";
import { installTestDom } from "~~/components/tokenless/testing/dom";

test("image preview focuses its close action and returns focus to the trigger", async () => {
  const restoreDom = installTestDom();
  const { cleanup, render, screen, waitFor } = await import("@testing-library/react");
  const userEvent = (await import("@testing-library/user-event")).default;
  const { QuestionMedia } = await import("./QuestionMedia");

  try {
    render(
      <QuestionMedia
        media={{
          kind: "images",
          items: [{ alt: "Deployment overview", assetId: "asset_01", digest: `sha256:${"a".repeat(64)}` }],
        }}
      />,
    );
    const trigger = screen.getByRole("button", { name: "Open image 1: Deployment overview" });
    await userEvent.setup().click(trigger);
    const dialog = screen.getByRole("dialog", { name: "Question image preview" });
    assert.ok(dialog);
    await waitFor(() => assert.equal(document.activeElement?.textContent, "Close"));
    await userEvent.setup().keyboard("{Escape}");
    await waitFor(() => assert.equal(screen.queryByRole("dialog"), null));
    await waitFor(() => assert.equal(document.activeElement, trigger));
  } finally {
    cleanup();
    restoreDom();
  }
});
