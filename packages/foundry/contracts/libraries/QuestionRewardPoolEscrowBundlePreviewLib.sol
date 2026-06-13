// SPDX-License-Identifier: MIT
pragma solidity ^0.8.34;

import { ContentRegistry } from "../ContentRegistry.sol";
import { IClusterPayoutOracle } from "../interfaces/IClusterPayoutOracle.sol";
import { IRaterRegistryStatus } from "../interfaces/IRaterRegistryStatus.sol";
import { ProtocolConfig } from "../ProtocolConfig.sol";
import { RoundVotingEngine } from "../RoundVotingEngine.sol";
import { QuestionRewardPoolEscrowBundleLib } from "./QuestionRewardPoolEscrowBundleLib.sol";
import { QuestionRewardPoolEscrowClaimLib, WeightedShareInputs } from "./QuestionRewardPoolEscrowClaimLib.sol";
import { BundleQuestion, BundleReward, BundleRoundSetSnapshot } from "./QuestionRewardPoolEscrowTypes.sol";
import { QuestionRewardPoolEscrowVoterLib } from "./QuestionRewardPoolEscrowVoterLib.sol";

struct BundlePreviewClaimContext {
    bool completed;
    address frontend;
    bytes32 firstCommitKey;
    uint256 firstContentId;
    uint256 firstRoundId;
    bytes32 identityKey;
    address rewardRecipient;
}

