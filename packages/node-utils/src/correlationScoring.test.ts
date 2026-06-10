import assert from "node:assert/strict";
import test from "node:test";
import { concat, keccak256, type Address, type Hex } from "viem";
import {
  BPS_DENOMINATOR,
  PAYOUT_DOMAIN_LAUNCH_CREDIT,
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
    verifiedHuman: false,
    historicalVoteCount: 5,
    features: [],
    ...overrides,
  };
}

function scoreQuestionRound(args: {
  votes: readonly CorrelationVoteInput[];
  trailingBaseRateUpBps?: number | null;
  domain?: number;
  params?: Partial<ReturnType<typeof defaultCorrelationScoringParams>>;
}) {
  return scoreRoundPayoutWeights({
    chainId: CHAIN_ID,
    oracleAddress: ORACLE,
    domain: args.domain ?? PAYOUT_DOMAIN_QUESTION_REWARD,
    rewardPoolId: 7n,
    contentId: 42n,
    roundId: 3n,
    votes: args.votes,
    trailingBaseRateUpBps: args.trailingBaseRateUpBps,
    params: args.params,
  });
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
    vote({ account: address("a1"), identityKey: hex("a1"), commitKey: hex("11"), features: ["ip:shared"], isUp: true, revealWeight: 10_000n }),
    vote({ account: address("b2"), identityKey: hex("b2"), commitKey: hex("22"), features: ["ip:shared", "device:shared"], isUp: true, revealWeight: 2_500n }),
    vote({ account: address("c3"), identityKey: hex("c3"), commitKey: hex("33"), features: ["device:shared"], isUp: false, revealWeight: 10_000n }),
  ];

  const first = scoreRoundPayoutWeights({
    chainId: CHAIN_ID,
    oracleAddress: ORACLE,
    domain: PAYOUT_DOMAIN_QUESTION_REWARD,
    rewardPoolId: 7n,
    contentId: 42n,
    roundId: 3n,
    votes,
    trailingBaseRateUpBps: 3_000,
  });
  const second = scoreRoundPayoutWeights({
    chainId: CHAIN_ID,
    oracleAddress: ORACLE,
    domain: PAYOUT_DOMAIN_QUESTION_REWARD,
    rewardPoolId: 7n,
    contentId: 42n,
    roundId: 3n,
    votes: [...votes].reverse(),
    trailingBaseRateUpBps: 3_000,
  });

  assert.equal(first.rawEligibleVoters, 3);
  assert.equal(first.weightRoot, second.weightRoot);
  assert.equal(first.reasonRoot, second.reasonRoot);
  assert.equal(first.totalClaimWeight, second.totalClaimWeight);
  assert.equal(new Set(first.leaves.map((leaf) => leaf.clusterId)).size, 1);

  const byAccount = (result: typeof first, account: Address) =>
    result.leaves.find((leaf) => leaf.account === account)!;
  for (const account of [address("a1"), address("b2"), address("c3")]) {
    assert.equal(byAccount(first, account).surpriseBps, byAccount(second, account).surpriseBps);
    assert.equal(byAccount(first, account).baseWeight, byAccount(second, account).baseWeight);
    assert.equal(byAccount(first, account).leaf, byAccount(second, account).leaf);
  }
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
  // Without surprise inputs each vote is neutral, so baseWeight is the flat
  // 10_000 and effectiveWeight equals independenceBps.
  assert.deepEqual(
    result.leaves.map((leaf) => leaf.baseWeight),
    [10_000n, 10_000n, 10_000n],
  );
  assert.deepEqual(
    result.leaves.map((leaf) => leaf.effectiveWeight),
    [2_500n, 5_773n, 6_000n],
  );
  assert.equal(result.effectiveParticipantUnits, 14_273);
  assert.equal(result.totalClaimWeight, 14_273n);
});

function surpriseVote(
  byte: string,
  isUp: boolean | null,
  revealWeight: bigint | null,
): CorrelationVoteInput {
  return vote({
    account: address(byte),
    identityKey: hex(byte),
    commitKey: hex(byte),
    verifiedHuman: true,
    isUp,
    revealWeight,
  });
}

