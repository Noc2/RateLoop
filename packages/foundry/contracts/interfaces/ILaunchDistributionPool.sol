// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface ILaunchDistributionPool {
    struct LaunchRewardPolicy {
        uint16 minQualifyingScoreBps;
        uint16 minVoters;
        uint16 minVerifiedHumans;
        uint16 minDistinctVerifiedAnchors;
        uint16 minDistinctAnchorRounds;
        uint32 eligibilityRatingCount;
        uint32 rewardingRatingCount;
        bool requireNoPendingCleanup;
    }

    function recordEarnedRaterReward(
        address rater,
        uint256 contentId,
        uint256 roundId,
        bytes32 commitKey,
        uint16 scoreBps,
        uint16 revealedRaterCount,
        bool noPendingCleanup,
        bytes32[] calldata verifiedAnchorIds
    ) external returns (uint256 paidAmount);
}
