// SPDX-License-Identifier: MIT
pragma solidity ^0.8.34;

import { IFrontendRegistry } from "../interfaces/IFrontendRegistry.sol";
import { IClusterPayoutOracle } from "../interfaces/IClusterPayoutOracle.sol";
import { IRaterRegistryStatus } from "../interfaces/IRaterRegistryStatus.sol";
import { ProtocolConfig } from "../ProtocolConfig.sol";
import { RoundVotingEngine } from "../RoundVotingEngine.sol";
import { RewardPool, RoundSnapshot, BOUNTY_ELIGIBILITY_OPEN } from "./QuestionRewardPoolEscrowTypes.sol";
import { QuestionRewardPoolEscrowEligibilityLib } from "./QuestionRewardPoolEscrowEligibilityLib.sol";
import { QuestionRewardPoolEscrowQualificationLib } from "./QuestionRewardPoolEscrowQualificationLib.sol";
import { QuestionRewardPoolEscrowVoterLib } from "./QuestionRewardPoolEscrowVoterLib.sol";
import { QuestionRewardPoolEscrowWindowLib } from "./QuestionRewardPoolEscrowWindowLib.sol";

/// @dev Equal-share inputs shared by `RoundSnapshot` (per-round) and
///      `BundleRoundSetSnapshot` (per-bundle) callers. Packed into a single struct so
///      `forge coverage --ir-minimum` does not blow the Yul ABI-encoder stack when
///      these library calls happen from contexts with many other locals (notably
///      `_claimQuestionReward`).
struct EqualShareInputs {
    uint256 allocation;
    uint256 frontendFeeAllocation;
    uint256 eligibleParticipants;
    uint256 claimedCount;
}

/// @dev Scalar (non-storage / non-calldata) parameters for the
///      `claimableQuestionReward*` library entry points. Packed into a struct so the
///      external library signatures stay under the IR-minimum ABI-encoder stack budget.
struct ClaimableQuestionRewardParams {
    uint256 rewardPoolId;
    uint256 roundId;
    address account;
    uint256 bpsScale;
    uint8 payoutDomain;
    bool bypassQualificationCursor;
    bool useRecoveredAllocation;
}

struct WeightedShareInputs {
    uint256 allocation;
    uint256 frontendFeeAllocation;
    uint256 totalClaimWeight;
    uint256 claimedWeight;
    uint256 claimedAmount;
    uint256 frontendFeeClaimedAmount;
}

