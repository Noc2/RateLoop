// SPDX-License-Identifier: MIT
pragma solidity ^0.8.34;

import { IClusterPayoutOracle } from "../contracts/interfaces/IClusterPayoutOracle.sol";
import {
    QuestionRewardPoolEscrowPoolActionsLib
} from "../contracts/libraries/QuestionRewardPoolEscrowPoolActionsLib.sol";
import { RoundSnapshot } from "../contracts/libraries/QuestionRewardPoolEscrowTypes.sol";
import { ClusterPayoutOracle } from "../contracts/ClusterPayoutOracle.sol";
import { SecondPassAuditRegressionBase } from "./helpers/SecondPassAuditRegressionBase.sol";

contract SecondPassRecoveredRewardPoolTest is SecondPassAuditRegressionBase {
    struct RecoveredRoundFixture {
        ClusterPayoutOracle oracle;
        uint256 contentId;
        uint256 rewardPoolId;
        uint256 roundId;
        IClusterPayoutOracle.PayoutWeight payoutWeight;
    }

    function testReopenedRecoveredSnapshotGetsFreshRefundGrace() public {
        ClusterPayoutOracle oracle = _enableClusterPayoutOracle();
        uint256 contentId = _submitQuestion("recovered-fresh-grace");
        uint256 rewardPoolId = _createRewardPool(contentId, REWARD_POOL_AMOUNT, 3);

        uint256 roundId = _settleRoundWith(_threeVoters(), contentId, _directions(true, true, false));
        IClusterPayoutOracle.PayoutWeight memory payoutWeight =
            _clusterPayoutWeight(rewardPoolId, contentId, roundId, 0);
        bytes32 originalRoot = oracle.payoutWeightLeaf(payoutWeight);
        _finalizeClusterPayoutSnapshotWithRoot(
            oracle, rewardPoolId, contentId, roundId, 3, 30_000, payoutWeight.effectiveWeight, originalRoot
        );
        rewardPoolEscrow.qualifyRound(rewardPoolId, roundId);

        bytes32 snapshotKey =
            oracle.roundPayoutSnapshotKey(oracle.PAYOUT_DOMAIN_QUESTION_REWARD(), rewardPoolId, contentId, roundId);
        oracle.rejectFinalizedRoundPayoutSnapshot(snapshotKey, keccak256("reject-original"));
        rewardPoolEscrow.recoverRejectedSnapshotRound(rewardPoolId, roundId);

        vm.expectRevert(QuestionRewardPoolEscrowPoolActionsLib.RecoveredRoundPending.selector);
        rewardPoolEscrow.refundExpiredRewardPool(rewardPoolId);

        vm.warp(uint256(rewardPoolEscrow.rewardPoolRefundEligibleAt(rewardPoolId)) + 1);

        IClusterPayoutOracle.PayoutWeight memory replacementWeight = payoutWeight;
        replacementWeight.reasonHash = keccak256("replacement-after-old-grace");
        bytes32 replacementRoot = oracle.payoutWeightLeaf(replacementWeight);
        _finalizeClusterRoundPayoutSnapshotWithRoot(
            oracle,
            rewardPoolId,
            contentId,
            roundId,
            uint64(roundId),
            3,
            30_000,
            replacementWeight.effectiveWeight,
            replacementRoot
        );

        rewardPoolEscrow.reopenRecoveredSnapshotRound(rewardPoolId, roundId);

        vm.expectRevert("Grace");
        rewardPoolEscrow.refundExpiredRecoveredRewardPool(rewardPoolId, _singleRoundIds(roundId));

        uint256 preview = rewardPoolEscrow.claimableQuestionRewardWithPayoutWeight(
            rewardPoolId, roundId, voter1, replacementWeight, new bytes32[](0)
        );
        assertGt(preview, 0);

        vm.prank(voter1);
        uint256 paid = rewardPoolEscrow.claimQuestionReward(rewardPoolId, roundId, replacementWeight, new bytes32[](0));
        assertEq(paid, preview);

        assertFalse(rewardPoolEscrow.reopenedRecoveredRound(rewardPoolId, roundId));
        assertFalse(rewardPoolEscrow.rejectedRecoveredRound(rewardPoolId, roundId));
        RoundSnapshot memory finalSnapshot = rewardPoolEscrow.getRoundSnapshot(rewardPoolId, roundId);
        assertTrue(finalSnapshot.qualified);
        assertEq(finalSnapshot.clusterWeightRoot, replacementRoot);
    }

    function testRefundExpiredRecoveredRewardPoolRevertsWhenReplacementFinalizedBeforeReopen() public {
        RecoveredRoundFixture memory fixture =
            _recoverRejectedRewardRound("expired-recovered-replacement", keccak256("reject-expired-original"));

        vm.warp(uint256(rewardPoolEscrow.rewardPoolRefundEligibleAt(fixture.rewardPoolId)) + 1);

        IClusterPayoutOracle.PayoutWeight memory replacementWeight = fixture.payoutWeight;
        replacementWeight.reasonHash = keccak256("expired-recovered-replacement-root");
        bytes32 replacementRoot = fixture.oracle.payoutWeightLeaf(replacementWeight);
        _finalizeClusterRoundPayoutSnapshotWithRoot(
            fixture.oracle,
            fixture.rewardPoolId,
            fixture.contentId,
            fixture.roundId,
            uint64(fixture.roundId),
            3,
            30_000,
            replacementWeight.effectiveWeight,
            replacementRoot
        );

        vm.expectRevert(QuestionRewardPoolEscrowPoolActionsLib.RecoveredReplacementSnapshotAvailable.selector);
        rewardPoolEscrow.refundExpiredRecoveredRewardPool(fixture.rewardPoolId, _singleRoundIds(fixture.roundId));

        assertTrue(rewardPoolEscrow.rejectedRecoveredRound(fixture.rewardPoolId, fixture.roundId));
        assertFalse(rewardPoolEscrow.reopenedRecoveredRound(fixture.rewardPoolId, fixture.roundId));
        assertGt(rewardPoolEscrow.getRoundSnapshot(fixture.rewardPoolId, fixture.roundId).allocation, 0);

        rewardPoolEscrow.reopenRecoveredSnapshotRound(fixture.rewardPoolId, fixture.roundId);
        assertTrue(rewardPoolEscrow.reopenedRecoveredRound(fixture.rewardPoolId, fixture.roundId));
    }

    function testRefundInactiveRecoveredRewardPoolRevertsWhenReplacementFinalizedBeforeReopen() public {
        RecoveredRoundFixture memory fixture =
            _recoverRejectedRewardRound("inactive-recovered-replacement", keccak256("reject-inactive-original"));

        IClusterPayoutOracle.PayoutWeight memory replacementWeight = fixture.payoutWeight;
        replacementWeight.reasonHash = keccak256("inactive-recovered-replacement-root");
        bytes32 replacementRoot = fixture.oracle.payoutWeightLeaf(replacementWeight);
        _finalizeClusterRoundPayoutSnapshotWithRoot(
            fixture.oracle,
            fixture.rewardPoolId,
            fixture.contentId,
            fixture.roundId,
            uint64(fixture.roundId),
            3,
            30_000,
            replacementWeight.effectiveWeight,
            replacementRoot
        );

        vm.warp(block.timestamp + 31 days);
        registry.markDormant(fixture.contentId);
        vm.warp(block.timestamp + 2 days);

        vm.expectRevert(QuestionRewardPoolEscrowPoolActionsLib.RecoveredReplacementSnapshotAvailable.selector);
        rewardPoolEscrow.refundInactiveRecoveredRewardPool(fixture.rewardPoolId, _singleRoundIds(fixture.roundId));

        assertTrue(rewardPoolEscrow.rejectedRecoveredRound(fixture.rewardPoolId, fixture.roundId));
        assertFalse(rewardPoolEscrow.reopenedRecoveredRound(fixture.rewardPoolId, fixture.roundId));

        rewardPoolEscrow.reopenRecoveredSnapshotRound(fixture.rewardPoolId, fixture.roundId);
        assertTrue(rewardPoolEscrow.reopenedRecoveredRound(fixture.rewardPoolId, fixture.roundId));
    }

    function _recoverRejectedRewardRound(string memory suffix, bytes32 rejectionReason)
        private
        returns (RecoveredRoundFixture memory fixture)
    {
        fixture.oracle = _enableClusterPayoutOracle();
        fixture.contentId = _submitQuestion(suffix);
        fixture.rewardPoolId = _createRewardPool(fixture.contentId, REWARD_POOL_AMOUNT, 3);

        fixture.roundId = _settleRoundWith(_threeVoters(), fixture.contentId, _directions(true, true, false));
        fixture.payoutWeight = _clusterPayoutWeight(fixture.rewardPoolId, fixture.contentId, fixture.roundId, 0);
        bytes32 originalRoot = fixture.oracle.payoutWeightLeaf(fixture.payoutWeight);
        _finalizeClusterPayoutSnapshotWithRoot(
            fixture.oracle,
            fixture.rewardPoolId,
            fixture.contentId,
            fixture.roundId,
            3,
            30_000,
            fixture.payoutWeight.effectiveWeight,
            originalRoot
        );
        rewardPoolEscrow.qualifyRound(fixture.rewardPoolId, fixture.roundId);

        bytes32 snapshotKey = fixture.oracle
            .roundPayoutSnapshotKey(
                fixture.oracle.PAYOUT_DOMAIN_QUESTION_REWARD(), fixture.rewardPoolId, fixture.contentId, fixture.roundId
            );
        fixture.oracle.rejectFinalizedRoundPayoutSnapshot(snapshotKey, rejectionReason);
        rewardPoolEscrow.recoverRejectedSnapshotRound(fixture.rewardPoolId, fixture.roundId);
        assertTrue(rewardPoolEscrow.rejectedRecoveredRound(fixture.rewardPoolId, fixture.roundId));
    }
}
