import { getRecentUserVotesQueryKey } from "./useRecentUserVotes";
import assert from "node:assert/strict";
import test from "node:test";

test("getRecentUserVotesQueryKey scopes cache entries by chain", () => {
  assert.deepEqual(getRecentUserVotesQueryKey("0xAbC", 4801), ["ponder-fallback", "recentUserVotes", 4801, "0xabc"]);
});