library QuestionRewardPoolEscrowClaimLib {
    uint256 private constant BASE_CLAIM_WEIGHT_BPS = 10_000;
    // Upper bound for surprise-weighted leaf base weights in cluster snapshots
    // (baseWeightFloorBps + baseWeightBonusBps * surpriseCapBps / 10_000 with
    // default scorer parameters).
    uint256 private constant MAX_CLAIM_WEIGHT_BPS = 20_000;

    function nextEqualShare(uint256 totalAmount, uint256 eligibleVoters, uint256 claimedCount)
        external
        pure
        returns (uint256)
    {
        return _nextEqualShare(totalAmount, eligibleVoters, claimedCount);
    }

    function frontendRewardRecipient(
        RoundVotingEngine votingEngine,
        uint256 contentId,
        uint256 roundId,
        address frontend
    ) external view returns (address) {
        return _resolveFrontendRewardRecipient(votingEngine, contentId, roundId, frontend);
    }

    function computeEqualShareClaimSplit(
        RoundVotingEngine votingEngine,
        uint256 contentId,
        uint256 roundId,
        bytes32 commitKey,
        address frontend,
        EqualShareInputs memory inputs
    ) external view returns (uint256 grossAmount, uint256 voterReward, uint256 frontendFee, address frontendRecipient) {
        grossAmount = _nextEqualShare(inputs.allocation, inputs.eligibleParticipants, inputs.claimedCount);
        uint256 reservedFrontendFee =
            _nextEqualShare(inputs.frontendFeeAllocation, inputs.eligibleParticipants, inputs.claimedCount);
        (voterReward, frontendFee, frontendRecipient) =
            _computeClaimSplit(votingEngine, contentId, roundId, commitKey, frontend, grossAmount, reservedFrontendFee);
    }

    function computeWeightedClaimSplit(
        RoundVotingEngine votingEngine,
        uint256 contentId,
        uint256 roundId,
        bytes32 commitKey,
        address frontend,
        uint256 claimWeight,
        WeightedShareInputs memory inputs
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
        grossAmount = _nextWeightedShare(
            inputs.allocation, inputs.totalClaimWeight, claimWeight, inputs.claimedWeight, inputs.claimedAmount
        );
        reservedFrontendFee = _nextWeightedShare(
            inputs.frontendFeeAllocation,
            inputs.totalClaimWeight,
            claimWeight,
            inputs.claimedWeight,
            inputs.frontendFeeClaimedAmount
        );
        (voterReward, frontendFee, frontendRecipient) =
            _computeClaimSplit(votingEngine, contentId, roundId, commitKey, frontend, grossAmount, reservedFrontendFee);
    }

    function claimableQuestionReward(
        mapping(uint256 => RewardPool) storage rewardPools,
        mapping(uint256 => mapping(uint256 => RoundSnapshot)) storage roundSnapshots,
        mapping(uint256 => mapping(uint256 => mapping(bytes32 => bool))) storage rewardClaimed,
        mapping(
            uint256 => mapping(uint256 => mapping(bytes32 => mapping(bytes32 => bool)))
        ) storage qualifiedQuestionRewardClaimants,
        mapping(uint256 => address) storage rewardPoolPayerIdentity,
        mapping(uint256 => bytes32) storage rewardPoolPayerIdentityKey,
        RoundVotingEngine votingEngine,
        ProtocolConfig protocolConfig,
        uint256 rewardPoolId,
        uint256 roundId,
        address account,
        uint256 bpsScale
    ) external view returns (uint256 claimableAmount) {
        return _claimableQuestionReward(
            rewardPools,
            roundSnapshots,
            rewardClaimed,
            qualifiedQuestionRewardClaimants,
            rewardPoolPayerIdentity,
            rewardPoolPayerIdentityKey,
            votingEngine,
            protocolConfig,
            rewardPoolId,
            roundId,
            account,
            bpsScale
        );
    }

    function claimableQuestionRewardWithPayoutWeight(
        mapping(uint256 => RewardPool) storage rewardPools,
        mapping(uint256 => mapping(uint256 => RoundSnapshot)) storage roundSnapshots,
        mapping(uint256 => mapping(uint256 => mapping(bytes32 => bool))) storage rewardClaimed,
        mapping(
            uint256 => mapping(uint256 => mapping(bytes32 => mapping(bytes32 => bool)))
        ) storage qualifiedQuestionRewardClaimants,
        mapping(uint256 => address) storage rewardPoolPayerIdentity,
        mapping(uint256 => bytes32) storage rewardPoolPayerIdentityKey,
        mapping(uint256 => address) storage rewardPoolClusterPayoutOracle,
        mapping(uint256 => uint64) storage rewardPoolClusterPayoutOraclePinnedAt,
        RoundVotingEngine votingEngine,
        ProtocolConfig protocolConfig,
        IClusterPayoutOracle.PayoutWeight calldata payoutWeight,
        bytes32[] calldata proof,
        ClaimableQuestionRewardParams calldata params
    ) external view returns (uint256 claimableAmount) {
        RewardPool storage rewardPool = rewardPools[params.rewardPoolId];
        if (rewardPool.id == 0 || rewardPool.refunded) return 0;
        if (!_usesClusterPayoutSnapshot(rewardPoolClusterPayoutOracle, rewardPool)) {
            return _claimableQuestionReward(
                rewardPools,
                roundSnapshots,
                rewardClaimed,
                qualifiedQuestionRewardClaimants,
                rewardPoolPayerIdentity,
                rewardPoolPayerIdentityKey,
                votingEngine,
                protocolConfig,
                params.rewardPoolId,
                params.roundId,
                params.account,
                params.bpsScale
            );
        }

        (bytes32 identityKey, bytes32 commitKey, address rewardRecipient) = QuestionRewardPoolEscrowVoterLib.resolveRoundRewardClaim(
            votingEngine, protocolConfig, rewardPool.contentId, params.roundId, params.account
        );
        if (
            commitKey == bytes32(0) || rewardClaimed[params.rewardPoolId][params.roundId][commitKey]
                || _isIdentityBannedForRound(
                    votingEngine, protocolConfig, rewardPool.contentId, params.roundId, identityKey
                )
                || _isCommitVoterBannedForRound(
                    votingEngine, protocolConfig, rewardPool.contentId, params.roundId, commitKey
                )
                || _isExcludedClaimant(
                    rewardPool, rewardPoolPayerIdentity, rewardPoolPayerIdentityKey, identityKey, rewardRecipient
                )
        ) return 0;
        (bool windowActive, uint64 bountyOpensAt, uint64 bountyClosesAt) =
            QuestionRewardPoolEscrowWindowLib.previewRewardPoolWindowForRound(votingEngine, rewardPool, params.roundId);
        if (!windowActive) return 0;
        (bool revealed, address frontend) = QuestionRewardPoolEscrowVoterLib.timelyRevealedCommitFrontend(
            votingEngine, rewardPool.contentId, params.roundId, commitKey, bountyOpensAt, bountyClosesAt
        );
        (,, uint256 cleanupRemaining,) = votingEngine.roundLifecycleState(rewardPool.contentId, params.roundId);
        if (!revealed || cleanupRemaining > 0) {
            return 0;
        }

        RoundSnapshot storage snapshot = roundSnapshots[params.rewardPoolId][params.roundId];
        if (!_isQuestionBountyEligibleForClaim(
                rewardPool,
                qualifiedQuestionRewardClaimants,
                params.rewardPoolId,
                params.roundId,
                commitKey,
                votingEngine,
                snapshot
            )) return 0;
        uint256 baseClaimWeight = _roundClaimWeight(votingEngine, rewardPool.contentId, params.roundId, commitKey);
        uint256 claimWeight = _effectiveClusterQuestionClaimWeight(
            rewardPoolClusterPayoutOracle,
            rewardPool,
            params.rewardPoolId,
            params.roundId,
            identityKey,
            commitKey,
            rewardRecipient,
            baseClaimWeight,
            payoutWeight,
            proof,
            params.payoutDomain,
            snapshot.clusterWeightRoot,
            snapshot.clusterSnapshotDigest,
            snapshot.totalClaimWeight
        );
        if (claimWeight == 0) return 0;

        if (!snapshot.qualified) {
            if (!_canPreviewNewQualification(
                    rewardPool, params.roundId, params.bypassQualificationCursor, params.useRecoveredAllocation
                )) return 0;
            (, bool canQualify,, uint256 effectiveParticipantUnits, uint256 totalClaimWeight,) = QuestionRewardPoolEscrowQualificationLib.previewRoundQualificationWithClusterSnapshot(
                rewardPoolPayerIdentity,
                rewardPoolPayerIdentityKey,
                rewardPoolClusterPayoutOracle,
                rewardPoolClusterPayoutOraclePinnedAt,
                votingEngine,
                rewardPool,
                params.roundId,
                params.payoutDomain
            );
            if (!canQualify) return 0;

            uint256 allocation =
                params.useRecoveredAllocation ? snapshot.allocation : _previewRoundAllocation(rewardPool);
            if (allocation == 0 || allocation < effectiveParticipantUnits) return 0;
            return _claimableWeighted(
                votingEngine,
                rewardPool.contentId,
                params.roundId,
                commitKey,
                frontend,
                allocation,
                (allocation * rewardPool.frontendFeeBps) / params.bpsScale,
                totalClaimWeight,
                claimWeight,
                0,
                0,
                0
            );
        }
        if (snapshot.claimedWeight >= snapshot.totalClaimWeight) return 0;
        return _claimableWeighted(
            votingEngine,
            rewardPool.contentId,
            params.roundId,
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

    function effectiveClusterQuestionClaimWeight(
        mapping(uint256 => address) storage rewardPoolClusterPayoutOracle,
        RewardPool storage rewardPool,
        uint256 rewardPoolId,
        uint256 roundId,
        bytes32 identityKey,
        bytes32 commitKey,
        address rewardRecipient,
        uint256 baseClaimWeight,
        IClusterPayoutOracle.PayoutWeight memory payoutWeight,
        bytes32[] memory proof,
        uint8 payoutDomain,
        bytes32 expectedWeightRoot,
        bytes32 expectedSnapshotDigest,
        uint256 expectedTotalClaimWeight
    ) external view returns (uint256) {
        return _effectiveClusterQuestionClaimWeight(
            rewardPoolClusterPayoutOracle,
            rewardPool,
            rewardPoolId,
            roundId,
            identityKey,
            commitKey,
            rewardRecipient,
            baseClaimWeight,
            payoutWeight,
            proof,
            payoutDomain,
            expectedWeightRoot,
            expectedSnapshotDigest,
            expectedTotalClaimWeight
        );
    }

    function _claimableQuestionReward(
        mapping(uint256 => RewardPool) storage rewardPools,
        mapping(uint256 => mapping(uint256 => RoundSnapshot)) storage roundSnapshots,
        mapping(uint256 => mapping(uint256 => mapping(bytes32 => bool))) storage rewardClaimed,
        mapping(
            uint256 => mapping(uint256 => mapping(bytes32 => mapping(bytes32 => bool)))
        ) storage qualifiedQuestionRewardClaimants,
        mapping(uint256 => address) storage rewardPoolPayerIdentity,
        mapping(uint256 => bytes32) storage rewardPoolPayerIdentityKey,
        RoundVotingEngine votingEngine,
        ProtocolConfig protocolConfig,
        uint256 rewardPoolId,
        uint256 roundId,
        address account,
        uint256 bpsScale
    ) private view returns (uint256 claimableAmount) {
        RewardPool storage rewardPool = rewardPools[rewardPoolId];
        if (rewardPool.id == 0 || rewardPool.refunded) return 0;

        (bytes32 identityKey, bytes32 commitKey, address rewardRecipient) = QuestionRewardPoolEscrowVoterLib.resolveRoundRewardClaim(
            votingEngine, protocolConfig, rewardPool.contentId, roundId, account
        );
        if (
            commitKey == bytes32(0)
                || _isIdentityBannedForRound(votingEngine, protocolConfig, rewardPool.contentId, roundId, identityKey)
                || _isCommitVoterBannedForRound(votingEngine, protocolConfig, rewardPool.contentId, roundId, commitKey)
                || _isExcludedClaimant(
                    rewardPool, rewardPoolPayerIdentity, rewardPoolPayerIdentityKey, identityKey, rewardRecipient
                )
        ) {
            return 0;
        }

        if (rewardClaimed[rewardPoolId][roundId][commitKey]) return 0;
        (bool windowActive, uint64 bountyOpensAt, uint64 bountyClosesAt) =
            QuestionRewardPoolEscrowWindowLib.previewRewardPoolWindowForRound(votingEngine, rewardPool, roundId);
        if (!windowActive) return 0;
        (bool revealed, address frontend) = QuestionRewardPoolEscrowVoterLib.timelyRevealedCommitFrontend(
            votingEngine, rewardPool.contentId, roundId, commitKey, bountyOpensAt, bountyClosesAt
        );
        if (!revealed) return 0;

        RoundSnapshot storage snapshot = roundSnapshots[rewardPoolId][roundId];
        if (!_isQuestionBountyEligibleForClaim(
                rewardPool, qualifiedQuestionRewardClaimants, rewardPoolId, roundId, commitKey, votingEngine, snapshot
            )) return 0;
        (,, uint256 cleanupRemaining,) = votingEngine.roundLifecycleState(rewardPool.contentId, roundId);
        if (cleanupRemaining > 0) return 0;
        uint256 claimWeight = _roundClaimWeight(votingEngine, rewardPool.contentId, roundId, commitKey);
        if (claimWeight == 0) return 0;
        if (!snapshot.qualified) {
            if (!_canPreviewNewQualification(rewardPool, roundId, false, false)) return 0;
            (, bool canQualify,, uint256 effectiveParticipantUnits, uint256 totalClaimWeight,) = _previewRoundQualification(
                rewardPool, rewardPoolPayerIdentity, rewardPoolPayerIdentityKey, votingEngine, protocolConfig, roundId
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
        if (snapshot.totalClaimWeight == 0) return 0;
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

    function _isQuestionBountyEligibleForClaim(
        RewardPool storage rewardPool,
        mapping(
            uint256 => mapping(uint256 => mapping(bytes32 => mapping(bytes32 => bool)))
        ) storage qualifiedQuestionRewardClaimants,
        uint256 rewardPoolId,
        uint256 roundId,
        bytes32 commitKey,
        RoundVotingEngine votingEngine,
        RoundSnapshot storage snapshot
    ) private view returns (bool) {
        if (snapshot.qualified) {
            return qualifiedQuestionRewardClaimants[rewardPoolId][roundId][snapshot.clusterSnapshotDigest][commitKey];
        }
        if (rewardPool.bountyEligibility == BOUNTY_ELIGIBILITY_OPEN) return true;
        (,,, uint8 credentialMask, uint8 freshCredentialMask,) =
            votingEngine.commitIdentityState(rewardPool.contentId, roundId, commitKey);
        return QuestionRewardPoolEscrowEligibilityLib.isCommitEligibleForBounty(
            rewardPool.bountyEligibility, credentialMask, freshCredentialMask
        );
    }

    function _isIdentityBannedForRound(
        RoundVotingEngine votingEngine,
        ProtocolConfig protocolConfig,
        uint256 contentId,
        uint256 roundId,
        bytes32 identityKey
    ) private view returns (bool) {
        if (identityKey == bytes32(0)) return false;
        address snapshot = votingEngine.roundRaterRegistrySnapshot(contentId, roundId);
        if (_isIdentityBannedAt(snapshot, identityKey)) return true;
        address current = protocolConfig.raterRegistry();
        if (current == snapshot) return false;
        return _isIdentityBannedAt(current, identityKey);
    }

    function _isCommitVoterBannedForRound(
        RoundVotingEngine votingEngine,
        ProtocolConfig protocolConfig,
        uint256 contentId,
        uint256 roundId,
        bytes32 commitKey
    ) private view returns (bool) {
        (address voter,,,,,,) = votingEngine.commitCore(contentId, roundId, commitKey);
        (, address holder,,,,) = votingEngine.commitIdentityState(contentId, roundId, commitKey);
        return _isIdentityBannedForRound(
            votingEngine, protocolConfig, contentId, roundId, QuestionRewardPoolEscrowVoterLib.addressIdentityKey(voter)
        )
            || _isIdentityBannedForRound(
            votingEngine,
            protocolConfig,
            contentId,
            roundId,
            QuestionRewardPoolEscrowVoterLib.addressIdentityKey(holder)
        );
    }

    function _isIdentityBannedAt(address registryAddress, bytes32 identityKey) private view returns (bool) {
        if (registryAddress == address(0)) return false;
        try IRaterRegistryStatus(registryAddress).isIdentityKeyBanned(identityKey) returns (bool banned) {
            return banned;
        } catch {
            return false;
        }
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
        RewardPool storage rewardPool,
        mapping(uint256 => address) storage rewardPoolPayerIdentity,
        mapping(uint256 => bytes32) storage rewardPoolPayerIdentityKey,
        bytes32 identityKey,
        address account
    ) private view returns (bool) {
        return QuestionRewardPoolEscrowQualificationLib.isExcludedRater(
            identityKey,
            account,
            rewardPool.funder,
            rewardPoolPayerIdentity[rewardPool.id],
            rewardPoolPayerIdentityKey[rewardPool.id],
            rewardPool.submitterIdentity,
            rewardPool.submitterIdentityKey
        );
    }

    function _canPreviewNewQualification(
        RewardPool storage rewardPool,
        uint256 roundId,
        bool bypassCursor,
        bool useRecoveredAllocation
    ) private view returns (bool) {
        if (rewardPool.refunded || rewardPool.qualifiedRounds >= rewardPool.requiredSettledRounds) {
            return false;
        }
        bool preQualificationSkippedPreview = bypassCursor && !useRecoveredAllocation
            && rewardPool.pendingPreQualificationRejectedRounds != 0
            && uint256(rewardPool.nextRoundToEvaluate)
                == roundId + uint256(rewardPool.pendingPreQualificationRejectedRounds);
        if (rewardPool.pendingPreQualificationRejectedRounds != 0 && !preQualificationSkippedPreview) {
            return false;
        }
        if (bypassCursor) {
            if (useRecoveredAllocation) return roundId >= rewardPool.startRoundId;
            if (rewardPool.unallocatedRefunded || rewardPool.pendingRecoveredRounds != 0) return false;
            return roundId >= rewardPool.startRoundId;
        }
        if (rewardPool.unallocatedRefunded || rewardPool.pendingRecoveredRounds != 0) return false;
        return roundId >= rewardPool.startRoundId && roundId == rewardPool.nextRoundToEvaluate;
    }

    function _previewRoundQualification(
        RewardPool storage rewardPool,
        mapping(uint256 => address) storage rewardPoolPayerIdentity,
        mapping(uint256 => bytes32) storage rewardPoolPayerIdentityKey,
        RoundVotingEngine votingEngine,
        ProtocolConfig protocolConfig,
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
        (bool windowActive, uint64 bountyOpensAt, uint64 bountyClosesAt) =
            QuestionRewardPoolEscrowWindowLib.previewRewardPoolWindowForRound(votingEngine, rewardPool, roundId);
        if (!windowActive) return (false, false, 0, 0, 0, 0);
        (roundSettled, canQualify, rawEligibleVoters, effectiveParticipantUnits, totalClaimWeight, settledAt) =
            QuestionRewardPoolEscrowQualificationLib.previewRoundQualification(
                QuestionRewardPoolEscrowQualificationLib.QualificationContext({
                    votingEngine: votingEngine,
                    protocolConfig: protocolConfig,
                    rewardId: rewardPool.id,
                    contentId: rewardPool.contentId,
                    roundId: roundId,
                    bountyOpensAt: bountyOpensAt,
                    bountyClosesAt: bountyClosesAt,
                    requiredVoters: rewardPool.requiredVoters,
                    bountyEligibility: rewardPool.bountyEligibility,
                    funder: rewardPool.funder,
                    funderIdentity: rewardPoolPayerIdentity[rewardPool.id],
                    funderIdentityKey: rewardPoolPayerIdentityKey[rewardPool.id],
                    submitterIdentity: rewardPool.submitterIdentity,
                    submitterIdentityKey: rewardPool.submitterIdentityKey
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

    function _roundClaimWeight(RoundVotingEngine, uint256, uint256, bytes32) private pure returns (uint256) {
        return BASE_CLAIM_WEIGHT_BPS;
    }

    function _effectiveClusterQuestionClaimWeight(
        mapping(uint256 => address) storage rewardPoolClusterPayoutOracle,
        RewardPool storage rewardPool,
        uint256 rewardPoolId,
        uint256 roundId,
        bytes32 identityKey,
        bytes32 commitKey,
        address rewardRecipient,
        uint256 baseClaimWeight,
        IClusterPayoutOracle.PayoutWeight memory payoutWeight,
        bytes32[] memory proof,
        uint8 payoutDomain,
        bytes32 expectedWeightRoot,
        bytes32 expectedSnapshotDigest,
        uint256 expectedTotalClaimWeight
    ) private view returns (uint256) {
        // Cluster-snapshot leaves carry a surprise-weighted base weight in
        // [10_000, 20_000] bps; non-snapshot
        // rounds keep the flat equal-share path (`_roundClaimWeight` returning exactly
        // BASE_CLAIM_WEIGHT_BPS).
        require(
            payoutWeight.domain == payoutDomain && payoutWeight.rewardPoolId == rewardPoolId
                && payoutWeight.contentId == rewardPool.contentId && payoutWeight.roundId == roundId
                && payoutWeight.commitKey == commitKey && payoutWeight.identityKey == identityKey
                && payoutWeight.account == rewardRecipient && payoutWeight.baseWeight >= baseClaimWeight
                && payoutWeight.baseWeight <= MAX_CLAIM_WEIGHT_BPS && payoutWeight.effectiveWeight > 0,
            "Invalid cluster proof"
        );
        address oracle = rewardPoolClusterPayoutOracle[rewardPool.id];
        require(IClusterPayoutOracle(oracle).verifyPayoutWeight(payoutWeight, proof), "Invalid cluster proof");
        if (expectedWeightRoot != bytes32(0)) {
            IClusterPayoutOracle.RoundPayoutSnapshot memory currentSnapshot = IClusterPayoutOracle(oracle)
                .getRoundPayoutSnapshot(payoutDomain, rewardPoolId, rewardPool.contentId, roundId);
            bytes32 currentDigest =
                IClusterPayoutOracle(oracle).roundPayoutSnapshotProposalDigest(currentSnapshot.snapshotKey);
            require(
                currentSnapshot.status == IClusterPayoutOracle.SnapshotStatus.Finalized
                    && currentSnapshot.weightRoot == expectedWeightRoot
                    && currentSnapshot.totalClaimWeight == expectedTotalClaimWeight
                    && currentDigest == expectedSnapshotDigest
                    && !IClusterPayoutOracle(oracle)
                        .rejectedRoundPayoutSnapshotDigests(currentSnapshot.snapshotKey, expectedSnapshotDigest),
                "Cluster snapshot changed"
            );
        }
        return payoutWeight.effectiveWeight;
    }

    function _usesClusterPayoutSnapshot(
        mapping(uint256 => address) storage rewardPoolClusterPayoutOracle,
        RewardPool storage rewardPool
    ) private view returns (bool) {
        return rewardPoolClusterPayoutOracle[rewardPool.id] != address(0);
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
        if (reservedFrontendFee == 0 || frontend == address(0)) {
            return (grossAmount, 0, address(0));
        }

        (,,,,, bool frontendEligible) = votingEngine.commitIdentityState(contentId, roundId, commitKey);
        if (!frontendEligible) {
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
            // settled cannot revive the bounty fee. Also covers slash/exit-pending/credential status.
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
        (,,,,,, settledAt,) = votingEngine.roundCore(contentId, roundId);
    }
}
