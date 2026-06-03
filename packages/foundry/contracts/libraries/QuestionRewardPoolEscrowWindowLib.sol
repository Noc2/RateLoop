// SPDX-License-Identifier: MIT
pragma solidity ^0.8.34;

import { SafeCast } from "@openzeppelin/contracts/utils/math/SafeCast.sol";

import { RoundVotingEngine } from "../RoundVotingEngine.sol";
import { RewardPool, BundleReward, BundleQuestion } from "./QuestionRewardPoolEscrowTypes.sol";

library QuestionRewardPoolEscrowWindowLib {
    using SafeCast for uint256;

    event RewardPoolWindowActivated(
        uint256 indexed rewardPoolId,
        uint256 indexed contentId,
        uint256 indexed roundId,
        uint256 bountyOpensAt,
        uint256 bountyClosesAt,
        uint256 feedbackClosesAt
    );
    event QuestionBundleWindowActivated(
        uint256 indexed bundleId, uint256 bountyOpensAt, uint256 bountyClosesAt, uint256 feedbackClosesAt
    );

    function validateWindow(
        uint256 bountyStartBy,
        uint256 bountyWindowSeconds,
        uint256 feedbackWindowSeconds,
        bool allowOpenEnded
    ) internal view returns (uint256 normalizedFeedbackWindowSeconds) {
        if (bountyWindowSeconds == 0) {
            require(allowOpenEnded, "Bounty window required");
            require(bountyStartBy == 0, "Bad start-by");
            require(feedbackWindowSeconds == 0, "Bad feedback window");
            return 0;
        }

        require(bountyStartBy > block.timestamp, "Bad start-by");
        bountyWindowSeconds.toUint32();
        normalizedFeedbackWindowSeconds = feedbackWindowSeconds == 0 ? bountyWindowSeconds : feedbackWindowSeconds;
        normalizedFeedbackWindowSeconds.toUint32();
        require(normalizedFeedbackWindowSeconds <= bountyWindowSeconds, "Late feedback");
    }

    function activateRewardPoolWindowForRound(
        RoundVotingEngine votingEngine,
        RewardPool storage rewardPool,
        uint256 roundId
    ) internal returns (bool active) {
        if (rewardPool.bountyWindowSeconds == 0) return true;
        if (rewardPool.bountyClosesAt != 0) return rewardPool.bountyOpensAt <= rewardPool.bountyClosesAt;

        uint64 firstStakedAt = _firstStakedAtForRound(votingEngine, rewardPool.contentId, roundId);
        if (firstStakedAt == 0) return false;

        if (firstStakedAt > rewardPool.bountyStartBy) {
            rewardPool.bountyOpensAt = firstStakedAt;
            rewardPool.bountyClosesAt = rewardPool.bountyStartBy;
            rewardPool.feedbackClosesAt = rewardPool.bountyStartBy;
            rewardPool.claimDeadline = rewardPool.bountyStartBy;
            emit RewardPoolWindowActivated(
                rewardPool.id,
                rewardPool.contentId,
                roundId,
                rewardPool.bountyOpensAt,
                rewardPool.bountyClosesAt,
                rewardPool.feedbackClosesAt
            );
            return false;
        }

        uint64 bountyClosesAt = uint64(uint256(firstStakedAt) + rewardPool.bountyWindowSeconds);
        uint64 feedbackClosesAt = uint64(uint256(firstStakedAt) + rewardPool.feedbackWindowSeconds);
        rewardPool.bountyOpensAt = firstStakedAt;
        rewardPool.bountyClosesAt = bountyClosesAt;
        rewardPool.feedbackClosesAt = feedbackClosesAt;
        rewardPool.claimDeadline = bountyClosesAt;

        emit RewardPoolWindowActivated(
            rewardPool.id, rewardPool.contentId, roundId, firstStakedAt, bountyClosesAt, feedbackClosesAt
        );
        return true;
    }

    function previewRewardPoolWindowForRound(
        RoundVotingEngine votingEngine,
        RewardPool storage rewardPool,
        uint256 roundId
    ) internal view returns (bool active, uint64 bountyOpensAt, uint64 bountyClosesAt) {
        if (rewardPool.bountyWindowSeconds == 0) {
            return (true, rewardPool.bountyOpensAt, 0);
        }
        if (rewardPool.bountyClosesAt != 0) {
            return (
                rewardPool.bountyOpensAt <= rewardPool.bountyClosesAt,
                rewardPool.bountyOpensAt,
                rewardPool.bountyClosesAt
            );
        }

        uint64 firstStakedAt = _firstStakedAtForRound(votingEngine, rewardPool.contentId, roundId);
        if (firstStakedAt == 0 || firstStakedAt > rewardPool.bountyStartBy) {
            return (false, firstStakedAt, rewardPool.bountyStartBy);
        }
        return (true, firstStakedAt, uint64(uint256(firstStakedAt) + rewardPool.bountyWindowSeconds));
    }

    function rewardPoolExpired(RewardPool storage rewardPool)
        internal
        view
        returns (bool expired, uint64 bountyClosesAt)
    {
        if (rewardPool.bountyWindowSeconds == 0) return (false, 0);
        if (rewardPool.bountyClosesAt != 0) {
            return (block.timestamp > rewardPool.bountyClosesAt, rewardPool.bountyClosesAt);
        }
        if (block.timestamp <= rewardPool.bountyStartBy) return (false, 0);
        return (true, 0);
    }

    function activateBundleWindowForRoundSet(
        RoundVotingEngine votingEngine,
        BundleReward storage bundle,
        BundleQuestion[] storage questions,
        mapping(uint256 => mapping(uint256 => mapping(uint256 => uint64))) storage bundleRoundIds,
        uint256 bundleId,
        uint256 roundSetIndex
    ) internal returns (bool active) {
        if (bundle.bountyWindowSeconds == 0) return true;
        if (bundle.bountyClosesAt != 0) return bundle.bountyOpensAt <= bundle.bountyClosesAt;

        uint64 firstStakedAt =
            _firstBundleRoundSetStake(votingEngine, questions, bundleRoundIds, bundleId, roundSetIndex);
        if (firstStakedAt == 0) return false;

        if (firstStakedAt > bundle.bountyStartBy) {
            bundle.bountyOpensAt = firstStakedAt;
            bundle.bountyClosesAt = bundle.bountyStartBy;
            bundle.feedbackClosesAt = bundle.bountyStartBy;
            emit QuestionBundleWindowActivated(
                bundle.id, bundle.bountyOpensAt, bundle.bountyClosesAt, bundle.feedbackClosesAt
            );
            return false;
        }

        uint64 bountyClosesAt = uint64(uint256(firstStakedAt) + bundle.bountyWindowSeconds);
        uint64 feedbackClosesAt = uint64(uint256(firstStakedAt) + bundle.feedbackWindowSeconds);
        bundle.bountyOpensAt = firstStakedAt;
        bundle.bountyClosesAt = bountyClosesAt;
        bundle.feedbackClosesAt = feedbackClosesAt;

        emit QuestionBundleWindowActivated(bundle.id, firstStakedAt, bountyClosesAt, feedbackClosesAt);
        return true;
    }

    function bundleRefundClock(BundleReward storage bundle) internal view returns (uint64) {
        if (bundle.bountyWindowSeconds == 0) return 0;
        if (bundle.bountyClosesAt != 0) return bundle.bountyClosesAt;
        return bundle.bountyStartBy;
    }

    function _firstBundleRoundSetStake(
        RoundVotingEngine votingEngine,
        BundleQuestion[] storage questions,
        mapping(uint256 => mapping(uint256 => mapping(uint256 => uint64))) storage bundleRoundIds,
        uint256 bundleId,
        uint256 roundSetIndex
    ) private view returns (uint64 firstStakedAt) {
        for (uint256 i = 0; i < questions.length;) {
            uint256 roundId = bundleRoundIds[bundleId][i][roundSetIndex];
            if (roundId != 0) {
                uint64 candidate = _firstStakedAtForRound(votingEngine, questions[i].contentId, roundId);
                if (candidate != 0 && (firstStakedAt == 0 || candidate < firstStakedAt)) {
                    firstStakedAt = candidate;
                }
            }
            unchecked {
                ++i;
            }
        }
    }

    function _firstStakedAtForRound(RoundVotingEngine votingEngine, uint256 contentId, uint256 roundId)
        private
        view
        returns (uint64 firstStakedAt)
    {
        (uint48 startedAt,, uint16 commitCount,,,,,,,,,,,) = votingEngine.rounds(contentId, roundId);
        if (commitCount == 0) return 0;
        bytes32 firstCommitKey = votingEngine.getRoundCommitKey(contentId, roundId, 0);
        uint48 committedAt = votingEngine.commitCommittedAt(contentId, roundId, firstCommitKey);
        return uint64(committedAt == 0 ? startedAt : committedAt);
    }
}
