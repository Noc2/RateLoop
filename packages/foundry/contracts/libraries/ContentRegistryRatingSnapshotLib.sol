// SPDX-License-Identifier: MIT
pragma solidity ^0.8.34;

import { IClusterPayoutOracle } from "../interfaces/IClusterPayoutOracle.sol";
import { IRoundVotingEngine } from "../interfaces/IRoundVotingEngine.sol";
import { ProtocolConfig } from "../ProtocolConfig.sol";
import { ContentRegistryRatingStateLib } from "./ContentRegistryRatingStateLib.sol";
import { ContentRegistryTypes } from "./ContentRegistryTypes.sol";
import { RatingLib } from "./RatingLib.sol";
import { RatingMath } from "./RatingMath.sol";
import { RoundLib } from "./RoundLib.sol";

/// @title ContentRegistryRatingSnapshotLib
/// @notice Validates finalized rating payout snapshots and computes the resulting rating state.
library ContentRegistryRatingSnapshotLib {
    error InvalidState();
    error RatingSnapshotOutOfOrder(uint256 expectedRoundId);

    event RatingSnapshotApplied(
        uint256 indexed contentId,
        uint256 indexed roundId,
        bytes32 indexed snapshotKey,
        bytes32 snapshotDigest,
        uint256 adjustedUpEvidence,
        uint256 adjustedDownEvidence
    );
    event RatingSnapshotSkipped(
        uint256 indexed contentId, uint256 indexed roundId, address indexed clusterPayoutOracle, bytes32 reasonHash
    );
    event RatingReviewPending(
        uint256 indexed contentId,
        uint256 indexed roundId,
        uint16 referenceRatingBps,
        uint256 upEvidence,
        uint256 downEvidence,
        uint256 readyAt
    );
    event PendingRatingClusterPayoutOracleRepointed(
        uint256 indexed contentId,
        uint256 indexed roundId,
        address indexed oldClusterPayoutOracle,
        address newClusterPayoutOracle
    );
    event RatingSnapshotCursorAdvanced(uint256 indexed contentId, uint256 nextRoundId, uint256 advancedRounds);

    uint8 internal constant PAYOUT_DOMAIN_PUBLIC_RATING = 3;
    uint64 internal constant RATING_EVIDENCE_BASE_UNIT = 1_000_000;
    uint64 internal constant RATING_EVIDENCE_STAKE_BONUS_CAP = 10_000_000;
    uint64 internal constant RATING_EVIDENCE_MAX_STAKE_BONUS = 1_000_000;
    uint256 internal constant RATING_SNAPSHOT_NO_PROPOSAL_GRACE = 1 hours;
    bytes32 internal constant RATING_SNAPSHOT_NO_PROPOSAL_SKIP_REASON =
        keccak256("rateloop.rating-snapshot.no-proposal-skip.v1");

    struct SnapshotApplication {
        bytes32 snapshotKey;
        bytes32 snapshotDigest;
        uint256 adjustedUpEvidence;
        uint256 adjustedDownEvidence;
        RatingLib.RatingState nextState;
    }

    struct SnapshotContext {
        IClusterPayoutOracle oracle;
        IRoundVotingEngine votingEngine;
        uint256 contentId;
        uint256 roundId;
    }

    struct EvidenceTotals {
        uint256 adjustedUpEvidence;
        uint256 adjustedDownEvidence;
        uint256 totalEffectiveWeight;
        bytes32 previousCommitKey;
    }

    function recordPendingRatingSettlement(
        mapping(address => uint256) storage votingEngineCallbackGeneration,
        mapping(uint256 => address) storage contentRoundTrackingEngine,
        mapping(uint256 => uint256) storage contentSettlementEngineGeneration,
        mapping(uint256 => uint256) storage latestVotingRoundId,
        ContentRegistryTypes.Content storage content,
        mapping(uint256 => uint256) storage dormancyAnchorAt,
        ContentRegistryTypes.PendingRatingSettlement storage pending,
        address currentVotingEngine,
        ProtocolConfig protocolConfig,
        uint256 contentId,
        uint256 roundId,
        uint16 referenceRatingBps,
        uint64 upEvidence,
        uint64 downEvidence,
        uint256 readyAt
    ) external returns (bool authorized) {
        address caller = msg.sender;
        uint256 callerGeneration = votingEngineCallbackGeneration[caller];
        if (callerGeneration == 0) return false;
        if (caller != currentVotingEngine && roundId > latestVotingRoundId[contentId]) {
            if (
                contentRoundTrackingEngine[contentId] != caller
                    || callerGeneration < contentSettlementEngineGeneration[contentId]
            ) {
                return false;
            }
        }

        require(content.id != 0);
        if (readyAt > type(uint48).max) revert InvalidState();
        uint48 readyAt48;
        assembly ("memory-safe") {
            readyAt48 := readyAt
        }
        if (readyAt48 > content.lastActivityAt) {
            content.lastActivityAt = readyAt48;
        }
        if (readyAt > dormancyAnchorAt[contentId]) {
            dormancyAnchorAt[contentId] = readyAt;
        }
        if (caller == currentVotingEngine) {
            contentSettlementEngineGeneration[contentId] = callerGeneration;
        }

        if (pending.exists) return true;

        pending.votingEngine = caller;
        pending.clusterPayoutOracle = protocolConfig.clusterPayoutOracle();
        pending.upEvidence = upEvidence;
        pending.downEvidence = downEvidence;
        pending.readyAt = readyAt48;
        pending.referenceRatingBps = referenceRatingBps;
        pending.exists = true;

        emit RatingReviewPending(contentId, roundId, referenceRatingBps, upEvidence, downEvidence, readyAt48);
        return true;
    }

    function repointPendingRatingClusterPayoutOracle(
        ContentRegistryTypes.PendingRatingSettlement storage pending,
        address expectedConsumer,
        uint256 contentId,
        uint256 roundId,
        address newOracle
    ) external {
        if (!pending.exists || pending.applied) revert InvalidState();
        address oldOracle = pending.clusterPayoutOracle;
        if (oldOracle == address(0) || newOracle == address(0) || newOracle.code.length == 0) revert InvalidState();
        if (newOracle == oldOracle) revert InvalidState();

        IClusterPayoutOracle oracle = IClusterPayoutOracle(newOracle);
        try oracle.roundPayoutSnapshotProposedAt(PAYOUT_DOMAIN_PUBLIC_RATING, 0, contentId, roundId) returns (
            uint64 proposedAt
        ) {
            if (proposedAt != 0) revert InvalidState();
        } catch {
            revert InvalidState();
        }
        try oracle.roundPayoutSnapshotConsumer(PAYOUT_DOMAIN_PUBLIC_RATING) returns (address consumer) {
            if (consumer != expectedConsumer) revert InvalidState();
        } catch {
            revert InvalidState();
        }

        pending.clusterPayoutOracle = newOracle;
        emit PendingRatingClusterPayoutOracleRepointed(contentId, roundId, oldOracle, newOracle);
    }

    function roundPayoutSnapshotSourceReadyAt(
        ContentRegistryTypes.PendingRatingSettlement storage pending,
        uint256 latestAppliedRoundId,
        uint256 contentId,
        uint256 roundId
    ) external view returns (uint64) {
        if (!pending.exists || pending.applied || msg.sender != pending.clusterPayoutOracle) {
            return 0;
        }
        if (pending.provisionallySkipped && latestAppliedRoundId >= roundId) return 0;
        (,, uint256 cleanupRemaining, uint48 sourceReadyAt) =
            IRoundVotingEngine(pending.votingEngine).roundLifecycleState(contentId, roundId);
        if (cleanupRemaining != 0) return 0;
        return sourceReadyAt;
    }

    function applyRatingPayoutSnapshot(
        mapping(uint256 => ContentRegistryTypes.PendingRatingSettlement) storage pendingSettlements,
        mapping(uint256 => uint256) storage nextRatingSnapshotRoundId,
        ContentRegistryTypes.Content storage content,
        RatingLib.RatingState storage ratingState,
        RatingLib.SlashConfig storage slashConfig,
        mapping(uint256 => mapping(uint256 => bytes32)) storage appliedRatingSnapshotDigest,
        mapping(uint256 => uint256) storage latestAppliedRatingSnapshotRoundId,
        uint256 contentId,
        uint256 roundId,
        IClusterPayoutOracle.PayoutWeight[] calldata payoutWeights,
        bytes32[][] calldata proofs,
        uint48 settledAt
    ) external {
        uint256 expectedRoundId = _expectedRatingSnapshotRound(nextRatingSnapshotRoundId, contentId);
        ContentRegistryTypes.PendingRatingSettlement storage pending = pendingSettlements[roundId];
        if (roundId != expectedRoundId) {
            if (
                roundId >= expectedRoundId || !pending.provisionallySkipped
                    || latestAppliedRatingSnapshotRoundId[contentId] >= roundId
            ) {
                revert RatingSnapshotOutOfOrder(expectedRoundId);
            }
        }
        if (!pending.exists || pending.applied) revert InvalidState();
        pending.applied = true;

        SnapshotApplication memory application = _validateAndBuild(
            pending.clusterPayoutOracle,
            pending.votingEngine,
            contentId,
            roundId,
            pending.referenceRatingBps,
            ratingState,
            slashConfig,
            payoutWeights,
            proofs,
            settledAt
        );
        appliedRatingSnapshotDigest[contentId][roundId] = application.snapshotDigest;

        ContentRegistryRatingStateLib.updateRatingState(
            content, ratingState, contentId, roundId, pending.referenceRatingBps, application.nextState, settledAt
        );
        if (roundId == expectedRoundId) {
            unchecked {
                nextRatingSnapshotRoundId[contentId] = roundId + 1;
            }
        }
        latestAppliedRatingSnapshotRoundId[contentId] = roundId;

        emit RatingSnapshotApplied(
            contentId,
            roundId,
            application.snapshotKey,
            application.snapshotDigest,
            application.adjustedUpEvidence,
            application.adjustedDownEvidence
        );
    }

    function advanceRatingSnapshotCursor(
        mapping(uint256 => ContentRegistryTypes.PendingRatingSettlement) storage pendingSettlements,
        mapping(uint256 => uint256) storage nextRatingSnapshotRoundId,
        mapping(uint256 => mapping(uint256 => bytes32)) storage appliedRatingSnapshotDigest,
        mapping(uint256 => address) storage roundVotingEngine,
        address votingEngineAddress,
        uint256 latestRoundId,
        uint256 contentId,
        uint256 maxRounds
    ) external returns (uint256 advancedRounds, uint256 nextRoundId) {
        if (votingEngineAddress == address(0)) revert InvalidState();

        nextRoundId = _expectedRatingSnapshotRound(nextRatingSnapshotRoundId, contentId);
        IRoundVotingEngine votingEngine = IRoundVotingEngine(votingEngineAddress);
        while (advancedRounds < maxRounds) {
            if (latestRoundId != 0 && nextRoundId > latestRoundId) break;
            if (!_canAdvanceRatingSnapshotCursor(
                    pendingSettlements,
                    appliedRatingSnapshotDigest,
                    roundVotingEngine,
                    votingEngine,
                    contentId,
                    nextRoundId
                )) {
                break;
            }

            unchecked {
                ++nextRoundId;
                ++advancedRounds;
            }
        }
        nextRatingSnapshotRoundId[contentId] = nextRoundId;
        if (advancedRounds != 0) emit RatingSnapshotCursorAdvanced(contentId, nextRoundId, advancedRounds);
    }

    function _expectedRatingSnapshotRound(
        mapping(uint256 => uint256) storage nextRatingSnapshotRoundId,
        uint256 contentId
    ) private view returns (uint256 expectedRoundId) {
        expectedRoundId = nextRatingSnapshotRoundId[contentId];
        if (expectedRoundId == 0) expectedRoundId = 1;
    }

    function _canAdvanceRatingSnapshotCursor(
        mapping(uint256 => ContentRegistryTypes.PendingRatingSettlement) storage pendingSettlements,
        mapping(uint256 => mapping(uint256 => bytes32)) storage appliedRatingSnapshotDigest,
        mapping(uint256 => address) storage roundVotingEngine,
        IRoundVotingEngine votingEngine,
        uint256 contentId,
        uint256 roundId
    ) private returns (bool) {
        ContentRegistryTypes.PendingRatingSettlement storage prior = pendingSettlements[roundId];
        if (prior.exists) {
            if (prior.applied) return true;
            if (prior.provisionallySkipped) return true;
            (bool canSkip, bytes32 reasonHash) = _pendingRatingSnapshotSkipReason(prior, contentId, roundId);
            if (canSkip) {
                prior.provisionallySkipped = true;
                emit RatingSnapshotSkipped(contentId, roundId, prior.clusterPayoutOracle, reasonHash);
                return true;
            }
            return false;
        }

        address roundEngineAddress = roundVotingEngine[roundId];
        IRoundVotingEngine roundEngine =
            roundEngineAddress == address(0) ? votingEngine : IRoundVotingEngine(roundEngineAddress);
        (, RoundLib.RoundState state,,,,,,) = roundEngine.roundCore(contentId, roundId);
        return _canSkipRatingSnapshotRound(state, appliedRatingSnapshotDigest[contentId][roundId]);
    }

    function _pendingRatingSnapshotSkipReason(
        ContentRegistryTypes.PendingRatingSettlement storage pending,
        uint256 contentId,
        uint256 roundId
    ) private view returns (bool canSkip, bytes32 reasonHash) {
        if (pending.clusterPayoutOracle == address(0) || pending.votingEngine == address(0)) {
            return (false, bytes32(0));
        }
        if (block.timestamp < uint256(pending.readyAt) + RATING_SNAPSHOT_NO_PROPOSAL_GRACE) {
            return (false, bytes32(0));
        }

        (,, uint256 cleanupRemaining, uint48 sourceReadyAt) =
            IRoundVotingEngine(pending.votingEngine).roundLifecycleState(contentId, roundId);
        if (cleanupRemaining != 0 || sourceReadyAt == 0) return (false, bytes32(0));

        IClusterPayoutOracle oracle = IClusterPayoutOracle(pending.clusterPayoutOracle);
        try oracle.roundPayoutSnapshotProposedAt(PAYOUT_DOMAIN_PUBLIC_RATING, 0, contentId, roundId) returns (
            uint64 proposedAt
        ) {
            if (proposedAt == 0) return (true, RATING_SNAPSHOT_NO_PROPOSAL_SKIP_REASON);
            if (block.timestamp < uint256(proposedAt) + RATING_SNAPSHOT_NO_PROPOSAL_GRACE) {
                return (false, bytes32(0));
            }
        } catch {
            return (false, bytes32(0));
        }
        try oracle.getRoundPayoutSnapshot(PAYOUT_DOMAIN_PUBLIC_RATING, 0, contentId, roundId) returns (
            IClusterPayoutOracle.RoundPayoutSnapshot memory snapshot
        ) {
            if (snapshot.status == IClusterPayoutOracle.SnapshotStatus.Rejected) {
                return (true, RATING_SNAPSHOT_NO_PROPOSAL_SKIP_REASON);
            }
        } catch {
            return (false, bytes32(0));
        }
        return (false, bytes32(0));
    }

    function _canSkipRatingSnapshotRound(RoundLib.RoundState state, bytes32 appliedDigest) private pure returns (bool) {
        return state == RoundLib.RoundState.Cancelled || state == RoundLib.RoundState.Tied
            || state == RoundLib.RoundState.RevealFailed
            || (state == RoundLib.RoundState.Settled && appliedDigest != bytes32(0));
    }

    function _validateAndBuild(
        address oracleAddress,
        address votingEngineAddress,
        uint256 contentId,
        uint256 roundId,
        uint16 referenceRatingBps,
        RatingLib.RatingState memory currentState,
        RatingLib.SlashConfig memory slashConfig,
        IClusterPayoutOracle.PayoutWeight[] calldata payoutWeights,
        bytes32[][] calldata proofs,
        uint48 settledAt
    ) private view returns (SnapshotApplication memory application) {
        if (payoutWeights.length != proofs.length) revert InvalidState();
        if (oracleAddress == address(0) || votingEngineAddress == address(0)) revert InvalidState();

        SnapshotContext memory context = SnapshotContext({
            oracle: IClusterPayoutOracle(oracleAddress),
            votingEngine: IRoundVotingEngine(votingEngineAddress),
            contentId: contentId,
            roundId: roundId
        });
        IClusterPayoutOracle.RoundPayoutSnapshot memory snapshot = _validatedSnapshot(context, payoutWeights.length);
        EvidenceTotals memory totals = _accumulateEvidence(context, payoutWeights, proofs);
        if (totals.totalEffectiveWeight != snapshot.totalClaimWeight) revert InvalidState();

        application.snapshotKey = snapshot.snapshotKey;
        application.snapshotDigest = context.oracle.roundPayoutSnapshotProposalDigest(snapshot.snapshotKey);
        application.adjustedUpEvidence = totals.adjustedUpEvidence;
        application.adjustedDownEvidence = totals.adjustedDownEvidence;
        application.nextState = RatingMath.applySettlement(
            referenceRatingBps,
            totals.adjustedUpEvidence,
            totals.adjustedDownEvidence,
            currentState,
            _roundRatingConfig(context.votingEngine, contentId, roundId),
            slashConfig,
            settledAt
        );
    }

    function _validatedSnapshot(SnapshotContext memory context, uint256 payoutWeightCount)
        private
        view
        returns (IClusterPayoutOracle.RoundPayoutSnapshot memory snapshot)
    {
        snapshot = context.oracle
        .getRoundPayoutSnapshot(PAYOUT_DOMAIN_PUBLIC_RATING, 0, context.contentId, context.roundId);
        if (snapshot.status != IClusterPayoutOracle.SnapshotStatus.Finalized) revert InvalidState();
        if (!context.oracle
                .isRoundPayoutSnapshotOutsideVetoWindow(
                    PAYOUT_DOMAIN_PUBLIC_RATING, 0, context.contentId, context.roundId
                )) {
            revert InvalidState();
        }
        if (snapshot.rawEligibleVoters != payoutWeightCount || snapshot.totalClaimWeight == 0) revert InvalidState();

        (,, uint256 cleanupRemaining, uint48 sourceReadyAt) =
            context.votingEngine.roundLifecycleState(context.contentId, context.roundId);
        if (cleanupRemaining != 0 || sourceReadyAt == 0) revert InvalidState();

        (, RoundLib.RoundState roundState,, uint16 revealedCount,,,,) =
            context.votingEngine.roundCore(context.contentId, context.roundId);
        if (roundState != RoundLib.RoundState.Settled || revealedCount != payoutWeightCount) revert InvalidState();
    }

    function _accumulateEvidence(
        SnapshotContext memory context,
        IClusterPayoutOracle.PayoutWeight[] calldata payoutWeights,
        bytes32[][] calldata proofs
    ) private view returns (EvidenceTotals memory totals) {
        for (uint256 i = 0; i < payoutWeights.length; i++) {
            IClusterPayoutOracle.PayoutWeight calldata payout = payoutWeights[i];
            _validatePayoutScope(context, payout);
            if (i > 0 && payout.commitKey <= totals.previousCommitKey) revert InvalidState();
            totals.previousCommitKey = payout.commitKey;
            if (!context.oracle.verifyPayoutWeight(payout, proofs[i])) revert InvalidState();

            (bool isUp, uint256 baseEvidence) = _commitEvidence(context, payout);
            if (payout.baseWeight != baseEvidence || payout.effectiveWeight > baseEvidence) revert InvalidState();

            totals.totalEffectiveWeight += payout.effectiveWeight;
            if (isUp) {
                totals.adjustedUpEvidence += payout.effectiveWeight;
            } else {
                totals.adjustedDownEvidence += payout.effectiveWeight;
            }
        }
    }

    function _validatePayoutScope(SnapshotContext memory context, IClusterPayoutOracle.PayoutWeight calldata payout)
        private
        pure
    {
        if (
            payout.domain != PAYOUT_DOMAIN_PUBLIC_RATING || payout.rewardPoolId != 0
                || payout.contentId != context.contentId || payout.roundId != context.roundId
        ) {
            revert InvalidState();
        }
    }

    function _commitEvidence(SnapshotContext memory context, IClusterPayoutOracle.PayoutWeight calldata payout)
        private
        view
        returns (bool isUp, uint256 baseEvidence)
    {
        (uint256 flags, bytes32 identityKey, address holder) =
            context.votingEngine.ratingCommitStateCompact(context.contentId, context.roundId, payout.commitKey);
        if ((flags & 1) == 0 || identityKey != payout.identityKey || holder != payout.account) revert InvalidState();

        isUp = (flags & 2) != 0;
        baseEvidence = _ratingEvidenceWeight(uint64(flags >> 8));
    }

    function _ratingEvidenceWeight(uint64 stakeAmount) private pure returns (uint256) {
        uint256 stakeForBonus =
            stakeAmount > RATING_EVIDENCE_STAKE_BONUS_CAP ? RATING_EVIDENCE_STAKE_BONUS_CAP : stakeAmount;
        uint256 stakeBonus = (stakeForBonus * RATING_EVIDENCE_MAX_STAKE_BONUS) / RATING_EVIDENCE_STAKE_BONUS_CAP;
        uint256 rawEvidence = uint256(RATING_EVIDENCE_BASE_UNIT) + stakeBonus;
        return rawEvidence;
    }

    function _roundRatingConfig(IRoundVotingEngine votingEngine, uint256 contentId, uint256 roundId)
        private
        view
        returns (RatingLib.RatingConfig memory cfg)
    {
        (uint256 massWord, uint256 penaltyWord) = votingEngine.roundRatingConfigPacked(contentId, roundId);
        cfg.confidenceMassInitial = uint128(massWord);
        cfg.confidenceMassMin = uint128(massWord >> 128);
        cfg.confidenceMassMax = uint128(penaltyWord);
        cfg.conservativePenaltyMaxBps = uint16(penaltyWord >> 128);
        cfg.conservativePenaltyMinBps = uint16(penaltyWord >> 144);
    }
}
