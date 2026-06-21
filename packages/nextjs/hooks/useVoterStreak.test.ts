import { getVoterStreakQueryKey } from "./useVoterStreak";
import assert from "node:assert/strict";
import test from "node:test";

test("getVoterStreakQueryKey scopes streak cache entries by chain, deployment, and wallet", () => {
  assert.deepEqual(getVoterStreakQueryKey("0xAbC", 4801, "4801:deployment"), [
    "ponder-fallback",
    "voterStreak",
    4801,
    "4801:deployment",
    "0xabc",
  ]);
});
