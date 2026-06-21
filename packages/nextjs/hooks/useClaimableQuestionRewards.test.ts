import {
  buildClaimableQuestionRewardCandidateVoters,
  getClaimableQuestionRewardsQueryKey,
  getQuestionRewardAsset,
} from "./useClaimableQuestionRewards";
import assert from "node:assert/strict";
import test from "node:test";

test("buildClaimableQuestionRewardCandidateVoters includes linked delegate identities and dedupes them", () => {
  assert.deepEqual(
    buildClaimableQuestionRewardCandidateVoters({
      address: "0xABCDEF0000000000000000000000000000000001",
      delegateTo: "0xabcdef0000000000000000000000000000000002",
      delegateOf: "0xABCDEF0000000000000000000000000000000001",
    }),
    ["0xabcdef0000000000000000000000000000000001", "0xabcdef0000000000000000000000000000000002"],
  );
});

test("buildClaimableQuestionRewardCandidateVoters filters invalid and zero linked identities", () => {
  assert.deepEqual(
    buildClaimableQuestionRewardCandidateVoters({
      address: "0xABCDEF0000000000000000000000000000000001",
      delegateTo: "0x0000000000000000000000000000000000000000",
      delegateOf: "not-an-address",
    }),
    ["0xabcdef0000000000000000000000000000000001"],
  );
});

test("getClaimableQuestionRewardsQueryKey keeps linked claim discovery scoped by the full identity set", () => {
  assert.deepEqual(
    getClaimableQuestionRewardsQueryKey(
      ["0xabcdef0000000000000000000000000000000001", "0xabcdef0000000000000000000000000000000002"],
      480,
    ),
    [
      "claimableQuestionRewards",
      "0xabcdef0000000000000000000000000000000001,0xabcdef0000000000000000000000000000000002",
      480,
      null,
    ],
  );
});

test("getClaimableQuestionRewardsQueryKey scopes linked claim discovery by deployment key", () => {
  assert.deepEqual(
    getClaimableQuestionRewardsQueryKey(["0xabcdef0000000000000000000000000000000001"], 8453, "base-mainnet"),
    ["claimableQuestionRewards", "0xabcdef0000000000000000000000000000000001", 8453, "base-mainnet"],
  );
});

test("getQuestionRewardAsset resolves LREP from either the currency string or the asset id", () => {
  assert.equal(getQuestionRewardAsset({ currency: "LREP", asset: 0 }), "LREP");
  assert.equal(getQuestionRewardAsset({ currency: null, asset: 0 }), "LREP");
  assert.equal(getQuestionRewardAsset({ currency: "LREP", asset: null }), "LREP");
});

test("getQuestionRewardAsset falls back to USDC for non-LREP candidates", () => {
  assert.equal(getQuestionRewardAsset({ currency: "USDC", asset: 1 }), "USDC");
  assert.equal(getQuestionRewardAsset({ currency: null, asset: 1 }), "USDC");
  assert.equal(getQuestionRewardAsset({ currency: null, asset: null }), "USDC");
});
