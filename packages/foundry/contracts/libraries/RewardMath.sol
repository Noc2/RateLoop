// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title RewardMath
/// @notice Pure functions for parimutuel reward calculations with epoch-weighted stake.
/// @dev Pool split: 96% voters, 3% frontend, 1% treasury.
///      Voter rewards are distributed proportional to epoch-weighted effective stake.
///      Epoch 1 (blind) = 100% weight; Epoch 2+ (saw results) = 25% weight.
///      This creates a 4:1 reward ratio for early blind voters vs late informed voters.
library RewardMath {
    uint256 internal constant PRECISION = 1e18;

    // Pool split percentages
    uint256 internal constant PLATFORM_BPS = 300; // 3% frontend fee share
    uint256 internal constant TREASURY_BPS = 100; // 1% treasury
    uint256 internal constant REVEALED_LOSER_REFUND_BPS = 500; // 5% rebate for revealed losing votes
    uint256 internal constant BPS_TOTAL = 10000;

    // Rating calculation parameter (fixed, not configurable)
    uint256 internal constant RATING_B = 50e6; // Smoothing parameter for rating formula (50 LREP in 6 decimals)

    /// @notice Calculate live content rating based on revealed stake pools.
    /// @dev rating = 50 + 50 * (qUp - qDown) / (qUp + qDown + b)
    ///      Clamped to [0, 100]. Uses fixed b=50 LREP for smoothing.
    ///      Called at settlement with final revealed raw pools.
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

    /// @notice Calculate a voter's reward from the voter pool (epoch-weighted-stake-proportional).
    /// @param effectiveStake The voter's epoch-weighted effective stake (stake × epochWeightBps / 10000).
    /// @param totalWeightedWinningStake Sum of all winning voters' effective stakes.
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

    /// @notice Calculate the fixed rebate paid to a revealed losing vote.
    /// @param losingStake The original stake of the revealed losing vote.
    /// @return refund Amount of tokens the losing voter can reclaim.
    function calculateRevealedLoserRefund(uint256 losingStake) internal pure returns (uint256 refund) {
        refund = (losingStake * REVEALED_LOSER_REFUND_BPS) / BPS_TOTAL;
    }

    /// @notice Split the losing pool into voter and protocol buckets.
    /// @param losingPool Total tokens from losing side.
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
