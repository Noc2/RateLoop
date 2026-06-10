/*
 * Math.spec — Phase 1 formal properties for the RateLoop pure math libraries.
 *
 * Verification target: certora/harnesses/MathHarness.sol
 * Run with:           certoraRun certora/confs/base.conf certora/confs/math.conf
 *
 * These are "smoke" properties: cheap to state, they validate the harness/config/CI
 * wiring while pinning the accounting and bounds guarantees the protocol relies on.
 * See docs/testing/certora.md (Phase 1) for the property rationale.
 *
 * Constants (mirrored from the libraries, kept literal so the spec is self-contained):
 *   BPS_SCALE      = 10_000
 *   MIN_RATING_BPS = 100
 *   MAX_RATING_BPS = 9_900
 */

methods {
    // RewardMath
    function calculateRating(uint256, uint256) external returns (uint16) envfree;
    function calculateVoterReward(uint256, uint256, uint256) external returns (uint256) envfree;
    function calculatePositiveScoreSpreadWeight(uint256, uint16, uint16) external returns (uint256) envfree;
    function calculateNegativeScoreSpreadForfeit(uint256, uint16, uint16, uint256) external returns (uint256) envfree;
    function splitPoolVoter(uint256) external returns (uint256) envfree;
    function splitPoolPlatform(uint256) external returns (uint256) envfree;
    function splitPoolTreasury(uint256) external returns (uint256) envfree;

    // RobustBtsMath
    function shadowPredictionBps(uint16, bool) external returns (uint16) envfree;
    function quadraticScoreBps(uint16, bool) external returns (uint16) envfree;
    function btsScoreBps(bool, uint16, uint16, bool) external returns (uint16) envfree;

    // RatingMath (integer subset)
    function clampRatingBps(uint256) external returns (uint16) envfree;
    function displayRatingFromBps(uint16) external returns (uint8) envfree;
    function evidenceRatingBps(uint256, uint256) external returns (uint16) envfree;
}

// ---------------------------------------------------------------------------
// RewardMath — forfeited-pool accounting
// ---------------------------------------------------------------------------

/// The three pool shares always re-sum to exactly the input. No dust is created
/// or destroyed when the forfeited pool is split.
rule splitPoolConservesInput(uint256 losingPool) {
    uint256 voterShare = splitPoolVoter(losingPool);
    uint256 platformShare = splitPoolPlatform(losingPool);
    uint256 treasuryShare = splitPoolTreasury(losingPool);
    assert to_mathint(voterShare) + to_mathint(platformShare) + to_mathint(treasuryShare)
        == to_mathint(losingPool);
}

/// A voter's reward never exceeds the voter pool, as long as the voter's effective
/// stake is bounded by the total weighted winning stake (the protocol invariant
/// under which the pro-rata split is defined).
rule voterRewardBoundedByPool(uint256 effectiveStake, uint256 totalWeighted, uint256 voterPool) {
    require totalWeighted > 0;
    require effectiveStake <= totalWeighted;
    uint256 reward = calculateVoterReward(effectiveStake, totalWeighted, voterPool);
    assert reward <= voterPool;
}

/// With no winners (zero total weight) there is nothing to distribute.
rule voterRewardZeroWhenNoWinners(uint256 effectiveStake, uint256 voterPool) {
    uint256 reward = calculateVoterReward(effectiveStake, 0, voterPool);
    assert reward == 0;
}

/// Below-mean forfeiture is capped by the raw stake: a voter can never forfeit
/// more than they staked.
rule negativeForfeitCappedByStake(uint256 stakeAmount, uint16 scoreBps, uint16 meanScoreBps, uint256 revealedCount) {
    uint256 forfeit = calculateNegativeScoreSpreadForfeit(stakeAmount, scoreBps, meanScoreBps, revealedCount);
    assert forfeit <= stakeAmount;
}

