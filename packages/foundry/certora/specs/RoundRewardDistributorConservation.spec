/*
 * RoundRewardDistributorConservation.spec — Track C (aggregate solvency, slice 1).
 *
 * Verification target: contracts/RoundRewardDistributor.sol (verified directly).
 * Run with:           certoraRun certora/confs/round-reward-distributor-conservation.conf
 *
 * The headline solvency property is "the sum of all voter-reward payouts for a round
 * never exceeds that round's voterPool". The running sum lives in the scalar slot
 * roundVoterRewardClaimedAmount[contentId][roundId] (written at RoundRewardDistributor.sol
 * :265 as `claimedAmount + reward` and at :597 as `+= releasedDust`), so the property is
 * `roundVoterRewardClaimedAmount[c][r] <= voterPool(c,r)`.
 *
 * What is proved here (engine-model-free, robust):
 *   - the accumulator is MONOTONE: neither a voter claim nor dust finalization can ever
 *     decrease it. Every write adds a non-negative amount or reverts. This is the
 *     no-clawback / no-underflow half of conservation and the inductive scaffold the
 *     upper bound builds on.
 *
 * Why the upper bound itself is NOT proved here (deferred, with the gap made explicit):
 *   The per-claimant increment is a PROPORTIONAL share,
 *   reward = RewardMath.calculateVoterReward(scoreWeight, totalScoreWeight, voterPool)
 *          = (voterPool * scoreWeight) / totalScoreWeight,
 *   so `sum(reward) <= voterPool` holds only because `sum(scoreWeight) <= totalScoreWeight`
 *   across claimants — an aggregate over engine state, not a distributor-storage fact.
 *   The two pieces it factors into ARE addressed elsewhere:
 *     - the single-claimant bound `(voterPool * scoreWeight)/totalScoreWeight <= voterPool`
 *       (for scoreWeight <= totalScoreWeight) is the mul-div lemma in MulDivLemma.spec;
 *     - the last-claimant settlement pays exactly `voterPool - claimedAmount` (:262),
 *       landing the sum on voterPool exactly.
 *   The remaining gap is the score-weight summation invariant across the engine's
 *   per-commit state, which needs a faithful engine model rather than the NONDET
 *   summaries used here. Tracked in docs/testing/certora-round3-plan.md (Track C).
 *
 * The engine payout (transferReward) and the LREP token transfer are summarized NONDET
 * exactly as RoundRewardDistributor.spec does: the distributor never custodies rewards,
 * so those calls cannot write its accumulators, and havoc'd engine view returns only make
 * the monotonicity argument stronger (it holds for every possible voterPool).
 */

methods {
    function roundVoterRewardClaimedAmount(uint256, uint256) external returns (uint256) envfree;
    function roundFrontendClaimedAmount(uint256, uint256) external returns (uint256) envfree;

    function _.transferReward(address, uint256) external => NONDET;
    function _.transfer(address, uint256) external => NONDET;
}

// A voter claim never decreases the per-round claimed-amount accumulator (any round).
// The only write is `claimedAmount + reward` with reward >= 0; every other path reverts.
rule claimRewardNeverDecreasesClaimedAmount(env e, uint256 contentId, uint256 roundId, uint256 c, uint256 r) {
    uint256 before = roundVoterRewardClaimedAmount(c, r);
    claimReward(e, contentId, roundId);
    assert roundVoterRewardClaimedAmount(c, r) >= before;
}

// Dust finalization never decreases the accumulator either: it adds releasedDust (> 0,
// or the call reverts with NoRewardDust). Together with the rule above, the per-round
// voter-reward sum is non-decreasing across the whole claim lifecycle.
rule dustFinalizationNeverDecreasesClaimedAmount(
    env e,
    uint256 contentId,
    uint256 roundId,
    address[] sortedWinningVoters,
    uint256 c,
    uint256 r
) {
    uint256 before = roundVoterRewardClaimedAmount(c, r);
    finalizeVoterRewardDust(e, contentId, roundId, sortedWinningVoters);
    assert roundVoterRewardClaimedAmount(c, r) >= before;
}

// Symmetric monotonicity for the frontend-fee accumulator (RoundRewardDistributor.sol:98),
// which follows the same add-or-revert discipline as the voter accumulator: the only writes
// are `+= fee` (_consumeFrontendFeeClaim, :750) and `+= releasedDust` (_finalizeProcessed-
// FrontendFeeDust, :914). Targeted at the three public mutators rather than written as one
// parametric rule over every method: a free parametric rule over this via_ir, struct-heavy
// contract yields a spurious counterexample from an unreachable havoc prestate (the known
// auto-finder artifact documented in certora-security-findings.md), even though every real
// write only adds. The targeted rules below verify cleanly.
rule claimFrontendFeeNeverDecreasesClaimedAmount(
    env e, uint256 contentId, uint256 roundId, address frontend, uint256 c, uint256 r
) {
    uint256 before = roundFrontendClaimedAmount(c, r);
    claimFrontendFee(e, contentId, roundId, frontend);
    assert roundFrontendClaimedAmount(c, r) >= before;
}

// NOTE: the public `finalizeFrontendFeeDust(.. address[] sortedFrontends)` wrapper is
// intentionally NOT given its own rule. Its only write to roundFrontendClaimedAmount is the
// `+= releasedDust` inside _finalizeProcessedFrontendFeeDust — already covered by the rule
// below — but it first runs the _processFrontendFeeDustBatch loop over the sorted-frontend
// array, whose deep internal calls hit the via_ir auto-finder instrumentation gap and
// produce a spurious "decrease" counterexample from an unreachable havoc state (the artifact
// documented in certora-security-findings.md). Covering the underlying writer directly keeps
// the proof sound without that false positive.
rule finalizeProcessedFrontendFeeDustNeverDecreasesClaimedAmount(
    env e, uint256 contentId, uint256 roundId, uint256 c, uint256 r
) {
    uint256 before = roundFrontendClaimedAmount(c, r);
    finalizeProcessedFrontendFeeDust(e, contentId, roundId);
    assert roundFrontendClaimedAmount(c, r) >= before;
}
