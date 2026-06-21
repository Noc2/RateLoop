import { getVotingStakesQueryKey } from "./useVotingStakes";
import assert from "node:assert/strict";
import test from "node:test";

test("getVotingStakesQueryKey scopes stake cache entries by chain and wallet", () => {
  assert.deepEqual(getVotingStakesQueryKey("0xAbC", 4801, "4801:deployment"), [
    "ponder-fallback",
    "votingStakes",
    4801,
    "4801:deployment",
    "0xabc",
  ]);
});
