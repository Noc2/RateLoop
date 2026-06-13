// SPDX-License-Identifier: MIT
pragma solidity ^0.8.34;

import { ContentRegistry } from "../ContentRegistry.sol";

/// @title RoundSettlementSideEffectsLib
/// @notice Moves best-effort post-settlement external calls out of RoundVotingEngine runtime bytecode.
library RoundSettlementSideEffectsLib {
    enum SideEffectFailureStage {
        RatingStateUpdate,
        MeaningfulActivityRecord
    }

    event SettlementSideEffectFailed(
        uint256 indexed contentId, uint256 indexed roundId, address indexed target, SideEffectFailureStage stage
    );

    function recordSettlement(
        ContentRegistry registry,
        uint256 contentId,
        uint256 roundId,
        uint16 referenceRatingBps,
        uint64 upEvidence,
        uint64 downEvidence
    ) external {
        // Canonical public rating movement waits for the correlation snapshot so correlated
        // wallet clusters cannot move the visible rating by raw headcount. Settlement records
        // the raw evidence as pending; anyone can later apply the finalized adjusted weights.
        try registry.recordPendingRatingSettlement(contentId, roundId, referenceRatingBps, upEvidence, downEvidence) { }
        catch {
            emit SettlementSideEffectFailed(
                contentId, roundId, address(registry), SideEffectFailureStage.RatingStateUpdate
            );
        }

        try registry.recordMeaningfulActivity(contentId) { }
        catch {
            emit SettlementSideEffectFailed(
                contentId, roundId, address(registry), SideEffectFailureStage.MeaningfulActivityRecord
            );
        }
    }
}
