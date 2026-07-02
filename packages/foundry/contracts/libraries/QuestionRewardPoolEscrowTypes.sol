// SPDX-License-Identifier: MIT
pragma solidity ^0.8.34;

uint8 constant BOUNTY_ELIGIBILITY_OPEN = 0;
uint8 constant BOUNTY_ELIGIBILITY_SELFIE = 1 << 1;
uint8 constant BOUNTY_ELIGIBILITY_PASSPORT = 1 << 2;
uint8 constant BOUNTY_ELIGIBILITY_VERIFIED_HUMAN = 1 << 3;
uint8 constant BOUNTY_ELIGIBILITY_RECENT_RECHECK_FLAG = 0x80;
uint8 constant BOUNTY_ELIGIBILITY_CREDENTIAL_MASK =
    BOUNTY_ELIGIBILITY_SELFIE | BOUNTY_ELIGIBILITY_PASSPORT | BOUNTY_ELIGIBILITY_VERIFIED_HUMAN;

struct RewardPool {
    uint64 id;
    uint64 contentId;
    uint64 startRoundId;
    uint64 nextRoundToEvaluate;
    uint64 challengedRoundId;
    uint64 bountyStartBy;
    uint64 bountyOpensAt;
    uint64 bountyClosesAt;
    // Informational only: feedbackClosesAt (and feedbackWindowSeconds below) are computed and emitted
    // for off-chain consumers to display a feedback window. They are NOT read by any on-chain
    // eligibility/qualification/claim check here (the same is true of the BundleReward equivalents).
    uint64 feedbackClosesAt;
    uint64 claimDeadline;
    address funder;
    address funderIdentity;
    address submitterIdentity;
    bytes32 funderIdentityKey;
    bytes32 submitterIdentityKey;
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
    uint32 bountyWindowSeconds;
    uint32 feedbackWindowSeconds;
    uint8 bountyKind;
    uint8 bountyEligibility;
    bool nonRefundable;
    bytes32 reasonHash;
    bytes32 bountyEligibilityDataHash;
    // Append-only upgrade field. Keep after all pre-existing RewardPool fields so
    // deployed proxy storage for packed fields above remains stable.
    uint32 pendingRecoveredRounds;
    uint32 pendingPreQualificationRejectedRounds;
}

struct RoundSnapshot {
    bool qualified;
    uint32 eligibleVoters;
    uint32 rawEligibleVoters;
    uint256 allocation;
    uint32 claimedCount;
    uint256 frontendFeeAllocation;
    uint256 totalClaimWeight;
    uint256 claimedWeight;
    uint256 claimedAmount;
    uint256 frontendFeeClaimedAmount;
    // M-Oracle-2-Followup (audit 2026-05-17): tracks whether at least one claim
    // against this round has moved real funds.
    bool firstClaimPaid;
    // M-Oracle-3 (audit 2026-05-17): cluster-qualified snapshots bind to the finalized payout
    // root used at qualification time so later replacement roots cannot satisfy old snapshots.
    bytes32 clusterWeightRoot;
    // Exact oracle proposal payload qualified into this snapshot. This preserves recovery proof
    // when metadata around a deterministic root is rejected, then replaced with the same root.
    bytes32 clusterSnapshotDigest;
}

struct BundleReward {
    uint64 id;
    uint64 bountyStartBy;
    uint64 bountyOpensAt;
    uint64 bountyClosesAt;
    uint64 feedbackClosesAt;
    uint64 claimDeadline;
    address funder;
    address funderIdentity;
    uint8 asset;
    uint32 questionCount;
    uint32 requiredCompleters;
    uint32 requiredSettledRounds;
    uint32 completedRoundSets;
    uint32 claimedCount;
    uint16 frontendFeeBps;
    uint32 bountyWindowSeconds;
    uint32 feedbackWindowSeconds;
    uint8 bountyEligibility;
    bytes32 funderIdentityKey;
    uint256 fundedAmount;
    uint256 unallocatedAmount;
    uint256 claimedAmount;
    bytes32 bountyEligibilityDataHash;
    bool refunded;
    // When set, unclaimed residue is forfeited to the protocol treasury instead of
    // refunded to the funder. Mirrors RewardPool.nonRefundable for the mandatory-
    // bounty anti-spam model on registry-initiated submissions.
    bool nonRefundable;
    uint32 pendingRecoveredRoundSets;
}

struct BundleQuestion {
    uint256 contentId;
    bytes32 submitterIdentityKey;
}

struct BundleRoundSetSnapshot {
    bool qualified;
    uint32 claimedCount;
    uint32 eligibleCompleters;
    uint32 rawEligibleCompleters;
    uint256 allocation;
    uint256 frontendFeeAllocation;
    uint256 totalClaimWeight;
    uint256 claimedWeight;
    uint256 claimedAmount;
    uint256 frontendFeeClaimedAmount;
    bool firstClaimPaid;
    bytes32 clusterWeightRoot;
    bytes32 clusterSnapshotDigest;
}

/// @dev Caller-supplied params for `QuestionRewardPoolEscrowPoolActionsLib.createRewardPool`.
///      Packed into a struct for the same IR-minimum stack budget reason as
///      `CreateSubmissionBundleParams` -- the previous 22-arg signature blew the stack.
struct CreateRewardPoolParams {
    uint256 contentId;
    address funder;
    address payer;
    uint8 asset;
    uint256 amount;
    uint256 requiredVoters;
    uint256 requiredSettledRounds;
    uint256 bountyStartBy;
    uint256 bountyWindowSeconds;
    uint256 feedbackWindowSeconds;
    uint8 bountyEligibility;
    bool nonRefundable;
    uint8 bountyKind;
    uint256 relatedRoundId;
    bytes32 reasonHash;
}

/// @dev Caller-supplied params for `QuestionRewardPoolEscrowBundleActionsLib.createSubmissionBundleFromRegistry`.
///      Packed into a struct so the lib entry point stays under the IR-minimum stack budget
///      that `forge coverage --ir-minimum` enforces (the previous 19-arg signature blew the
///      stack on Yul ABI encoding).
struct CreateSubmissionBundleParams {
    uint256 bundleId;
    uint256[] contentIds;
    address funder;
    uint8 asset;
    uint256 amount;
    uint256 requiredCompleters;
    uint256 requiredSettledRounds;
    uint256 bountyStartBy;
    uint256 bountyWindowSeconds;
    uint256 feedbackWindowSeconds;
    uint8 bountyEligibility;
}
