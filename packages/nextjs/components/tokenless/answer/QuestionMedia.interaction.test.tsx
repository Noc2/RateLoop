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

test("approval state stays blocked until every image is visible and fails closed on preview errors", async () => {
  const restoreDom = installTestDom();
  const { cleanup, fireEvent, render } = await import("@testing-library/react");
  const { QuestionMedia } = await import("./QuestionMedia");
  const states: string[] = [];

  try {
    const view = render(
      <QuestionMedia
        media={{
          kind: "images",
          items: [
            { alt: "First image", assetId: "asset_01", digest: `sha256:${"a".repeat(64)}` },
            { alt: "Second image", assetId: "asset_02", digest: `sha256:${"b".repeat(64)}` },
          ],
        }}
        onReviewStateChange={state => states.push(state.status)}
      />,
    );

    const images = view.getAllByRole("img");
    assert.equal(states.at(-1), "pending");
    fireEvent.load(images[0]!);
    assert.equal(states.at(-1), "pending");
    fireEvent.load(images[1]!);
    assert.equal(states.at(-1), "ready");
    fireEvent.error(images[0]!);
    assert.equal(states.at(-1), "error");
  } finally {
    cleanup();
    restoreDom();
  }
});

test("YouTube approval stays blocked until the owner loads the exact video", async () => {
  const restoreDom = installTestDom();
  const { cleanup, fireEvent, render } = await import("@testing-library/react");
  const userEvent = (await import("@testing-library/user-event")).default;
  const { QuestionMedia } = await import("./QuestionMedia");
  const states: string[] = [];

  try {
    const view = render(
      <QuestionMedia
        media={{ kind: "youtube", videoId: "dQw4w9WgXcQ" }}
        onReviewStateChange={state => states.push(state.status)}
      />,
    );

    assert.equal(states.at(-1), "pending");
    assert.match(view.getByText("Video dQw4w9WgXcQ").textContent ?? "", /dQw4w9WgXcQ/);
    await userEvent.setup().click(view.getByRole("button", { name: "Load and play YouTube video" }));
    const frame = view.getByTitle("YouTube context for this question");
    assert.equal(states.at(-1), "pending");
    fireEvent.load(frame);
    assert.equal(states.at(-1), "ready");
  } finally {
    cleanup();
    restoreDom();
  }
});
