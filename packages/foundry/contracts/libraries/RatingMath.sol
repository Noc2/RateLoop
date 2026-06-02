// SPDX-License-Identifier: MIT
pragma solidity ^0.8.34;

import { SD59x18, convert, div, exp, ln, sd, unwrap } from "../../lib/prb-math/src/SD59x18.sol";
import { RatingLib } from "./RatingLib.sol";

/// @title RatingMath
/// @notice Pure helpers for the cumulative bounded-evidence rating model. Ratings are derived
///         directly from cumulative up/down evidence; the previous confidence-reopening model
///         (per-round logit steps, surprise, confidence reopen) has been removed.
library RatingMath {
    error RatingMathOverflow();

    uint256 internal constant MIN_PROBABILITY_X18 = 1e12;
    uint256 internal constant MAX_PROBABILITY_X18 = RatingLib.WAD - MIN_PROBABILITY_X18;

    function clampRatingBps(uint256 ratingBps) internal pure returns (uint16) {
        if (ratingBps < RatingLib.MIN_RATING_BPS) return RatingLib.MIN_RATING_BPS;
        if (ratingBps > RatingLib.MAX_RATING_BPS) return RatingLib.MAX_RATING_BPS;
        return uint16(ratingBps);
    }

    function displayRatingFromBps(uint16 ratingBps) internal pure returns (uint8) {
        uint256 displayRating = (uint256(ratingBps) + 50) / 100;
        if (displayRating > 100) return 100;
        return uint8(displayRating);
    }

    function evidenceRatingBps(uint256 upEvidence, uint256 downEvidence) internal pure returns (uint16) {
        uint256 totalEvidence = upEvidence + downEvidence;
        if (totalEvidence == 0) return RatingLib.DEFAULT_RATING_BPS;
        return clampRatingBps((upEvidence * RatingLib.BPS_SCALE) / totalEvidence);
    }

    function probabilityX18FromBps(uint16 ratingBps) internal pure returns (SD59x18) {
        uint16 clampedRating = clampRatingBps(ratingBps);
        return div(convert(int256(uint256(clampedRating))), convert(int256(uint256(RatingLib.BPS_SCALE))));
    }

    function ratingBpsToLogitX18(uint16 ratingBps) internal pure returns (int256) {
        return unwrap(_logit(probabilityX18FromBps(ratingBps)));
    }

    function logitX18ToRatingBps(int256 ratingLogitX18) internal pure returns (uint16) {
        SD59x18 probability = _sigmoid(sd(ratingLogitX18));
        uint256 probabilityX18 = uint256(unwrap(probability));
        uint256 ratingBps = (probabilityX18 * RatingLib.BPS_SCALE) / RatingLib.WAD;
        return clampRatingBps(ratingBps);
    }

    function applySettlement(
        uint16 referenceRatingBps,
        uint256 weightedUp,
        uint256 weightedDown,
        RatingLib.RatingState memory previousState,
        RatingLib.RatingConfig memory ratingConfig,
        RatingLib.SlashConfig memory slashConfig,
        uint48 settledAt
    ) internal pure returns (RatingLib.RatingState memory nextState) {
        uint256 cumulativeUpEvidence = uint256(previousState.upEvidence) + weightedUp;
        uint256 cumulativeDownEvidence = uint256(previousState.downEvidence) + weightedDown;
        uint256 cumulativeEvidence = cumulativeUpEvidence + cumulativeDownEvidence;

        uint16 nextRatingBps = cumulativeEvidence == 0
            ? clampRatingBps(previousState.ratingBps == 0 ? referenceRatingBps : previousState.ratingBps)
            : evidenceRatingBps(cumulativeUpEvidence, cumulativeDownEvidence);
        int256 nextLogitX18 = ratingBpsToLogitX18(nextRatingBps);

        nextState.ratingLogitX18 = _toInt128(nextLogitX18);
        nextState.confidenceMass = _toUint128(
            _clampConfidenceMass(
                cumulativeEvidence == 0 ? ratingConfig.confidenceMassInitial : cumulativeEvidence, ratingConfig
            )
        );
        nextState.effectiveEvidence = _toUint128(cumulativeEvidence);
        nextState.upEvidence = _toUint128(cumulativeUpEvidence);
        nextState.downEvidence = _toUint128(cumulativeDownEvidence);
        nextState.settledRounds = previousState.settledRounds + 1;
        nextState.ratingBps = nextRatingBps;
        nextState.conservativeRatingBps =
            computeConservativeRatingBps(nextRatingBps, uint256(nextState.confidenceMass), ratingConfig);
        nextState.lastUpdatedAt = settledAt;

        bool canTrackLowRating = uint256(nextState.effectiveEvidence) >= slashConfig.minSlashEvidence
            && nextState.settledRounds >= slashConfig.minSlashSettledRounds;
        if (canTrackLowRating && nextState.conservativeRatingBps < slashConfig.slashThresholdBps) {
            nextState.lowSince = previousState.lowSince == 0 ? settledAt : previousState.lowSince;
        } else {
            nextState.lowSince = 0;
        }
    }

    function computeConservativeRatingBps(
        uint16 ratingBps,
        uint256 confidenceMass,
        RatingLib.RatingConfig memory ratingConfig
    ) internal pure returns (uint16) {
        uint256 maxPenaltyBps = ratingConfig.conservativePenaltyMaxBps;
        if (maxPenaltyBps == 0) {
            return ratingBps;
        }

        uint256 penaltyBps;
        if (confidenceMass == 0 || confidenceMass <= ratingConfig.confidenceMassInitial) {
            penaltyBps = maxPenaltyBps;
        } else {
            penaltyBps = (maxPenaltyBps * ratingConfig.confidenceMassInitial) / confidenceMass;
            if (penaltyBps < ratingConfig.conservativePenaltyMinBps) {
                penaltyBps = ratingConfig.conservativePenaltyMinBps;
            }
            if (penaltyBps > maxPenaltyBps) {
                penaltyBps = maxPenaltyBps;
            }
        }

        if (ratingBps <= penaltyBps) {
            return 0;
        }
        return uint16(uint256(ratingBps) - penaltyBps);
    }

    function _logit(SD59x18 probability) private pure returns (SD59x18) {
        SD59x18 clampedProbability = _clampProbability(probability);
        int256 oneMinusProbabilityX18 = int256(RatingLib.WAD) - unwrap(clampedProbability);
        SD59x18 odds = div(clampedProbability, sd(oneMinusProbabilityX18));
        return ln(odds);
    }

    function _sigmoid(SD59x18 x) private pure returns (SD59x18) {
        if (unwrap(x) >= 0) {
            SD59x18 denominator = sd(int256(RatingLib.WAD) + unwrap(exp(-x)));
            return div(sd(int256(RatingLib.WAD)), denominator);
        }

        SD59x18 expX = exp(x);
        return div(expX, sd(int256(RatingLib.WAD) + unwrap(expX)));
    }

    function _clampProbability(SD59x18 probability) private pure returns (SD59x18) {
        int256 probabilityX18 = unwrap(probability);
        if (probabilityX18 < int256(MIN_PROBABILITY_X18)) {
            return sd(int256(MIN_PROBABILITY_X18));
        }
        if (probabilityX18 > int256(MAX_PROBABILITY_X18)) {
            return sd(int256(MAX_PROBABILITY_X18));
        }
        return probability;
    }

    function _clampConfidenceMass(uint256 confidenceMass, RatingLib.RatingConfig memory ratingConfig)
        private
        pure
        returns (uint256)
    {
        if (confidenceMass < ratingConfig.confidenceMassMin) {
            return ratingConfig.confidenceMassMin;
        }
        if (confidenceMass > ratingConfig.confidenceMassMax) {
            return ratingConfig.confidenceMassMax;
        }
        return confidenceMass;
    }

    function _toUint128(uint256 value) private pure returns (uint128) {
        if (value > type(uint128).max) revert RatingMathOverflow();
        return uint128(value);
    }

    function _toInt128(int256 value) private pure returns (int128) {
        if (value > type(int128).max || value < type(int128).min) revert RatingMathOverflow();
        return int128(value);
    }
}
