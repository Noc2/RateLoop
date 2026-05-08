// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { IVoterIdNFT } from "../interfaces/IVoterIdNFT.sol";
import { ContentRegistry } from "../ContentRegistry.sol";
import { RoundVotingEngine } from "../RoundVotingEngine.sol";
import { RoundLib } from "./RoundLib.sol";
import { RewardPool, RoundSnapshot } from "./QuestionRewardPoolEscrowTypes.sol";

library QuestionRewardPoolEscrowQualificationLib {
    uint256 internal constant MIN_EFFECTIVE_PARTICIPANT_UNITS = 3;
    uint256 internal constant BPS_SCALE = 10_000;

    error RewardPoolCursorNeedsAdvance();

    struct QualificationContext {
        RoundVotingEngine votingEngine;
        IVoterIdNFT voterIdNft;
        uint256 contentId;
        uint256 roundId;
        uint64 bountyClosesAt;
        uint32 requiredVoters;
        address funder;
        address funderIdentity;
        uint256 funderNullifier;
        address submitterIdentity;
        uint256 submitterNullifier;
    }

    function previewRoundQualification(QualificationContext memory ctx)
        public
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
        uint256 effectiveFloor = (
            ctx.requiredVoters > MIN_EFFECTIVE_PARTICIPANT_UNITS ? ctx.requiredVoters : MIN_EFFECTIVE_PARTICIPANT_UNITS
        ) * BPS_SCALE;
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

    function qualifyRound(
        mapping(uint256 => mapping(uint256 => RoundSnapshot)) storage roundSnapshots,
        mapping(uint256 => address) storage rewardPoolPayerIdentity,
        mapping(uint256 => uint256) storage rewardPoolPayerNullifier,
        mapping(uint256 => uint256) storage rewardPoolSubmitterNullifier,
        RoundVotingEngine votingEngine,
        IVoterIdNFT defaultVoterIdNFT,
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
                voterIdNft: _roundVoterIdNft(votingEngine, defaultVoterIdNFT, rewardPool.contentId, roundId),
                contentId: rewardPool.contentId,
                roundId: roundId,
                bountyClosesAt: rewardPool.bountyClosesAt,
                requiredVoters: rewardPool.requiredVoters,
                funder: rewardPool.funder,
                funderIdentity: rewardPoolPayerIdentity[rewardPool.id],
                funderNullifier: rewardPoolPayerNullifier[rewardPool.id],
                submitterIdentity: rewardPool.submitterIdentity,
                submitterNullifier: rewardPoolSubmitterNullifier[rewardPool.id]
            })
        );
        require(roundSettled, "Round not settled");
        require(canQualify, "Too few eligible voters");
        require(votingEngine.roundUnrevealedCleanupRemaining(rewardPool.contentId, roundId) == 0, "Cleanup pending");

        allocation = _previewRoundAllocation(rewardPool);
        require(allocation > 0 && allocation <= rewardPool.unallocatedAmount, "No allocation");
        require(allocation >= effectiveUnits, "Small allocation");
        frontendFeeAllocation = (allocation * rewardPool.frontendFeeBps) / bpsScale;

        unchecked {
            rewardPool.qualifiedRounds++;
        }
        uint256 claimDeadline = block.timestamp > settledAt ? block.timestamp : settledAt;
        if (claimDeadline > rewardPool.claimDeadline) {
            rewardPool.claimDeadline = uint64(claimDeadline);
        }
        rewardPool.nextRoundToEvaluate = uint64(roundId + 1);
        rewardPool.unallocatedAmount -= allocation;

        roundSnapshots[rewardPoolId][roundId] = RoundSnapshot({
            qualified: true,
            eligibleVoters: uint32(effectiveUnits),
            rawEligibleVoters: uint32(rawEligible),
            allocation: allocation,
            claimedCount: 0,
            frontendFeeAllocation: frontendFeeAllocation,
            totalClaimWeight: totalWeight,
            claimedWeight: 0,
            claimedAmount: 0,
            frontendFeeClaimedAmount: 0
        });

        effectiveParticipantUnits = effectiveUnits;
        rawEligibleVoters = rawEligible;
        totalClaimWeight = totalWeight;
    }

    function isExcludedVoter(
        IVoterIdNFT voterIdNft,
        uint256 voterId,
        address funder,
        address funderIdentity,
        uint256 funderNullifier,
        address submitterIdentity,
        uint256 submitterNullifier
    ) external view returns (bool) {
        return _isExcludedVoter(
            voterIdNft, voterId, funder, funderIdentity, funderNullifier, submitterIdentity, submitterNullifier
        );
    }

    function resolveSubmitterNullifier(ContentRegistry registry, IVoterIdNFT voterIdNft, uint256 contentId)
        external
        view
        returns (uint256)
    {
        uint256 snapshottedNullifier = registry.contentSubmitterNullifier(contentId);
        if (snapshottedNullifier != 0) return snapshottedNullifier;

        address account = registry.getSubmitterIdentity(contentId);
        uint256 voterId = voterIdNft.getTokenId(account);
        return voterId == 0 ? 0 : voterIdNft.getNullifier(voterId);
    }

    function isBundleExcludedVoter(
        IVoterIdNFT voterIdNft,
        address account,
        address funder,
        uint256 funderNullifier,
        uint256 submitterNullifier
    ) external view returns (bool) {
        uint256 voterId = voterIdNft.getTokenId(account);
        if (voterId == 0) return false;
        if (voterId == voterIdNft.getTokenId(funder)) return true;

        uint256 voterNullifier = voterIdNft.getNullifier(voterId);
        return voterNullifier != 0 && (voterNullifier == funderNullifier || voterNullifier == submitterNullifier);
    }

    function _countEligibleRevealedVoters(QualificationContext memory ctx)
        private
        view
        returns (uint256 rawEligibleVoters, uint256 effectiveParticipantUnits, uint256 totalClaimWeight)
    {
        uint256 commitCount = ctx.votingEngine.getRoundCommitCount(ctx.contentId, ctx.roundId);
        for (uint256 i = 0; i < commitCount;) {
            bytes32 commitKey = ctx.votingEngine.getRoundCommitKey(ctx.contentId, ctx.roundId, i);
            (address voter,,, uint48 revealedAt, bool revealed,,) =
                ctx.votingEngine.commitCore(ctx.contentId, ctx.roundId, commitKey);
            if (voter != address(0) && revealed && _revealedByBountyClose(ctx.bountyClosesAt, revealedAt)) {
                uint256 voterId = ctx.votingEngine.commitVoterId(ctx.contentId, ctx.roundId, commitKey);
                if (!_isExcludedVoter(
                        ctx.voterIdNft,
                        voterId,
                        ctx.funder,
                        ctx.funderIdentity,
                        ctx.funderNullifier,
                        ctx.submitterIdentity,
                        ctx.submitterNullifier
                    )) {
                    rawEligibleVoters++;
                    uint256 claimWeight = _claimWeight(ctx.votingEngine, ctx.contentId, ctx.roundId, commitKey);
                    if (claimWeight > 0) {
                        totalClaimWeight += claimWeight;
                        effectiveParticipantUnits +=
                            ctx.votingEngine.commitRaterWeightBps(ctx.contentId, ctx.roundId, commitKey);
                    }
                }
            }
            unchecked {
                ++i;
            }
        }
    }

    function _claimWeight(RoundVotingEngine votingEngine, uint256 contentId, uint256 roundId, bytes32 commitKey)
        private
        view
        returns (uint256)
    {
        if (votingEngine.roundFinalPredictionRatingBps(contentId, roundId) == 0) {
            return votingEngine.commitRaterWeightBps(contentId, roundId, commitKey);
        }
        return votingEngine.commitPredictionRewardWeight(contentId, roundId, commitKey);
    }

    function _previewRoundAllocation(RewardPool storage rewardPool) private view returns (uint256 allocation) {
        if (rewardPool.qualifiedRounds >= rewardPool.requiredSettledRounds) return 0;
        uint256 remainingRounds = uint256(rewardPool.requiredSettledRounds) - rewardPool.qualifiedRounds;
        allocation = remainingRounds == 1
            ? rewardPool.unallocatedAmount
            : rewardPool.fundedAmount / rewardPool.requiredSettledRounds;
        if (allocation > rewardPool.unallocatedAmount) return 0;
    }

    function _roundVoterIdNft(
        RoundVotingEngine votingEngine,
        IVoterIdNFT defaultVoterIdNFT,
        uint256 contentId,
        uint256 roundId
    ) private view returns (IVoterIdNFT) {
        address snapshot = votingEngine.roundVoterIdNFTSnapshot(contentId, roundId);
        return IVoterIdNFT(snapshot == address(0) ? address(defaultVoterIdNFT) : snapshot);
    }

    function _revealedByBountyClose(uint64 bountyClosesAt, uint48 revealedAt) private pure returns (bool) {
        return bountyClosesAt == 0 || revealedAt <= bountyClosesAt;
    }

    function _isExcludedVoter(
        IVoterIdNFT voterIdNft,
        uint256 voterId,
        address funder,
        address funderIdentity,
        uint256 funderNullifier,
        address submitterIdentity,
        uint256 submitterNullifier
    ) private view returns (bool) {
        if (voterId == 0) return false;

        uint256 voterNullifier = voterIdNft.getNullifier(voterId);
        if (voterNullifier != 0 && (voterNullifier == funderNullifier || voterNullifier == submitterNullifier)) {
            return true;
        }

        if (
            voterId == _resolveFunderVoterId(voterIdNft, funder, funderIdentity)
                || voterId == voterIdNft.getTokenId(funder)
        ) {
            return true;
        }

        if (submitterIdentity != address(0) && voterId == voterIdNft.getTokenId(submitterIdentity)) {
            return true;
        }

        return false;
    }

    function _resolveFunderVoterId(IVoterIdNFT voterIdNft, address funder, address funderIdentity)
        private
        view
        returns (uint256)
    {
        if (funderIdentity != address(0)) {
            uint256 identityVoterId = voterIdNft.getTokenId(funderIdentity);
            if (identityVoterId != 0) return identityVoterId;
        }
        return voterIdNft.getTokenId(funder);
    }
}
