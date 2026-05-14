// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { SafeCast } from "@openzeppelin/contracts/utils/math/SafeCast.sol";
import { ProtocolConfig } from "../ProtocolConfig.sol";
import { RoundVotingEngine } from "../RoundVotingEngine.sol";
import { RoundLib } from "./RoundLib.sol";
import { RewardPool, RoundSnapshot } from "./QuestionRewardPoolEscrowTypes.sol";
import { QuestionRewardPoolEscrowEligibilityLib } from "./QuestionRewardPoolEscrowEligibilityLib.sol";
import { QuestionRewardPoolEscrowVoterLib } from "./QuestionRewardPoolEscrowVoterLib.sol";

library QuestionRewardPoolEscrowQualificationLib {
    using SafeCast for uint256;

    uint256 internal constant MIN_EFFECTIVE_PARTICIPANT_UNITS = 3;
    uint256 internal constant BPS_SCALE = 10_000;

    error RewardPoolCursorNeedsAdvance();

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

    function qualifyRound(
        mapping(uint256 => mapping(uint256 => RoundSnapshot)) storage roundSnapshots,
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

        allocation = _previewRoundAllocation(rewardPool);
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
        rewardPool.nextRoundToEvaluate = (roundId + 1).toUint64();
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
            frontendFeeClaimedAmount: 0
        });

        effectiveParticipantUnits = effectiveUnits;
        rawEligibleVoters = rawEligible;
        totalClaimWeight = totalWeight;
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
            (address voter,,, uint48 revealedAt, bool revealed,,) =
                ctx.votingEngine.commitCore(ctx.contentId, ctx.roundId, commitKey);
            if (voter != address(0) && revealed && _revealedByBountyClose(ctx.bountyClosesAt, revealedAt)) {
                (bytes32 identityKey, address holder) = QuestionRewardPoolEscrowVoterLib.commitIdentity(
                    ctx.votingEngine, ctx.protocolConfig, ctx.contentId, ctx.roundId, commitKey, voter
                );
                if (
                    !_isExcludedRater(
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
                        )
                ) {
                    rawEligibleVoters++;
                    uint256 claimWeight = _claimWeight(ctx.votingEngine, ctx.contentId, ctx.roundId, commitKey);
                    if (claimWeight > 0) {
                        totalClaimWeight += claimWeight;
                        effectiveParticipantUnits += BPS_SCALE;
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
        if (!votingEngine.roundRbtsScored(contentId, roundId)) {
            return BPS_SCALE;
        }
        return votingEngine.commitRbtsRewardWeight(contentId, roundId, commitKey);
    }

    function _previewRoundAllocation(RewardPool storage rewardPool) private view returns (uint256 allocation) {
        if (rewardPool.qualifiedRounds >= rewardPool.requiredSettledRounds) return 0;
        uint256 remainingRounds = uint256(rewardPool.requiredSettledRounds) - rewardPool.qualifiedRounds;
        allocation = remainingRounds == 1
            ? rewardPool.unallocatedAmount
            : rewardPool.fundedAmount / rewardPool.requiredSettledRounds;
        if (allocation > rewardPool.unallocatedAmount) return 0;
    }

    function _revealedByBountyClose(uint64 bountyClosesAt, uint48 revealedAt) private pure returns (bool) {
        return bountyClosesAt == 0 || revealedAt <= bountyClosesAt;
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
