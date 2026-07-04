// SPDX-License-Identifier: MIT
pragma solidity ^0.8.34;

import { SafeCast } from "@openzeppelin/contracts/utils/math/SafeCast.sol";
import { IClusterPayoutOracle } from "../interfaces/IClusterPayoutOracle.sol";
import { ContentRegistry } from "../ContentRegistry.sol";
import { ProtocolConfig } from "../ProtocolConfig.sol";
import { RoundVotingEngine } from "../RoundVotingEngine.sol";
import { BundleReward, BundleQuestion, BundleRoundSetSnapshot } from "./QuestionRewardPoolEscrowTypes.sol";
import { QuestionRewardPoolEscrowBundleActionsLib } from "./QuestionRewardPoolEscrowBundleActionsLib.sol";
import { QuestionRewardPoolEscrowBundleLib } from "./QuestionRewardPoolEscrowBundleLib.sol";

library QuestionRewardPoolEscrowBundleRecoveryLib {
    using SafeCast for uint256;

    error RecoveredBundleRoundSetReplacementSnapshotAvailable();

    event RejectedSnapshotBundleRoundSetRecovered(
        uint256 indexed bundleId, uint256 indexed roundSetIndex, uint256 allocationReturned
    );
    event RecoveredSnapshotBundleRoundSetReopened(
        uint256 indexed bundleId, uint256 indexed roundSetIndex, bytes32 newWeightRoot
    );
    event RecoveredSnapshotBundleRoundSetAbandoned(
        uint256 indexed bundleId, uint256 indexed roundSetIndex, uint256 allocation
    );
    event PreQualificationRejectedSnapshotBundleRoundSetSkipped(
        uint256 indexed bundleId, uint256 indexed roundSetIndex, bytes32 snapshotDigest, bytes32 weightRoot
    );

    function skipPreQualificationRejectedSnapshotRoundSet(
        mapping(uint256 => BundleReward) storage bundleRewards,
        mapping(uint256 => BundleQuestion[]) storage bundleQuestions,
        mapping(uint256 => mapping(uint256 => uint32)) storage bundleQuestionRecordedRounds,
        mapping(uint256 => mapping(uint256 => mapping(uint256 => uint64))) storage bundleRoundIds,
        mapping(uint256 => mapping(uint256 => BundleRoundSetSnapshot)) storage bundleRoundSetSnapshots,
        mapping(uint256 => address) storage bundleRewardClusterPayoutOracle,
        mapping(uint256 => uint64) storage bundleRewardClusterPayoutOraclePinnedAt,
        RoundVotingEngine votingEngine,
        uint256 bundleId,
        uint256 roundSetIndex,
        uint8 payoutDomain
    ) external {
        BundleReward storage bundle = bundleRewards[bundleId];
        require(bundle.id != 0, "Bundle not found");
        require(!bundle.refunded, "Bundle refunded");
        require(_usesClusterPayoutSnapshot(bundleRewardClusterPayoutOracle, bundle), "Not cluster-snapshot bundle");
        require(bundle.pendingRecoveredRoundSets == 0, "Recovered round set pending");
        require(roundSetIndex == bundle.completedRoundSets, "Round set out of order");
        require(roundSetIndex < bundle.requiredSettledRounds, "Invalid round set");
        BundleRoundSetSnapshot storage snapshot = bundleRoundSetSnapshots[bundleId][roundSetIndex];
        require(!snapshot.qualified, "Round set qualified");
        require(
            snapshot.clusterSnapshotDigest == bytes32(0) && !snapshot.preQualificationSnapshotlessSkipped,
            "Round set already skipped"
        );
        require(
            QuestionRewardPoolEscrowBundleLib.isRoundSetComplete(
                bundleQuestions, bundleQuestionRecordedRounds, bundleId, roundSetIndex
            ),
            "Round set incomplete"
        );

        (bytes32 snapshotDigest, bytes32 weightRoot) = _requireRejectedOrMissingPreQualificationBundleSnapshot(
            bundleQuestions,
            bundleRoundIds,
            bundleRewardClusterPayoutOracle,
            bundleRewardClusterPayoutOraclePinnedAt,
            votingEngine,
            bundleId,
            roundSetIndex,
            payoutDomain
        );

        snapshot.clusterSnapshotDigest = snapshotDigest;
        snapshot.clusterWeightRoot = weightRoot;
        snapshot.preQualificationSnapshotlessSkipped = snapshotDigest == bytes32(0);

        emit PreQualificationRejectedSnapshotBundleRoundSetSkipped(bundleId, roundSetIndex, snapshotDigest, weightRoot);
    }

    function recoverOrReopenSnapshotRoundSet(
        mapping(uint256 => BundleReward) storage bundleRewards,
        mapping(uint256 => BundleQuestion[]) storage bundleQuestions,
        mapping(uint256 => mapping(uint256 => uint32)) storage bundleQuestionRecordedRounds,
        mapping(uint256 => mapping(uint256 => mapping(uint256 => uint64))) storage bundleRoundIds,
        mapping(uint256 => mapping(uint256 => BundleRoundSetSnapshot)) storage bundleRoundSetSnapshots,
        mapping(uint256 => address) storage bundleRewardClusterPayoutOracle,
        mapping(uint256 => uint64) storage bundleRewardClusterPayoutOraclePinnedAt,
        mapping(uint256 => mapping(uint256 => bool)) storage rejectedRecoveredBundleRoundSet,
        mapping(uint256 => mapping(uint256 => bool)) storage reopenedRecoveredBundleRoundSet,
        mapping(uint256 => mapping(uint256 => mapping(bytes32 => bool))) storage qualifiedBundleRoundSetClaimants,
        ContentRegistry registry,
        RoundVotingEngine votingEngine,
        uint256 bundleId,
        uint256 roundSetIndex,
        uint8 payoutDomain
    ) external {
        if (rejectedRecoveredBundleRoundSet[bundleId][roundSetIndex]) {
            _reopenRecoveredSnapshotRoundSet(
                bundleRewards,
                bundleQuestions,
                bundleQuestionRecordedRounds,
                bundleRoundIds,
                bundleRoundSetSnapshots,
                bundleRewardClusterPayoutOracle,
                bundleRewardClusterPayoutOraclePinnedAt,
                rejectedRecoveredBundleRoundSet,
                reopenedRecoveredBundleRoundSet,
                registry,
                votingEngine,
                bundleId,
                roundSetIndex,
                payoutDomain
            );
        } else {
            _recoverRejectedSnapshotRoundSet(
                bundleRewards,
                bundleQuestions,
                bundleRoundIds,
                bundleRoundSetSnapshots,
                bundleRewardClusterPayoutOracle,
                rejectedRecoveredBundleRoundSet,
                qualifiedBundleRoundSetClaimants,
                votingEngine,
                bundleId,
                roundSetIndex,
                payoutDomain
            );
        }
    }

    function abandonRecoveredRoundSets(
        mapping(uint256 => BundleReward) storage bundleRewards,
        mapping(uint256 => BundleQuestion[]) storage bundleQuestions,
        mapping(uint256 => mapping(uint256 => uint32)) storage bundleQuestionRecordedRounds,
        mapping(uint256 => mapping(uint256 => mapping(uint256 => uint64))) storage bundleRoundIds,
        mapping(uint256 => mapping(uint256 => BundleRoundSetSnapshot)) storage bundleRoundSetSnapshots,
        mapping(uint256 => address) storage bundleRewardClusterPayoutOracle,
        mapping(uint256 => uint64) storage bundleRewardClusterPayoutOraclePinnedAt,
        mapping(uint256 => mapping(uint256 => bool)) storage rejectedRecoveredBundleRoundSet,
        mapping(uint256 => mapping(uint256 => bool)) storage reopenedRecoveredBundleRoundSet,
        ContentRegistry registry,
        RoundVotingEngine votingEngine,
        ProtocolConfig protocolConfig,
        uint256 bundleId,
        uint256[] calldata roundSetIndexes,
        uint8 payoutDomain
    ) external {
        BundleReward storage bundle = bundleRewards[bundleId];
        require(bundle.id != 0, "Bundle not found");
        require(!bundle.refunded, "Bundle refunded");

        uint256 pendingRecoveredRoundSets = bundle.pendingRecoveredRoundSets;
        require(pendingRecoveredRoundSets != 0, "Recovered round set pending");
        require(roundSetIndexes.length != 0, "Round set required");

        address oracleAddr = bundleRewardClusterPayoutOracle[bundleId];
        uint64 pinnedAt = bundleRewardClusterPayoutOraclePinnedAt[bundleId];

        for (uint256 i; i < roundSetIndexes.length;) {
            uint256 roundSetIndex = roundSetIndexes[i];
            require(rejectedRecoveredBundleRoundSet[bundleId][roundSetIndex], "Round set not recovered");
            BundleRoundSetSnapshot storage snapshot = bundleRoundSetSnapshots[bundleId][roundSetIndex];
            if (
                !reopenedRecoveredBundleRoundSet[bundleId][roundSetIndex]
                    && _hasRecoveredReplacementSnapshot(
                        bundleRewards,
                        bundleQuestions,
                        bundleQuestionRecordedRounds,
                        bundleRoundIds,
                        oracleAddr,
                        pinnedAt,
                        bundleRewardClusterPayoutOracle,
                        bundleRewardClusterPayoutOraclePinnedAt,
                        registry,
                        votingEngine,
                        protocolConfig,
                        snapshot.allocation,
                        bundleId,
                        roundSetIndex,
                        payoutDomain
                    )
            ) {
                revert RecoveredBundleRoundSetReplacementSnapshotAvailable();
            }

            require(!snapshot.qualified, "Round set qualified");
            uint256 allocation = snapshot.allocation;

            delete bundleRoundSetSnapshots[bundleId][roundSetIndex];
            rejectedRecoveredBundleRoundSet[bundleId][roundSetIndex] = false;
            reopenedRecoveredBundleRoundSet[bundleId][roundSetIndex] = false;
            unchecked {
                --pendingRecoveredRoundSets;
                ++i;
            }
            emit RecoveredSnapshotBundleRoundSetAbandoned(bundleId, roundSetIndex, allocation);
        }

        bundle.pendingRecoveredRoundSets = uint32(pendingRecoveredRoundSets);
        require(bundle.pendingRecoveredRoundSets == 0, "Recovered round set pending");
    }

    function _recoverRejectedSnapshotRoundSet(
        mapping(uint256 => BundleReward) storage bundleRewards,
        mapping(uint256 => BundleQuestion[]) storage bundleQuestions,
        mapping(uint256 => mapping(uint256 => mapping(uint256 => uint64))) storage bundleRoundIds,
        mapping(uint256 => mapping(uint256 => BundleRoundSetSnapshot)) storage bundleRoundSetSnapshots,
        mapping(uint256 => address) storage bundleRewardClusterPayoutOracle,
        mapping(uint256 => mapping(uint256 => bool)) storage rejectedRecoveredBundleRoundSet,
        mapping(uint256 => mapping(uint256 => mapping(bytes32 => bool))) storage qualifiedBundleRoundSetClaimants,
        RoundVotingEngine votingEngine,
        uint256 bundleId,
        uint256 roundSetIndex,
        uint8 payoutDomain
    ) private {
        BundleReward storage bundle = bundleRewards[bundleId];
        require(bundle.id != 0, "Bundle not found");
        require(!bundle.refunded, "Bundle refunded");
        require(_usesClusterPayoutSnapshot(bundleRewardClusterPayoutOracle, bundle), "Not cluster-snapshot bundle");
        require(roundSetIndex < bundle.requiredSettledRounds, "Invalid round set");

        BundleRoundSetSnapshot storage snapshot = bundleRoundSetSnapshots[bundleId][roundSetIndex];
        require(snapshot.qualified, "Round set not qualified");
        require(!snapshot.firstClaimPaid, "Claims already paid");

        address oracleAddr = bundleRewardClusterPayoutOracle[bundleId];
        IClusterPayoutOracle oracle = IClusterPayoutOracle(oracleAddr);
        uint256 snapshotRoundId = _bundleSnapshotRoundId(roundSetIndex);
        IClusterPayoutOracle.RoundPayoutSnapshot memory oracleSnapshot =
            oracle.getRoundPayoutSnapshot(payoutDomain, bundleId, bundleId, snapshotRoundId);
        bytes32 snapshotKey = oracle.roundPayoutSnapshotKey(payoutDomain, bundleId, bundleId, snapshotRoundId);

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
        bundle.unallocatedAmount += allocationToReturn;
        require(bundle.pendingRecoveredRoundSets < type(uint32).max, "Too many recovered round sets");
        unchecked {
            bundle.pendingRecoveredRoundSets += 1;
        }

        _clearQualifiedBundleRoundSetClaimants(
            qualifiedBundleRoundSetClaimants, bundleQuestions, bundleRoundIds, votingEngine, bundleId, roundSetIndex
        );
        delete bundleRoundSetSnapshots[bundleId][roundSetIndex];
        bundleRoundSetSnapshots[bundleId][roundSetIndex].allocation = allocationToReturn;
        rejectedRecoveredBundleRoundSet[bundleId][roundSetIndex] = true;

        emit RejectedSnapshotBundleRoundSetRecovered(bundleId, roundSetIndex, allocationToReturn);
    }

    function _reopenRecoveredSnapshotRoundSet(
        mapping(uint256 => BundleReward) storage bundleRewards,
        mapping(uint256 => BundleQuestion[]) storage bundleQuestions,
        mapping(uint256 => mapping(uint256 => uint32)) storage bundleQuestionRecordedRounds,
        mapping(uint256 => mapping(uint256 => mapping(uint256 => uint64))) storage bundleRoundIds,
        mapping(uint256 => mapping(uint256 => BundleRoundSetSnapshot)) storage bundleRoundSetSnapshots,
        mapping(uint256 => address) storage bundleRewardClusterPayoutOracle,
        mapping(uint256 => uint64) storage bundleRewardClusterPayoutOraclePinnedAt,
        mapping(uint256 => mapping(uint256 => bool)) storage rejectedRecoveredBundleRoundSet,
        mapping(uint256 => mapping(uint256 => bool)) storage reopenedRecoveredBundleRoundSet,
        ContentRegistry registry,
        RoundVotingEngine votingEngine,
        uint256 bundleId,
        uint256 roundSetIndex,
        uint8 payoutDomain
    ) private {
        BundleReward storage bundle = bundleRewards[bundleId];
        require(bundle.id != 0, "Bundle not found");
        require(!bundle.refunded, "Bundle refunded");
        require(_usesClusterPayoutSnapshot(bundleRewardClusterPayoutOracle, bundle), "Not cluster-snapshot bundle");
        require(roundSetIndex < bundle.requiredSettledRounds, "Invalid round set");
        require(rejectedRecoveredBundleRoundSet[bundleId][roundSetIndex], "Round set not recovered");
        BundleRoundSetSnapshot storage recoveredSnapshot = bundleRoundSetSnapshots[bundleId][roundSetIndex];
        require(!recoveredSnapshot.qualified, "Round set already qualified");
        require(!reopenedRecoveredBundleRoundSet[bundleId][roundSetIndex], "Round set already reopened");

        address oracleAddr = bundleRewardClusterPayoutOracle[bundleId];
        IClusterPayoutOracle oracle = IClusterPayoutOracle(oracleAddr);
        uint256 snapshotRoundId = _bundleSnapshotRoundId(roundSetIndex);
        require(
            oracle.isRoundPayoutSnapshotFinalized(payoutDomain, bundleId, bundleId, snapshotRoundId),
            "Oracle snapshot not finalized"
        );
        IClusterPayoutOracle.RoundPayoutSnapshot memory newSnapshot =
            oracle.getRoundPayoutSnapshot(payoutDomain, bundleId, bundleId, snapshotRoundId);
        require(!_finalizedSnapshotWithinVetoWindow(oracle, newSnapshot), "Oracle snapshot not finalized");
        bytes32 snapshotKey = oracle.roundPayoutSnapshotKey(payoutDomain, bundleId, bundleId, snapshotRoundId);
        bytes32 newSnapshotDigest = oracle.roundPayoutSnapshotProposalDigest(snapshotKey);
        require(!oracle.rejectedRoundPayoutSnapshotDigests(snapshotKey, newSnapshotDigest), "Snapshot payload rejected");
        require(!oracle.rejectedRoundPayoutSnapshotRoots(snapshotKey, newSnapshot.weightRoot), "Snapshot root rejected");
        uint64 sourceReadyAt =
            _bundlePayoutSnapshotSourceReadyAt(bundleQuestions, bundleRoundIds, votingEngine, bundleId, roundSetIndex);
        require(sourceReadyAt != 0, "Cluster source pending");
        require(
            oracle.roundPayoutSnapshotConsumerFor(payoutDomain, bundleId, bundleId, snapshotRoundId) == address(this),
            "Cluster consumer mismatch"
        );
        uint64 pinnedAt = bundleRewardClusterPayoutOraclePinnedAt[bundleId];
        require(pinnedAt != 0, "Oracle not pinned");
        uint64 proposedAt = oracle.roundPayoutSnapshotProposedAt(payoutDomain, bundleId, bundleId, snapshotRoundId);
        require(proposedAt >= sourceReadyAt && proposedAt >= pinnedAt, "Cluster source stale");
        require(
            QuestionRewardPoolEscrowBundleActionsLib.hasQualifiableRecoveredBundleReplacementSnapshot(
                bundleRewards,
                bundleQuestions,
                bundleQuestionRecordedRounds,
                bundleRoundIds,
                bundleRewardClusterPayoutOracle,
                bundleRewardClusterPayoutOraclePinnedAt,
                registry,
                votingEngine,
                votingEngine.protocolConfig(),
                payoutDomain,
                bundleId,
                roundSetIndex,
                recoveredSnapshot.allocation
            ),
            "Replacement not qualifiable"
        );

        if (block.timestamp > bundle.claimDeadline) {
            bundle.claimDeadline = block.timestamp.toUint64();
        }
        reopenedRecoveredBundleRoundSet[bundleId][roundSetIndex] = true;

        emit RecoveredSnapshotBundleRoundSetReopened(bundleId, roundSetIndex, newSnapshot.weightRoot);
    }

    function qualifyRecoveredRoundSetIfNeeded(
        mapping(uint256 => BundleReward) storage bundleRewards,
        mapping(uint256 => BundleQuestion[]) storage bundleQuestions,
        mapping(uint256 => mapping(uint256 => uint32)) storage bundleQuestionRecordedRounds,
        mapping(uint256 => mapping(uint256 => mapping(uint256 => uint64))) storage bundleRoundIds,
        mapping(uint256 => mapping(uint256 => BundleRoundSetSnapshot)) storage bundleRoundSetSnapshots,
        mapping(uint256 => address) storage bundleRewardClusterPayoutOracle,
        mapping(uint256 => uint64) storage bundleRewardClusterPayoutOraclePinnedAt,
        mapping(uint256 => mapping(uint256 => uint256)) storage bundleQuestionTerminalSyncCursor,
        mapping(uint256 => mapping(uint256 => mapping(bytes32 => bool))) storage qualifiedBundleRoundSetClaimants,
        mapping(uint256 => mapping(uint256 => bool)) storage rejectedRecoveredBundleRoundSet,
        mapping(uint256 => mapping(uint256 => bool)) storage reopenedRecoveredBundleRoundSet,
        ContentRegistry registry,
        RoundVotingEngine votingEngine,
        ProtocolConfig protocolConfig,
        uint8 payoutDomain,
        uint256 bundleId,
        uint256 roundSetIndex
    ) external {
        if (!reopenedRecoveredBundleRoundSet[bundleId][roundSetIndex]) return;
        uint256 recoveredAllocation = bundleRoundSetSnapshots[bundleId][roundSetIndex].allocation;
        bool qualified = QuestionRewardPoolEscrowBundleActionsLib.qualifyRecoveredBundleRoundSet(
            bundleRewards,
            bundleQuestions,
            bundleQuestionRecordedRounds,
            bundleRoundIds,
            bundleRoundSetSnapshots,
            bundleRewardClusterPayoutOracle,
            bundleRewardClusterPayoutOraclePinnedAt,
            bundleQuestionTerminalSyncCursor,
            qualifiedBundleRoundSetClaimants,
            registry,
            votingEngine,
            protocolConfig,
            payoutDomain,
            bundleId,
            roundSetIndex,
            recoveredAllocation
        );
        if (qualified) {
            _finishRecoveredRoundSetQualification(
                bundleRewards, rejectedRecoveredBundleRoundSet, reopenedRecoveredBundleRoundSet, bundleId, roundSetIndex
            );
        }
    }

    function _finishRecoveredRoundSetQualification(
        mapping(uint256 => BundleReward) storage bundleRewards,
        mapping(uint256 => mapping(uint256 => bool)) storage rejectedRecoveredBundleRoundSet,
        mapping(uint256 => mapping(uint256 => bool)) storage reopenedRecoveredBundleRoundSet,
        uint256 bundleId,
        uint256 roundSetIndex
    ) private {
        BundleReward storage bundle = bundleRewards[bundleId];
        require(bundle.pendingRecoveredRoundSets > 0, "Recovered round set pending");
        unchecked {
            bundle.pendingRecoveredRoundSets -= 1;
        }
        reopenedRecoveredBundleRoundSet[bundleId][roundSetIndex] = false;
        rejectedRecoveredBundleRoundSet[bundleId][roundSetIndex] = false;
    }

    function _hasRecoveredReplacementSnapshot(
        mapping(uint256 => BundleReward) storage bundleRewards,
        mapping(uint256 => BundleQuestion[]) storage bundleQuestions,
        mapping(uint256 => mapping(uint256 => uint32)) storage bundleQuestionRecordedRounds,
        mapping(uint256 => mapping(uint256 => mapping(uint256 => uint64))) storage bundleRoundIds,
        address oracleAddr,
        uint64 pinnedAt,
        mapping(uint256 => address) storage bundleRewardClusterPayoutOracle,
        mapping(uint256 => uint64) storage bundleRewardClusterPayoutOraclePinnedAt,
        ContentRegistry registry,
        RoundVotingEngine votingEngine,
        ProtocolConfig protocolConfig,
        uint256 recoveredAllocation,
        uint256 bundleId,
        uint256 roundSetIndex,
        uint8 payoutDomain
    ) private view returns (bool) {
        if (oracleAddr == address(0) || pinnedAt == 0) return false;
        BundleReward storage bundle = bundleRewards[bundleId];
        if (roundSetIndex >= bundle.requiredSettledRounds) return false;
        if (
            !QuestionRewardPoolEscrowBundleLib.isRoundSetComplete(
                bundleQuestions, bundleQuestionRecordedRounds, bundleId, roundSetIndex
            )
        ) {
            return false;
        }

        IClusterPayoutOracle oracle = IClusterPayoutOracle(oracleAddr);
        uint256 snapshotRoundId = _bundleSnapshotRoundId(roundSetIndex);
        IClusterPayoutOracle.RoundPayoutSnapshot memory payoutSnapshot;
        try oracle.getRoundPayoutSnapshot(payoutDomain, bundleId, bundleId, snapshotRoundId) returns (
            IClusterPayoutOracle.RoundPayoutSnapshot memory loadedSnapshot
        ) {
            payoutSnapshot = loadedSnapshot;
        } catch {
            return false;
        }
        if (
            payoutSnapshot.status != IClusterPayoutOracle.SnapshotStatus.Proposed
                && payoutSnapshot.status != IClusterPayoutOracle.SnapshotStatus.Challenged
                && payoutSnapshot.status != IClusterPayoutOracle.SnapshotStatus.Finalized
        ) {
            return false;
        }

        uint64 proposedAt = oracle.roundPayoutSnapshotProposedAt(payoutDomain, bundleId, bundleId, snapshotRoundId);
        if (proposedAt < pinnedAt) return false;
        uint64 sourceReadyAt =
            _bundlePayoutSnapshotSourceReadyAt(bundleQuestions, bundleRoundIds, votingEngine, bundleId, roundSetIndex);
        if (sourceReadyAt == 0 || proposedAt < sourceReadyAt) return false;
        if (oracle.roundPayoutSnapshotConsumerFor(payoutDomain, bundleId, bundleId, snapshotRoundId) != address(this)) {
            return false;
        }

        bytes32 snapshotKey = oracle.roundPayoutSnapshotKey(payoutDomain, bundleId, bundleId, snapshotRoundId);
        bytes32 snapshotDigest = oracle.roundPayoutSnapshotProposalDigest(snapshotKey);
        if (oracle.rejectedRoundPayoutSnapshotDigests(snapshotKey, snapshotDigest)) return false;
        if (oracle.rejectedRoundPayoutSnapshotRoots(snapshotKey, payoutSnapshot.weightRoot)) return false;
        if (_isRoundPayoutSnapshotRejectedByCorrelationEpoch(oracle, payoutDomain, bundleId, bundleId, snapshotRoundId)) {
            return false;
        }
        if (payoutSnapshot.status != IClusterPayoutOracle.SnapshotStatus.Finalized) return true;
        if (_finalizedSnapshotWithinVetoWindow(oracle, payoutSnapshot)) return true;

        return QuestionRewardPoolEscrowBundleActionsLib.hasQualifiableRecoveredBundleReplacementSnapshot(
            bundleRewards,
            bundleQuestions,
            bundleQuestionRecordedRounds,
            bundleRoundIds,
            bundleRewardClusterPayoutOracle,
            bundleRewardClusterPayoutOraclePinnedAt,
            registry,
            votingEngine,
            protocolConfig,
            payoutDomain,
            bundleId,
            roundSetIndex,
            recoveredAllocation
        );
    }

    function _clearQualifiedBundleRoundSetClaimants(
        mapping(uint256 => mapping(uint256 => mapping(bytes32 => bool))) storage qualifiedBundleRoundSetClaimants,
        mapping(uint256 => BundleQuestion[]) storage bundleQuestions,
        mapping(uint256 => mapping(uint256 => mapping(uint256 => uint64))) storage bundleRoundIds,
        RoundVotingEngine votingEngine,
        uint256 bundleId,
        uint256 roundSetIndex
    ) private {
        BundleQuestion[] storage questions = bundleQuestions[bundleId];
        if (questions.length == 0) return;
        uint256 firstContentId = questions[0].contentId;
        uint256 firstRoundId = bundleRoundIds[bundleId][0][roundSetIndex];
        if (firstRoundId == 0) return;
        (,, uint16 commitCount,,,,,) = votingEngine.roundCore(firstContentId, firstRoundId);
        for (uint256 i; i < commitCount;) {
            bytes32 commitKey = votingEngine.getRoundCommitKey(firstContentId, firstRoundId, i);
            delete qualifiedBundleRoundSetClaimants[bundleId][roundSetIndex][commitKey];
            unchecked {
                ++i;
            }
        }
    }

    function _requireRejectedOrMissingPreQualificationBundleSnapshot(
        mapping(uint256 => BundleQuestion[]) storage bundleQuestions,
        mapping(uint256 => mapping(uint256 => mapping(uint256 => uint64))) storage bundleRoundIds,
        mapping(uint256 => address) storage bundleRewardClusterPayoutOracle,
        mapping(uint256 => uint64) storage bundleRewardClusterPayoutOraclePinnedAt,
        RoundVotingEngine votingEngine,
        uint256 bundleId,
        uint256 roundSetIndex,
        uint8 payoutDomain
    ) private view returns (bytes32 snapshotDigest, bytes32 weightRoot) {
        address oracleAddr = bundleRewardClusterPayoutOracle[bundleId];
        require(oracleAddr != address(0), "Oracle not pinned");
        uint64 pinnedAt = bundleRewardClusterPayoutOraclePinnedAt[bundleId];
        require(pinnedAt != 0, "Oracle not pinned");
        uint64 sourceReadyAt =
            _bundlePayoutSnapshotSourceReadyAt(bundleQuestions, bundleRoundIds, votingEngine, bundleId, roundSetIndex);
        require(sourceReadyAt != 0, "Cluster source pending");

        IClusterPayoutOracle oracle = IClusterPayoutOracle(oracleAddr);
        uint256 snapshotRoundId = _bundleSnapshotRoundId(roundSetIndex);
        uint64 proposedAt = oracle.roundPayoutSnapshotProposedAt(payoutDomain, bundleId, bundleId, snapshotRoundId);
        if (proposedAt == 0) {
            require(oracle.roundPayoutSnapshotConsumer(payoutDomain) == address(this), "Cluster consumer mismatch");
            return (bytes32(0), bytes32(0));
        }

        IClusterPayoutOracle.RoundPayoutSnapshot memory oracleSnapshot =
            oracle.getRoundPayoutSnapshot(payoutDomain, bundleId, bundleId, snapshotRoundId);
        require(oracleSnapshot.status == IClusterPayoutOracle.SnapshotStatus.Rejected, "Snapshot not rejected");
        require(
            oracle.roundPayoutSnapshotConsumerFor(payoutDomain, bundleId, bundleId, snapshotRoundId) == address(this),
            "Cluster consumer mismatch"
        );
        require(proposedAt >= sourceReadyAt && proposedAt >= pinnedAt, "Cluster source stale");

        bytes32 snapshotKey = oracle.roundPayoutSnapshotKey(payoutDomain, bundleId, bundleId, snapshotRoundId);
        snapshotDigest = oracle.roundPayoutSnapshotProposalDigest(snapshotKey);
        weightRoot = oracleSnapshot.weightRoot;
        bool rejected = oracle.rejectedRoundPayoutSnapshotDigests(snapshotKey, snapshotDigest)
            || oracle.rejectedRoundPayoutSnapshotRoots(snapshotKey, weightRoot)
            || _isRoundPayoutSnapshotRejectedByCorrelationEpoch(
                oracle, payoutDomain, bundleId, bundleId, snapshotRoundId
            );
        require(rejected, "Snapshot rejection missing");
    }

    function _usesClusterPayoutSnapshot(
        mapping(uint256 => address) storage bundleRewardClusterPayoutOracle,
        BundleReward storage bundle
    ) private view returns (bool) {
        return bundleRewardClusterPayoutOracle[bundle.id] != address(0);
    }

    function _bundleSnapshotRoundId(uint256 roundSetIndex) private pure returns (uint256) {
        return roundSetIndex + 1;
    }

    function _finalizedSnapshotWithinVetoWindow(
        IClusterPayoutOracle oracle,
        IClusterPayoutOracle.RoundPayoutSnapshot memory payoutSnapshot
    ) private view returns (bool) {
        return !oracle.isRoundPayoutSnapshotOutsideVetoWindow(
            payoutSnapshot.domain, payoutSnapshot.rewardPoolId, payoutSnapshot.contentId, payoutSnapshot.roundId
        );
    }

    function _bundlePayoutSnapshotSourceReadyAt(
        mapping(uint256 => BundleQuestion[]) storage bundleQuestions,
        mapping(
            uint256
                => mapping(
                uint256 => mapping(uint256 => uint64)
            )
        ) storage bundleRoundIds,
        RoundVotingEngine votingEngine,
        uint256 bundleId,
        uint256 roundSetIndex
    ) private view returns (uint64 readyAt) {
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
