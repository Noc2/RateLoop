// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

struct RewardPool {
    uint64 id;
    uint64 contentId;
    uint64 startRoundId;
    uint64 nextRoundToEvaluate;
    uint64 challengedRoundId;
    uint64 bountyOpensAt;
    uint64 bountyClosesAt;
    uint64 claimDeadline;
    address funder;
    address funderIdentity;
    address submitterIdentity;
    // Deprecated fields retained to preserve proxy storage layout.
    uint256 submitterVoterId;
    address submitterVoterIdNFT;
    uint8 asset;
    uint256 fundedAmount;
    uint256 unallocatedAmount;
    uint256 claimedAmount;
    uint32 requiredVoters;
    uint32 requiredSettledRounds;
    uint32 qualifiedRounds;
    bool refunded;
    bool unallocatedRefunded;
    uint16 frontendFeeBps;
    uint8 bountyKind;
    bool nonRefundable;
    bytes32 reasonHash;
}

struct RoundSnapshot {
    bool qualified;
    uint32 eligibleVoters;
    uint32 rawEligibleVoters;
    uint32 clusterCount;
    uint32 largestClusterEffectiveUnits;
    uint32 locoEffectiveParticipantUnits;
    uint256 allocation;
    uint32 claimedCount;
    uint256 frontendFeeAllocation;
    uint256 totalClaimWeight;
    uint256 claimedWeight;
    uint256 claimedAmount;
    uint256 frontendFeeClaimedAmount;
}

struct BundleReward {
    uint64 id;
    uint64 bountyOpensAt;
    uint64 bountyClosesAt;
    uint64 feedbackClosesAt;
    address funder;
    address funderIdentity;
    uint8 asset;
    uint32 questionCount;
    uint32 requiredCompleters;
    uint32 requiredSettledRounds;
    uint32 completedRoundSets;
    uint32 claimedCount;
    uint16 frontendFeeBps;
    uint256 funderNullifier;
    uint256 fundedAmount;
    uint256 unallocatedAmount;
    uint256 claimedAmount;
    bool refunded;
    // When set, unclaimed residue is forfeited to the protocol treasury instead of
    // refunded to the funder. Mirrors RewardPool.nonRefundable for the mandatory-
    // bounty anti-spam model on registry-initiated submissions.
    bool nonRefundable;
}

struct BundleQuestion {
    uint256 contentId;
    uint256 submitterNullifier;
}

struct BundleRoundSetSnapshot {
    bool qualified;
    uint32 claimedCount;
    uint32 eligibleCompleters;
    uint256 allocation;
    uint256 frontendFeeAllocation;
}
