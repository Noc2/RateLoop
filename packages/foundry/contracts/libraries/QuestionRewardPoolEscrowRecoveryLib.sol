// SPDX-License-Identifier: MIT
pragma solidity ^0.8.34;

import { IClusterPayoutOracle } from "../interfaces/IClusterPayoutOracle.sol";
import { RewardPool, RoundSnapshot } from "./QuestionRewardPoolEscrowTypes.sol";

library QuestionRewardPoolEscrowRecoveryLib {
    uint8 internal constant REWARD_ASSET_USDC = 1;

    event RecoveredSnapshotRoundReopened(
        uint256 indexed rewardPoolId, uint256 indexed contentId, uint256 indexed roundId, bytes32 newWeightRoot
    );
    event RejectedSnapshotRoundRecovered(
        uint256 indexed rewardPoolId, uint256 indexed contentId, uint256 indexed roundId, uint256 allocationReturned
    );

    function recoverRejectedSnapshotRound(
        mapping(uint256 => RewardPool) storage rewardPools,
        mapping(uint256 => mapping(uint256 => RoundSnapshot)) storage roundSnapshots,
        mapping(uint256 => address) storage rewardPoolClusterPayoutOracle,
        mapping(uint256 => mapping(uint256 => bool)) storage rejectedRecoveredRound,
        uint256 rewardPoolId,
        uint256 roundId,
        uint8 payoutDomain
    ) external {
        RewardPool storage rewardPool = rewardPools[rewardPoolId];
        require(rewardPool.id != 0, "Bounty not found");
        require(_usesClusterPayoutSnapshot(rewardPool, rewardPoolClusterPayoutOracle), "Not cluster-snapshot pool");

        RoundSnapshot storage snapshot = roundSnapshots[rewardPoolId][roundId];
        require(snapshot.qualified, "Round not qualified");
        require(!snapshot.firstClaimPaid, "Claims already paid");

        address oracleAddr = rewardPoolClusterPayoutOracle[rewardPoolId];
        require(oracleAddr != address(0), "Oracle not pinned");
        IClusterPayoutOracle oracle = IClusterPayoutOracle(oracleAddr);
        IClusterPayoutOracle.RoundPayoutSnapshot memory oracleSnapshot =
            oracle.getRoundPayoutSnapshot(payoutDomain, rewardPoolId, rewardPool.contentId, roundId);
        bytes32 snapshotKey = oracle.roundPayoutSnapshotKey(payoutDomain, rewardPoolId, rewardPool.contentId, roundId);
        bool cachedSnapshotRejected;
        if (snapshot.clusterSnapshotDigest != bytes32(0)) {
            cachedSnapshotRejected =
                oracle.rejectedRoundPayoutSnapshotDigests(snapshotKey, snapshot.clusterSnapshotDigest);
            if (
                !cachedSnapshotRejected && oracleSnapshot.status == IClusterPayoutOracle.SnapshotStatus.Rejected
                    && oracleSnapshot.weightRoot == snapshot.clusterWeightRoot
            ) {
                cachedSnapshotRejected =
                    oracle.roundPayoutSnapshotProposalDigest(snapshotKey) == snapshot.clusterSnapshotDigest;
            }
        }
        if (!cachedSnapshotRejected) {
            cachedSnapshotRejected = oracle.rejectedRoundPayoutSnapshotRoots(snapshotKey, snapshot.clusterWeightRoot);
        }
        require(cachedSnapshotRejected, "Snapshot not rejected");

        uint256 allocationToReturn = snapshot.allocation;
        rewardPool.unallocatedAmount += allocationToReturn;
        require(rewardPool.qualifiedRounds > 0, "No qualified rounds");
        require(rewardPool.pendingRecoveredRounds < type(uint32).max, "Too many recovered rounds");
        unchecked {
            rewardPool.qualifiedRounds -= 1;
            rewardPool.pendingRecoveredRounds += 1;
        }
        delete roundSnapshots[rewardPoolId][roundId];
        roundSnapshots[rewardPoolId][roundId].allocation = allocationToReturn;
        rejectedRecoveredRound[rewardPoolId][roundId] = true;

        emit RejectedSnapshotRoundRecovered(rewardPoolId, rewardPool.contentId, roundId, allocationToReturn);
    }

    function reopenRecoveredSnapshotRound(
        mapping(uint256 => RewardPool) storage rewardPools,
        mapping(uint256 => mapping(uint256 => RoundSnapshot)) storage roundSnapshots,
        mapping(uint256 => address) storage rewardPoolClusterPayoutOracle,
        mapping(uint256 => mapping(uint256 => bool)) storage rejectedRecoveredRound,
        mapping(uint256 => mapping(uint256 => bool)) storage reopenedRecoveredRound,
        uint256 rewardPoolId,
        uint256 roundId,
        uint8 payoutDomain
    ) external {
        RewardPool storage rewardPool = rewardPools[rewardPoolId];
        require(rewardPool.id != 0, "Bounty not found");
        require(_usesClusterPayoutSnapshot(rewardPool, rewardPoolClusterPayoutOracle), "Not cluster-snapshot pool");
        require(!rewardPool.refunded, "Bounty refunded");
        require(rewardPool.qualifiedRounds < rewardPool.requiredSettledRounds, "Bounty complete");
        require(rejectedRecoveredRound[rewardPoolId][roundId], "Round not recovered");
        require(!roundSnapshots[rewardPoolId][roundId].qualified, "Round already qualified");
        require(roundId < rewardPool.nextRoundToEvaluate, "Cursor not advanced");

        address oracleAddr = rewardPoolClusterPayoutOracle[rewardPoolId];
        require(oracleAddr != address(0), "Oracle not pinned");
        IClusterPayoutOracle oracle = IClusterPayoutOracle(oracleAddr);
        require(
            oracle.isRoundPayoutSnapshotFinalized(payoutDomain, rewardPoolId, rewardPool.contentId, roundId),
            "Oracle snapshot not finalized"
        );
        IClusterPayoutOracle.RoundPayoutSnapshot memory newSnapshot =
            oracle.getRoundPayoutSnapshot(payoutDomain, rewardPoolId, rewardPool.contentId, roundId);
        bytes32 snapshotKey = oracle.roundPayoutSnapshotKey(payoutDomain, rewardPoolId, rewardPool.contentId, roundId);
        bytes32 newSnapshotDigest = oracle.roundPayoutSnapshotProposalDigest(snapshotKey);
        require(!oracle.rejectedRoundPayoutSnapshotDigests(snapshotKey, newSnapshotDigest), "Snapshot payload rejected");
        require(!oracle.rejectedRoundPayoutSnapshotRoots(snapshotKey, newSnapshot.weightRoot), "Snapshot root rejected");

        if (roundId + 1 == rewardPool.nextRoundToEvaluate) {
            rewardPool.nextRoundToEvaluate = uint64(roundId);
        }
        reopenedRecoveredRound[rewardPoolId][roundId] = true;
        rejectedRecoveredRound[rewardPoolId][roundId] = false;

        emit RecoveredSnapshotRoundReopened(rewardPoolId, rewardPool.contentId, roundId, newSnapshot.weightRoot);
    }

    function _usesClusterPayoutSnapshot(
        RewardPool storage rewardPool,
        mapping(uint256 => address) storage rewardPoolClusterPayoutOracle
    ) private view returns (bool) {
        return rewardPool.asset == REWARD_ASSET_USDC && rewardPoolClusterPayoutOracle[rewardPool.id] != address(0);
    }
}
