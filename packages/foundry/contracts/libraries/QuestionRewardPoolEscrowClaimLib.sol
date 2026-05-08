// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { IFrontendRegistry } from "../interfaces/IFrontendRegistry.sol";
import { IVoterIdNFT } from "../interfaces/IVoterIdNFT.sol";
import { RoundVotingEngine } from "../RoundVotingEngine.sol";
import { RewardPool, RoundSnapshot } from "./QuestionRewardPoolEscrowTypes.sol";
import { QuestionRewardPoolEscrowQualificationLib } from "./QuestionRewardPoolEscrowQualificationLib.sol";
import { QuestionRewardPoolEscrowVoterLib } from "./QuestionRewardPoolEscrowVoterLib.sol";

library QuestionRewardPoolEscrowClaimLib {
    function nextEqualShare(uint256 totalAmount, uint256 eligibleVoters, uint256 claimedCount)
        external
        pure
        returns (uint256)
    {
        return _nextEqualShare(totalAmount, eligibleVoters, claimedCount);
    }

    function computeClaimSplit(
        RoundVotingEngine votingEngine,
        uint256 contentId,
        uint256 roundId,
        bytes32 commitKey,
        address frontend,
        uint256 grossAmount,
        uint256 reservedFrontendFee
    ) external view returns (uint256 voterReward, uint256 frontendFee, address frontendRecipient) {
        return
            _computeClaimSplit(votingEngine, contentId, roundId, commitKey, frontend, grossAmount, reservedFrontendFee);
    }

    function computeEqualShareClaimSplit(
        RoundVotingEngine votingEngine,
        uint256 contentId,
        uint256 roundId,
        bytes32 commitKey,
        address frontend,
        uint256 allocation,
        uint256 frontendFeeAllocation,
        uint256 eligibleVoters,
        uint256 claimedCount
    ) external view returns (uint256 grossAmount, uint256 voterReward, uint256 frontendFee, address frontendRecipient) {
        grossAmount = _nextEqualShare(allocation, eligibleVoters, claimedCount);
        uint256 reservedFrontendFee = _nextEqualShare(frontendFeeAllocation, eligibleVoters, claimedCount);
        (voterReward, frontendFee, frontendRecipient) = _computeClaimSplit(
            votingEngine, contentId, roundId, commitKey, frontend, grossAmount, reservedFrontendFee
        );
    }

    function computeWeightedClaimSplit(
        RoundVotingEngine votingEngine,
        uint256 contentId,
        uint256 roundId,
        bytes32 commitKey,
        address frontend,
        uint256 allocation,
        uint256 frontendFeeAllocation,
        uint256 totalClaimWeight,
        uint256 claimWeight,
        uint256 claimedWeight,
        uint256 claimedAmount,
        uint256 frontendFeeClaimedAmount
    )
        external
        view
        returns (
            uint256 grossAmount,
            uint256 voterReward,
            uint256 frontendFee,
            address frontendRecipient,
            uint256 reservedFrontendFee
        )
    {
        grossAmount = _nextWeightedShare(allocation, totalClaimWeight, claimWeight, claimedWeight, claimedAmount);
        reservedFrontendFee = _nextWeightedShare(
            frontendFeeAllocation, totalClaimWeight, claimWeight, claimedWeight, frontendFeeClaimedAmount
        );
        (voterReward, frontendFee, frontendRecipient) = _computeClaimSplit(
            votingEngine, contentId, roundId, commitKey, frontend, grossAmount, reservedFrontendFee
        );
    }

    function claimableQuestionReward(
        mapping(uint256 => RewardPool) storage rewardPools,
        mapping(uint256 => mapping(uint256 => RoundSnapshot)) storage roundSnapshots,
        mapping(uint256 => mapping(uint256 => mapping(bytes32 => bool))) storage rewardClaimed,
        mapping(uint256 => address) storage rewardPoolPayerIdentity,
        mapping(uint256 => uint256) storage rewardPoolPayerNullifier,
        mapping(uint256 => uint256) storage rewardPoolSubmitterNullifier,
        RoundVotingEngine votingEngine,
        IVoterIdNFT voterIdNFT,
        uint256 rewardPoolId,
        uint256 roundId,
        address account,
        uint256 bpsScale
    ) external view returns (uint256 claimableAmount) {
        RewardPool storage rewardPool = rewardPools[rewardPoolId];
        if (rewardPool.id == 0 || rewardPool.refunded) return 0;

        (uint256 voterId, bytes32 commitKey,) = QuestionRewardPoolEscrowVoterLib.resolveRoundRewardClaim(
            votingEngine, voterIdNFT, rewardPool.contentId, roundId, account
        );
        if (
            commitKey == bytes32(0)
                || _isExcludedClaimant(
                    votingEngine,
                    voterIdNFT,
                    rewardPool,
                    rewardPoolPayerIdentity,
                    rewardPoolPayerNullifier,
                    rewardPoolSubmitterNullifier,
                    roundId,
                    voterId,
                    account
                )
        ) {
            return 0;
        }

        if (rewardClaimed[rewardPoolId][roundId][commitKey]) return 0;
        (bool revealed, address frontend) = QuestionRewardPoolEscrowVoterLib.timelyRevealedCommitFrontend(
            votingEngine, rewardPool.contentId, roundId, commitKey, rewardPool.bountyClosesAt
        );
        if (!revealed) return 0;

        RoundSnapshot storage snapshot = roundSnapshots[rewardPoolId][roundId];
        if (votingEngine.roundUnrevealedCleanupRemaining(rewardPool.contentId, roundId) > 0) return 0;
        uint256 claimWeight = _roundClaimWeight(votingEngine, rewardPool.contentId, roundId, commitKey);
        if (claimWeight == 0) return 0;
        if (!snapshot.qualified) {
            if (!_canPreviewNewQualification(rewardPool, roundId)) return 0;
            (, bool canQualify,, uint256 effectiveParticipantUnits, uint256 totalClaimWeight,) = _previewRoundQualification(
                rewardPool,
                rewardPoolPayerIdentity,
                rewardPoolPayerNullifier,
                rewardPoolSubmitterNullifier,
                votingEngine,
                voterIdNFT,
                roundId
            );
            if (!canQualify) return 0;

            uint256 allocation = _previewRoundAllocation(rewardPool);
            if (allocation == 0 || allocation < effectiveParticipantUnits) return 0;
            return _claimableWeighted(
                votingEngine,
                rewardPool.contentId,
                roundId,
                commitKey,
                frontend,
                allocation,
                (allocation * rewardPool.frontendFeeBps) / bpsScale,
                totalClaimWeight,
                claimWeight,
                0,
                0,
                0
            );
        }
        if (snapshot.totalClaimWeight == 0) {
            return _claimableEqual(
                votingEngine,
                rewardPool.contentId,
                roundId,
                commitKey,
                frontend,
                snapshot.allocation,
                snapshot.frontendFeeAllocation,
                snapshot.eligibleVoters,
                snapshot.claimedCount
            );
        }
        if (snapshot.claimedWeight >= snapshot.totalClaimWeight) return 0;
        return _claimableWeighted(
            votingEngine,
            rewardPool.contentId,
            roundId,
            commitKey,
            frontend,
            snapshot.allocation,
            snapshot.frontendFeeAllocation,
            snapshot.totalClaimWeight,
            claimWeight,
            snapshot.claimedWeight,
            snapshot.claimedAmount,
            snapshot.frontendFeeClaimedAmount
        );
    }

    function _nextEqualShare(uint256 totalAmount, uint256 eligibleVoters, uint256 claimedCount)
        private
        pure
        returns (uint256)
    {
        if (totalAmount == 0 || eligibleVoters == 0 || claimedCount >= eligibleVoters) return 0;
        uint256 baseShare = totalAmount / eligibleVoters;
        if (claimedCount + 1 == eligibleVoters) {
            return totalAmount - (baseShare * claimedCount);
        }
        return baseShare;
    }

    function _nextWeightedShare(
        uint256 totalAmount,
        uint256 totalClaimWeight,
        uint256 claimWeight,
        uint256 claimedWeight,
        uint256 claimedAmount
    ) private pure returns (uint256) {
        if (totalAmount == 0 || totalClaimWeight == 0 || claimWeight == 0 || claimedWeight >= totalClaimWeight) {
            return 0;
        }
        if (claimedWeight + claimWeight >= totalClaimWeight) {
            return totalAmount > claimedAmount ? totalAmount - claimedAmount : 0;
        }
        return (totalAmount * claimWeight) / totalClaimWeight;
    }

    function _claimableWeighted(
        RoundVotingEngine votingEngine,
        uint256 contentId,
        uint256 roundId,
        bytes32 commitKey,
        address frontend,
        uint256 allocation,
        uint256 frontendFeeAllocation,
        uint256 totalClaimWeight,
        uint256 claimWeight,
        uint256 claimedWeight,
        uint256 claimedAmount,
        uint256 frontendFeeClaimedAmount
    ) private view returns (uint256 claimableAmount) {
        uint256 grossAmount = _nextWeightedShare(
            allocation, totalClaimWeight, claimWeight, claimedWeight, claimedAmount
        );
        uint256 reservedFrontendFee = _nextWeightedShare(
            frontendFeeAllocation, totalClaimWeight, claimWeight, claimedWeight, frontendFeeClaimedAmount
        );
        (claimableAmount,,) =
            _computeClaimSplit(votingEngine, contentId, roundId, commitKey, frontend, grossAmount, reservedFrontendFee);
    }

    function _claimableEqual(
        RoundVotingEngine votingEngine,
        uint256 contentId,
        uint256 roundId,
        bytes32 commitKey,
        address frontend,
        uint256 allocation,
        uint256 frontendFeeAllocation,
        uint256 eligibleVoters,
        uint256 claimedCount
    ) private view returns (uint256 claimableAmount) {
        uint256 grossAmount = _nextEqualShare(allocation, eligibleVoters, claimedCount);
        uint256 reservedFrontendFee = _nextEqualShare(frontendFeeAllocation, eligibleVoters, claimedCount);
        (claimableAmount,,) =
            _computeClaimSplit(votingEngine, contentId, roundId, commitKey, frontend, grossAmount, reservedFrontendFee);
    }

    function _isExcludedClaimant(
        RoundVotingEngine votingEngine,
        IVoterIdNFT voterIdNFT,
        RewardPool storage rewardPool,
        mapping(uint256 => address) storage rewardPoolPayerIdentity,
        mapping(uint256 => uint256) storage rewardPoolPayerNullifier,
        mapping(uint256 => uint256) storage rewardPoolSubmitterNullifier,
        uint256 roundId,
        uint256 voterId,
        address account
    ) private view returns (bool) {
        if (voterId == 0) {
            return account == rewardPool.funder || account == rewardPoolPayerIdentity[rewardPool.id]
                || account == rewardPool.submitterIdentity;
        }
        return QuestionRewardPoolEscrowQualificationLib.isExcludedVoter(
            _roundVoterIdNft(votingEngine, voterIdNFT, rewardPool.contentId, roundId),
            voterId,
            rewardPool.funder,
            rewardPoolPayerIdentity[rewardPool.id],
            rewardPoolPayerNullifier[rewardPool.id],
            rewardPool.submitterIdentity,
            rewardPoolSubmitterNullifier[rewardPool.id]
        );
    }

    function _canPreviewNewQualification(RewardPool storage rewardPool, uint256 roundId) private view returns (bool) {
        if (
            rewardPool.refunded || rewardPool.unallocatedRefunded
                || rewardPool.qualifiedRounds >= rewardPool.requiredSettledRounds
        ) return false;
        return roundId >= rewardPool.startRoundId && roundId == rewardPool.nextRoundToEvaluate;
    }

    function _previewRoundQualification(
        RewardPool storage rewardPool,
        mapping(uint256 => address) storage rewardPoolPayerIdentity,
        mapping(uint256 => uint256) storage rewardPoolPayerNullifier,
        mapping(uint256 => uint256) storage rewardPoolSubmitterNullifier,
        RoundVotingEngine votingEngine,
        IVoterIdNFT voterIdNFT,
        uint256 roundId
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
        return QuestionRewardPoolEscrowQualificationLib.previewRoundQualification(
            QuestionRewardPoolEscrowQualificationLib.QualificationContext({
                votingEngine: votingEngine,
                voterIdNft: _roundVoterIdNft(votingEngine, voterIdNFT, rewardPool.contentId, roundId),
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
    }

    function _previewRoundAllocation(RewardPool storage rewardPool) private view returns (uint256 allocation) {
        if (rewardPool.qualifiedRounds >= rewardPool.requiredSettledRounds) return 0;
        uint256 remainingRounds = uint256(rewardPool.requiredSettledRounds) - rewardPool.qualifiedRounds;
        allocation = remainingRounds == 1
            ? rewardPool.unallocatedAmount
            : rewardPool.fundedAmount / rewardPool.requiredSettledRounds;
        if (allocation > rewardPool.unallocatedAmount) return 0;
    }

    function _roundClaimWeight(RoundVotingEngine votingEngine, uint256 contentId, uint256 roundId, bytes32 commitKey)
        private
        view
        returns (uint256)
    {
        if (votingEngine.roundFinalPredictionRatingBps(contentId, roundId) == 0) {
            return votingEngine.commitRaterWeightBps(contentId, roundId, commitKey);
        }
        return votingEngine.commitPredictionRewardWeight(contentId, roundId, commitKey);
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

    function _computeClaimSplit(
        RoundVotingEngine votingEngine,
        uint256 contentId,
        uint256 roundId,
        bytes32 commitKey,
        address frontend,
        uint256 grossAmount,
        uint256 reservedFrontendFee
    ) private view returns (uint256 voterReward, uint256 frontendFee, address frontendRecipient) {
        if (
            reservedFrontendFee == 0 || frontend == address(0)
                || !votingEngine.frontendEligibleAtCommit(contentId, roundId, commitKey)
        ) {
            return (grossAmount, 0, address(0));
        }

        if (reservedFrontendFee > grossAmount) {
            reservedFrontendFee = grossAmount;
        }

        frontendRecipient = _resolveFrontendRewardRecipient(votingEngine, contentId, roundId, frontend);
        if (frontendRecipient == address(0)) {
            return (grossAmount, 0, address(0));
        }

        frontendFee = reservedFrontendFee;
        voterReward = grossAmount - frontendFee;
    }

    function _resolveFrontendRewardRecipient(
        RoundVotingEngine votingEngine,
        uint256 contentId,
        uint256 roundId,
        address frontend
    ) private view returns (address) {
        address frontendRegistry = votingEngine.roundFrontendRegistrySnapshot(contentId, roundId);
        if (frontendRegistry == address(0)) {
            return frontend;
        }

        try IFrontendRegistry(frontendRegistry).getFrontendInfo(frontend) returns (
            address operator, uint256, bool, bool
        ) {
            if (operator == address(0)) {
                return address(0);
            }
            // Use the round-time gate so a frontend that re-registered after this round
            // settled cannot revive the bounty fee. Also covers slash/exit-pending/Voter ID.
            uint48 roundSettledAt = _readRoundSettledAt(votingEngine, contentId, roundId);
            if (_canClaimFeesForRound(frontendRegistry, frontend, roundSettledAt)) {
                return operator;
            }
        } catch {
            return address(0);
        }

        return address(0);
    }

    function _canClaimFeesForRound(address frontendRegistry, address frontend, uint48 roundSettledAt)
        private
        view
        returns (bool)
    {
        try IFrontendRegistry(frontendRegistry).canClaimFeesForRound(frontend, roundSettledAt) returns (bool can) {
            return can;
        } catch {
            return false;
        }
    }

    function _readRoundSettledAt(RoundVotingEngine votingEngine, uint256 contentId, uint256 roundId)
        private
        view
        returns (uint48 settledAt)
    {
        (,,,,,,,,,, settledAt,,,) = votingEngine.rounds(contentId, roundId);
    }
}
