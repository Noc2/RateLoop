// SPDX-License-Identifier: MIT
pragma solidity ^0.8.34;

import { RoundVotingEngine } from "../RoundVotingEngine.sol";
import { RoundLib } from "./RoundLib.sol";

/// @notice Linked helper for batched frontend-fee dust accounting.
library FrontendFeeDustLib {
    error RoundNotSettled();
    error UnrevealedCleanupPending();
    error RewardFinalizationTooEarly();
    error InvalidFinalizationInput();
    error RewardDustAlreadyFinalized();
    error NoRewardDust();

    function processBatch(
        RoundVotingEngine votingEngine,
        mapping(uint256 => mapping(uint256 => bool)) storage roundFrontendFeeDustFinalized,
        mapping(uint256 => mapping(uint256 => uint256)) storage roundFrontendFeeDustProcessedCount,
        mapping(uint256 => mapping(uint256 => uint256)) storage roundFrontendFeeDustExpectedTotal,
        mapping(uint256 => mapping(uint256 => address)) storage roundFrontendFeeDustLastFrontend,
        uint256 contentId,
        uint256 roundId,
        address[] calldata sortedFrontends,
        uint256 staleDelay
    ) external returns (uint256 processedCount, uint256 expectedTotal) {
        if (roundFrontendFeeDustFinalized[contentId][roundId]) revert RewardDustAlreadyFinalized();
        if (sortedFrontends.length == 0) revert InvalidFinalizationInput();

        requireSettledStaleRound(votingEngine, contentId, roundId, staleDelay);
        (,, uint256 cleanupRemaining,) = votingEngine.roundLifecycleState(contentId, roundId);
        if (cleanupRemaining > 0) {
            revert UnrevealedCleanupPending();
        }

        (uint256 totalFrontendPool,, uint256 totalEligibleStake, uint256 totalFrontendClaimants) =
            votingEngine.frontendFeeState(contentId, roundId, address(0));
        if (totalFrontendPool == 0 || totalEligibleStake == 0 || totalFrontendClaimants == 0) revert NoRewardDust();

        processedCount = roundFrontendFeeDustProcessedCount[contentId][roundId];
        expectedTotal = roundFrontendFeeDustExpectedTotal[contentId][roundId];
        address previous = roundFrontendFeeDustLastFrontend[contentId][roundId];

        for (uint256 i = 0; i < sortedFrontends.length; i++) {
            address frontend = sortedFrontends[i];
            if (frontend == address(0) || frontend <= previous) revert InvalidFinalizationInput();
            previous = frontend;

            (, uint256 frontendStake,,) = votingEngine.frontendFeeState(contentId, roundId, frontend);
            if (frontendStake == 0) revert InvalidFinalizationInput();
            expectedTotal += (totalFrontendPool * frontendStake) / totalEligibleStake;
        }

        processedCount += sortedFrontends.length;
        if (processedCount > totalFrontendClaimants) revert InvalidFinalizationInput();

        roundFrontendFeeDustProcessedCount[contentId][roundId] = processedCount;
        roundFrontendFeeDustExpectedTotal[contentId][roundId] = expectedTotal;
        roundFrontendFeeDustLastFrontend[contentId][roundId] = previous;
    }

    function requireSettledStaleRound(
        RoundVotingEngine votingEngine,
        uint256 contentId,
        uint256 roundId,
        uint256 staleDelay
    ) internal view {
        (, RoundLib.RoundState state,,,,, uint48 settledAt,) = votingEngine.roundCore(contentId, roundId);

        if (state != RoundLib.RoundState.Settled) revert RoundNotSettled();
        if (settledAt == 0 || block.timestamp < uint256(settledAt) + staleDelay) revert RewardFinalizationTooEarly();
    }
}
