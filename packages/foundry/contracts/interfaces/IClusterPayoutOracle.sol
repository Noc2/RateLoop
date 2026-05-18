// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IClusterPayoutOracle {
    enum SnapshotStatus {
        None,
        Proposed,
        Challenged,
        Finalized,
        Rejected
    }

    struct RoundPayoutSnapshot {
        bytes32 snapshotKey;
        uint8 domain;
        uint64 correlationEpochId;
        uint64 finalizedAt;
        uint32 rawEligibleVoters;
        uint32 effectiveParticipantUnits;
        uint256 rewardPoolId;
        uint256 contentId;
        uint256 roundId;
        uint256 totalClaimWeight;
        bytes32 weightRoot;
        bytes32 reasonRoot;
        SnapshotStatus status;
    }

    struct RoundPayoutSnapshotInput {
        uint8 domain;
        uint256 rewardPoolId;
        uint256 contentId;
        uint256 roundId;
        uint64 correlationEpochId;
        uint32 rawEligibleVoters;
        uint32 effectiveParticipantUnits;
        uint256 totalClaimWeight;
        bytes32 weightRoot;
        bytes32 reasonRoot;
        bytes32 artifactHash;
        string artifactURI;
    }

    struct PayoutWeight {
        uint8 domain;
        uint256 rewardPoolId;
        uint256 contentId;
        uint256 roundId;
        bytes32 commitKey;
        bytes32 identityKey;
        address account;
        uint256 baseWeight;
        uint16 independenceBps;
        uint256 effectiveWeight;
        bytes32 reasonHash;
    }

    function roundPayoutSnapshotKey(uint8 domain, uint256 rewardPoolId, uint256 contentId, uint256 roundId)
        external
        pure
        returns (bytes32);

    function isRoundPayoutSnapshotFinalized(uint8 domain, uint256 rewardPoolId, uint256 contentId, uint256 roundId)
        external
        view
        returns (bool);

    function getRoundPayoutSnapshot(uint8 domain, uint256 rewardPoolId, uint256 contentId, uint256 roundId)
        external
        view
        returns (RoundPayoutSnapshot memory);

    function rejectedRoundPayoutSnapshotRoots(bytes32 snapshotKey, bytes32 weightRoot) external view returns (bool);

    function verifyPayoutWeight(PayoutWeight calldata payout, bytes32[] calldata proof) external view returns (bool);
}
