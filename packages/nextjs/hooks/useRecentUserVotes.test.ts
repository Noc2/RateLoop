import { getRecentUserVotesQueryKey, mergeRecentVotesForConnectedWallet } from "./useRecentUserVotes";
import assert from "node:assert/strict";
import test from "node:test";
import type { PonderVoteItem } from "~~/services/ponder/client";

test("mergeRecentVotesForConnectedWallet keeps delegate votes for the connected wallet", () => {
  const delegateVote = {
    id: "vote-delegate",
    contentId: "1",
    roundId: "2",
    voter: "0xdelegate",
    identityHolder: "0xholder",
    roundState: 1,
  } as PonderVoteItem;
  const selfVote = {
    id: "vote-self",
    contentId: "3",
    roundId: "4",
    voter: "0xholder",
    identityHolder: "0xholder",
    roundState: 1,
  } as PonderVoteItem;

  const merged = mergeRecentVotesForConnectedWallet([[delegateVote], [selfVote]], "0xholder");

  assert.equal(merged.length, 2);
  assert.deepEqual(
    merged.map(vote => vote.id),
    ["vote-delegate", "vote-self"],
  );
});

test("getRecentUserVotesQueryKey scopes cache entries by chain", () => {
  assert.deepEqual(getRecentUserVotesQueryKey("0xAbC", 8453, "8453:deployment"), [
    "ponder-fallback",
    "recentUserVotes",
    8453,
    "8453:deployment",
    "0xabc",
  ]);
});
