// SPDX-License-Identifier: MIT
pragma solidity ^0.8.34;

import { ContentRegistry } from "../ContentRegistry.sol";
import { ProtocolConfig } from "../ProtocolConfig.sol";
import { RoundVotingEngine } from "../RoundVotingEngine.sol";
import { IRaterRegistryStatus } from "../interfaces/IRaterRegistryStatus.sol";
import { QuestionRewardPoolEscrowBundleLib } from "./QuestionRewardPoolEscrowBundleLib.sol";
import { QuestionRewardPoolEscrowClaimLib, EqualShareInputs } from "./QuestionRewardPoolEscrowClaimLib.sol";
import { BundleReward, BundleQuestion, BundleRoundSetSnapshot } from "./QuestionRewardPoolEscrowTypes.sol";
import { QuestionRewardPoolEscrowVoterLib } from "./QuestionRewardPoolEscrowVoterLib.sol";

library QuestionRewardPoolEscrowBundleClaimableLib {
    function claimableQuestionBundleReward(
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
        uint256 bundleId,
        uint256 roundSetIndex,
        address account
    ) external view returns (uint256 claimableAmount) {
        BundleReward storage bundle = bundleRewards[bundleId];
        if (bundle.id == 0) return 0;
        if (!QuestionRewardPoolEscrowBundleLib.isRoundSetClaimOpen(
                bundleRoundSetSnapshots, bundle, bundleId, roundSetIndex
            )) return 0;
        if (bundleRewardClusterPayoutOracle[bundle.id] != address(0)) return 0;
        if (QuestionRewardPoolEscrowBundleLib.isBundleExcludedVoter(
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

        (bool completed, address frontend, bytes32 firstCommitKey) = QuestionRewardPoolEscrowBundleLib.bundleRoundSetCommitStatus(
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
        if (!completed) return 0;
        if (!qualifiedBundleRoundSetClaimants[bundleId][roundSetIndex][firstCommitKey]) return 0;
        if (bundleRoundSetRewardClaimed[bundleId][roundSetIndex][firstCommitKey]) return 0;
        if (_isBundleCompleterBanned(
                bundleQuestions, bundleRoundIds, votingEngine, protocolConfig, bundleId, roundSetIndex, account
            )) return 0;

        BundleQuestion storage firstQuestion = bundleQuestions[bundleId][0];
        uint256 firstRoundId = bundleRoundIds[bundleId][0][roundSetIndex];
        BundleRoundSetSnapshot storage snapshot = bundleRoundSetSnapshots[bundleId][roundSetIndex];
        (, claimableAmount,,) = QuestionRewardPoolEscrowClaimLib.computeEqualShareClaimSplit(
            votingEngine,
            firstQuestion.contentId,
            firstRoundId,
            firstCommitKey,
            frontend,
            EqualShareInputs({
                allocation: snapshot.allocation,
                frontendFeeAllocation: snapshot.frontendFeeAllocation,
                eligibleParticipants: snapshot.eligibleCompleters,
                claimedCount: snapshot.claimedCount
            })
        );
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
}
