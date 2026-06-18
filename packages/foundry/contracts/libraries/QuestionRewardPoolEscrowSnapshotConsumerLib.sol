// SPDX-License-Identifier: MIT
pragma solidity ^0.8.34;

import { RoundVotingEngine } from "../RoundVotingEngine.sol";
import { IClusterPayoutOracle } from "../interfaces/IClusterPayoutOracle.sol";
import {
    RewardPool,
    RoundSnapshot,
    BundleReward,
    BundleQuestion,
    BundleRoundSetSnapshot
} from "./QuestionRewardPoolEscrowTypes.sol";
import { QuestionRewardPoolEscrowBundleLib } from "./QuestionRewardPoolEscrowBundleLib.sol";

library QuestionRewardPoolEscrowSnapshotConsumerLib {
    event RewardPoolClusterPayoutOracleRepointed(
        uint256 indexed rewardPoolId, address indexed oldClusterPayoutOracle, address indexed newClusterPayoutOracle
    );
    event QuestionBundleClusterPayoutOracleRepointed(
        uint256 indexed bundleId, address indexed oldClusterPayoutOracle, address indexed newClusterPayoutOracle
    );

    function repoint(
        mapping(uint256 => RewardPool) storage rewardPools,
        mapping(uint256 => address) storage rewardPoolClusterPayoutOracle,
        uint8 payoutDomain,
        address expectedConsumer,
        uint256 rewardPoolId,
        address newOracle
    ) external {
        RewardPool storage rewardPool = rewardPools[rewardPoolId];
        require(rewardPool.id != 0, "Bounty not found");
        require(rewardPool.qualifiedRounds == 0 && rewardPool.claimedAmount == 0, "Pool already consumed");
        address oldOracle = rewardPoolClusterPayoutOracle[rewardPoolId];
        require(oldOracle != address(0), "Oracle not pinned");
        require(newOracle != address(0) && newOracle.code.length != 0, "Invalid oracle");
        require(newOracle != oldOracle, "Oracle unchanged");
        IClusterPayoutOracle oracle = IClusterPayoutOracle(newOracle);
        try oracle.roundPayoutSnapshotProposedAt(payoutDomain, rewardPoolId, rewardPool.contentId, 0) returns (
            uint64 proposedAt
        ) {
            require(proposedAt == 0, "Oracle snapshot exists");
        }
        catch {
            revert("Invalid oracle");
        }
        try oracle.roundPayoutSnapshotConsumer(payoutDomain) returns (address consumer) {
            require(consumer == expectedConsumer, "Oracle consumer mismatch");
        } catch {
            revert("Invalid oracle");
        }
        rewardPoolClusterPayoutOracle[rewardPoolId] = newOracle;
        emit RewardPoolClusterPayoutOracleRepointed(rewardPoolId, oldOracle, newOracle);
    }

    function repointBundle(
        mapping(uint256 => BundleReward) storage bundleRewards,
        mapping(uint256 => address) storage bundleRewardClusterPayoutOracle,
        uint8 payoutDomain,
        address expectedConsumer,
        uint256 bundleId,
        address newOracle
    ) external {
        BundleReward storage bundle = bundleRewards[bundleId];
        require(bundle.id != 0, "Bundle not found");
        require(!bundle.refunded, "Bundle refunded");
        require(
            bundle.claimedAmount == 0 && bundle.completedRoundSets == bundle.pendingRecoveredRoundSets,
            "Bundle already consumed"
        );
        address oldOracle = bundleRewardClusterPayoutOracle[bundleId];
        require(oldOracle != address(0), "Oracle not pinned");
        require(newOracle != address(0) && newOracle.code.length != 0, "Invalid oracle");
        require(newOracle != oldOracle, "Oracle unchanged");
        IClusterPayoutOracle oracle = IClusterPayoutOracle(newOracle);
        try oracle.roundPayoutSnapshotProposedAt(payoutDomain, bundleId, bundleId, 1) returns (uint64 proposedAt) {
            require(proposedAt == 0, "Oracle snapshot exists");
        }
        catch {
            revert("Invalid oracle");
        }
        try oracle.roundPayoutSnapshotConsumer(payoutDomain) returns (address consumer) {
            require(consumer == expectedConsumer, "Oracle consumer mismatch");
        } catch {
            revert("Invalid oracle");
        }
        bundleRewardClusterPayoutOracle[bundleId] = newOracle;
        emit QuestionBundleClusterPayoutOracleRepointed(bundleId, oldOracle, newOracle);
    }

    function isConsumed(
        mapping(uint256 => RewardPool) storage rewardPools,
        mapping(uint256 => mapping(uint256 => RoundSnapshot)) storage roundSnapshots,
        mapping(uint256 => BundleReward) storage bundleRewards,
        mapping(uint256 => mapping(uint256 => BundleRoundSetSnapshot)) storage bundleRoundSetSnapshots,
        mapping(uint256 => address) storage rewardPoolClusterPayoutOracle,
        mapping(uint256 => address) storage bundleRewardClusterPayoutOracle,
        uint8 questionDomain,
        uint8 bundleDomain,
        uint8 domain,
        uint256 rewardPoolId,
        uint256 contentId,
        uint256 roundId
    ) external view returns (bool) {
        if (domain == bundleDomain) {
            return _isBundleConsumed(
                bundleRewards,
                bundleRoundSetSnapshots,
                bundleRewardClusterPayoutOracle,
                rewardPoolId,
                contentId,
                roundId
            );
        }
        if (domain != questionDomain) return false;
        RewardPool storage rewardPool = rewardPools[rewardPoolId];
        return rewardPool.id != 0 && rewardPool.contentId == contentId
            && rewardPoolClusterPayoutOracle[rewardPool.id] != address(0)
            && roundSnapshots[rewardPoolId][roundId].firstClaimPaid;
    }

    function sourceReadyAt(
        mapping(uint256 => RewardPool) storage rewardPools,
        mapping(uint256 => BundleReward) storage bundleRewards,
        mapping(uint256 => BundleQuestion[]) storage bundleQuestions,
        mapping(uint256 => mapping(uint256 => uint32)) storage bundleQuestionRecordedRounds,
        mapping(uint256 => mapping(uint256 => mapping(uint256 => uint64))) storage bundleRoundIds,
        mapping(uint256 => address) storage rewardPoolClusterPayoutOracle,
        mapping(uint256 => address) storage bundleRewardClusterPayoutOracle,
        RoundVotingEngine votingEngine,
        uint8 questionDomain,
        uint8 bundleDomain,
        uint8 domain,
        uint256 rewardPoolId,
        uint256 contentId,
        uint256 roundId
    ) external view returns (uint64) {
        if (domain == bundleDomain) {
            return _bundleSourceReadyAt(
                bundleRewards,
                bundleQuestions,
                bundleQuestionRecordedRounds,
                bundleRoundIds,
                bundleRewardClusterPayoutOracle,
                votingEngine,
                rewardPoolId,
                contentId,
                roundId
            );
        }
        if (domain != questionDomain) return 0;
        RewardPool storage rewardPool = rewardPools[rewardPoolId];
        if (
            rewardPool.id == 0 || rewardPool.refunded || rewardPool.contentId != contentId
                || rewardPoolClusterPayoutOracle[rewardPool.id] == address(0) || roundId < rewardPool.startRoundId
        ) return 0;
        (,,, uint48 readyAt) = votingEngine.roundLifecycleState(contentId, roundId);
        return readyAt;
    }

    function _isBundleConsumed(
        mapping(uint256 => BundleReward) storage bundleRewards,
        mapping(uint256 => mapping(uint256 => BundleRoundSetSnapshot)) storage bundleRoundSetSnapshots,
        mapping(uint256 => address) storage bundleRewardClusterPayoutOracle,
        uint256 bundleId,
        uint256 contentId,
        uint256 roundId
    ) private view returns (bool) {
        if (contentId != bundleId || roundId == 0) return false;
        BundleReward storage bundle = bundleRewards[bundleId];
        if (
            bundle.id == 0 || bundleRewardClusterPayoutOracle[bundleId] == address(0)
                || roundId > bundle.requiredSettledRounds
        ) return false;
        return bundleRoundSetSnapshots[bundleId][roundId - 1].firstClaimPaid;
    }

    function _bundleSourceReadyAt(
        mapping(uint256 => BundleReward) storage bundleRewards,
        mapping(uint256 => BundleQuestion[]) storage bundleQuestions,
        mapping(uint256 => mapping(uint256 => uint32)) storage bundleQuestionRecordedRounds,
        mapping(uint256 => mapping(uint256 => mapping(uint256 => uint64))) storage bundleRoundIds,
        mapping(uint256 => address) storage bundleRewardClusterPayoutOracle,
        RoundVotingEngine votingEngine,
        uint256 bundleId,
        uint256 contentId,
        uint256 roundId
    ) private view returns (uint64 readyAt) {
        if (contentId != bundleId || roundId == 0) return 0;
        BundleReward storage bundle = bundleRewards[bundleId];
        if (
            bundle.id == 0 || bundle.refunded || bundleRewardClusterPayoutOracle[bundleId] == address(0)
                || roundId > bundle.requiredSettledRounds
        ) return 0;
        if (
            bundle.bountyWindowSeconds != 0
                && (bundle.bountyClosesAt == 0 || bundle.bountyOpensAt > bundle.bountyClosesAt)
        ) return 0;

        uint256 roundSetIndex = roundId - 1;
        if (!QuestionRewardPoolEscrowBundleLib.isRoundSetComplete(
                bundleQuestions, bundleQuestionRecordedRounds, bundleId, roundSetIndex
            )) return 0;
        BundleQuestion[] storage questions = bundleQuestions[bundleId];
        for (uint256 i; i < questions.length;) {
            uint256 questionRoundId = bundleRoundIds[bundleId][i][roundSetIndex];
            if (questionRoundId == 0) return 0;
            (,,, uint48 questionReadyAt) = votingEngine.roundLifecycleState(questions[i].contentId, questionRoundId);
            if (questionReadyAt == 0) return 0;
            if (questionReadyAt > readyAt) readyAt = questionReadyAt;
            unchecked {
                ++i;
            }
        }
    }
}
