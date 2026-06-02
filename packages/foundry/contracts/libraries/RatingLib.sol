// SPDX-License-Identifier: MIT
pragma solidity ^0.8.34;

/// @title RatingLib
/// @notice Shared config and state structs for the cumulative bounded-evidence rating system.
library RatingLib {
    uint16 internal constant BPS_SCALE = 10_000;
    uint16 internal constant MIN_RATING_BPS = 100; // 1.0 / 10
    uint16 internal constant MAX_RATING_BPS = 9_900; // 9.9 / 10
    uint16 internal constant DEFAULT_RATING_BPS = 5_000; // 5.0 / 10
    int256 internal constant DEFAULT_RATING_LOGIT_X18 = 0;
    uint256 internal constant WAD = 1e18;

    struct RatingConfig {
        // The following fields (smoothingAlpha, smoothingBeta, observationBetaX18, confidenceGainBps,
        // confidenceReopenBps, surpriseReferenceX18, maxDeltaLogitX18) are retained for config/ABI/storage
        // stability but are NOT read by the current cumulative bounded-evidence model. They belonged to the
        // removed confidence-reopening model (per-round logit steps, surprise, confidence reopen).
        uint256 smoothingAlpha; // inert: not read by current model
        uint256 smoothingBeta; // inert: not read by current model
        uint256 observationBetaX18; // inert: not read by current model
        uint256 confidenceMassInitial;
        uint256 confidenceMassMin;
        uint256 confidenceMassMax;
        uint16 confidenceGainBps; // inert: not read by current model
        uint16 confidenceReopenBps; // inert: not read by current model
        uint256 surpriseReferenceX18; // inert: not read by current model
        uint256 maxDeltaLogitX18; // inert: not read by current model
        uint256 maxAbsLogitX18;
        uint16 conservativePenaltyMaxBps;
        uint16 conservativePenaltyMinBps;
    }

    struct SlashConfig {
        uint16 slashThresholdBps;
        uint16 minSlashSettledRounds;
        uint48 minSlashLowDuration;
        uint256 minSlashEvidence;
    }

    struct RatingState {
        int128 ratingLogitX18;
        uint128 confidenceMass;
        uint128 effectiveEvidence;
        uint128 upEvidence;
        uint128 downEvidence;
        uint32 settledRounds;
        uint16 ratingBps;
        uint16 conservativeRatingBps;
        uint48 lastUpdatedAt;
        uint48 lowSince;
    }
}
