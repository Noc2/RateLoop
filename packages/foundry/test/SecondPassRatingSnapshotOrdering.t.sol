// SPDX-License-Identifier: MIT
pragma solidity ^0.8.34;

import { Vm } from "forge-std/Vm.sol";
import { IClusterPayoutOracle } from "../contracts/interfaces/IClusterPayoutOracle.sol";
import { ContentRegistryRatingSnapshotLib } from "../contracts/libraries/ContentRegistryRatingSnapshotLib.sol";
import { RoundLib } from "../contracts/libraries/RoundLib.sol";
import { ClusterPayoutOracle } from "../contracts/ClusterPayoutOracle.sol";
import { RoundEngineReadHelpers } from "./helpers/RoundEngineReadHelpers.sol";
import { SecondPassAuditRegressionBase } from "./helpers/SecondPassAuditRegressionBase.sol";

contract SecondPassRatingSnapshotOrderingTest is SecondPassAuditRegressionBase {
    uint64 internal constant RATING_EVIDENCE_BASE_UNIT = 1_000_000;
    uint64 internal constant RATING_EVIDENCE_STAKE_BONUS_CAP = 10_000_000;
    uint64 internal constant RATING_EVIDENCE_MAX_STAKE_BONUS = 1_000_000;

    function testPublicRatingSnapshotsApplyInRoundOrderAcrossRbtsPendingRounds() public {
        ClusterPayoutOracle oracle = _enableClusterPayoutOracle();
        uint256 contentId = _submitQuestion("rating-order");

        uint256 firstRoundId = _moveRoundToSettlementPending(contentId);
        vm.warp(block.timestamp + 24 hours + 1);
        uint256 secondRoundId = _settleRoundWith(_threeVoters(), contentId, _directions(true, true, false));
        assertEq(secondRoundId, firstRoundId + 1);

        (IClusterPayoutOracle.PayoutWeight[] memory secondWeights, bytes32[][] memory secondProofs) =
            _finalizePublicRatingPayoutSnapshot(oracle, contentId, secondRoundId, 3);

        vm.expectRevert(
            abi.encodeWithSelector(ContentRegistryRatingSnapshotLib.RatingSnapshotOutOfOrder.selector, firstRoundId)
        );
        registry.applyRatingPayoutSnapshot(contentId, secondRoundId, secondWeights, secondProofs);

        RoundLib.Round memory firstRound = RoundEngineReadHelpers.round(votingEngine, contentId, firstRoundId);
        _applyIdentityRbtsSettlementSnapshot(votingEngine, contentId, firstRoundId, firstRound.revealedCount);

        (IClusterPayoutOracle.PayoutWeight[] memory firstWeights, bytes32[][] memory firstProofs) =
            _finalizePublicRatingPayoutSnapshot(oracle, contentId, firstRoundId, 3);

        registry.applyRatingPayoutSnapshot(contentId, firstRoundId, firstWeights, firstProofs);
        assertTrue(registry.isRoundPayoutSnapshotConsumed(3, 0, contentId, firstRoundId));

        registry.applyRatingPayoutSnapshot(contentId, secondRoundId, secondWeights, secondProofs);
        assertTrue(registry.isRoundPayoutSnapshotConsumed(3, 0, contentId, secondRoundId));

        assertGt(registry.getRating(contentId), 0);
    }

    function testPublicRatingSnapshotCursorAdvancesSkippedRoundsInBoundedBatches() public {
        ClusterPayoutOracle oracle = _enableClusterPayoutOracle();
        uint256 contentId = _submitQuestion("rating-cursor-batches");

        uint256 firstSkippedRoundId = _cancelEmptyRound(contentId);
        uint256 skippedRounds = 6;
        for (uint256 i = 1; i < skippedRounds; i++) {
            _cancelEmptyRound(contentId);
        }

        uint256 settledRoundId = _settleRoundWith(_threeVoters(), contentId, _directions(true, true, false));
        assertEq(settledRoundId, firstSkippedRoundId + skippedRounds);

        (IClusterPayoutOracle.PayoutWeight[] memory weights, bytes32[][] memory proofs) =
            _finalizePublicRatingPayoutSnapshot(oracle, contentId, settledRoundId, 3);

        vm.expectRevert(
            abi.encodeWithSelector(
                ContentRegistryRatingSnapshotLib.RatingSnapshotOutOfOrder.selector, firstSkippedRoundId
            )
        );
        registry.applyRatingPayoutSnapshot(contentId, settledRoundId, weights, proofs);

        registry.advanceRatingSnapshotCursor(contentId, 2);

        vm.expectRevert(
            abi.encodeWithSelector(
                ContentRegistryRatingSnapshotLib.RatingSnapshotOutOfOrder.selector, firstSkippedRoundId + 2
            )
        );
        registry.applyRatingPayoutSnapshot(contentId, settledRoundId, weights, proofs);

        registry.advanceRatingSnapshotCursor(contentId, 2);

        vm.expectRevert(
            abi.encodeWithSelector(
                ContentRegistryRatingSnapshotLib.RatingSnapshotOutOfOrder.selector, firstSkippedRoundId + 4
            )
        );
        registry.applyRatingPayoutSnapshot(contentId, settledRoundId, weights, proofs);

        registry.advanceRatingSnapshotCursor(contentId, 10);

        registry.applyRatingPayoutSnapshot(contentId, settledRoundId, weights, proofs);
        assertTrue(registry.isRoundPayoutSnapshotConsumed(3, 0, contentId, settledRoundId));
    }

    function testPublicRatingSnapshotCursorSkipsPendingRoundWithoutProposalAfterGrace() public {
        ClusterPayoutOracle oracle = _enableClusterPayoutOracle();
        uint256 contentId = _submitQuestion("rating-no-proposer");
        uint256 roundId = _settleRoundWith(_threeVoters(), contentId, _directions(true, true, false));

        assertFalse(registry.isRoundPayoutSnapshotConsumed(3, 0, contentId, roundId));
        registry.advanceRatingSnapshotCursor(contentId, 1);
        assertFalse(registry.isRoundPayoutSnapshotConsumed(3, 0, contentId, roundId), "grace blocks early skip");

        vm.warp(block.timestamp + 1 hours);
        vm.expectEmit(true, true, true, true, address(registry));
        emit ContentRegistryRatingSnapshotLib.RatingSnapshotSkipped(
            contentId, roundId, address(oracle), keccak256("rateloop.rating-snapshot.no-proposal-skip.v1")
        );
        registry.advanceRatingSnapshotCursor(contentId, 1);

        assertFalse(registry.isRoundPayoutSnapshotConsumed(3, 0, contentId, roundId));
        vm.prank(address(oracle));
        assertGt(registry.roundPayoutSnapshotSourceReadyAt(3, 0, contentId, roundId), 0);
    }

    function testPublicRatingNoProposalSkipCanStillApplyLateSnapshotBeforeLaterApply() public {
        ClusterPayoutOracle oracle = _enableClusterPayoutOracle();
        uint256 contentId = _submitQuestion("rating-late-after-skip");
        uint256 roundId = _settleRoundWith(_threeVoters(), contentId, _directions(true, true, false));

        vm.warp(block.timestamp + 1 hours);
        registry.advanceRatingSnapshotCursor(contentId, 1);
        assertFalse(registry.isRoundPayoutSnapshotConsumed(3, 0, contentId, roundId));

        (IClusterPayoutOracle.PayoutWeight[] memory weights, bytes32[][] memory proofs) =
            _finalizePublicRatingPayoutSnapshot(oracle, contentId, roundId, 3);
        registry.applyRatingPayoutSnapshot(contentId, roundId, weights, proofs);

        assertTrue(registry.isRoundPayoutSnapshotConsumed(3, 0, contentId, roundId));
    }

    function testPublicRatingLaterApplyClosesOlderProvisionalSkip() public {
        ClusterPayoutOracle oracle = _enableClusterPayoutOracle();
        uint256 contentId = _submitQuestion("rating-late-closed");

        uint256 firstRoundId = _settleRoundWith(_threeVoters(), contentId, _directions(true, true, false));
        vm.warp(block.timestamp + 1 hours);
        registry.advanceRatingSnapshotCursor(contentId, 1);

        vm.warp(block.timestamp + 24 hours + 1);
        uint256 secondRoundId = _settleRoundWith(_threeVoters(), contentId, _directions(true, false, true));
        assertEq(secondRoundId, firstRoundId + 1);
        (IClusterPayoutOracle.PayoutWeight[] memory secondWeights, bytes32[][] memory secondProofs) =
            _finalizePublicRatingPayoutSnapshot(oracle, contentId, secondRoundId, 3);
        registry.applyRatingPayoutSnapshot(contentId, secondRoundId, secondWeights, secondProofs);

        vm.prank(address(oracle));
        assertEq(registry.roundPayoutSnapshotSourceReadyAt(3, 0, contentId, firstRoundId), 0);
        assertFalse(registry.isRoundPayoutSnapshotConsumed(3, 0, contentId, firstRoundId));
    }

    function testPublicRatingDirectRejectedSnapshotWaitsFreshGraceBeforeSkip() public {
        ClusterPayoutOracle oracle = _enableClusterPayoutOracle();
        uint256 contentId = _submitQuestion("rating-direct-reject-grace");
        uint256 roundId = _settleRoundWith(_threeVoters(), contentId, _directions(true, true, false));

        bytes32[] memory leaves;
        IClusterPayoutOracle.PayoutWeight[] memory weights;
        (weights, leaves) = _publicRatingPayoutLeaves(oracle, contentId, roundId, 3);
        bytes32 snapshotKey = _finalizePublicRatingPayoutSnapshotWithRoot(
            oracle, contentId, roundId, 3, 30_000, _sumEffectiveWeights(weights), _merkleRoot(leaves)
        );

        oracle.rejectFinalizedRoundPayoutSnapshot(snapshotKey, keccak256("bad-direct-rating-snapshot"));
        uint64 rejectedAt = oracle.roundPayoutSnapshotRejectedAt(snapshotKey);
        assertEq(rejectedAt, block.timestamp);

        vm.recordLogs();
        registry.advanceRatingSnapshotCursor(contentId, 1);
        _assertNoRatingSnapshotSkippedLog(vm.getRecordedLogs());

        vm.warp(uint256(rejectedAt) + 1 hours);
        vm.expectEmit(true, true, true, true, address(registry));
        emit ContentRegistryRatingSnapshotLib.RatingSnapshotSkipped(
            contentId, roundId, address(oracle), keccak256("rateloop.rating-snapshot.no-proposal-skip.v1")
        );
        registry.advanceRatingSnapshotCursor(contentId, 1);
    }

    function testPublicRatingParentRejectedSnapshotWaitsFreshGraceBeforeSkip() public {
        ClusterPayoutOracle oracle = _enableClusterPayoutOracle();
        uint256 contentId = _submitQuestion("rating-parent-reject-grace");
        uint256 roundId = _settleRoundWith(_threeVoters(), contentId, _directions(true, true, false));
        uint64 correlationEpochId = uint64(roundId + 1000);

        bytes32[] memory leaves;
        IClusterPayoutOracle.PayoutWeight[] memory weights;
        (weights, leaves) = _publicRatingPayoutLeaves(oracle, contentId, roundId, 3);
        oracle.proposeCorrelationEpoch(
            correlationEpochId,
            uint64(roundId),
            uint64(roundId),
            keccak256(abi.encode("public-rating-cluster-root", roundId, correlationEpochId)),
            keccak256("params"),
            keccak256("epoch-artifact"),
            "ipfs://rating-epoch",
            _publicRatingEpochSources(contentId, roundId)
        );
        oracle.proposeRoundPayoutSnapshot(
            IClusterPayoutOracle.RoundPayoutSnapshotInput({
                domain: oracle.PAYOUT_DOMAIN_PUBLIC_RATING(),
                rewardPoolId: 0,
                contentId: contentId,
                roundId: roundId,
                correlationEpochId: correlationEpochId,
                rawEligibleVoters: 3,
                effectiveParticipantUnits: 30_000,
                totalClaimWeight: _sumEffectiveWeights(weights),
                weightRoot: _merkleRoot(leaves),
                reasonRoot: keccak256("rating-reason-root"),
                artifactHash: keccak256("epoch-artifact"),
                artifactURI: "ipfs://rating-round"
            })
        );
        bytes32 snapshotKey =
            oracle.roundPayoutSnapshotKey(oracle.PAYOUT_DOMAIN_PUBLIC_RATING(), 0, contentId, roundId);
        uint64 proposedAt =
            oracle.roundPayoutSnapshotProposedAt(oracle.PAYOUT_DOMAIN_PUBLIC_RATING(), 0, contentId, roundId);

        vm.warp(uint256(proposedAt) + 1 hours + 1);
        oracle.rejectCorrelationEpoch(correlationEpochId, keccak256("bad-parent-rating-snapshot"));
        uint64 parentRejectedAt = oracle.roundPayoutSnapshotCorrelationEpochRejectedAt(snapshotKey);
        assertEq(parentRejectedAt, block.timestamp);

        vm.recordLogs();
        registry.advanceRatingSnapshotCursor(contentId, 1);
        _assertNoRatingSnapshotSkippedLog(vm.getRecordedLogs());

        vm.warp(uint256(parentRejectedAt) + 1 hours);
        vm.expectEmit(true, true, true, true, address(registry));
        emit ContentRegistryRatingSnapshotLib.RatingSnapshotSkipped(
            contentId, roundId, address(oracle), keccak256("rateloop.rating-snapshot.no-proposal-skip.v1")
        );
        registry.advanceRatingSnapshotCursor(contentId, 1);
    }

    function testPublicRatingRepointSkippedRoundReopensCursorBeforeLaterApply() public {
        ClusterPayoutOracle originalOracle = _enableClusterPayoutOracle();
        ClusterPayoutOracle replacementOracle = _newPublicRatingOracle();
        uint256 contentId = _submitQuestion("rating-repoint-skipped-reopens");

        uint256 firstRoundId = _settleRoundWith(_threeVoters(), contentId, _directions(true, true, false));
        vm.warp(block.timestamp + 1 hours);
        registry.advanceRatingSnapshotCursor(contentId, 1);

        vm.warp(block.timestamp + 24 hours + 1);
        uint256 secondRoundId = _settleRoundWith(_threeVoters(), contentId, _directions(true, false, true));
        assertEq(secondRoundId, firstRoundId + 1);
        (IClusterPayoutOracle.PayoutWeight[] memory secondWeights, bytes32[][] memory secondProofs) =
            _finalizePublicRatingPayoutSnapshot(originalOracle, contentId, secondRoundId, 3);

        vm.prank(owner);
        registry.repointPendingRatingClusterPayoutOracle(contentId, firstRoundId, address(replacementOracle));

        vm.expectRevert(
            abi.encodeWithSelector(ContentRegistryRatingSnapshotLib.RatingSnapshotOutOfOrder.selector, firstRoundId)
        );
        registry.applyRatingPayoutSnapshot(contentId, secondRoundId, secondWeights, secondProofs);

        vm.prank(address(replacementOracle));
        assertGt(registry.roundPayoutSnapshotSourceReadyAt(3, 0, contentId, firstRoundId), 0);

        vm.recordLogs();
        registry.advanceRatingSnapshotCursor(contentId, 1);
        _assertNoRatingSnapshotSkippedLog(vm.getRecordedLogs());

        vm.warp(block.timestamp + 1 hours + 1);
        vm.expectEmit(true, true, true, true, address(registry));
        emit ContentRegistryRatingSnapshotLib.RatingSnapshotSkipped(
            contentId, firstRoundId, address(replacementOracle), keccak256("rateloop.rating-snapshot.no-proposal-skip.v1")
        );
        registry.advanceRatingSnapshotCursor(contentId, 1);
        registry.applyRatingPayoutSnapshot(contentId, secondRoundId, secondWeights, secondProofs);
        assertTrue(registry.isRoundPayoutSnapshotConsumed(3, 0, contentId, secondRoundId));
    }

    function testPublicRatingRepointSkippedRoundRevertsAfterLaterApply() public {
        ClusterPayoutOracle originalOracle = _enableClusterPayoutOracle();
        ClusterPayoutOracle replacementOracle = _newPublicRatingOracle();
        uint256 contentId = _submitQuestion("rating-repoint-skipped-closed");

        uint256 firstRoundId = _settleRoundWith(_threeVoters(), contentId, _directions(true, true, false));
        vm.warp(block.timestamp + 1 hours);
        registry.advanceRatingSnapshotCursor(contentId, 1);

        vm.warp(block.timestamp + 24 hours + 1);
        uint256 secondRoundId = _settleRoundWith(_threeVoters(), contentId, _directions(true, false, true));
        (IClusterPayoutOracle.PayoutWeight[] memory secondWeights, bytes32[][] memory secondProofs) =
            _finalizePublicRatingPayoutSnapshot(originalOracle, contentId, secondRoundId, 3);
        registry.applyRatingPayoutSnapshot(contentId, secondRoundId, secondWeights, secondProofs);
        assertTrue(registry.isRoundPayoutSnapshotConsumed(3, 0, contentId, secondRoundId));

        vm.prank(owner);
        vm.expectRevert(ContentRegistryRatingSnapshotLib.InvalidState.selector);
        registry.repointPendingRatingClusterPayoutOracle(contentId, firstRoundId, address(replacementOracle));
    }

    function testPublicRatingRejectedSnapshotCanSkipAndStillAcceptReplacement() public {
        ClusterPayoutOracle oracle = _enableClusterPayoutOracle();
        uint256 contentId = _submitQuestion("rating-rejected-replacement");
        uint256 roundId = _settleRoundWith(_threeVoters(), contentId, _directions(true, true, false));

        bytes32[] memory leaves;
        IClusterPayoutOracle.PayoutWeight[] memory weights;
        (weights, leaves) = _publicRatingPayoutLeaves(oracle, contentId, roundId, 3);
        bytes32 snapshotKey = _finalizePublicRatingPayoutSnapshotWithRoot(
            oracle, contentId, roundId, 3, 30_000, _sumEffectiveWeights(weights), _merkleRoot(leaves)
        );
        oracle.rejectFinalizedRoundPayoutSnapshot(snapshotKey, keccak256("bad-rating-snapshot"));

        vm.warp(block.timestamp + 1 hours);
        vm.expectEmit(true, true, true, true, address(registry));
        emit ContentRegistryRatingSnapshotLib.RatingSnapshotSkipped(
            contentId, roundId, address(oracle), keccak256("rateloop.rating-snapshot.no-proposal-skip.v1")
        );
        registry.advanceRatingSnapshotCursor(contentId, 1);
        assertFalse(registry.isRoundPayoutSnapshotConsumed(3, 0, contentId, roundId));

        bytes32 replacementKey = _finalizePublicRatingPayoutSnapshotWithRootForEpoch(
            oracle,
            contentId,
            roundId,
            uint64(roundId + 1000),
            3,
            30_000,
            _sumEffectiveWeights(weights),
            _merkleRoot(leaves)
        );
        assertEq(replacementKey, snapshotKey);
        bytes32[][] memory proofs = _merkleProofs(leaves);
        IClusterPayoutOracle.RoundPayoutSnapshot memory replacementSnapshot =
            oracle.getRoundPayoutSnapshot(oracle.PAYOUT_DOMAIN_PUBLIC_RATING(), 0, contentId, roundId);
        vm.warp(uint256(replacementSnapshot.finalizedAt) + uint256(oracle.FINALIZATION_VETO_WINDOW()) + 1);

        registry.applyRatingPayoutSnapshot(contentId, roundId, weights, proofs);
        assertTrue(registry.isRoundPayoutSnapshotConsumed(3, 0, contentId, roundId));
    }

    function testPublicRatingSnapshotAppliedIndexesSnapshotKey() public {
        ClusterPayoutOracle oracle = _enableClusterPayoutOracle();
        uint256 contentId = _submitQuestion("rating-event-abi");
        uint256 roundId = _settleRoundWith(_threeVoters(), contentId, _directions(true, true, false));

        bytes32[] memory leaves;
        IClusterPayoutOracle.PayoutWeight[] memory weights;
        (weights, leaves) = _publicRatingPayoutLeaves(oracle, contentId, roundId, 3);
        bytes32 snapshotKey = _finalizePublicRatingPayoutSnapshotWithRoot(
            oracle, contentId, roundId, 3, 30_000, _sumEffectiveWeights(weights), _merkleRoot(leaves)
        );
        bytes32[][] memory proofs = _merkleProofs(leaves);
        IClusterPayoutOracle.RoundPayoutSnapshot memory snapshot =
            oracle.getRoundPayoutSnapshot(oracle.PAYOUT_DOMAIN_PUBLIC_RATING(), 0, contentId, roundId);
        vm.warp(uint256(snapshot.finalizedAt) + uint256(oracle.FINALIZATION_VETO_WINDOW()) + 1);

        vm.recordLogs();
        registry.applyRatingPayoutSnapshot(contentId, roundId, weights, proofs);
        Vm.Log[] memory logs = vm.getRecordedLogs();
        bytes32 eventTopic = keccak256("RatingSnapshotApplied(uint256,uint256,bytes32,bytes32,uint256,uint256)");
        bool found;
        for (uint256 i; i < logs.length; i++) {
            if (logs[i].emitter == address(registry) && logs[i].topics.length != 0 && logs[i].topics[0] == eventTopic) {
                assertEq(logs[i].topics.length, 4, "snapshotKey is indexed");
                assertEq(logs[i].topics[3], snapshotKey, "indexed snapshot key");
                found = true;
            }
        }
        assertTrue(found, "RatingSnapshotApplied emitted");
    }

    function _moveRoundToSettlementPending(uint256 contentId) internal returns (uint256 roundId) {
        roundId = _revealRoundWith(_threeVoters(), contentId, _directions(true, true, false));
        _ensureTestClusterPayoutOracle(votingEngine);
        vm.roll(block.number + 1);
        votingEngine.settleRound(contentId, roundId);

        RoundLib.Round memory round = RoundEngineReadHelpers.round(votingEngine, contentId, roundId);
        assertEq(uint8(round.state), uint8(RoundLib.RoundState.SettlementPending));
    }

    function _cancelEmptyRound(uint256 contentId) internal returns (uint256 roundId) {
        vm.prank(voter1);
        votingEngine.openRound(contentId);
        roundId = RoundEngineReadHelpers.activeRoundId(votingEngine, contentId);

        vm.warp(block.timestamp + EPOCH_DURATION + 1);
        votingEngine.cancelExpiredRound(contentId, roundId);

        RoundLib.Round memory round = RoundEngineReadHelpers.round(votingEngine, contentId, roundId);
        assertEq(uint8(round.state), uint8(RoundLib.RoundState.Cancelled));
    }

    function _finalizePublicRatingPayoutSnapshot(
        ClusterPayoutOracle oracle,
        uint256 contentId,
        uint256 roundId,
        uint256 commitCount
    ) internal returns (IClusterPayoutOracle.PayoutWeight[] memory payoutWeights, bytes32[][] memory proofs) {
        bytes32[] memory leaves;
        (payoutWeights, leaves) = _publicRatingPayoutLeaves(oracle, contentId, roundId, commitCount);
        _finalizePublicRatingPayoutSnapshotWithRoot(
            oracle,
            contentId,
            roundId,
            uint32(commitCount),
            30_000,
            _sumEffectiveWeights(payoutWeights),
            _merkleRoot(leaves)
        );
        proofs = _merkleProofs(leaves);

        IClusterPayoutOracle.RoundPayoutSnapshot memory snapshot =
            oracle.getRoundPayoutSnapshot(oracle.PAYOUT_DOMAIN_PUBLIC_RATING(), 0, contentId, roundId);
        vm.warp(uint256(snapshot.finalizedAt) + uint256(oracle.FINALIZATION_VETO_WINDOW()) + 1);
    }

    function _finalizePublicRatingPayoutSnapshotWithRoot(
        ClusterPayoutOracle oracle,
        uint256 contentId,
        uint256 roundId,
        uint32 rawEligibleVoters,
        uint32 effectiveParticipantUnits,
        uint256 totalClaimWeight,
        bytes32 weightRoot
    ) internal returns (bytes32 snapshotKey) {
        return _finalizePublicRatingPayoutSnapshotWithRootForEpoch(
            oracle,
            contentId,
            roundId,
            uint64(roundId),
            rawEligibleVoters,
            effectiveParticipantUnits,
            totalClaimWeight,
            weightRoot
        );
    }

    function _finalizePublicRatingPayoutSnapshotWithRootForEpoch(
        ClusterPayoutOracle oracle,
        uint256 contentId,
        uint256 roundId,
        uint64 correlationEpochId,
        uint32 rawEligibleVoters,
        uint32 effectiveParticipantUnits,
        uint256 totalClaimWeight,
        bytes32 weightRoot
    ) internal returns (bytes32 snapshotKey) {
        oracle.proposeCorrelationEpoch(
            correlationEpochId,
            uint64(roundId),
            uint64(roundId),
            keccak256(abi.encode("public-rating-cluster-root", roundId, correlationEpochId)),
            keccak256("params"),
            keccak256("epoch-artifact"),
            "ipfs://rating-epoch",
            _publicRatingEpochSources(contentId, roundId)
        );
        vm.warp(block.timestamp + uint256(oracle.challengeWindow()) + 1);
        oracle.finalizeCorrelationEpoch(correlationEpochId);

        oracle.proposeRoundPayoutSnapshot(
            IClusterPayoutOracle.RoundPayoutSnapshotInput({
                domain: oracle.PAYOUT_DOMAIN_PUBLIC_RATING(),
                rewardPoolId: 0,
                contentId: contentId,
                roundId: roundId,
                correlationEpochId: correlationEpochId,
                rawEligibleVoters: rawEligibleVoters,
                effectiveParticipantUnits: effectiveParticipantUnits,
                totalClaimWeight: totalClaimWeight,
                weightRoot: weightRoot,
                reasonRoot: keccak256("rating-reason-root"),
                artifactHash: keccak256("epoch-artifact"),
                artifactURI: "ipfs://rating-round"
            })
        );
        snapshotKey = oracle.roundPayoutSnapshotKey(oracle.PAYOUT_DOMAIN_PUBLIC_RATING(), 0, contentId, roundId);
        uint64 proposedAt =
            oracle.roundPayoutSnapshotProposedAt(oracle.PAYOUT_DOMAIN_PUBLIC_RATING(), 0, contentId, roundId);
        vm.warp(uint256(proposedAt) + uint256(oracle.challengeWindow()) + 1);
        oracle.finalizeRoundPayoutSnapshot(snapshotKey);
    }

    function _publicRatingPayoutLeaves(
        ClusterPayoutOracle oracle,
        uint256 contentId,
        uint256 roundId,
        uint256 commitCount
    ) internal view returns (IClusterPayoutOracle.PayoutWeight[] memory payoutWeights, bytes32[] memory leaves) {
        payoutWeights = new IClusterPayoutOracle.PayoutWeight[](commitCount);
        for (uint256 i = 0; i < commitCount; i++) {
            bytes32 commitKey = votingEngine.getRoundCommitKey(contentId, roundId, i);
            (uint256 flags, bytes32 identityKey, address holder) =
                votingEngine.ratingCommitStateCompact(contentId, roundId, commitKey);
            uint256 baseEvidence = _ratingEvidenceWeight(uint64(flags >> 8));
            payoutWeights[i] = IClusterPayoutOracle.PayoutWeight({
                domain: oracle.PAYOUT_DOMAIN_PUBLIC_RATING(),
                rewardPoolId: 0,
                contentId: contentId,
                roundId: roundId,
                commitKey: commitKey,
                identityKey: identityKey,
                account: holder,
                baseWeight: baseEvidence,
                independenceBps: 10_000,
                effectiveWeight: baseEvidence,
                reasonHash: keccak256(abi.encodePacked("public-rating-payout", i))
            });
        }
        _sortPayoutWeightsByCommitKey(payoutWeights);

        leaves = new bytes32[](commitCount);
        for (uint256 i = 0; i < commitCount; i++) {
            leaves[i] = oracle.payoutWeightLeaf(payoutWeights[i]);
        }
    }

    function _ratingEvidenceWeight(uint64 stakeAmount) internal pure returns (uint256) {
        uint256 stakeForBonus =
            stakeAmount > RATING_EVIDENCE_STAKE_BONUS_CAP ? RATING_EVIDENCE_STAKE_BONUS_CAP : stakeAmount;
        uint256 stakeBonus = (stakeForBonus * RATING_EVIDENCE_MAX_STAKE_BONUS) / RATING_EVIDENCE_STAKE_BONUS_CAP;
        uint256 rawEvidence = RATING_EVIDENCE_BASE_UNIT + stakeBonus;
        return rawEvidence;
    }

    function _publicRatingEpochSources(uint256 contentId, uint256 roundId)
        internal
        pure
        returns (IClusterPayoutOracle.CorrelationEpochSourceRef[] memory sources)
    {
        sources = new IClusterPayoutOracle.CorrelationEpochSourceRef[](1);
        sources[0] = IClusterPayoutOracle.CorrelationEpochSourceRef({
            domain: 3, rewardPoolId: 0, contentId: contentId, roundId: roundId
        });
    }

    function _sumEffectiveWeights(IClusterPayoutOracle.PayoutWeight[] memory payoutWeights)
        internal
        pure
        returns (uint256 total)
    {
        for (uint256 i = 0; i < payoutWeights.length; i++) {
            total += payoutWeights[i].effectiveWeight;
        }
    }

    function _merkleRoot(bytes32[] memory leaves) internal pure returns (bytes32) {
        bytes32[] memory level = _sortedLeaves(leaves);
        while (level.length > 1) {
            level = _nextMerkleLevel(level);
        }
        return level.length == 0 ? bytes32(0) : level[0];
    }

    function _merkleProofs(bytes32[] memory leaves) internal pure returns (bytes32[][] memory proofs) {
        proofs = new bytes32[][](leaves.length);
        for (uint256 i = 0; i < leaves.length; i++) {
            proofs[i] = _merkleProof(leaves, leaves[i]);
        }
    }

    function _merkleProof(bytes32[] memory leaves, bytes32 leaf) internal pure returns (bytes32[] memory proof) {
        bytes32[] memory level = _sortedLeaves(leaves);
        uint256 leafIndex = _findLeafIndex(level, leaf);
        proof = new bytes32[](_merkleDepth(level.length));
        uint256 proofIndex;

        while (level.length > 1) {
            uint256 siblingIndex = leafIndex % 2 == 0 ? leafIndex + 1 : leafIndex - 1;
            proof[proofIndex] = siblingIndex < level.length ? level[siblingIndex] : level[leafIndex];
            unchecked {
                ++proofIndex;
            }
            leafIndex = leafIndex / 2;
            level = _nextMerkleLevel(level);
        }
    }

    function _sortedLeaves(bytes32[] memory leaves) internal pure returns (bytes32[] memory sorted) {
        sorted = new bytes32[](leaves.length);
        for (uint256 i = 0; i < leaves.length; i++) {
            sorted[i] = leaves[i];
        }
        for (uint256 i = 0; i < sorted.length; i++) {
            for (uint256 j = i + 1; j < sorted.length; j++) {
                if (uint256(sorted[j]) < uint256(sorted[i])) {
                    bytes32 current = sorted[i];
                    sorted[i] = sorted[j];
                    sorted[j] = current;
                }
            }
        }
    }

    function _nextMerkleLevel(bytes32[] memory level) internal pure returns (bytes32[] memory next) {
        next = new bytes32[]((level.length + 1) / 2);
        for (uint256 i = 0; i < level.length; i += 2) {
            bytes32 right = i + 1 < level.length ? level[i + 1] : level[i];
            next[i / 2] = _hashSortedPair(level[i], right);
        }
    }

    function _hashSortedPair(bytes32 left, bytes32 right) internal pure returns (bytes32) {
        return
            uint256(left) <= uint256(right)
                ? keccak256(bytes.concat(left, right))
                : keccak256(bytes.concat(right, left));
    }

    function _findLeafIndex(bytes32[] memory level, bytes32 leaf) internal pure returns (uint256) {
        for (uint256 i = 0; i < level.length; i++) {
            if (level[i] == leaf) return i;
        }
        revert("Leaf not found");
    }

    function _merkleDepth(uint256 leafCount) internal pure returns (uint256 depth) {
        while (leafCount > 1) {
            leafCount = (leafCount + 1) / 2;
            depth++;
        }
    }

    function _assertNoRatingSnapshotSkippedLog(Vm.Log[] memory logs) internal {
        bytes32 skippedTopic = keccak256("RatingSnapshotSkipped(uint256,uint256,address,bytes32)");
        for (uint256 i = 0; i < logs.length; i++) {
            if (logs[i].topics.length != 0 && logs[i].topics[0] == skippedTopic) {
                fail("rating snapshot skipped too early");
            }
        }
    }

    function _newPublicRatingOracle() internal returns (ClusterPayoutOracle oracle) {
        oracle = _newEligibleClusterPayoutOracle();
        oracle.setOracleConfig(1 hours, 5e6, address(this));
        oracle.setRoundPayoutSnapshotConsumer(oracle.PAYOUT_DOMAIN_PUBLIC_RATING(), address(registry));
    }
}
