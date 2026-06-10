// SPDX-License-Identifier: MIT
pragma solidity ^0.8.34;

/// @title RewardMath
/// @notice Pure functions for rating and competitive RBTS reward calculations.
/// @dev Voter rewards are distributed proportional to positive score-spread weight.
///      Epoch 1 (blind) = 100% weight; Epoch 2+ (saw results) = 25% weight.
///      This creates a 4:1 reward ratio for early blind voters vs late informed voters.
library RewardMath {
    uint256 internal constant PRECISION = 1e18;

    // Forfeited-pool split percentages.
    uint256 internal constant PLATFORM_BPS = 300; // 3% frontend fee share
    uint256 internal constant TREASURY_BPS = 100; // 1% treasury
    uint256 internal constant BPS_TOTAL = 10000;
    uint256 internal constant SCORE_SPREAD_INTENSITY_BPS = 15_000; // 1.5x below-mean score penalty
    uint256 internal constant SCORE_SPREAD_FORFEIT_MIN_REVEALS = 8;
    uint256 internal constant MAX_SCORE_SPREAD_FORFEIT_BPS = 5_000; // 50% max score-spread stake loss

    // Rating calculation parameter (fixed, not configurable). Only used by the legacy
    // reference formula `calculateRating` below; not referenced by any production path.
    uint256 internal constant RATING_B = 50e6; // Smoothing parameter for rating formula (50 LREP in 6 decimals)

    /// @notice Legacy stake-pool rating formula. Reference-only — NOT used in production.
    /// @dev L-Math-A: the live rating model is `RatingMath.evidenceRatingBps`, applied at
    ///      settlement via `RoundSettlementSideEffectsLib.recordSettlement`. No deployed
    ///      contract calls this function; it is kept as a reference implementation exercised
    ///      by the Certora `Math.spec` rating rules (via `MathHarness`) and the RewardMath
    ///      unit/fuzz tests. Removing it requires updating those specs/tests in lockstep.
    ///      rating = 50 + 50 * (qUp - qDown) / (qUp + qDown + b)
    ///      Clamped to [0, 100]. Uses fixed b=50 LREP for smoothing.
    ///      AUDIT NOTE (I-2): Integer granularity [0-100] is intentional. The RATING_B smoothing
    ///      parameter (50 LREP) ensures small-stake rounds stay near 50, preventing manipulation.
    ///      Higher precision (e.g. 1e18) would add gas cost with no UX benefit since ratings
    ///      are displayed as whole numbers in the frontend.
    /// @param totalUpStake Total revealed UP stake in the current round.
    /// @param totalDownStake Total revealed DOWN stake in the current round.
    /// @return rating New content rating [0, 100].
    function calculateRating(uint256 totalUpStake, uint256 totalDownStake) internal pure returns (uint16) {
        if (totalUpStake == 0 && totalDownStake == 0) return 50;

        // rating = 50 + 50 * (qUp - qDown) / (qUp + qDown + b)
        uint256 sum = totalUpStake + totalDownStake + RATING_B;

        if (totalUpStake >= totalDownStake) {
            uint256 diff = totalUpStake - totalDownStake;
            uint256 delta = (50 * diff) / sum;
            uint256 r = 50 + delta;
            return r > 100 ? uint16(100) : uint16(r);
        } else {
            uint256 diff = totalDownStake - totalUpStake;
            uint256 delta = (50 * diff) / sum;
            return delta >= 50 ? uint16(0) : uint16(50 - delta);
        }
    }

    /// @notice Calculate a voter's reward from the voter pool.
    /// @param effectiveStake The voter's positive score-spread reward weight.
    /// @param totalWeightedWinningStake Sum of all positive score-spread reward weights.
    /// @param voterPool The portion of forfeited stakes allocated to voters.
    /// @return reward Amount of tokens the voter earns (excludes original stake return).
    function calculateVoterReward(uint256 effectiveStake, uint256 totalWeightedWinningStake, uint256 voterPool)
        internal
        pure
        returns (uint256)
    {
        if (totalWeightedWinningStake == 0) return 0;
        return (voterPool * effectiveStake) / totalWeightedWinningStake;
    }

    /// @notice Calculate the positive reward weight from score spread above the round mean.
    /// @param rbtsWeight Epoch-weighted stake used for RBTS reward accounting.
    /// @param scoreBps Rater's RBTS score in bps.
    /// @param meanScoreBps Stake-weighted round mean RBTS score in bps.
    function calculatePositiveScoreSpreadWeight(uint256 rbtsWeight, uint16 scoreBps, uint16 meanScoreBps)
        internal
        pure
        returns (uint256)
    {
        if (rbtsWeight == 0 || scoreBps <= meanScoreBps) return 0;
        return (rbtsWeight * (uint256(scoreBps) - meanScoreBps)) / BPS_TOTAL;
    }

    /// @notice Calculate forfeited stake from score spread below the round mean.
    /// @param stakeAmount Raw stake attached to the revealed report.
    /// @param scoreBps Rater's RBTS score in bps.
    /// @param meanScoreBps Stake-weighted round mean RBTS score in bps.
    /// @param revealedCount Number of score-eligible revealed participants in the round.
    function calculateNegativeScoreSpreadForfeit(
        uint256 stakeAmount,
        uint16 scoreBps,
        uint16 meanScoreBps,
        uint256 revealedCount
    ) internal pure returns (uint256) {
        if (revealedCount < SCORE_SPREAD_FORFEIT_MIN_REVEALS) return 0;
        if (stakeAmount == 0 || scoreBps >= meanScoreBps) return 0;
        uint256 deltaBps = uint256(meanScoreBps) - scoreBps;
        uint256 forfeitedStake = (stakeAmount * SCORE_SPREAD_INTENSITY_BPS * deltaBps) / BPS_TOTAL / BPS_TOTAL;
        uint256 maxForfeit = (stakeAmount * MAX_SCORE_SPREAD_FORFEIT_BPS) / BPS_TOTAL;
        return forfeitedStake > maxForfeit ? maxForfeit : forfeitedStake;
    }

    /// @notice Split the forfeited pool into voter and protocol buckets.
    /// @param losingPool Total forfeited tokens.
    /// @return voterShare 96% for scored voters (100% content-specific).
    /// @return platformShare 3% for frontend fees.
    /// @return treasuryShare 1% for governance treasury.
    function splitPool(uint256 losingPool)
        internal
        pure
        returns (uint256 voterShare, uint256 platformShare, uint256 treasuryShare)
    {
        platformShare = (losingPool * PLATFORM_BPS) / BPS_TOTAL;
        treasuryShare = (losingPool * TREASURY_BPS) / BPS_TOTAL;
        voterShare = losingPool - platformShare - treasuryShare; // remainder = 96%
    }
}
