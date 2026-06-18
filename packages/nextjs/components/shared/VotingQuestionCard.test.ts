import { getRewardPoolDisplay } from "./VotingQuestionCard";
import assert from "node:assert/strict";
import test from "node:test";

test("reward pool tooltip copy is network-neutral across bounty currencies", () => {
  for (const currency of [undefined, "USDC", "LREP", "MIXED"] as const) {
    const display = getRewardPoolDisplay(1_000_000n, currency);
    assert.doesNotMatch(display.tooltip, /World Chain/i);
    assert.match(display.tooltip, /active network/i);
  }
});
