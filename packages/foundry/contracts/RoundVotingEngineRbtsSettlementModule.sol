// SPDX-License-Identifier: MIT
pragma solidity ^0.8.34;

import { IClusterPayoutOracle } from "./interfaces/IClusterPayoutOracle.sol";
import { RoundVotingEngineStorage } from "./RoundVotingEngineStorage.sol";
import { RoundLib } from "./libraries/RoundLib.sol";
import { RoundRevealLib } from "./libraries/RoundRevealLib.sol";
import { RoundRbtsSettlementCompletionLib } from "./libraries/RoundRbtsSettlementCompletionLib.sol";
import { RoundRbtsSettlementSnapshotLib } from "./libraries/RoundRbtsSettlementSnapshotLib.sol";

/// @title RoundVotingEngineRbtsSettlementModule
/// @notice Delegatecall module for oracle-backed RBTS settlement.
contract RoundVotingEngineRbtsSettlementModule is RoundVotingEngineStorage {
    error RoundNotOpen();
    error RoundNotExpired();
    error UnrevealedPastEpochVotes();
    error SnapshotAvailable();

    uint16 internal constant MIN_RBTS_PARTICIPANTS = 3;
    uint8 internal constant PAYOUT_DOMAIN_RBTS_SETTLEMENT = 5;
    uint256 internal constant RBTS_SETTLEMENT_SNAPSHOT_TIMEOUT = 1 hours;

    event RbtsSettlementSnapshotApplied(
        uint256 indexed contentId,
        uint256 indexed roundId,
        bytes32 snapshotDigest,
        uint32 effectiveParticipantUnits,
        bool forfeitsEnabled
    );
    event RbtsSettlementSnapshotTimedOut(uint256 indexed contentId, uint256 indexed roundId);

    function applyRbtsSettlementSnapshot(
        uint256 contentId,
        uint256 roundId,
        IClusterPayoutOracle.PayoutWeight[] calldata payoutWeights,
        bytes32[][] calldata proofs
    ) external {
        RoundLib.Round storage round = rounds[contentId][roundId];
        if (round.state != RoundLib.RoundState.SettlementPending) revert RoundNotOpen();
        if (roundUnrevealedCleanupRemaining[contentId][roundId] != 0) revert UnrevealedPastEpochVotes();
        if (payoutWeights.length == 0 && proofs.length == 0) {
            uint48 readyAt = roundClusterPayoutReadyAt[contentId][roundId];
            if (readyAt == 0 || block.timestamp < uint256(readyAt) + RBTS_SETTLEMENT_SNAPSHOT_TIMEOUT) {
                revert RoundNotExpired();
            }
            if (_hasLiveRbtsSettlementSnapshot(
                    roundRbtsSettlementOracle[contentId][roundId], contentId, roundId, round.revealedCount
                )) {
                revert SnapshotAvailable();
            }
            _requireNoRecentRejectedRbtsSettlementSnapshot(
                roundRbtsSettlementOracle[contentId][roundId], contentId, roundId
            );
            _returnRbtsStakes(contentId, roundId);
            _completeRbtsSettlement(contentId, roundId, round, 0, 0, bytes32(0));
            emit RbtsSettlementSnapshotTimedOut(contentId, roundId);
            return;
        }

        RoundRbtsSettlementSnapshotLib.SnapshotResult memory snapshot =
            RoundRbtsSettlementSnapshotLib.applySnapshotWeights(
                roundCommitHashes[contentId][roundId],
                commits[contentId][roundId],
                commitIdentityKey[contentId][roundId],
                commitIdentityHolder[contentId][roundId],
                commitRbtsWeight[contentId][roundId],
                roundRbtsSettlementOracle[contentId][roundId],
                contentId,
                roundId,
                round.revealedCount,
                payoutWeights,
                proofs
            );

        uint256 weightedRewardStake;
        uint256 rbtsForfeitedPool;
        bytes32 scoreSeed;
        bool rbtsReady = true;
        if (snapshot.forfeitsEnabled) {
            (weightedRewardStake, rbtsForfeitedPool, scoreSeed, rbtsReady) =
                _scoreRbtsRewards(contentId, roundId, round.revealedCount, round.thresholdReachedAt);
        } else {
            weightedRewardStake = _returnRbtsStakes(contentId, roundId).rewardWeight;
        }
        if (!rbtsReady) return;

        roundRbtsSettlementSnapshotDigest[contentId][roundId] = snapshot.snapshotDigest;
        _completeRbtsSettlement(contentId, roundId, round, weightedRewardStake, rbtsForfeitedPool, scoreSeed);
        emit RbtsSettlementSnapshotApplied(
            contentId, roundId, snapshot.snapshotDigest, snapshot.effectiveParticipantUnits, snapshot.forfeitsEnabled
        );
    }

    function _completeRbtsSettlement(
        uint256 contentId,
        uint256 roundId,
        RoundLib.Round storage round,
        uint256 weightedRewardStake,
        uint256 rbtsForfeitedPool,
        bytes32 scoreSeed
    ) internal {
        accountedLrepBalance = RoundRbtsSettlementCompletionLib.complete(
            lrepToken,
            registry,
            protocolConfig,
            round,
            roundRbtsScored,
            roundRbtsRewardWeight,
            roundRbtsRewardClaimants,
            roundRbtsForfeitedPool,
            roundRbtsForfeitClaimants,
            roundRbtsMeanScoreBps,
            roundVoterPool,
            roundWinningStake,
            roundStakeWithEligibleFrontend,
            roundFrontendPool,
            roundFrontendRegistrySnapshot,
            roundReferenceRatingBpsSnapshot,
            roundRatingUpEvidence,
            roundRatingDownEvidence,
            pendingRatingSettlementReplay,
            pendingBundleObserverReplay,
            roundClusterPayoutReadyAt,
            RoundRbtsSettlementCompletionLib.CompleteParams({
                accountedLrepBalance: accountedLrepBalance,
                contentId: contentId,
                roundId: roundId,
                weightedRewardStake: weightedRewardStake,
                rbtsForfeitedPool: rbtsForfeitedPool,
                scoreSeed: scoreSeed,
                caller: msg.sender
            })
        );
    }

    function _hasLiveRbtsSettlementSnapshot(address oracleAddress, uint256 contentId, uint256 roundId, uint16)
        internal
        view
        returns (bool)
    {
        if (oracleAddress == address(0)) return false;
        IClusterPayoutOracle oracle = IClusterPayoutOracle(oracleAddress);
        try oracle.getRoundPayoutSnapshot(PAYOUT_DOMAIN_RBTS_SETTLEMENT, 0, contentId, roundId) returns (
            IClusterPayoutOracle.RoundPayoutSnapshot memory snapshot
        ) {
            if (!_isLiveRbtsSettlementSnapshotStatus(snapshot.status)) {
                return false;
            }
        } catch {
            return false;
        }

        try oracle.roundPayoutSnapshotConsumerFor(PAYOUT_DOMAIN_RBTS_SETTLEMENT, 0, contentId, roundId) returns (
            address consumer
        ) {
            return consumer == address(this);
        } catch {
            return false;
        }
    }

    function _isLiveRbtsSettlementSnapshotStatus(IClusterPayoutOracle.SnapshotStatus status)
        internal
        pure
        returns (bool)
    {
        return status == IClusterPayoutOracle.SnapshotStatus.Proposed
            || status == IClusterPayoutOracle.SnapshotStatus.Challenged
            || status == IClusterPayoutOracle.SnapshotStatus.Finalized;
    }

    function _requireNoRecentRejectedRbtsSettlementSnapshot(address oracleAddress, uint256 contentId, uint256 roundId)
        internal
        view
    {
        if (oracleAddress == address(0)) return;
        IClusterPayoutOracle oracle = IClusterPayoutOracle(oracleAddress);
        bytes32 snapshotKey = oracle.roundPayoutSnapshotKey(PAYOUT_DOMAIN_RBTS_SETTLEMENT, 0, contentId, roundId);
        uint64 latestRejectedAt;
        try oracle.roundPayoutSnapshotRejectedAt(snapshotKey) returns (uint64 rejectedAt) {
            latestRejectedAt = rejectedAt;
        } catch { }
        try oracle.roundPayoutSnapshotCorrelationEpochRejectedAt(snapshotKey) returns (uint64 parentRejectedAt) {
            if (parentRejectedAt > latestRejectedAt) latestRejectedAt = parentRejectedAt;
        } catch { }
        if (latestRejectedAt != 0 && block.timestamp < uint256(latestRejectedAt) + RBTS_SETTLEMENT_SNAPSHOT_TIMEOUT) {
            revert RoundNotExpired();
        }
    }

    function _returnRbtsStakes(uint256 contentId, uint256 roundId)
        internal
        returns (RoundRevealLib.ScoreRbtsResult memory result)
    {
        result = RoundRbtsSettlementSnapshotLib.returnRbtsStakes(
            roundCommitHashes[contentId][roundId],
            commits[contentId][roundId],
            commitRbtsWeight[contentId][roundId],
            commitRbtsStakeReturned[contentId][roundId]
        );
        roundRbtsRewardWeight[contentId][roundId] = 0;
        roundRbtsRewardClaimants[contentId][roundId] = 0;
        roundRbtsParticipationWeight[contentId][roundId] = result.participationWeight;
        roundRbtsParticipationClaimants[contentId][roundId] = result.participationClaimants;
        roundRbtsForfeitedPool[contentId][roundId] = 0;
        roundRbtsForfeitClaimants[contentId][roundId] = 0;
        roundRbtsMeanScoreBps[contentId][roundId] = 0;
        roundRbtsScoreSeed[contentId][roundId] = bytes32(0);
    }

    function _scoreRbtsRewards(uint256 contentId, uint256 roundId, uint256 revealedCount, uint48 thresholdReachedAt)
        internal
        returns (uint256 rewardWeight, uint256 forfeitedPool, bytes32 scoreSeed, bool seedReady)
    {
        RoundRevealLib.ScoreRbtsResult memory result;
        (result, seedReady) = RoundRbtsSettlementSnapshotLib.scoreRbtsRewards(
            roundRbtsSeedEntropy,
            roundCommitHashes[contentId][roundId],
            commits[contentId][roundId],
            commitPredictedUpBps[contentId][roundId],
            commitRbtsWeight[contentId][roundId],
            commitRbtsScoreBps[contentId][roundId],
            commitRbtsRewardWeight[contentId][roundId],
            commitRbtsStakeReturned[contentId][roundId],
            commitRbtsForfeitedStake[contentId][roundId],
            commitIdentityKey[contentId][roundId],
            commitRevealEntropy[contentId][roundId],
            RoundRbtsSettlementSnapshotLib.ScoreParams({
                contentId: contentId,
                roundId: roundId,
                revealedCount: revealedCount,
                minParticipants: MIN_RBTS_PARTICIPANTS,
                thresholdReachedAt: thresholdReachedAt
            })
        );
        if (!seedReady) return (0, 0, bytes32(0), false);
        rewardWeight = result.rewardWeight;
        forfeitedPool = result.forfeitedPool;
        scoreSeed = result.scoreSeed;
        roundRbtsRewardWeight[contentId][roundId] = result.rewardWeight;
        roundRbtsRewardClaimants[contentId][roundId] = result.rewardClaimants;
        roundRbtsParticipationWeight[contentId][roundId] = result.participationWeight;
        roundRbtsParticipationClaimants[contentId][roundId] = result.participationClaimants;
        roundRbtsForfeitedPool[contentId][roundId] = result.forfeitedPool;
        roundRbtsForfeitClaimants[contentId][roundId] = result.forfeitClaimants;
        roundRbtsMeanScoreBps[contentId][roundId] = result.meanScoreBps;
        roundRbtsScoreSeed[contentId][roundId] = result.scoreSeed;
    }
}
