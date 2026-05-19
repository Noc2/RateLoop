// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface ILaunchDistributionPool {
    struct LaunchRewardPolicy {
        uint16 minQualifyingScoreBps;
        uint16 minVoters;
        uint16 minVerifiedHumans;
        uint16 minDistinctVerifiedAnchors;
        uint16 minDistinctAnchorRounds;
        uint64 minLaunchCreditStake;
        uint16 maxDistinctRatersPerVerifiedAnchor;
        uint16 maxUnverifiedCreditsPerRound;
        uint16 unverifiedEarnedRaterCapBps;
        uint32 minAnchorCredentialAgeSeconds;
        uint32 eligibilityRatingCount;
        uint32 rewardingRatingCount;
        bool requireNoPendingCleanup;
    }

    function launchAnchorCredentialAgeSeconds() external view returns (uint32);
    function raterRoundCreditRecorded(address rater, uint256 contentId, uint256 roundId) external view returns (bool);

    function recordEarnedRaterReward(
        address rater,
        uint256 contentId,
        uint256 roundId,
        bytes32 commitKey,
        uint16 scoreBps,
        uint16 revealedRaterCount,
        bool noPendingCleanup,
        uint256 stakeAmount,
        bytes32[] calldata verifiedAnchorIds
    ) external returns (uint256 paidAmount);

    function recordEarnedRaterRewardWithSourceReady(
        address rater,
        uint256 contentId,
        uint256 roundId,
        bytes32 commitKey,
        uint16 scoreBps,
        uint16 revealedRaterCount,
        bool noPendingCleanup,
        uint256 stakeAmount,
        bytes32[] calldata verifiedAnchorIds,
        uint64 sourceReadyAt
    ) external returns (uint256 paidAmount);

    function recordAdvisoryRaterReward(
        address rater,
        uint256 contentId,
        uint256 roundId,
        bytes32 advisoryCommitKey,
        uint16 scoreBps,
        uint16 revealedRaterCount,
        bool noPendingCleanup,
        bytes32[] calldata verifiedAnchorIds
    ) external returns (bool recorded, uint256 paidAmount);

    function recordAdvisoryRaterRewardWithSourceReady(
        address rater,
        uint256 contentId,
        uint256 roundId,
        bytes32 advisoryCommitKey,
        uint16 scoreBps,
        uint16 revealedRaterCount,
        bool noPendingCleanup,
        bytes32[] calldata verifiedAnchorIds,
        uint64 sourceReadyAt
    ) external returns (bool recorded, uint256 paidAmount);
}
