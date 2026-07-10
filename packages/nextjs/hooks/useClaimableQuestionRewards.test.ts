import {
  buildClaimableQuestionRewardCandidateVoters,
  getClaimableQuestionRewardsQueryKey,
  getQuestionBundleRewardClaimCandidateKey,
  getQuestionRewardAsset,
  resolveQuestionRewardClaimant,
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
      8453,
    ),
    [
      "claimableQuestionRewards",
      "0xabcdef0000000000000000000000000000000001,0xabcdef0000000000000000000000000000000002",
      8453,
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

test("getQuestionBundleRewardClaimCandidateKey keeps identity-scoped bundle rows distinct", () => {
  assert.notEqual(
    getQuestionBundleRewardClaimCandidateKey({
      bundleId: "1",
      roundSetIndex: 0,
      identityKey: "0x1111000000000000000000000000000000000000000000000000000000000000",
      identityHolder: "0xABCDEF0000000000000000000000000000000001",
      payoutWeight: null,
    }),
    getQuestionBundleRewardClaimCandidateKey({
      bundleId: "1",
      roundSetIndex: 0,
      identityKey: "0x2222000000000000000000000000000000000000000000000000000000000000",
      identityHolder: "0xabcdef0000000000000000000000000000000002",
      payoutWeight: null,
    }),
  );
});

test("getQuestionBundleRewardClaimCandidateKey falls back to payout proof identity fields", () => {
  assert.equal(
    getQuestionBundleRewardClaimCandidateKey({
      bundleId: "2",
      roundSetIndex: 1,
      identityKey: null,
      identityHolder: null,
      payoutWeight: {
        domain: 2,
        rewardPoolId: "2",
        contentId: "2",
        roundId: "2",
        commitKey: "0x3333000000000000000000000000000000000000000000000000000000000000",
        identityKey: "0x4444000000000000000000000000000000000000000000000000000000000000",
        account: "0xABCDEF0000000000000000000000000000000003",
        baseWeight: "10",
        independenceBps: 10000,
        effectiveWeight: "10",
        reasonHash: "0x5555000000000000000000000000000000000000000000000000000000000000",
      },
    }),
    "2-1-0x4444000000000000000000000000000000000000000000000000000000000000-0xabcdef0000000000000000000000000000000003",
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

test("resolveQuestionRewardClaimant prefers payout proof and linked identity claimants", () => {
  const connectedAddress = "0xabcdef0000000000000000000000000000000001";
  const candidateVoter = "0xabcdef0000000000000000000000000000000002";
  const identityHolder = "0xabcdef0000000000000000000000000000000003";
  const payoutAccount = "0xabcdef0000000000000000000000000000000004";

  assert.equal(
    resolveQuestionRewardClaimant({
      candidateVoter,
      connectedAddress,
      identityHolder,
      payoutWeight: { account: payoutAccount },
    }),
    payoutAccount.toLowerCase(),
  );
  assert.equal(
    resolveQuestionRewardClaimant({
      candidateVoter,
      connectedAddress,
      identityHolder,
    }),
    identityHolder.toLowerCase(),
  );
  assert.equal(
    resolveQuestionRewardClaimant({
      candidateVoter,
      connectedAddress,
    }),
    candidateVoter.toLowerCase(),
  );
  assert.equal(
    resolveQuestionRewardClaimant({
      connectedAddress,
    }),
    connectedAddress.toLowerCase(),
  );
});
