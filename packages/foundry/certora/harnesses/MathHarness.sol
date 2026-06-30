// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

import { RewardMath } from "../../contracts/libraries/RewardMath.sol";
import { RatingMath } from "../../contracts/libraries/RatingMath.sol";
import { RobustBtsMath } from "../../contracts/libraries/RobustBtsMath.sol";

/// @title MathHarness
/// @notice External wrappers around the internal, pure math libraries so the Certora
///         Prover can call them as `envfree` functions. This is the verification
///         target for `certora/specs/Math.spec`.
/// @dev Only the integer helpers of RatingMath are exposed. Its logit/sigmoid paths
///      use PRBMath SD59x18 (exp/ln) and are intentionally out of scope for Phase 1.
contract MathHarness {
    // ---------------------------------------------------------------------
    // RewardMath
    // ---------------------------------------------------------------------

    function calculateRating(uint256 totalUpStake, uint256 totalDownStake) external pure returns (uint16) {
        return RewardMath.calculateRating(totalUpStake, totalDownStake);
    }

    function calculateVoterReward(uint256 effectiveStake, uint256 totalWeightedWinningStake, uint256 voterPool)
        external
        pure
        returns (uint256)
    {
        return RewardMath.calculateVoterReward(effectiveStake, totalWeightedWinningStake, voterPool);
    }

    function calculatePositiveScoreSpreadWeight(uint256 rbtsWeight, uint16 scoreBps, uint16 meanScoreBps)
        external
        pure
        returns (uint256)
    {
        return RewardMath.calculatePositiveScoreSpreadWeight(rbtsWeight, scoreBps, meanScoreBps);
    }

    function calculateNegativeScoreSpreadForfeit(
        uint256 stakeAmount,
        uint16 scoreBps,
        uint16 meanScoreBps,
        uint256 revealedCount
    ) external pure returns (uint256) {
        return RewardMath.calculateNegativeScoreSpreadForfeit(stakeAmount, scoreBps, meanScoreBps, revealedCount);
    }

    // splitPool returns a 3-tuple; expose each share separately so the spec can
    // reason about them without CVL tuple destructuring.
    function splitPoolVoter(uint256 losingPool) external pure returns (uint256 voterShare) {
        (voterShare,,) = RewardMath.splitPool(losingPool);
    }

    function splitPoolPlatform(uint256 losingPool) external pure returns (uint256 platformShare) {
        (, platformShare,) = RewardMath.splitPool(losingPool);
    }

    function splitPoolTreasury(uint256 losingPool) external pure returns (uint256 treasuryShare) {
        (,, treasuryShare) = RewardMath.splitPool(losingPool);
    }

    // ---------------------------------------------------------------------
    // RobustBtsMath
    // ---------------------------------------------------------------------

    function shadowPredictionBps(uint16 referencePredictionBps, bool signalIsUp) external pure returns (uint16) {
        return RobustBtsMath.shadowPredictionBps(referencePredictionBps, signalIsUp);
    }

    function quadraticScoreBps(uint16 predictionBps, bool actualIsUp) external pure returns (uint16) {
        return RobustBtsMath.quadraticScoreBps(predictionBps, actualIsUp);
    }

    function btsScoreBps(
        bool ownSignalIsUp,
        uint16 ownPredictionBps,
        uint16 referencePredictionBps,
        bool peerSignalIsUp
    ) external pure returns (uint16) {
        return RobustBtsMath.scoreBps(ownSignalIsUp, ownPredictionBps, referencePredictionBps, peerSignalIsUp);
    }

    // ---------------------------------------------------------------------
    // RatingMath (integer subset only)
    // ---------------------------------------------------------------------

    function clampRatingBps(uint256 ratingBps) external pure returns (uint16) {
        return RatingMath.clampRatingBps(ratingBps);
    }

    function displayRatingFromBps(uint16 ratingBps) external pure returns (uint8) {
        return RatingMath.displayRatingFromBps(ratingBps);
    }

    function evidenceRatingBps(uint256 upEvidence, uint256 downEvidence) external pure returns (uint16) {
        return RatingMath.evidenceRatingBps(upEvidence, downEvidence);
    }
}
