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
        if (votingEngine.roundUnrevealedCleanupRemaining(contentId, roundId) > 0) {
            revert UnrevealedCleanupPending();
        }

        uint256 totalFrontendPool = votingEngine.roundFrontendPool(contentId, roundId);
        uint256 totalEligibleStake = votingEngine.roundStakeWithEligibleFrontend(contentId, roundId);
        uint256 totalFrontendClaimants = votingEngine.roundEligibleFrontendCount(contentId, roundId);
        if (totalFrontendPool == 0 || totalEligibleStake == 0 || totalFrontendClaimants == 0) revert NoRewardDust();

        processedCount = roundFrontendFeeDustProcessedCount[contentId][roundId];
        expectedTotal = roundFrontendFeeDustExpectedTotal[contentId][roundId];
        address previous = roundFrontendFeeDustLastFrontend[contentId][roundId];

        for (uint256 i = 0; i < sortedFrontends.length; i++) {
            address frontend = sortedFrontends[i];
            if (frontend == address(0) || frontend <= previous) revert InvalidFinalizationInput();
            previous = frontend;

            uint256 frontendStake = votingEngine.roundPerFrontendStake(contentId, roundId, frontend);
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
        (
            uint48 startTime,
            RoundLib.RoundState state,
            uint16 voteCount,
            uint16 revealedCount,
            uint64 totalStake,
            uint64 upPool,
            uint64 downPool,
            uint16 upCount,
            uint16 downCount,
            bool upWins,
            uint48 settledAt,
            uint48 thresholdReachedAt,
            uint64 weightedUpPool,
            uint64 weightedDownPool
        ) = votingEngine.rounds(contentId, roundId);
        startTime;
        voteCount;
        revealedCount;
        totalStake;
        upPool;
        downPool;
        upCount;
        downCount;
        upWins;
        thresholdReachedAt;
        weightedUpPool;
        weightedDownPool;

        if (state != RoundLib.RoundState.Settled) revert RoundNotSettled();
        if (settledAt == 0 || block.timestamp < uint256(settledAt) + staleDelay) revert RewardFinalizationTooEarly();
    }
}
