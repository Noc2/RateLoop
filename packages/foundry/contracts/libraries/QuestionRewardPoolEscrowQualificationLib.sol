// SPDX-License-Identifier: MIT
pragma solidity ^0.8.34;

import { SafeCast } from "@openzeppelin/contracts/utils/math/SafeCast.sol";
import { ProtocolConfig } from "../ProtocolConfig.sol";
import { RoundVotingEngine } from "../RoundVotingEngine.sol";
import { IClusterPayoutOracle } from "../interfaces/IClusterPayoutOracle.sol";
import { RoundLib } from "./RoundLib.sol";
import { RewardPool, RoundSnapshot } from "./QuestionRewardPoolEscrowTypes.sol";
import { QuestionRewardPoolEscrowEligibilityLib } from "./QuestionRewardPoolEscrowEligibilityLib.sol";
import { QuestionRewardPoolEscrowVoterLib } from "./QuestionRewardPoolEscrowVoterLib.sol";

library QuestionRewardPoolEscrowQualificationLib {
    using SafeCast for uint256;

    uint256 internal constant MIN_EFFECTIVE_PARTICIPANT_UNITS = 3;
    uint256 internal constant BPS_SCALE = 10_000;

    error RewardPoolCursorNeedsAdvance();

    event RewardPoolRoundQualified(
        uint256 indexed rewardPoolId,
        uint256 indexed contentId,
        uint256 indexed roundId,
        uint256 allocation,
        uint256 eligibleVoters,
        uint256 frontendFeeAllocation
    );
    event RewardPoolRoundEffectiveUnits(
        uint256 indexed rewardPoolId,
        uint256 indexed contentId,
        uint256 indexed roundId,
        uint256 rawEligibleVoters,
        uint256 effectiveParticipantUnits,
        uint256 totalClaimWeight
    );
    event RewardPoolRoundCorrelationSnapshotApplied(
        uint256 indexed rewardPoolId,
        uint256 indexed contentId,
        uint256 indexed roundId,
        uint64 correlationEpochId,
        bytes32 weightRoot
    );

    struct QualificationContext {
        RoundVotingEngine votingEngine;
        ProtocolConfig protocolConfig;
        uint256 rewardId;
        uint256 contentId;
        uint256 roundId;
        uint64 bountyClosesAt;
        uint32 requiredVoters;
        uint8 bountyEligibility;
        address funder;
        address funderIdentity;
        bytes32 funderIdentityKey;
        address submitterIdentity;
        bytes32 submitterIdentityKey;
    }

    struct AdvanceCursorParams {
        uint256 maxRounds;
        uint8 rewardAssetUsdc;
        uint8 payoutDomain;
    }

    function previewRoundQualification(QualificationContext memory ctx)
        internal
        view
        returns (
            bool roundSettled,
            bool canQualify,
            uint256 rawEligibleVoters,
            uint256 effectiveParticipantUnits,
            uint256 totalClaimWeight,
            uint48 settledAt
        )
    {
        (, RoundLib.RoundState state,,,,,,,,, uint48 roundSettledAt,,,) =
            ctx.votingEngine.rounds(ctx.contentId, ctx.roundId);
        if (state != RoundLib.RoundState.Settled || roundSettledAt == 0) return (false, false, 0, 0, 0, 0);
        settledAt = roundSettledAt;

        roundSettled = true;
        (rawEligibleVoters, effectiveParticipantUnits, totalClaimWeight) = _countEligibleRevealedVoters(ctx);
        uint256 minEffectiveUnits =
            ctx.requiredVoters > MIN_EFFECTIVE_PARTICIPANT_UNITS ? ctx.requiredVoters : MIN_EFFECTIVE_PARTICIPANT_UNITS;
        uint256 effectiveFloor = minEffectiveUnits * BPS_SCALE;
        canQualify = rawEligibleVoters >= ctx.requiredVoters && effectiveParticipantUnits >= effectiveFloor
            && totalClaimWeight > 0;
    }

    function requireNoPendingFinishedRound(
        RoundVotingEngine votingEngine,
        uint256 contentId,
        uint256 nextRoundToEvaluate,
        uint64 bountyClosesAt
    ) external view {
        (uint48 startedAt, RoundLib.RoundState state,,,,,,,,,,,,) = votingEngine.rounds(contentId, nextRoundToEvaluate);
        if (state == RoundLib.RoundState.Open) {
            if (startedAt == 0 || (bountyClosesAt != 0 && startedAt > bountyClosesAt)) return;
        }
        revert RewardPoolCursorNeedsAdvance();
    }

    function advanceQualificationCursor(
        mapping(uint256 => address) storage rewardPoolPayerIdentity,
        mapping(uint256 => bytes32) storage rewardPoolPayerIdentityKey,
        mapping(uint256 => address) storage rewardPoolClusterPayoutOracle,
        RoundVotingEngine votingEngine,
        RewardPool storage rewardPool,
        AdvanceCursorParams memory params
    ) external returns (uint256 skipped, uint256 nextRoundToEvaluate) {
        require(params.maxRounds > 0, "No rounds");

        nextRoundToEvaluate = rewardPool.nextRoundToEvaluate;
        while (skipped < params.maxRounds) {
            (bool roundFinished, bool canQualify,) = _roundQualificationStatus(
                rewardPoolPayerIdentity,
                rewardPoolPayerIdentityKey,
                rewardPoolClusterPayoutOracle,
                votingEngine,
                rewardPool,
                nextRoundToEvaluate,
                params.rewardAssetUsdc,
                params.payoutDomain
            );
            if (!roundFinished || canQualify) break;
            nextRoundToEvaluate++;
            skipped++;
        }

        if (skipped > 0) {
            rewardPool.nextRoundToEvaluate = nextRoundToEvaluate.toUint64();
        }
    }

    function qualifyRound(
        mapping(uint256 => mapping(uint256 => RoundSnapshot)) storage roundSnapshots,
        mapping(
            uint256
                => mapping(
                uint256 => mapping(bytes32 => mapping(bytes32 => bool))
            )
        ) storage qualifiedQuestionRewardClaimants,
        mapping(uint256 => address) storage rewardPoolPayerIdentity,
        mapping(uint256 => bytes32) storage rewardPoolPayerIdentityKey,
        RoundVotingEngine votingEngine,
        RewardPool storage rewardPool,
        uint256 rewardPoolId,
        uint256 roundId,
        uint256 bpsScale
    )
        external
        returns (
            uint256 allocation,
            uint256 effectiveParticipantUnits,
            uint256 frontendFeeAllocation,
            uint256 rawEligibleVoters,
            uint256 totalClaimWeight
        )
    {
        require(roundId >= rewardPool.startRoundId, "Round too early");
        require(!roundSnapshots[rewardPoolId][roundId].qualified, "Round qualified");
        // Non-cluster rounds always qualify through the sequential cursor. Recovered snapshot
        // requalification is only reachable for cluster-snapshot pools.
        require(roundId == rewardPool.nextRoundToEvaluate, "Round out of order");

        (
            bool roundSettled,
            bool canQualify,
            uint256 rawEligible,
            uint256 effectiveUnits,
            uint256 totalWeight,
            uint48 settledAt
        ) = previewRoundQualification(
            QualificationContext({
                votingEngine: votingEngine,
                protocolConfig: votingEngine.protocolConfig(),
                rewardId: rewardPool.id,
                contentId: rewardPool.contentId,
                roundId: roundId,
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
        require(canQualify, "Too few eligible voters");
        require(votingEngine.roundUnrevealedCleanupRemaining(rewardPool.contentId, roundId) == 0, "Cleanup pending");

        allocation = _previewRoundAllocation(rewardPool, false, 0);
        require(allocation > 0 && allocation <= rewardPool.unallocatedAmount, "No allocation");
        require(allocation >= effectiveUnits, "Small allocation");
        frontendFeeAllocation = (allocation * rewardPool.frontendFeeBps) / bpsScale;

        unchecked {
            rewardPool.qualifiedRounds++;
        }
        uint256 claimDeadline = block.timestamp > settledAt ? block.timestamp : settledAt;
        if (claimDeadline > rewardPool.claimDeadline) {
            rewardPool.claimDeadline = claimDeadline.toUint64();
        }
        // FE-1: only advance the cursor on the normal sequential path. A reopened round whose
        // cursor was already advanced past must not roll the cursor backwards over
        // already-qualified later rounds.
        if (roundId + 1 > rewardPool.nextRoundToEvaluate) {
            rewardPool.nextRoundToEvaluate = (roundId + 1).toUint64();
        }
        rewardPool.unallocatedAmount -= allocation;

        roundSnapshots[rewardPoolId][roundId] = RoundSnapshot({
            qualified: true,
            eligibleVoters: effectiveUnits.toUint32(),
            rawEligibleVoters: rawEligible.toUint32(),
            allocation: allocation,
            claimedCount: 0,
            frontendFeeAllocation: frontendFeeAllocation,
            totalClaimWeight: totalWeight,
            claimedWeight: 0,
            claimedAmount: 0,
            frontendFeeClaimedAmount: 0,
            firstClaimPaid: false,
            clusterWeightRoot: bytes32(0),
            clusterSnapshotDigest: bytes32(0)
        });
        _markEligibleRevealedVoters(
            QualificationContext({
                votingEngine: votingEngine,
                protocolConfig: votingEngine.protocolConfig(),
                rewardId: rewardPool.id,
                contentId: rewardPool.contentId,
                roundId: roundId,
                bountyClosesAt: rewardPool.bountyClosesAt,
                requiredVoters: rewardPool.requiredVoters,
                bountyEligibility: rewardPool.bountyEligibility,
                funder: rewardPool.funder,
                funderIdentity: rewardPoolPayerIdentity[rewardPool.id],
                funderIdentityKey: rewardPoolPayerIdentityKey[rewardPool.id],
                submitterIdentity: rewardPool.submitterIdentity,
                submitterIdentityKey: rewardPool.submitterIdentityKey
            }),
            qualifiedQuestionRewardClaimants,
            rewardPoolId,
            bytes32(0)
        );

        effectiveParticipantUnits = effectiveUnits;
        rawEligibleVoters = rawEligible;
        totalClaimWeight = totalWeight;
    }

    function qualifyRoundWithClusterSnapshot(
        mapping(uint256 => mapping(uint256 => RoundSnapshot)) storage roundSnapshots,
        mapping(
            uint256 => mapping(uint256 => mapping(bytes32 => mapping(bytes32 => bool)))
        ) storage qualifiedQuestionRewardClaimants,
        mapping(uint256 => address) storage rewardPoolPayerIdentity,
        mapping(uint256 => bytes32) storage rewardPoolPayerIdentityKey,
        mapping(uint256 => address) storage rewardPoolClusterPayoutOracle,
        RoundVotingEngine votingEngine,
        RewardPool storage rewardPool,
        uint256 rewardPoolId,
        uint256 roundId,
        uint8 payoutDomain,
        bool reopened,
        uint256 recoveredAllocation
    ) external {
        require(roundId >= rewardPool.startRoundId, "Round too early");
        require(!roundSnapshots[rewardPoolId][roundId].qualified, "Round qualified");
        // FE-1: admit either the normal sequential cursor OR a recovered-and-reopened round
        // whose cursor has already advanced past it. The escrow caller sets `reopened` only
        // when the DEFAULT_ADMIN_ROLE-gated `reopenRecoveredSnapshotRound` ran and verified the
        // oracle has a new finalized snapshot with a non-rejected weight root.
        require(reopened || roundId == rewardPool.nextRoundToEvaluate, "Round out of order");

        (bool roundSettled,, uint256 baseRawEligibleVoters,,, uint48 settledAt) = previewRoundQualification(
            QualificationContext({
                votingEngine: votingEngine,
                protocolConfig: votingEngine.protocolConfig(),
                rewardId: rewardPool.id,
                contentId: rewardPool.contentId,
                roundId: roundId,
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
        require(votingEngine.roundUnrevealedCleanupRemaining(rewardPool.contentId, roundId) == 0, "Cleanup pending");

        IClusterPayoutOracle.RoundPayoutSnapshot memory payoutSnapshot = _finalizedQuestionPayoutSnapshot(
            rewardPoolClusterPayoutOracle, votingEngine, rewardPoolId, rewardPool.contentId, roundId, payoutDomain
        );
        require(payoutSnapshot.rawEligibleVoters == baseRawEligibleVoters, "Cluster snapshot mismatch");
        bytes32 clusterSnapshotDigest = IClusterPayoutOracle(
                _clusterPayoutOracleAddress(rewardPoolClusterPayoutOracle, rewardPoolId)
            ).roundPayoutSnapshotProposalDigest(payoutSnapshot.snapshotKey);

        uint256 effectiveParticipantUnits = payoutSnapshot.effectiveParticipantUnits;
        uint256 totalClaimWeight = payoutSnapshot.totalClaimWeight;
        uint256 minEffectiveUnits = rewardPool.requiredVoters > MIN_EFFECTIVE_PARTICIPANT_UNITS
            ? rewardPool.requiredVoters
            : MIN_EFFECTIVE_PARTICIPANT_UNITS;
        uint256 effectiveFloor = minEffectiveUnits * BPS_SCALE;
        require(
            baseRawEligibleVoters >= rewardPool.requiredVoters && effectiveParticipantUnits >= effectiveFloor
                && totalClaimWeight > 0,
            "Too few eligible voters"
        );

        uint256 allocation = _previewRoundAllocation(rewardPool, reopened, recoveredAllocation);
        require(allocation > 0 && allocation <= rewardPool.unallocatedAmount, "No allocation");
        require(allocation >= effectiveParticipantUnits, "Small allocation");
        uint256 frontendFeeAllocation = (allocation * rewardPool.frontendFeeBps) / BPS_SCALE;

        unchecked {
            rewardPool.qualifiedRounds++;
        }
        uint256 claimDeadline = block.timestamp > settledAt ? block.timestamp : settledAt;
        if (claimDeadline > rewardPool.claimDeadline) {
            rewardPool.claimDeadline = claimDeadline.toUint64();
        }
        // FE-1: only advance the cursor on the normal sequential path. A reopened round whose
        // cursor was already advanced past must not roll the cursor backwards over
        // already-qualified later rounds.
        if (roundId + 1 > rewardPool.nextRoundToEvaluate) {
            rewardPool.nextRoundToEvaluate = (roundId + 1).toUint64();
        }
        rewardPool.unallocatedAmount -= allocation;

        roundSnapshots[rewardPoolId][roundId] = RoundSnapshot({
            qualified: true,
            eligibleVoters: effectiveParticipantUnits.toUint32(),
            rawEligibleVoters: baseRawEligibleVoters.toUint32(),
            allocation: allocation,
            claimedCount: 0,
            frontendFeeAllocation: frontendFeeAllocation,
            totalClaimWeight: totalClaimWeight,
            claimedWeight: 0,
            claimedAmount: 0,
            frontendFeeClaimedAmount: 0,
            firstClaimPaid: false,
            clusterWeightRoot: payoutSnapshot.weightRoot,
            clusterSnapshotDigest: clusterSnapshotDigest
        });
        _markEligibleRevealedVoters(
            QualificationContext({
                votingEngine: votingEngine,
                protocolConfig: votingEngine.protocolConfig(),
                rewardId: rewardPool.id,
                contentId: rewardPool.contentId,
                roundId: roundId,
                bountyClosesAt: rewardPool.bountyClosesAt,
                requiredVoters: rewardPool.requiredVoters,
                bountyEligibility: rewardPool.bountyEligibility,
                funder: rewardPool.funder,
                funderIdentity: rewardPoolPayerIdentity[rewardPool.id],
                funderIdentityKey: rewardPoolPayerIdentityKey[rewardPool.id],
                submitterIdentity: rewardPool.submitterIdentity,
                submitterIdentityKey: rewardPool.submitterIdentityKey
            }),
            qualifiedQuestionRewardClaimants,
            rewardPoolId,
            clusterSnapshotDigest
        );

        emit RewardPoolRoundQualified(
            rewardPoolId, rewardPool.contentId, roundId, allocation, effectiveParticipantUnits, frontendFeeAllocation
        );
        emit RewardPoolRoundEffectiveUnits(
            rewardPoolId,
            rewardPool.contentId,
            roundId,
            baseRawEligibleVoters,
            effectiveParticipantUnits,
            totalClaimWeight
        );
        emit RewardPoolRoundCorrelationSnapshotApplied(
            rewardPoolId, rewardPool.contentId, roundId, payoutSnapshot.correlationEpochId, payoutSnapshot.weightRoot
        );
    }

    function previewRoundQualificationWithClusterSnapshot(
        mapping(uint256 => address) storage rewardPoolPayerIdentity,
        mapping(uint256 => bytes32) storage rewardPoolPayerIdentityKey,
        mapping(uint256 => address) storage rewardPoolClusterPayoutOracle,
        RoundVotingEngine votingEngine,
        RewardPool storage rewardPool,
        uint256 roundId,
        uint8 payoutDomain
    )
        external
        view
        returns (
            bool roundSettled,
            bool canQualify,
            uint256 rawEligibleVoters,
            uint256 effectiveParticipantUnits,
            uint256 totalClaimWeight,
            uint48 settledAt
        )
    {
        return _previewRoundQualificationWithClusterSnapshot(
            rewardPoolPayerIdentity,
            rewardPoolPayerIdentityKey,
            rewardPoolClusterPayoutOracle,
            votingEngine,
            rewardPool,
            roundId,
            payoutDomain
        );
    }

    function clusterRoundQualificationStatus(
        mapping(uint256 => address) storage rewardPoolPayerIdentity,
        mapping(uint256 => bytes32) storage rewardPoolPayerIdentityKey,
        mapping(uint256 => address) storage rewardPoolClusterPayoutOracle,
        RoundVotingEngine votingEngine,
        RewardPool storage rewardPool,
        uint256 roundId,
        uint8 payoutDomain
    ) external view returns (bool roundFinished, bool canQualify, uint256 eligibleVoters) {
        return _clusterRoundQualificationStatus(
            rewardPoolPayerIdentity,
            rewardPoolPayerIdentityKey,
            rewardPoolClusterPayoutOracle,
            votingEngine,
            rewardPool,
            roundId,
            payoutDomain
        );
    }

    function _roundQualificationStatus(
        mapping(uint256 => address) storage rewardPoolPayerIdentity,
        mapping(uint256 => bytes32) storage rewardPoolPayerIdentityKey,
        mapping(uint256 => address) storage rewardPoolClusterPayoutOracle,
        RoundVotingEngine votingEngine,
        RewardPool storage rewardPool,
        uint256 roundId,
        uint8 rewardAssetUsdc,
        uint8 payoutDomain
    ) private view returns (bool roundFinished, bool canQualify, uint256 eligibleVoters) {
        (, RoundLib.RoundState state,,,,,,,,,,,,) = votingEngine.rounds(rewardPool.contentId, roundId);
        if (state == RoundLib.RoundState.Open) return (false, false, 0);
        if (state != RoundLib.RoundState.Settled) return (true, false, 0);

        if (rewardPool.asset == rewardAssetUsdc && rewardPoolClusterPayoutOracle[rewardPool.id] != address(0)) {
            return _clusterRoundQualificationStatus(
                rewardPoolPayerIdentity,
                rewardPoolPayerIdentityKey,
                rewardPoolClusterPayoutOracle,
                votingEngine,
                rewardPool,
                roundId,
                payoutDomain
            );
        }

        uint256 effectiveParticipantUnits;
        (, canQualify,, effectiveParticipantUnits,,) = previewRoundQualification(
            QualificationContext({
                votingEngine: votingEngine,
                protocolConfig: votingEngine.protocolConfig(),
                rewardId: rewardPool.id,
                contentId: rewardPool.contentId,
                roundId: roundId,
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
        if (canQualify) canQualify = _previewRoundAllocation(rewardPool, false, 0) >= effectiveParticipantUnits;
        return (true, canQualify, effectiveParticipantUnits);
    }

    function _clusterRoundQualificationStatus(
        mapping(uint256 => address) storage rewardPoolPayerIdentity,
        mapping(uint256 => bytes32) storage rewardPoolPayerIdentityKey,
        mapping(uint256 => address) storage rewardPoolClusterPayoutOracle,
        RoundVotingEngine votingEngine,
        RewardPool storage rewardPool,
        uint256 roundId,
        uint8 payoutDomain
    ) private view returns (bool roundFinished, bool canQualify, uint256 eligibleVoters) {
        (bool roundSettled,, uint256 rawEligibleVoters,,,) = _previewRoundQualificationWithClusterSnapshot(
            rewardPoolPayerIdentity,
            rewardPoolPayerIdentityKey,
            rewardPoolClusterPayoutOracle,
            votingEngine,
            rewardPool,
            roundId,
            payoutDomain
        );
        if (!roundSettled) return (false, false, 0);
        if (rawEligibleVoters < rewardPool.requiredVoters) return (true, false, rawEligibleVoters);

        address clusterPayoutOracle = _clusterPayoutOracleAddress(rewardPoolClusterPayoutOracle, rewardPool.id);
        try IClusterPayoutOracle(clusterPayoutOracle)
            .getRoundPayoutSnapshot(payoutDomain, rewardPool.id, rewardPool.contentId, roundId) returns (
            IClusterPayoutOracle.RoundPayoutSnapshot memory payoutSnapshot
        ) {
            if (
                payoutSnapshot.status != IClusterPayoutOracle.SnapshotStatus.Finalized
                    || payoutSnapshot.rawEligibleVoters != rawEligibleVoters
                    || !_questionPayoutSnapshotConsumerMatches(clusterPayoutOracle, rewardPool, roundId, payoutDomain)
                    || !_questionPayoutSnapshotSourceReady(
                        clusterPayoutOracle, votingEngine, rewardPool, roundId, payoutDomain
                    )
            ) {
                return (false, false, 0);
            }

            uint256 effectiveParticipantUnits = payoutSnapshot.effectiveParticipantUnits;
            uint256 minEffectiveUnits = rewardPool.requiredVoters > MIN_EFFECTIVE_PARTICIPANT_UNITS
                ? rewardPool.requiredVoters
                : MIN_EFFECTIVE_PARTICIPANT_UNITS;
            uint256 effectiveFloor = minEffectiveUnits * BPS_SCALE;
            canQualify = rawEligibleVoters >= rewardPool.requiredVoters && effectiveParticipantUnits >= effectiveFloor
                && payoutSnapshot.totalClaimWeight > 0;
            if (canQualify) canQualify = _previewRoundAllocation(rewardPool, false, 0) >= effectiveParticipantUnits;
            return (true, canQualify, effectiveParticipantUnits);
        } catch {
            return (false, false, 0);
        }
    }

    function isExcludedRater(
        bytes32 identityKey,
        address account,
        address funder,
        address funderIdentity,
        bytes32 funderIdentityKey,
        address submitterIdentity,
        bytes32 submitterIdentityKey
    ) external pure returns (bool) {
        return _isExcludedRater(
            identityKey, account, funder, funderIdentity, funderIdentityKey, submitterIdentity, submitterIdentityKey
        );
    }

    function _countEligibleRevealedVoters(QualificationContext memory ctx)
        private
        view
        returns (uint256 rawEligibleVoters, uint256 effectiveParticipantUnits, uint256 totalClaimWeight)
    {
        (,, uint16 commitCount,,,,,,,,,,,) = ctx.votingEngine.rounds(ctx.contentId, ctx.roundId);
        for (uint256 i = 0; i < commitCount;) {
            bytes32 commitKey = ctx.votingEngine.getRoundCommitKey(ctx.contentId, ctx.roundId, i);
            if (_isEligibleRevealedCommit(ctx, commitKey)) {
                rawEligibleVoters++;
                uint256 claimWeight = _claimWeight(ctx.votingEngine, ctx.contentId, ctx.roundId, commitKey);
                if (claimWeight > 0) {
                    totalClaimWeight += claimWeight;
                    effectiveParticipantUnits += BPS_SCALE;
                }
            }
            unchecked {
                ++i;
            }
        }
    }

    function _markEligibleRevealedVoters(
        QualificationContext memory ctx,
        mapping(
            uint256 => mapping(uint256 => mapping(bytes32 => mapping(bytes32 => bool)))
        ) storage qualifiedQuestionRewardClaimants,
        uint256 rewardPoolId,
        bytes32 snapshotDigest
    ) private {
        (,, uint16 commitCount,,,,,,,,,,,) = ctx.votingEngine.rounds(ctx.contentId, ctx.roundId);
        for (uint256 i = 0; i < commitCount;) {
            bytes32 commitKey = ctx.votingEngine.getRoundCommitKey(ctx.contentId, ctx.roundId, i);
            if (_isEligibleRevealedCommit(ctx, commitKey)) {
                qualifiedQuestionRewardClaimants[rewardPoolId][ctx.roundId][snapshotDigest][commitKey] = true;
            }
            unchecked {
                ++i;
            }
        }
    }

    function _isEligibleRevealedCommit(QualificationContext memory ctx, bytes32 commitKey) private view returns (bool) {
        (address voter, bool bountyEligibleTiming) = _readBountyEligibleRevealedCommit(ctx, commitKey);
        if (!bountyEligibleTiming) return false;
        (bytes32 identityKey, address holder) = QuestionRewardPoolEscrowVoterLib.commitIdentity(
            ctx.votingEngine, ctx.protocolConfig, ctx.contentId, ctx.roundId, commitKey, voter
        );
        return !_isExcludedRater(
            identityKey,
            holder,
            ctx.funder,
            ctx.funderIdentity,
            ctx.funderIdentityKey,
            ctx.submitterIdentity,
            ctx.submitterIdentityKey
        )
            && QuestionRewardPoolEscrowEligibilityLib.isAccountEligibleForBounty(
            ctx.protocolConfig, ctx.bountyEligibility, holder
        );
    }

    function _readBountyEligibleRevealedCommit(QualificationContext memory ctx, bytes32 commitKey)
        private
        view
        returns (address voter, bool bountyEligibleTiming)
    {
        uint48 revealedAt;
        bool revealed;
        (voter,,, revealedAt, revealed,,) = ctx.votingEngine.commitCore(ctx.contentId, ctx.roundId, commitKey);
        if (voter == address(0) || !revealed) return (voter, false);
        uint48 committedAt = ctx.votingEngine.commitCommittedAt(ctx.contentId, ctx.roundId, commitKey);
        bountyEligibleTiming =
            QuestionRewardPoolEscrowVoterLib.committedByBountyClose(ctx.bountyClosesAt, committedAt, revealedAt);
    }

    function _claimWeight(RoundVotingEngine, uint256, uint256, bytes32) private pure returns (uint256) {
        return BPS_SCALE;
    }

    function _previewRoundAllocation(RewardPool storage rewardPool, bool reopened, uint256 recoveredAllocation)
        private
        view
        returns (uint256 allocation)
    {
        if (rewardPool.qualifiedRounds >= rewardPool.requiredSettledRounds) return 0;
        if (reopened) {
            return recoveredAllocation;
        }
        uint256 remainingRounds = uint256(rewardPool.requiredSettledRounds) - rewardPool.qualifiedRounds;
        allocation = remainingRounds == 1
            ? rewardPool.unallocatedAmount
            : rewardPool.fundedAmount / rewardPool.requiredSettledRounds;
        if (allocation > rewardPool.unallocatedAmount) return 0;
    }

    function _previewRoundQualificationWithClusterSnapshot(
        mapping(uint256 => address) storage rewardPoolPayerIdentity,
        mapping(uint256 => bytes32) storage rewardPoolPayerIdentityKey,
        mapping(uint256 => address) storage rewardPoolClusterPayoutOracle,
        RoundVotingEngine votingEngine,
        RewardPool storage rewardPool,
        uint256 roundId,
        uint8 payoutDomain
    )
        private
        view
        returns (
            bool roundSettled,
            bool canQualify,
            uint256 rawEligibleVoters,
            uint256 effectiveParticipantUnits,
            uint256 totalClaimWeight,
            uint48 settledAt
        )
    {
        (roundSettled,, rawEligibleVoters,,, settledAt) = previewRoundQualification(
            QualificationContext({
                votingEngine: votingEngine,
                protocolConfig: votingEngine.protocolConfig(),
                rewardId: rewardPool.id,
                contentId: rewardPool.contentId,
                roundId: roundId,
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
        if (!roundSettled) return (false, false, 0, 0, 0, 0);

        address clusterPayoutOracle = _clusterPayoutOracleAddress(rewardPoolClusterPayoutOracle, rewardPool.id);
        try IClusterPayoutOracle(clusterPayoutOracle)
            .getRoundPayoutSnapshot(payoutDomain, rewardPool.id, rewardPool.contentId, roundId) returns (
            IClusterPayoutOracle.RoundPayoutSnapshot memory payoutSnapshot
        ) {
            if (payoutSnapshot.status != IClusterPayoutOracle.SnapshotStatus.Finalized) {
                return (roundSettled, false, rawEligibleVoters, 0, 0, settledAt);
            }
            if (!_questionPayoutSnapshotConsumerMatches(clusterPayoutOracle, rewardPool, roundId, payoutDomain)) {
                return (roundSettled, false, rawEligibleVoters, 0, 0, settledAt);
            }
            if (!_questionPayoutSnapshotSourceReady(
                    clusterPayoutOracle, votingEngine, rewardPool, roundId, payoutDomain
                )) {
                return (roundSettled, false, rawEligibleVoters, 0, 0, settledAt);
            }
            if (payoutSnapshot.rawEligibleVoters != rawEligibleVoters) {
                return (roundSettled, false, rawEligibleVoters, 0, 0, settledAt);
            }
            effectiveParticipantUnits = payoutSnapshot.effectiveParticipantUnits;
            totalClaimWeight = payoutSnapshot.totalClaimWeight;
            uint256 minEffectiveUnits = rewardPool.requiredVoters > MIN_EFFECTIVE_PARTICIPANT_UNITS
                ? rewardPool.requiredVoters
                : MIN_EFFECTIVE_PARTICIPANT_UNITS;
            uint256 effectiveFloor = minEffectiveUnits * BPS_SCALE;
            canQualify = rawEligibleVoters >= rewardPool.requiredVoters && effectiveParticipantUnits >= effectiveFloor
                && totalClaimWeight > 0;
        } catch {
            return (roundSettled, false, rawEligibleVoters, 0, 0, settledAt);
        }
    }

    function _finalizedQuestionPayoutSnapshot(
        mapping(uint256 => address) storage rewardPoolClusterPayoutOracle,
        RoundVotingEngine votingEngine,
        uint256 rewardPoolId,
        uint256 contentId,
        uint256 roundId,
        uint8 payoutDomain
    ) private view returns (IClusterPayoutOracle.RoundPayoutSnapshot memory payoutSnapshot) {
        address clusterPayoutOracle = _clusterPayoutOracleAddress(rewardPoolClusterPayoutOracle, rewardPoolId);
        IClusterPayoutOracle oracle = IClusterPayoutOracle(clusterPayoutOracle);
        payoutSnapshot = oracle.getRoundPayoutSnapshot(payoutDomain, rewardPoolId, contentId, roundId);
        require(payoutSnapshot.status == IClusterPayoutOracle.SnapshotStatus.Finalized, "Cluster snapshot pending");
        require(
            oracle.roundPayoutSnapshotConsumerFor(payoutDomain, rewardPoolId, contentId, roundId) == address(this),
            "Cluster consumer mismatch"
        );
        uint64 readyAt = votingEngine.roundClusterPayoutReadyAt(contentId, roundId);
        require(readyAt != 0, "Cluster source pending");
        require(
            oracle.roundPayoutSnapshotProposedAt(payoutDomain, rewardPoolId, contentId, roundId) >= readyAt,
            "Cluster source stale"
        );
    }

    function _questionPayoutSnapshotConsumerMatches(
        address clusterPayoutOracle,
        RewardPool storage rewardPool,
        uint256 roundId,
        uint8 payoutDomain
    ) private view returns (bool) {
        try IClusterPayoutOracle(clusterPayoutOracle)
            .roundPayoutSnapshotConsumerFor(payoutDomain, rewardPool.id, rewardPool.contentId, roundId) returns (
            address consumer
        ) {
            return consumer == address(this);
        } catch {
            return false;
        }
    }

    function _questionPayoutSnapshotSourceReady(
        address clusterPayoutOracle,
        RoundVotingEngine votingEngine,
        RewardPool storage rewardPool,
        uint256 roundId,
        uint8 payoutDomain
    ) private view returns (bool) {
        uint64 readyAt = votingEngine.roundClusterPayoutReadyAt(rewardPool.contentId, roundId);
        if (readyAt == 0) return false;
        try IClusterPayoutOracle(clusterPayoutOracle)
            .roundPayoutSnapshotProposedAt(payoutDomain, rewardPool.id, rewardPool.contentId, roundId) returns (
            uint64 proposedAt
        ) {
            return proposedAt >= readyAt;
        } catch {
            return false;
        }
    }

    function _clusterPayoutOracleAddress(
        mapping(uint256 => address) storage rewardPoolClusterPayoutOracle,
        uint256 rewardPoolId
    ) private view returns (address) {
        return rewardPoolClusterPayoutOracle[rewardPoolId];
    }

    function _isExcludedRater(
        bytes32 identityKey,
        address account,
        address funder,
        address funderIdentity,
        bytes32 funderIdentityKey,
        address submitterIdentity,
        bytes32 submitterIdentityKey
    ) private pure returns (bool) {
        if (identityKey == bytes32(0)) return true;
        if (identityKey == funderIdentityKey || identityKey == submitterIdentityKey) return true;
        return account == funder || account == funderIdentity || account == submitterIdentity;
    }
}