library QuestionRewardPoolEscrowBundlePreviewLib {
    uint256 private constant BASE_CLAIM_WEIGHT_BPS = 10_000;
    uint256 private constant MAX_CLAIM_WEIGHT_BPS = 20_000;

    function claimableQuestionBundleRewardWithPayoutWeight(
        mapping(uint256 => BundleReward) storage bundleRewards,
        mapping(uint256 => BundleQuestion[]) storage bundleQuestions,
        mapping(uint256 => mapping(uint256 => mapping(uint256 => uint64))) storage bundleRoundIds,
        mapping(uint256 => mapping(uint256 => BundleRoundSetSnapshot)) storage bundleRoundSetSnapshots,
        mapping(uint256 => address) storage bundleRewardClusterPayoutOracle,
        mapping(uint256 => mapping(uint256 => mapping(bytes32 => bool))) storage bundleRoundSetRewardClaimed,
        mapping(uint256 => mapping(uint256 => mapping(bytes32 => bool))) storage qualifiedBundleRoundSetClaimants,
        ContentRegistry registry,
        RoundVotingEngine votingEngine,
        ProtocolConfig protocolConfig,
        IClusterPayoutOracle.PayoutWeight calldata payoutWeight,
        bytes32[] calldata proof,
        uint8 payoutDomain,
        uint256 bundleId,
        uint256 roundSetIndex,
        address account
    ) external view returns (uint256 claimableAmount) {
        BundleReward storage bundle = bundleRewards[bundleId];
        if (bundle.id == 0 || !_isBundleRoundSetClaimOpen(bundleRoundSetSnapshots, bundle, bundleId, roundSetIndex)) {
            return 0;
        }
        if (bundleRewardClusterPayoutOracle[bundle.id] == address(0)) return 0;
        if (_isBundleExcludedVoter(
                bundleQuestions,
                bundleRoundIds,
                registry,
                votingEngine,
                protocolConfig,
                bundle,
                bundleId,
                roundSetIndex,
                account
            )) return 0;

        BundlePreviewClaimContext memory ctx = _bundleClaimContext(
            bundleQuestions, bundleRoundIds, votingEngine, protocolConfig, bundle, bundleId, roundSetIndex, account
        );
        if (!ctx.completed) return 0;
        if (!qualifiedBundleRoundSetClaimants[bundleId][roundSetIndex][ctx.firstCommitKey]) return 0;
        if (bundleRoundSetRewardClaimed[bundleId][roundSetIndex][ctx.firstCommitKey]) return 0;
        if (_isBundleCompleterBanned(
                bundleQuestions, bundleRoundIds, votingEngine, protocolConfig, bundleId, roundSetIndex, account
            )) return 0;

        BundleRoundSetSnapshot storage snapshot = bundleRoundSetSnapshots[bundleId][roundSetIndex];
        if (snapshot.totalClaimWeight == 0 || snapshot.claimedWeight >= snapshot.totalClaimWeight) return 0;
        uint256 claimWeight = _effectiveClusterBundleClaimWeight(
            bundleRewardClusterPayoutOracle,
            bundle,
            snapshot,
            bundleId,
            roundSetIndex,
            ctx.identityKey,
            ctx.firstCommitKey,
            ctx.rewardRecipient,
            payoutWeight,
            proof,
            payoutDomain
        );
        if (claimWeight == 0) return 0;
        (, claimableAmount,,,) = QuestionRewardPoolEscrowClaimLib.computeWeightedClaimSplit(
            votingEngine,
            ctx.firstContentId,
            ctx.firstRoundId,
            ctx.firstCommitKey,
            ctx.frontend,
            claimWeight,
            WeightedShareInputs({
                allocation: snapshot.allocation,
                frontendFeeAllocation: snapshot.frontendFeeAllocation,
                totalClaimWeight: snapshot.totalClaimWeight,
                claimedWeight: snapshot.claimedWeight,
                claimedAmount: snapshot.claimedAmount,
                frontendFeeClaimedAmount: snapshot.frontendFeeClaimedAmount
            })
        );
    }

    function _bundleClaimContext(
        mapping(uint256 => BundleQuestion[]) storage bundleQuestions,
        mapping(
            uint256
                => mapping(
                uint256 => mapping(uint256 => uint64)
            )
        ) storage bundleRoundIds,
        RoundVotingEngine votingEngine,
        ProtocolConfig protocolConfig,
        BundleReward storage bundle,
        uint256 bundleId,
        uint256 roundSetIndex,
        address account
    ) private view returns (BundlePreviewClaimContext memory ctx) {
        (ctx.completed, ctx.frontend, ctx.firstCommitKey) =
            QuestionRewardPoolEscrowBundleLib.bundleRoundSetCommitStatus(
                    bundleQuestions,
                    bundleRoundIds,
                    votingEngine,
                    protocolConfig,
                    bundle.bountyOpensAt,
                    bundle.bountyClosesAt,
                    bundleId,
                    roundSetIndex,
                    account,
                    true,
                    true
                );
        if (!ctx.completed) return ctx;

        ctx.firstContentId = bundleQuestions[bundleId][0].contentId;
        ctx.firstRoundId = bundleRoundIds[bundleId][0][roundSetIndex];
        bytes32 resolvedFirstCommitKey;
        (ctx.identityKey, resolvedFirstCommitKey, ctx.rewardRecipient) =
            QuestionRewardPoolEscrowVoterLib.resolveRoundRewardClaim(
                votingEngine, protocolConfig, ctx.firstContentId, ctx.firstRoundId, account
            );
        if (resolvedFirstCommitKey != ctx.firstCommitKey) {
            ctx.completed = false;
        }
    }

    function _isBundleCompleterBanned(
        mapping(uint256 => BundleQuestion[]) storage bundleQuestions,
        mapping(
            uint256
                => mapping(
                uint256 => mapping(uint256 => uint64)
            )
        ) storage bundleRoundIds,
        RoundVotingEngine votingEngine,
        ProtocolConfig protocolConfig,
        uint256 bundleId,
        uint256 roundSetIndex,
        address account
    ) private view returns (bool) {
        BundleQuestion[] storage questions = bundleQuestions[bundleId];
        for (uint256 i = 0; i < questions.length;) {
            uint256 contentId = questions[i].contentId;
            uint256 roundId = bundleRoundIds[bundleId][i][roundSetIndex];
            (bytes32 identityKey, bytes32 commitKey,) = QuestionRewardPoolEscrowVoterLib.resolveRoundRewardClaim(
                votingEngine, protocolConfig, contentId, roundId, account
            );
            if (_isIdentityBannedForRound(votingEngine, protocolConfig, contentId, roundId, identityKey)) return true;
            if (commitKey != bytes32(0)) {
                (address voter,,,,,,) = votingEngine.commitCore(contentId, roundId, commitKey);
                (, address holder,,,,) = votingEngine.commitIdentityState(contentId, roundId, commitKey);
                if (_isIdentityBannedForRound(
                        votingEngine,
                        protocolConfig,
                        contentId,
                        roundId,
                        QuestionRewardPoolEscrowVoterLib.addressIdentityKey(voter)
                    )) {
                    return true;
                }
                if (_isIdentityBannedForRound(
                        votingEngine,
                        protocolConfig,
                        contentId,
                        roundId,
                        QuestionRewardPoolEscrowVoterLib.addressIdentityKey(holder)
                    )) {
                    return true;
                }
            }
            unchecked {
                ++i;
            }
        }
        return false;
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

    function _isIdentityBannedAt(address registryAddress, bytes32 identityKey) private view returns (bool) {
        if (registryAddress == address(0)) return false;
        try IRaterRegistryStatus(registryAddress).isIdentityKeyBanned(identityKey) returns (bool banned) {
            return banned;
        } catch {
            return false;
        }
    }

    function _isBundleExcludedVoter(
        mapping(uint256 => BundleQuestion[]) storage bundleQuestions,
        mapping(
            uint256
                => mapping(
                uint256 => mapping(uint256 => uint64)
            )
        ) storage bundleRoundIds,
        ContentRegistry registry,
        RoundVotingEngine votingEngine,
        ProtocolConfig protocolConfig,
        BundleReward storage bundle,
        uint256 bundleId,
        uint256 roundSetIndex,
        address account
    ) private view returns (bool) {
        return QuestionRewardPoolEscrowBundleLib.isBundleExcludedVoter(
            bundleQuestions,
            bundleRoundIds,
            registry,
            votingEngine,
            protocolConfig,
            bundle,
            bundleId,
            roundSetIndex,
            account
        );
    }

    function _isBundleRoundSetClaimOpen(
        mapping(uint256 => mapping(uint256 => BundleRoundSetSnapshot)) storage bundleRoundSetSnapshots,
        BundleReward storage bundle,
        uint256 bundleId,
        uint256 roundSetIndex
    ) private view returns (bool) {
        return QuestionRewardPoolEscrowBundleLib.isRoundSetClaimOpen(
            bundleRoundSetSnapshots, bundle, bundleId, roundSetIndex
        );
    }

    function _bundleSnapshotRoundId(uint256 roundSetIndex) private pure returns (uint256) {
        return roundSetIndex + 1;
    }

    function _effectiveClusterBundleClaimWeight(
        mapping(uint256 => address) storage bundleRewardClusterPayoutOracle,
        BundleReward storage bundle,
        BundleRoundSetSnapshot storage snapshot,
        uint256 bundleId,
        uint256 roundSetIndex,
        bytes32 identityKey,
        bytes32 commitKey,
        address rewardRecipient,
        IClusterPayoutOracle.PayoutWeight calldata payoutWeight,
        bytes32[] calldata proof,
        uint8 payoutDomain
    ) private view returns (uint256) {
        require(
            payoutWeight.domain == payoutDomain && payoutWeight.rewardPoolId == bundleId
                && payoutWeight.contentId == bundleId && payoutWeight.roundId == _bundleSnapshotRoundId(roundSetIndex)
                && payoutWeight.commitKey == commitKey && payoutWeight.identityKey == identityKey
                && payoutWeight.account == rewardRecipient && payoutWeight.baseWeight >= BASE_CLAIM_WEIGHT_BPS
                && payoutWeight.baseWeight <= MAX_CLAIM_WEIGHT_BPS && payoutWeight.effectiveWeight > 0,
            "Invalid cluster proof"
        );
        address oracleAddr = bundleRewardClusterPayoutOracle[bundle.id];
        require(oracleAddr != address(0), "Oracle not pinned");
        IClusterPayoutOracle oracle = IClusterPayoutOracle(oracleAddr);
        require(oracle.verifyPayoutWeight(payoutWeight, proof), "Invalid cluster proof");
        IClusterPayoutOracle.RoundPayoutSnapshot memory currentSnapshot =
            oracle.getRoundPayoutSnapshot(payoutDomain, bundleId, bundleId, _bundleSnapshotRoundId(roundSetIndex));
        bytes32 currentDigest = oracle.roundPayoutSnapshotProposalDigest(currentSnapshot.snapshotKey);
        require(
            currentSnapshot.status == IClusterPayoutOracle.SnapshotStatus.Finalized
                && currentSnapshot.weightRoot == snapshot.clusterWeightRoot
                && currentSnapshot.totalClaimWeight == snapshot.totalClaimWeight
                && currentDigest == snapshot.clusterSnapshotDigest
                && !oracle.rejectedRoundPayoutSnapshotDigests(currentSnapshot.snapshotKey, currentDigest),
            "Cluster snapshot changed"
        );
        return payoutWeight.effectiveWeight;
    }
}
