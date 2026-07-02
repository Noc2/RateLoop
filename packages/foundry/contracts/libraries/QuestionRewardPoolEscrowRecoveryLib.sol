// SPDX-License-Identifier: MIT
pragma solidity ^0.8.34;

import { SafeCast } from "@openzeppelin/contracts/utils/math/SafeCast.sol";
import { IClusterPayoutOracle } from "../interfaces/IClusterPayoutOracle.sol";
import { RoundVotingEngine } from "../RoundVotingEngine.sol";
import { RewardPool, RoundSnapshot } from "./QuestionRewardPoolEscrowTypes.sol";
import { QuestionRewardPoolEscrowQualificationLib } from "./QuestionRewardPoolEscrowQualificationLib.sol";
import { QuestionRewardPoolEscrowWindowLib } from "./QuestionRewardPoolEscrowWindowLib.sol";

library QuestionRewardPoolEscrowRecoveryLib {
    using SafeCast for uint256;

    event RecoveredSnapshotRoundReopened(
        uint256 indexed rewardPoolId, uint256 indexed contentId, uint256 indexed roundId, bytes32 newWeightRoot
    );
    event RejectedSnapshotRoundRecovered(
        uint256 indexed rewardPoolId, uint256 indexed contentId, uint256 indexed roundId, uint256 allocationReturned
    );
    event PreQualificationRejectedSnapshotRoundSkipped(
        uint256 indexed rewardPoolId,
        uint256 indexed contentId,
        uint256 indexed roundId,
        bytes32 snapshotDigest,
        bytes32 weightRoot
    );
    event PreQualificationSnapshotlessClusterRoundSkipped(
        uint256 indexed rewardPoolId, uint256 indexed contentId, uint256 indexed roundId
    );

    function skipPreQualificationRejectedSnapshotRound(
        mapping(uint256 => RewardPool) storage rewardPools,
        mapping(uint256 => mapping(uint256 => RoundSnapshot)) storage roundSnapshots,
        mapping(uint256 => address) storage rewardPoolPayerIdentity,
        mapping(uint256 => bytes32) storage rewardPoolPayerIdentityKey,
        mapping(uint256 => address) storage rewardPoolClusterPayoutOracle,
        mapping(uint256 => uint64) storage rewardPoolClusterPayoutOraclePinnedAt,
        mapping(uint256 => mapping(uint256 => bool)) storage preQualificationRejectedRound,
        RoundVotingEngine votingEngine,
        uint256 rewardPoolId,
        uint256 roundId,
        uint8 payoutDomain
    ) external {
        RewardPool storage rewardPool = rewardPools[rewardPoolId];
        require(rewardPool.id != 0, "Bounty not found");
        require(!rewardPool.refunded, "Bounty refunded");
        require(!rewardPool.unallocatedRefunded, "Bounty refunded");
        require(rewardPool.qualifiedRounds < rewardPool.requiredSettledRounds, "Bounty complete");
        require(_usesClusterPayoutSnapshot(rewardPool, rewardPoolClusterPayoutOracle), "Not cluster-snapshot pool");
        require(roundId >= rewardPool.startRoundId, "Round too early");
        require(roundId == rewardPool.nextRoundToEvaluate, "Round out of order");
        require(!roundSnapshots[rewardPoolId][roundId].qualified, "Round qualified");
        require(!preQualificationRejectedRound[rewardPoolId][roundId], "Round already skipped");
        require(
            QuestionRewardPoolEscrowWindowLib.activateRewardPoolWindowForRound(votingEngine, rewardPool, roundId),
            "Bounty not started"
        );

        (bool roundSettled,, uint256 rawEligibleVoters,,,) = QuestionRewardPoolEscrowQualificationLib.previewRoundQualification(
            QuestionRewardPoolEscrowQualificationLib.QualificationContext({
                votingEngine: votingEngine,
                protocolConfig: votingEngine.protocolConfig(),
                rewardId: rewardPool.id,
                contentId: rewardPool.contentId,
                roundId: roundId,
                bountyOpensAt: rewardPool.bountyOpensAt,
                bountyClosesAt: rewardPool.bountyClosesAt,
                requiredVoters: rewardPool.requiredVoters,
                bountyEligibility: rewardPool.bountyEligibility,
                funder: rewardPool.funder,
                funderIdentity: rewardPoolPayerIdentity[rewardPool.id],
                funderIdentityKey: rewardPoolPayerIdentityKey[rewardPool.id],
                submitterIdentity: rewardPool.submitterIdentity,
                submitterIdentityKey: rewardPool.submitterIdentityKey
            })
        );
        require(roundSettled, "Round not settled");
        (,, uint256 cleanupRemaining, uint48 sourceReadyAt) =
            votingEngine.roundLifecycleState(rewardPool.contentId, roundId);
        require(cleanupRemaining == 0, "Cleanup pending");
        require(sourceReadyAt != 0, "Cluster source pending");

        address oracleAddr = rewardPoolClusterPayoutOracle[rewardPoolId];
        require(oracleAddr != address(0), "Oracle not pinned");
        uint64 pinnedAt = rewardPoolClusterPayoutOraclePinnedAt[rewardPoolId];
        require(pinnedAt != 0, "Oracle not pinned");
        IClusterPayoutOracle oracle = IClusterPayoutOracle(oracleAddr);
        IClusterPayoutOracle.RoundPayoutSnapshot memory oracleSnapshot =
            oracle.getRoundPayoutSnapshot(payoutDomain, rewardPoolId, rewardPool.contentId, roundId);
        require(oracleSnapshot.status == IClusterPayoutOracle.SnapshotStatus.Rejected, "Snapshot not rejected");
        require(oracleSnapshot.rawEligibleVoters == rawEligibleVoters, "Cluster snapshot mismatch");
        require(
            oracle.roundPayoutSnapshotConsumerFor(payoutDomain, rewardPoolId, rewardPool.contentId, roundId)
                == address(this),
            "Cluster consumer mismatch"
        );
        uint64 proposedAt =
            oracle.roundPayoutSnapshotProposedAt(payoutDomain, rewardPoolId, rewardPool.contentId, roundId);
        require(proposedAt >= pinnedAt && proposedAt >= sourceReadyAt, "Cluster source stale");
        bytes32 snapshotKey = oracle.roundPayoutSnapshotKey(payoutDomain, rewardPoolId, rewardPool.contentId, roundId);
        bytes32 snapshotDigest = oracle.roundPayoutSnapshotProposalDigest(snapshotKey);
        bool rejected = oracle.rejectedRoundPayoutSnapshotDigests(snapshotKey, snapshotDigest)
            || oracle.rejectedRoundPayoutSnapshotRoots(snapshotKey, oracleSnapshot.weightRoot)
            || _isRoundPayoutSnapshotRejectedByCorrelationEpoch(
                oracle, payoutDomain, rewardPoolId, rewardPool.contentId, roundId
            );
        require(rejected, "Snapshot rejection missing");

        preQualificationRejectedRound[rewardPoolId][roundId] = true;
        rewardPool.nextRoundToEvaluate = (roundId + 1).toUint64();

        emit PreQualificationRejectedSnapshotRoundSkipped(
            rewardPoolId, rewardPool.contentId, roundId, snapshotDigest, oracleSnapshot.weightRoot
        );
    }

    function skipPreQualificationSnapshotlessClusterRound(
        mapping(uint256 => RewardPool) storage rewardPools,
        mapping(uint256 => mapping(uint256 => RoundSnapshot)) storage roundSnapshots,
        mapping(uint256 => address) storage rewardPoolPayerIdentity,
        mapping(uint256 => bytes32) storage rewardPoolPayerIdentityKey,
        mapping(uint256 => address) storage rewardPoolClusterPayoutOracle,
        mapping(uint256 => uint64) storage rewardPoolClusterPayoutOraclePinnedAt,
        mapping(uint256 => mapping(uint256 => bool)) storage preQualificationRejectedRound,
        RoundVotingEngine votingEngine,
        uint256 rewardPoolId,
        uint256 roundId,
        uint8 payoutDomain
    ) external {
        RewardPool storage rewardPool = rewardPools[rewardPoolId];
        require(rewardPool.id != 0, "Bounty not found");
        require(!rewardPool.refunded, "Bounty refunded");
        require(!rewardPool.unallocatedRefunded, "Bounty refunded");
        require(rewardPool.qualifiedRounds < rewardPool.requiredSettledRounds, "Bounty complete");
        require(_usesClusterPayoutSnapshot(rewardPool, rewardPoolClusterPayoutOracle), "Not cluster-snapshot pool");
        require(roundId >= rewardPool.startRoundId, "Round too early");
        require(roundId == rewardPool.nextRoundToEvaluate, "Round out of order");
        require(!roundSnapshots[rewardPoolId][roundId].qualified, "Round qualified");
        require(!preQualificationRejectedRound[rewardPoolId][roundId], "Round already skipped");
        require(
            QuestionRewardPoolEscrowWindowLib.activateRewardPoolWindowForRound(votingEngine, rewardPool, roundId),
            "Bounty not started"
        );

        (bool roundSettled, bool canQualify,,,) = _snapshotlessRoundStatus(
            rewardPoolPayerIdentity,
            rewardPoolPayerIdentityKey,
            votingEngine,
            rewardPool,
            roundId
        );
        require(roundSettled, "Round not settled");
        require(canQualify, "Too few eligible voters");
        (,, uint256 cleanupRemaining, uint48 sourceReadyAt) =
            votingEngine.roundLifecycleState(rewardPool.contentId, roundId);
        require(cleanupRemaining == 0, "Cleanup pending");
        require(sourceReadyAt != 0, "Cluster source pending");

        address oracleAddr = rewardPoolClusterPayoutOracle[rewardPoolId];
        require(oracleAddr != address(0), "Oracle not pinned");
        uint64 pinnedAt = rewardPoolClusterPayoutOraclePinnedAt[rewardPoolId];
        require(pinnedAt != 0, "Oracle not pinned");
        IClusterPayoutOracle oracle = IClusterPayoutOracle(oracleAddr);
        require(oracle.roundPayoutSnapshotConsumer(payoutDomain) == address(this), "Cluster consumer mismatch");
        require(
            oracle.roundPayoutSnapshotProposedAt(payoutDomain, rewardPoolId, rewardPool.contentId, roundId) == 0,
            "Oracle snapshot exists"
        );

        preQualificationRejectedRound[rewardPoolId][roundId] = true;
        rewardPool.nextRoundToEvaluate = (roundId + 1).toUint64();

        emit PreQualificationSnapshotlessClusterRoundSkipped(rewardPoolId, rewardPool.contentId, roundId);
    }

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
        require(!rewardPool.refunded, "Bounty refunded");
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
        mapping(uint256 => uint64) storage rewardPoolClusterPayoutOraclePinnedAt,
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
        uint64 pinnedAt = rewardPoolClusterPayoutOraclePinnedAt[rewardPoolId];
        require(pinnedAt != 0, "Oracle not pinned");
        require(
            oracle.roundPayoutSnapshotProposedAt(payoutDomain, rewardPoolId, rewardPool.contentId, roundId) >= pinnedAt,
            "Cluster source stale"
        );
        bytes32 snapshotKey = oracle.roundPayoutSnapshotKey(payoutDomain, rewardPoolId, rewardPool.contentId, roundId);
        bytes32 newSnapshotDigest = oracle.roundPayoutSnapshotProposalDigest(snapshotKey);
        require(!oracle.rejectedRoundPayoutSnapshotDigests(snapshotKey, newSnapshotDigest), "Snapshot payload rejected");
        require(!oracle.rejectedRoundPayoutSnapshotRoots(snapshotKey, newSnapshot.weightRoot), "Snapshot root rejected");

        if (roundId + 1 == rewardPool.nextRoundToEvaluate) {
            rewardPool.nextRoundToEvaluate = uint64(roundId);
        }
        reopenedRecoveredRound[rewardPoolId][roundId] = true;

        emit RecoveredSnapshotRoundReopened(rewardPoolId, rewardPool.contentId, roundId, newSnapshot.weightRoot);
    }

    function _usesClusterPayoutSnapshot(
        RewardPool storage rewardPool,
        mapping(uint256 => address) storage rewardPoolClusterPayoutOracle
    ) private view returns (bool) {
        return rewardPoolClusterPayoutOracle[rewardPool.id] != address(0);
    }

    function _snapshotlessRoundStatus(
        mapping(uint256 => address) storage rewardPoolPayerIdentity,
        mapping(uint256 => bytes32) storage rewardPoolPayerIdentityKey,
        RoundVotingEngine votingEngine,
        RewardPool storage rewardPool,
        uint256 roundId
    )
        private
        view
        returns (
            bool roundSettled,
            bool canQualify,
            uint256 rawEligibleVoters,
            uint256 effectiveParticipantUnits,
            uint256 totalClaimWeight
        )
    {
        (bool windowActive, uint64 bountyOpensAt, uint64 bountyClosesAt) =
            QuestionRewardPoolEscrowWindowLib.previewRewardPoolWindowForRound(votingEngine, rewardPool, roundId);
        if (!windowActive) return (false, false, 0, 0, 0);
        (roundSettled, canQualify, rawEligibleVoters, effectiveParticipantUnits, totalClaimWeight,) =
            QuestionRewardPoolEscrowQualificationLib.previewRoundQualification(
                QuestionRewardPoolEscrowQualificationLib.QualificationContext({
                    votingEngine: votingEngine,
                    protocolConfig: votingEngine.protocolConfig(),
                    rewardId: rewardPool.id,
                    contentId: rewardPool.contentId,
                    roundId: roundId,
                    bountyOpensAt: bountyOpensAt,
                    bountyClosesAt: bountyClosesAt,
                    requiredVoters: rewardPool.requiredVoters,
                    bountyEligibility: rewardPool.bountyEligibility,
                    funder: rewardPool.funder,
                    funderIdentity: rewardPoolPayerIdentity[rewardPool.id],
                    funderIdentityKey: rewardPoolPayerIdentityKey[rewardPool.id],
                    submitterIdentity: rewardPool.submitterIdentity,
                    submitterIdentityKey: rewardPool.submitterIdentityKey
                })
            );
    }

    function _isRoundPayoutSnapshotRejectedByCorrelationEpoch(
        IClusterPayoutOracle oracle,
        uint8 payoutDomain,
        uint256 rewardPoolId,
        uint256 contentId,
        uint256 roundId
    ) private view returns (bool) {
        try oracle.isRoundPayoutSnapshotRejectedByCorrelationEpoch(
            payoutDomain, rewardPoolId, contentId, roundId
        ) returns (
            bool rejected
        ) {
            return rejected;
        } catch {
            return false;
        }
    }
}