/// No forfeiture when the score is at or above the round mean.
rule negativeForfeitZeroAtOrAboveMean(
    uint256 stakeAmount,
    uint16 scoreBps,
    uint16 meanScoreBps,
    uint256 revealedCount
) {
    require scoreBps >= meanScoreBps;
    uint256 forfeit = calculateNegativeScoreSpreadForfeit(stakeAmount, scoreBps, meanScoreBps, revealedCount);
    assert forfeit == 0;
}

/// No positive reward weight when the score is at or below the round mean.
rule positiveWeightZeroAtOrBelowMean(uint256 rbtsWeight, uint16 scoreBps, uint16 meanScoreBps) {
    require scoreBps <= meanScoreBps;
    uint256 weight = calculatePositiveScoreSpreadWeight(rbtsWeight, scoreBps, meanScoreBps);
    assert weight == 0;
}

// ---------------------------------------------------------------------------
// RewardMath — content rating bounds and direction
// ---------------------------------------------------------------------------

/// The live rating is always a whole number in [0, 100]. (rating is uint16, so the
/// lower bound is structural; the cap is the property worth proving.)
rule ratingWithinBounds(uint256 totalUpStake, uint256 totalDownStake) {
    uint16 rating = calculateRating(totalUpStake, totalDownStake);
    assert rating <= 100;
}

/// An UP-majority (or tie) round never settles below the neutral rating of 50.
rule ratingUpMajorityAtLeastNeutral(uint256 totalUpStake, uint256 totalDownStake) {
    require totalUpStake >= totalDownStake;
    uint16 rating = calculateRating(totalUpStake, totalDownStake);
    assert rating >= 50;
}

/// A DOWN-majority (or tie) round never settles above the neutral rating of 50.
rule ratingDownMajorityAtMostNeutral(uint256 totalUpStake, uint256 totalDownStake) {
    require totalDownStake >= totalUpStake;
    uint16 rating = calculateRating(totalUpStake, totalDownStake);
    assert rating <= 50;
}

// ---------------------------------------------------------------------------
// RatingMath — integer helpers
// ---------------------------------------------------------------------------

/// Clamping always lands inside the protocol rating band.
rule clampRatingWithinBounds(uint256 ratingBps) {
    uint16 clamped = clampRatingBps(ratingBps);
    assert clamped >= 100 && clamped <= 9900;
}

/// The display rating is a percentage in [0, 100].
rule displayRatingAtMost100(uint16 ratingBps) {
    uint8 display = displayRatingFromBps(ratingBps);
    assert display <= 100;
}

/// Evidence-derived ratings stay inside the clamped band (the empty-evidence
/// default of 5000 is in range too).
rule evidenceRatingWithinBounds(uint256 upEvidence, uint256 downEvidence) {
    uint16 rating = evidenceRatingBps(upEvidence, downEvidence);
    assert rating >= 100 && rating <= 9900;
}

// ---------------------------------------------------------------------------
// RobustBtsMath — BTS scoring bounds
// ---------------------------------------------------------------------------

/// Shadow predictions stay within the BPS scale.
rule shadowPredictionWithinScale(uint16 referencePredictionBps, bool signalIsUp) {
    uint16 shadow = shadowPredictionBps(referencePredictionBps, signalIsUp);
    assert shadow <= 10000;
}

/// Quadratic scores stay within the BPS scale.
rule quadraticScoreWithinScale(uint16 predictionBps, bool actualIsUp) {
    uint16 score = quadraticScoreBps(predictionBps, actualIsUp);
    assert score <= 10000;
}

/// The composite BTS score (mean of two bounded scores) stays within the BPS scale.
rule btsScoreWithinScale(bool ownSignalIsUp, uint16 ownPredictionBps, uint16 referencePredictionBps, bool peerSignalIsUp) {
    uint16 score = btsScoreBps(ownSignalIsUp, ownPredictionBps, referencePredictionBps, peerSignalIsUp);
    assert score <= 10000;
}
