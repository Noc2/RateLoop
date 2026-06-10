import assert from "node:assert/strict";
import test from "node:test";
import { concat, keccak256, type Address, type Hex } from "viem";
import {
  BPS_DENOMINATOR,
  PAYOUT_DOMAIN_QUESTION_REWARD,
  correlationParameterHash,
  defaultCorrelationScoringParams,
  merkleProof,
  merkleRoot,
  payoutWeightLeaf,
  scoreRoundPayoutWeights,
  type CorrelationVoteInput,
} from "./correlationScoring";

const CHAIN_ID = 31337n;
const ORACLE = "0x1111111111111111111111111111111111111111" as Address;

function hex(byte: string): Hex {
  return `0x${byte.repeat(32)}` as Hex;
}

function address(byte: string): Address {
  return `0x${byte.repeat(20)}` as Address;
}

function vote(overrides: Partial<CorrelationVoteInput> = {}): CorrelationVoteInput {
  const index = overrides.account?.slice(2, 4) ?? "aa";
  return {
    account: address(index),
    identityKey: hex(index),
    commitKey: hex(index === "aa" ? "01" : index),
    baseWeight: 1_000n,
    verifiedHuman: false,
    historicalVoteCount: 5,
    features: [],
    ...overrides,
  };
}

function hashSortedPair(left: Hex, right: Hex): Hex {
  return left.toLowerCase() <= right.toLowerCase()
    ? keccak256(concat([left, right]))
    : keccak256(concat([right, left]));
}

function verifyProof(root: Hex, leaf: Hex, proof: readonly Hex[]) {
  let cursor = leaf;
  for (const sibling of proof) {
    cursor = hashSortedPair(cursor, sibling);
  }
  return cursor.toLowerCase() === root.toLowerCase();
}

test("scoreRoundPayoutWeights is deterministic and stable across input order", () => {
  const votes = [
    vote({ account: address("a1"), identityKey: hex("a1"), commitKey: hex("11"), features: ["ip:shared"] }),
    vote({ account: address("b2"), identityKey: hex("b2"), commitKey: hex("22"), features: ["ip:shared", "device:shared"] }),
    vote({ account: address("c3"), identityKey: hex("c3"), commitKey: hex("33"), features: ["device:shared"] }),
  ];

  const first = scoreRoundPayoutWeights({
    chainId: CHAIN_ID,
    oracleAddress: ORACLE,
    domain: PAYOUT_DOMAIN_QUESTION_REWARD,
    rewardPoolId: 7n,
    contentId: 42n,
    roundId: 3n,
    votes,
  });
  const second = scoreRoundPayoutWeights({
    chainId: CHAIN_ID,
    oracleAddress: ORACLE,
    domain: PAYOUT_DOMAIN_QUESTION_REWARD,
    rewardPoolId: 7n,
    contentId: 42n,
    roundId: 3n,
    votes: [...votes].reverse(),
  });

  assert.equal(first.rawEligibleVoters, 3);
  assert.equal(first.weightRoot, second.weightRoot);
  assert.equal(first.reasonRoot, second.reasonRoot);
  assert.equal(first.totalClaimWeight, second.totalClaimWeight);
  assert.equal(new Set(first.leaves.map((leaf) => leaf.clusterId)).size, 1);
});

test("scoreRoundPayoutWeights applies cluster, maturity, and verified floors", () => {
  const result = scoreRoundPayoutWeights({
    chainId: CHAIN_ID,
    oracleAddress: ORACLE,
    domain: PAYOUT_DOMAIN_QUESTION_REWARD,
    rewardPoolId: 7n,
    contentId: 42n,
    roundId: 3n,
    votes: [
      vote({
        account: address("01"),
        identityKey: hex("01"),
        commitKey: hex("11"),
        historicalVoteCount: 0,
        features: ["cluster"],
      }),
      vote({
        account: address("02"),
        identityKey: hex("02"),
        commitKey: hex("22"),
        historicalVoteCount: 3,
        features: ["cluster"],
      }),
      vote({
        account: address("03"),
        identityKey: hex("03"),
        commitKey: hex("33"),
        verifiedHuman: true,
        historicalVoteCount: 0,
        features: ["cluster"],
      }),
    ],
  });

  assert.deepEqual(
    result.leaves.map((leaf) => leaf.independenceBps),
    [2_500, 5_773, 6_000],
  );
  assert.deepEqual(
    result.leaves.map((leaf) => leaf.effectiveWeight),
    [250n, 577n, 600n],
  );
  assert.equal(result.effectiveParticipantUnits, 14_273);
  assert.equal(result.totalClaimWeight, 1_427n);
});

test("payoutWeightLeaf commits to every payout field", () => {
  const payout = {
    domain: PAYOUT_DOMAIN_QUESTION_REWARD,
    rewardPoolId: 7n,
    contentId: 42n,
    roundId: 3n,
    commitKey: hex("11"),
    identityKey: hex("22"),
    account: address("33"),
    baseWeight: 1_000n,
    independenceBps: 2_500,
    effectiveWeight: 250n,
    reasonHash: hex("44"),
  };

  const leaf = payoutWeightLeaf(CHAIN_ID, ORACLE, payout);
  const changed = payoutWeightLeaf(CHAIN_ID, ORACLE, {
    ...payout,
    effectiveWeight: 251n,
  });

  assert.match(leaf, /^0x[0-9a-f]{64}$/i);
  assert.notEqual(leaf, changed);
});

test("merkleRoot and merkleProof handle odd leaf counts", () => {
  const leaves = [hex("11"), hex("22"), hex("33")];
  const root = merkleRoot(leaves);

  for (const leaf of leaves) {
    assert.equal(verifyProof(root, leaf, merkleProof(leaves, leaf)), true);
  }

  assert.throws(() => merkleProof(leaves, hex("44")), /Leaf not found/);
});

test("correlationParameterHash pins spec versions and canonical params", () => {
  const params = defaultCorrelationScoringParams();

  assert.equal(
    correlationParameterHash(params),
    "0x08ecb089bf8ef590cf078ad9be9e4b312c79cf9b6bf59c8859317c564e718acb",
  );
  assert.notEqual(
    correlationParameterHash({
      ...params,
      eligibilitySpecVersion: "rateloop-correlation-eligibility-v2",
    }),
    correlationParameterHash(params),
  );
});

test("scoreRoundPayoutWeights rejects invalid parameters", () => {
  assert.throws(
    () =>
      scoreRoundPayoutWeights({
        chainId: CHAIN_ID,
        oracleAddress: ORACLE,
        domain: PAYOUT_DOMAIN_QUESTION_REWARD,
        rewardPoolId: 7n,
        contentId: 42n,
        roundId: 3n,
        votes: [],
        params: { minUnverifiedMaturityVotes: 0 },
      }),
    /Invalid correlation scoring parameters/,
  );

  assert.equal(BPS_DENOMINATOR, 10_000n);
});
