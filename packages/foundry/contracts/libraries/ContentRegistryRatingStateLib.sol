// SPDX-License-Identifier: MIT
pragma solidity ^0.8.34;

import { ContentRegistryTypes } from "./ContentRegistryTypes.sol";
import { RatingLib } from "./RatingLib.sol";
import { RatingMath } from "./RatingMath.sol";

/// @title ContentRegistryRatingStateLib
/// @notice Applies canonical rating state updates for ContentRegistry while keeping registry bytecode small.
library ContentRegistryRatingStateLib {
    event RatingUpdated(uint256 indexed contentId, uint8 oldRating, uint8 newRating);
    event RatingStateUpdated(
        uint256 indexed contentId,
        uint256 indexed roundId,
        uint16 referenceRatingBps,
        uint16 oldRatingBps,
        uint16 newRatingBps,
        uint16 conservativeRatingBps,
        uint256 upEvidence,
        uint256 downEvidence,
        uint256 confidenceMass,
        uint256 effectiveEvidence,
        uint32 settledRounds,
        uint48 lowSince
    );

    function updateRatingState(
        ContentRegistryTypes.Content storage content,
        RatingLib.RatingState storage state,
        uint256 contentId,
        uint256 roundId,
        uint16 referenceRatingBps,
        RatingLib.RatingState memory nextState,
        uint48 nowTimestamp
    ) external {
        uint16 oldRatingBps = state.ratingBps == 0 ? uint16(uint256(content.rating) * 100) : state.ratingBps;
        uint8 oldDisplayRating = content.rating;
        uint16 clampedRatingBps = RatingMath.clampRatingBps(nextState.ratingBps);
        uint16 clampedConservativeRatingBps =
            nextState.conservativeRatingBps > clampedRatingBps ? clampedRatingBps : nextState.conservativeRatingBps;

        state.ratingLogitX18 = nextState.ratingLogitX18;
        state.confidenceMass = nextState.confidenceMass;
        state.effectiveEvidence = nextState.effectiveEvidence;
        state.upEvidence = nextState.upEvidence;
        state.downEvidence = nextState.downEvidence;
        state.settledRounds = nextState.settledRounds;
        state.ratingBps = clampedRatingBps;
        state.conservativeRatingBps = clampedConservativeRatingBps;
        state.lastUpdatedAt = nextState.lastUpdatedAt == 0 ? nowTimestamp : nextState.lastUpdatedAt;
        state.lowSince = nextState.lowSince;

        uint8 newDisplayRating = RatingMath.displayRatingFromBps(clampedRatingBps);
        if (newDisplayRating != oldDisplayRating) {
            content.rating = newDisplayRating;
            emit RatingUpdated(contentId, oldDisplayRating, newDisplayRating);
        }

        emit RatingStateUpdated(
            contentId,
            roundId,
            referenceRatingBps,
            oldRatingBps,
            clampedRatingBps,
            clampedConservativeRatingBps,
            nextState.upEvidence,
            nextState.downEvidence,
            nextState.confidenceMass,
            nextState.effectiveEvidence,
            nextState.settledRounds,
            nextState.lowSince
        );
    }
}
