import { getVoterStreakQueryKey } from "./useVoterStreak";
import assert from "node:assert/strict";
import test from "node:test";

test("getVoterStreakQueryKey scopes streak cache entries by chain, deployment, and wallet", () => {
  assert.deepEqual(getVoterStreakQueryKey("0xAbC", 8453, "8453:deployment"), [
    "ponder-fallback",
    "voterStreak",
    8453,
    "8453:deployment",
    "0xabc",
  ]);
});
