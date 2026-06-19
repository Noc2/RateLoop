import { cycleVoteFeedForVisible } from "./wait-helpers";
import assert from "node:assert/strict";
import test from "node:test";

test("cycleVoteFeedForVisible stops when the feed is explicitly empty", async () => {
  let keyboardPressed = false;
  const target = {
    first: () => ({
      waitFor: async () => {
        throw new Error("target not visible");
      },
    }),
  };
  const emptyStateLocator = {
    first: () => ({
      isVisible: async () => true,
    }),
  };
  const activeCardLocator = {
    first: () => ({
      isVisible: async () => true,
      getAttribute: async () => "0",
      focus: async () => undefined,
    }),
  };
  const page = {
    getByText: () => emptyStateLocator,
    keyboard: {
      press: async () => {
        keyboardPressed = true;
      },
    },
    locator: () => activeCardLocator,
    waitForFunction: async () => undefined,
  };

  assert.equal(await cycleVoteFeedForVisible(page as never, target as never), false);
  assert.equal(keyboardPressed, false);
});
