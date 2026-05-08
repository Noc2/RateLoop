// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title PredictionRatingMath
/// @notice Pure helpers for one-round predicted final ratings on a 0-10 scale stored as 0-10000 bps.
library PredictionRatingMath {
    uint16 internal constant MIN_RATING_BPS = 0;
    uint16 internal constant MAX_RATING_BPS = 10_000;
    uint16 internal constant SCORE_SCALE_BPS = 10_000;

    error InvalidRating();
    error InvalidTolerance();
    error InvalidOwnWeight();

    function requireValidRating(uint16 ratingBps) internal pure {
        if (ratingBps > MAX_RATING_BPS) revert InvalidRating();
    }

    function weightedContribution(uint16 ratingBps, uint256 weight) internal pure returns (uint256) {
        requireValidRating(ratingBps);
        return uint256(ratingBps) * weight;
    }

    function weightedAverageRating(uint256 weightedRatingSum, uint256 totalWeight) internal pure returns (uint16) {
        if (totalWeight == 0) return 0;

        uint256 ratingBps = (weightedRatingSum + totalWeight / 2) / totalWeight;
        if (ratingBps > MAX_RATING_BPS) return MAX_RATING_BPS;
        return uint16(ratingBps);
    }

    function leaveOneOutRating(
        uint256 totalWeightedRating,
        uint256 totalWeight,
        uint16 ownPredictionBps,
        uint256 ownWeight
    ) internal pure returns (uint16) {
        requireValidRating(ownPredictionBps);
        if (ownWeight > totalWeight) revert InvalidOwnWeight();

        uint256 ownContribution = weightedContribution(ownPredictionBps, ownWeight);
        if (ownContribution > totalWeightedRating) revert InvalidOwnWeight();

        uint256 peerWeight = totalWeight - ownWeight;
        if (peerWeight == 0) {
            return weightedAverageRating(totalWeightedRating, totalWeight);
        }

        return weightedAverageRating(totalWeightedRating - ownContribution, peerWeight);
    }

    function absoluteErrorBps(uint16 predictionBps, uint16 finalRatingBps) internal pure returns (uint16) {
        requireValidRating(predictionBps);
        requireValidRating(finalRatingBps);
        return predictionBps >= finalRatingBps ? predictionBps - finalRatingBps : finalRatingBps - predictionBps;
    }

    function accuracyScoreBps(
        uint16 predictionBps,
        uint16 finalRatingBps,
        uint16 fullCreditToleranceBps,
        uint16 zeroCreditToleranceBps
    ) internal pure returns (uint16) {
        requireValidRating(predictionBps);
        requireValidRating(finalRatingBps);
        if (fullCreditToleranceBps > MAX_RATING_BPS || zeroCreditToleranceBps > MAX_RATING_BPS) {
            revert InvalidTolerance();
        }
        if (zeroCreditToleranceBps <= fullCreditToleranceBps) revert InvalidTolerance();

        uint16 errorBps = absoluteErrorBps(predictionBps, finalRatingBps);
        if (errorBps <= fullCreditToleranceBps) return SCORE_SCALE_BPS;
        if (errorBps >= zeroCreditToleranceBps) return 0;

        uint256 toleranceRange = zeroCreditToleranceBps - fullCreditToleranceBps;
        uint256 excessError = errorBps - fullCreditToleranceBps;
        return uint16(SCORE_SCALE_BPS - (SCORE_SCALE_BPS * excessError) / toleranceRange);
    }
}