test("uniform rounds produce equal baseWeights and flat shares regardless of base rate", () => {
  const votes = [
    surpriseVote("a1", true, 10_000n),
    surpriseVote("b2", true, 10_000n),
    surpriseVote("c3", true, 10_000n),
  ];

  for (const trailingBaseRateUpBps of [2_000, 5_000, 9_500]) {
    const result = scoreQuestionRound({ votes, trailingBaseRateUpBps });
    const baseWeights = result.leaves.map((leaf) => leaf.baseWeight);
    assert.equal(new Set(baseWeights.map(String)).size, 1);
    const surprises = result.leaves.map((leaf) => leaf.surpriseBps);
    assert.equal(new Set(surprises).size, 1);
    // Flat shares: every leaf carries an identical effectiveWeight, so each
    // claim is exactly totalClaimWeight / 3.
    assert.equal(result.totalClaimWeight, baseWeights[0]! * 3n);
  }
});

test("split rounds reward the side that beats the trailing base rate", () => {
  const votes = [
    surpriseVote("a1", true, 10_000n),
    surpriseVote("b2", true, 10_000n),
    surpriseVote("c3", false, 10_000n),
  ];

  const result = scoreQuestionRound({
    votes,
    trailingBaseRateUpBps: 2_000,
    params: { surpriseMinReveals: 3 },
  });

  // Majority (UP): agreement = 10_000 * 10_000 / 20_000 = 5_000;
  // surprise = 5_000 * 10_000 / 2_000 = 25_000; base = 5_000 + 12_500.
  assert.deepEqual(
    result.leaves.map((leaf) => leaf.surpriseBps),
    [25_000, 25_000, 10_000],
  );
  assert.deepEqual(
    result.leaves.map((leaf) => leaf.baseWeight),
    [17_500n, 17_500n, 10_000n],
  );
  // Minority is floored at the neutral multiplier, never punished below flat.
  assert.equal(result.totalClaimWeight, 45_000n);
});

test("manufactured surprise clamps at surpriseCapBps", () => {
  const votes = [
    surpriseVote("a1", false, 10_000n),
    surpriseVote("b2", false, 10_000n),
    surpriseVote("c3", true, 10_000n),
  ];

  // baseRate(DOWN) = 10_000 - 9_500 = 500; raw surprise would be
  // 5_000 * 10_000 / 500 = 100_000, clamped to 30_000.
  const result = scoreQuestionRound({
    votes,
    trailingBaseRateUpBps: 9_500,
    params: { surpriseMinReveals: 3 },
  });

  assert.deepEqual(
    result.leaves.map((leaf) => leaf.surpriseBps),
    [30_000, 30_000, 10_000],
  );
  assert.deepEqual(
    result.leaves.map((leaf) => leaf.baseWeight),
    [20_000n, 20_000n, 10_000n],
  );
});

test("missing surprise inputs fall back to the neutral multiplier", () => {
  const fullVotes = [
    surpriseVote("a1", true, 10_000n),
    surpriseVote("b2", true, 10_000n),
    surpriseVote("c3", null, 10_000n),
    surpriseVote("d4", false, null),
  ];

  const result = scoreQuestionRound({
    votes: fullVotes,
    trailingBaseRateUpBps: 2_000,
    params: { surpriseMinReveals: 2 },
  });
  // Votes without isUp or revealWeight are neutral and excluded from the
  // agreement pools; the remaining unanimous UP pair caps out.
  assert.deepEqual(
    result.leaves.map((leaf) => leaf.surpriseBps),
    [30_000, 30_000, 10_000, 10_000],
  );

  const soleVoter = scoreQuestionRound({
    votes: [surpriseVote("a1", true, 10_000n)],
    trailingBaseRateUpBps: 2_000,
  });
  assert.deepEqual(soleVoter.leaves.map((leaf) => leaf.surpriseBps), [10_000]);
  assert.deepEqual(soleVoter.leaves.map((leaf) => leaf.baseWeight), [10_000n]);

  const noBaseRate = scoreQuestionRound({
    votes: [
      surpriseVote("a1", true, 10_000n),
      surpriseVote("b2", true, 10_000n),
      surpriseVote("c3", false, 10_000n),
    ],
  });
  assert.deepEqual(
    noBaseRate.leaves.map((leaf) => leaf.surpriseBps),
    [10_000, 10_000, 10_000],
  );
  assert.deepEqual(
    noBaseRate.leaves.map((leaf) => leaf.baseWeight),
    [10_000n, 10_000n, 10_000n],
  );
});

