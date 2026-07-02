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
}
