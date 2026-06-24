import {
  buildVoteCooldownTimestampReadArgs,
  getAdvisoryOnChainCooldownRemainingSeconds,
  getEffectiveVoteCooldownRemainingSeconds,
  getOnChainVoteCooldownRemainingSeconds,
  mergeVoteCooldownRemainingByContentId,
  resolveLatestAdvisoryCommittedSeconds,
  resolveLatestVoteCommittedSeconds,
} from "./onChainVoteCooldown";
import assert from "node:assert/strict";
import test from "node:test";
import { type Address, type Hex } from "viem";

const voter = "0x0000000000000000000000000000000000000001" as Address;
const holder = "0x0000000000000000000000000000000000000002" as Address;
const identityKey = ("0x" + "ab".repeat(32)) as Hex;

test("resolveLatestVoteCommittedSeconds mirrors contract max logic", () => {
  assert.equal(
    resolveLatestVoteCommittedSeconds(
      {
        voterLastVote: 100n,
        identityHolderLastVote: 150n,
        identityLastVote: 120n,
      },
      voter,
      holder,
    ),
    150n,
  );
  assert.equal(
    resolveLatestVoteCommittedSeconds(
      {
        voterLastVote: 100n,
        identityHolderLastVote: 100n,
        identityLastVote: 200n,
      },
      voter,
      voter,
    ),
    200n,
  );
  assert.equal(
    resolveLatestVoteCommittedSeconds(
      {
        voterLastVote: 0n,
        identityHolderLastVote: 0n,
        identityLastVote: 0n,
      },
      voter,
      holder,
    ),
    null,
  );
});

test("getOnChainVoteCooldownRemainingSeconds returns remaining cooldown time", () => {
  const nowSeconds = 100_000;
  const remaining = getOnChainVoteCooldownRemainingSeconds(
    {
      voterLastVote: BigInt(nowSeconds - 60 * 60),
      identityHolderLastVote: 0n,
      identityLastVote: 0n,
    },
    nowSeconds,
    voter,
    holder,
  );
  assert.equal(remaining, 23 * 60 * 60);
});

test("buildVoteCooldownTimestampReadArgs zeroes missing holder and identity", () => {
  assert.deepEqual(buildVoteCooldownTimestampReadArgs({ contentId: 3n, voter }), [
    3n,
    voter,
    "0x0000000000000000000000000000000000000000",
    "0x" + "0".repeat(64),
  ]);
  assert.deepEqual(
    buildVoteCooldownTimestampReadArgs({
      contentId: 3n,
      voter,
      identityHolder: holder,
      identityKey,
    }),
    [3n, voter, holder, identityKey],
  );
});

test("mergeVoteCooldownRemainingByContentId keeps the longest cooldown per content", () => {
  const merged = mergeVoteCooldownRemainingByContentId(new Map([["3", 100]]), 3n, 200);
  assert.equal(merged.get("3"), 200);
});

test("resolveLatestAdvisoryCommittedSeconds mirrors advisory recorder max logic", () => {
  assert.equal(
    resolveLatestAdvisoryCommittedSeconds(
      {
        voterLastAdvisory: 100n,
        identityHolderLastAdvisory: 180n,
        identityLastAdvisory: 150n,
      },
      voter,
      holder,
    ),
    180n,
  );
});

test("getEffectiveVoteCooldownRemainingSeconds uses the longer engine or advisory cooldown", () => {
  assert.equal(getEffectiveVoteCooldownRemainingSeconds(100, 250), 250);
  assert.equal(
    getAdvisoryOnChainCooldownRemainingSeconds(
      {
        voterLastAdvisory: BigInt(100_000 - 30 * 60),
        identityHolderLastAdvisory: 0n,
        identityLastAdvisory: 0n,
      },
      100_000,
      voter,
      holder,
    ),
    23 * 60 * 60 + 30 * 60,
  );
});
