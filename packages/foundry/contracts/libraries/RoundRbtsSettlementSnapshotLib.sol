// SPDX-License-Identifier: MIT
pragma solidity ^0.8.34;

import { IClusterPayoutOracle } from "../interfaces/IClusterPayoutOracle.sol";
import { RoundLib } from "./RoundLib.sol";
import { RoundRevealLib } from "./RoundRevealLib.sol";
import { VotePreflightLib } from "./VotePreflightLib.sol";

/// @title RoundRbtsSettlementSnapshotLib
/// @notice Validates oracle-backed independence weights before RBTS LREP settlement.
library RoundRbtsSettlementSnapshotLib {
    uint8 internal constant PAYOUT_DOMAIN_RBTS_SETTLEMENT = 5;
    uint16 internal constant BPS_DENOMINATOR = 10_000;
    uint32 internal constant MIN_EFFECTIVE_FORFEIT_UNITS = 8 * uint32(BPS_DENOMINATOR);

    error InvalidState();
    error MissingRevealEntropy();

    struct SnapshotResult {
        bytes32 snapshotKey;
        bytes32 snapshotDigest;
        uint32 effectiveParticipantUnits;
        uint256 totalClaimWeight;
        bool forfeitsEnabled;
    }

    struct ScoreParams {
        uint256 contentId;
        uint256 roundId;
        uint256 revealedCount;
        uint16 minParticipants;
        uint48 thresholdReachedAt;
    }

    function applySnapshotWeights(
        bytes32[] storage commitKeys,
        mapping(bytes32 => RoundLib.Commit) storage roundCommits,
        mapping(bytes32 => bytes32) storage commitIdentityKey,
        mapping(bytes32 => address) storage commitIdentityHolder,
        mapping(bytes32 => uint256) storage commitRbtsWeight,
        address oracleAddress,
        uint256 contentId,
        uint256 roundId,
        uint16 revealedCount,
        IClusterPayoutOracle.PayoutWeight[] calldata payoutWeights,
        bytes32[][] calldata proofs
    ) external returns (SnapshotResult memory result) {
        if (oracleAddress == address(0) || payoutWeights.length != proofs.length) {
            revert InvalidState();
        }
        if (commitKeys.length < payoutWeights.length) revert InvalidState();
        IClusterPayoutOracle oracle = IClusterPayoutOracle(oracleAddress);
        IClusterPayoutOracle.RoundPayoutSnapshot memory snapshot =
            oracle.getRoundPayoutSnapshot(PAYOUT_DOMAIN_RBTS_SETTLEMENT, 0, contentId, roundId);
        if (snapshot.status != IClusterPayoutOracle.SnapshotStatus.Finalized) revert InvalidState();
        if (block.timestamp <= uint256(snapshot.finalizedAt) + uint256(oracle.FINALIZATION_VETO_WINDOW())) {
            revert InvalidState();
        }
        if (snapshot.rawEligibleVoters != payoutWeights.length || snapshot.rawEligibleVoters != revealedCount) {
            revert InvalidState();
        }

        bytes32 previousCommitKey;
        uint256 totalClaimWeight;
        uint256 effectiveParticipantUnits;
        uint256 revealedLeaves;

        for (uint256 i = 0; i < payoutWeights.length;) {
            IClusterPayoutOracle.PayoutWeight calldata payout = payoutWeights[i];
            if (i != 0 && payout.commitKey <= previousCommitKey) revert InvalidState();
            previousCommitKey = payout.commitKey;
            _validatePayoutScope(payout, contentId, roundId);
            if (payout.independenceBps > BPS_DENOMINATOR) revert InvalidState();
            if (!oracle.verifyPayoutWeight(payout, proofs[i])) revert InvalidState();

            RoundLib.Commit storage commit = roundCommits[payout.commitKey];
            if (!commit.revealed || commit.voter == address(0)) revert InvalidState();
            if (payout.identityKey != commitIdentityKey[payout.commitKey]) revert InvalidState();
            if (payout.account != commitIdentityHolder[payout.commitKey]) revert InvalidState();

            uint256 baseWeight = RoundLib.effectiveStake(commit);
            if (
                baseWeight == 0 || payout.baseWeight != baseWeight || payout.effectiveWeight == 0
                    || payout.effectiveWeight > baseWeight
            ) {
                revert InvalidState();
            }

            commitRbtsWeight[payout.commitKey] = payout.effectiveWeight;
            totalClaimWeight += payout.effectiveWeight;
            effectiveParticipantUnits += payout.independenceBps;
            unchecked {
                ++revealedLeaves;
                ++i;
            }
        }

        if (revealedLeaves != revealedCount) revert InvalidState();
        if (totalClaimWeight != snapshot.totalClaimWeight) revert InvalidState();
        if (effectiveParticipantUnits != snapshot.effectiveParticipantUnits) revert InvalidState();

        result.snapshotKey = snapshot.snapshotKey;
        result.snapshotDigest = oracle.roundPayoutSnapshotProposalDigest(snapshot.snapshotKey);
        result.effectiveParticipantUnits = snapshot.effectiveParticipantUnits;
        result.totalClaimWeight = totalClaimWeight;
        result.forfeitsEnabled = snapshot.effectiveParticipantUnits >= MIN_EFFECTIVE_FORFEIT_UNITS;
    }

    function _validatePayoutScope(IClusterPayoutOracle.PayoutWeight calldata payout, uint256 contentId, uint256 roundId)
        private
        pure
    {
        if (
            payout.domain != PAYOUT_DOMAIN_RBTS_SETTLEMENT || payout.rewardPoolId != 0 || payout.contentId != contentId
                || payout.roundId != roundId
        ) {
            revert InvalidState();
        }
    }

    function scoreRbtsRewards(
        mapping(uint256 => mapping(uint256 => bytes32)) storage roundRbtsSeedEntropy,
        bytes32[] storage commitKeys,
        mapping(bytes32 => RoundLib.Commit) storage roundCommits,
        mapping(bytes32 => uint16) storage commitPredictedUpBps,
        mapping(bytes32 => uint256) storage commitRbtsWeight,
        mapping(bytes32 => uint16) storage commitRbtsScoreBps,
        mapping(bytes32 => uint256) storage commitRbtsRewardWeight,
        mapping(bytes32 => uint256) storage commitRbtsStakeReturned,
        mapping(bytes32 => uint256) storage commitRbtsForfeitedStake,
        mapping(bytes32 => bytes32) storage commitIdentityKey,
        mapping(bytes32 => bytes32) storage commitRevealEntropy,
        ScoreParams memory params
    ) external returns (RoundRevealLib.ScoreRbtsResult memory result, bool seedReady) {
        (bytes32 settlementEntropy, bool ready) =
            RoundRevealLib.finalizeRbtsSeed(roundRbtsSeedEntropy, params.contentId, params.roundId);
        if (!ready) return (result, false);
        (bytes32 scoringSetHash, uint256 scoringSetCount) = _rbtsScoringSetHash(
            commitKeys, roundCommits, commitRbtsWeight, commitIdentityKey, commitRevealEntropy, params.minParticipants
        );
        result = RoundRevealLib.scoreRbtsRewards(
            commitKeys,
            roundCommits,
            commitPredictedUpBps,
            commitRbtsWeight,
            commitRbtsScoreBps,
            commitRbtsRewardWeight,
            commitRbtsStakeReturned,
            commitRbtsForfeitedStake,
            commitIdentityKey,
            RoundRevealLib.ScoreRbtsParams({
                contentId: params.contentId,
                roundId: params.roundId,
                revealedCount: params.revealedCount,
                minParticipants: params.minParticipants,
                settlementEntropy: settlementEntropy,
                scoringSetHash: scoringSetHash,
                scoringSetCount: scoringSetCount,
                thresholdReachedAt: params.thresholdReachedAt
            })
        );
        seedReady = true;
    }

    function _rbtsScoringSetHash(
        bytes32[] storage commitKeys,
        mapping(bytes32 => RoundLib.Commit) storage roundCommits,
        mapping(bytes32 => uint256) storage commitRbtsWeight,
        mapping(bytes32 => bytes32) storage commitIdentityKey,
        mapping(bytes32 => bytes32) storage commitRevealEntropy,
        uint16 minParticipants
    ) private view returns (bytes32 scoringSetHash, uint256 scoringSetCount) {
        uint256 committedCount = commitKeys.length;
        for (uint256 i = 0; i < committedCount;) {
            bytes32 commitKey = commitKeys[i];
            RoundLib.Commit storage commit = roundCommits[commitKey];
            if (commit.revealed && commitRbtsWeight[commitKey] > 0) {
                bytes32 identityKey = commitIdentityKey[commitKey];
                bytes32 drawKey = identityKey == bytes32(0)
                    ? VotePreflightLib.addressIdentityKey(commit.voter)
                    : identityKey;
                bytes32 revealEntropy = commitRevealEntropy[commitKey];
                if (revealEntropy == bytes32(0)) revert MissingRevealEntropy();
                scoringSetHash = keccak256(abi.encode(scoringSetHash, commitKey, drawKey, revealEntropy));
                unchecked {
                    ++scoringSetCount;
                }
            }
            unchecked {
                ++i;
            }
        }
        if (scoringSetCount < minParticipants) revert InvalidState();
    }

    function returnRbtsStakes(
        bytes32[] storage commitKeys,
        mapping(bytes32 => RoundLib.Commit) storage roundCommits,
        mapping(bytes32 => uint256) storage commitRbtsWeight,
        mapping(bytes32 => uint256) storage commitRbtsStakeReturned
    ) external returns (RoundRevealLib.ScoreRbtsResult memory result) {
        result = RoundRevealLib.returnRbtsStakes(commitKeys, roundCommits, commitRbtsWeight, commitRbtsStakeReturned);
    }
}
