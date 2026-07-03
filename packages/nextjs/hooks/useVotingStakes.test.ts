import { getVotingStakesQueryKey } from "./useVotingStakes";
import assert from "node:assert/strict";
import test from "node:test";

test("getVotingStakesQueryKey scopes stake cache entries by chain and wallet", () => {
  assert.deepEqual(getVotingStakesQueryKey("0xAbC", 8453, "8453:deployment"), [
    "ponder-fallback",
    "votingStakes",
    8453,
    "8453:deployment",
    "0xabc",
  ]);
});