test("surprise bonuses stay neutral below the minimum reveal floor", () => {
  const votes = [
    surpriseVote("a1", true, 10_000n),
    surpriseVote("b2", true, 10_000n),
    surpriseVote("c3", false, 10_000n),
    surpriseVote("d4", true, 10_000n),
    surpriseVote("e5", true, 10_000n),
    surpriseVote("f6", true, 10_000n),
    surpriseVote("a7", false, 10_000n),
  ];

  const result = scoreQuestionRound({ votes, trailingBaseRateUpBps: 2_000 });

  assert.deepEqual(
    result.leaves.map((leaf) => leaf.surpriseBps),
    Array.from({ length: votes.length }, () => 10_000),
  );
  assert.deepEqual(
    result.leaves.map((leaf) => leaf.baseWeight),
    Array.from({ length: votes.length }, () => 10_000n),
  );
});

test("correlationParameterHash commits to the surprise parameters", () => {
  const params = defaultCorrelationScoringParams();
  assert.equal(params.scorerVersion, "rateloop-correlation-epoch-v2");
  assert.equal(
    correlationParameterHash(params),
    "0xd70bff6a96793230e7bf1384cf7768aeec8387785672f4d5a34adc3bb5f1c2c8",
  );

  const defaultHash = correlationParameterHash(params);
  assert.notEqual(
    correlationParameterHash({ ...params, surpriseCapBps: 25_000 }),
    defaultHash,
  );
  assert.notEqual(
    correlationParameterHash({ ...params, baseWeightFloorBps: 4_000 }),
    defaultHash,
  );
  assert.notEqual(
    correlationParameterHash({ ...params, baseRateWindowRounds: 50 }),
    defaultHash,
  );
  assert.notEqual(
    correlationParameterHash({ ...params, baseRateMinBps: 1_000 }),
    defaultHash,
  );
  assert.notEqual(
    correlationParameterHash({ ...params, baseRateMaxBps: 9_000 }),
    defaultHash,
  );
  assert.notEqual(
    correlationParameterHash({ ...params, baseWeightBonusBps: 6_000 }),
    defaultHash,
  );
  assert.notEqual(
    correlationParameterHash({ ...params, surpriseMinReveals: 3 }),
    defaultHash,
  );
});

test("effectiveWeight never exceeds baseWeight", () => {
  const result = scoreQuestionRound({
    votes: [
      vote({
        account: address("a1"),
        identityKey: hex("a1"),
        commitKey: hex("11"),
        historicalVoteCount: 0,
        features: ["cluster"],
        isUp: true,
        revealWeight: 10_000n,
      }),
      vote({
        account: address("b2"),
        identityKey: hex("b2"),
        commitKey: hex("22"),
        historicalVoteCount: 3,
        features: ["cluster"],
        isUp: true,
        revealWeight: 10_000n,
      }),
      vote({
        account: address("c3"),
        identityKey: hex("c3"),
        commitKey: hex("33"),
        verifiedHuman: true,
        isUp: false,
        revealWeight: 10_000n,
      }),
    ],
    trailingBaseRateUpBps: 2_000,
  });

  for (const leaf of result.leaves) {
    assert.ok(leaf.effectiveWeight <= leaf.baseWeight);
    assert.ok(leaf.independenceBps <= 10_000);
    assert.ok(leaf.baseWeight >= 10_000n && leaf.baseWeight <= 20_000n);
  }
});

test("launch-credit domain keeps flat baseWeights and no surprise", () => {
  const result = scoreQuestionRound({
    domain: PAYOUT_DOMAIN_LAUNCH_CREDIT,
    votes: [
      surpriseVote("a1", true, 10_000n),
      surpriseVote("b2", true, 10_000n),
      surpriseVote("c3", false, 10_000n),
    ],
    trailingBaseRateUpBps: 2_000,
  });

  assert.deepEqual(
    result.leaves.map((leaf) => leaf.surpriseBps),
    [10_000, 10_000, 10_000],
  );
  assert.deepEqual(
    result.leaves.map((leaf) => leaf.baseWeight),
    [10_000n, 10_000n, 10_000n],
  );
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
    "0xd70bff6a96793230e7bf1384cf7768aeec8387785672f4d5a34adc3bb5f1c2c8",
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

  for (const params of [
    { surpriseCapBps: 9_999 },
    { baseWeightFloorBps: -1 },
    { baseWeightBonusBps: -1 },
    { surpriseMinReveals: 0 },
    { baseRateWindowRounds: 0 },
    { baseRateMinBps: 0 },
    { baseRateMaxBps: 10_000 },
    { baseRateMinBps: 6_000, baseRateMaxBps: 5_000 },
  ]) {
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
          params,
        }),
      /Invalid correlation scoring parameters/,
    );
  }

  assert.equal(BPS_DENOMINATOR, 10_000n);
});
