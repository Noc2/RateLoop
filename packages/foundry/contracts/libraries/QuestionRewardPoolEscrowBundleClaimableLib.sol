// SPDX-License-Identifier: MIT
pragma solidity ^0.8.34;

import { ContentRegistry } from "../ContentRegistry.sol";
import { ProtocolConfig } from "../ProtocolConfig.sol";
import { RoundVotingEngine } from "../RoundVotingEngine.sol";
import { IRaterRegistryStatus } from "../interfaces/IRaterRegistryStatus.sol";
import { QuestionRewardPoolEscrowBundleLib } from "./QuestionRewardPoolEscrowBundleLib.sol";
import { QuestionRewardPoolEscrowClaimLib, EqualShareInputs } from "./QuestionRewardPoolEscrowClaimLib.sol";
import {
    BOUNTY_ELIGIBILITY_OPEN,
    BundleReward,
    BundleQuestion,
    BundleRoundSetSnapshot
} from "./QuestionRewardPoolEscrowTypes.sol";
import { QuestionRewardPoolEscrowEligibilityLib } from "./QuestionRewardPoolEscrowEligibilityLib.sol";
import { QuestionRewardPoolEscrowVoterLib } from "./QuestionRewardPoolEscrowVoterLib.sol";
import { QuestionRewardPoolEscrowWindowLib } from "./QuestionRewardPoolEscrowWindowLib.sol";

struct BundleEqualSharePreview {
    uint256 allocation;
    uint256 frontendFeeAllocation;
    uint256 eligibleCompleters;
    uint256 claimedCount;
}

library QuestionRewardPoolEscrowBundleClaimableLib {
    uint256 private constant BPS_SCALE = 10_000;

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
        if (bundle.refunded || roundSetIndex >= bundle.requiredSettledRounds) return 0;
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

        (bool windowActive, uint64 bountyOpensAt, uint64 bountyClosesAt) = QuestionRewardPoolEscrowWindowLib.previewBundleWindowForRoundSet(
            votingEngine, bundle, bundleQuestions[bundleId], bundleRoundIds, bundleId, roundSetIndex
        );
        if (!windowActive) return 0;

        (bool completed, address frontend, bytes32 firstCommitKey) = QuestionRewardPoolEscrowBundleLib.bundleRoundSetCommitStatus(
            bundleQuestions,
            bundleRoundIds,
            votingEngine,
            protocolConfig,
            bountyOpensAt,
            bountyClosesAt,
            bundleId,
            roundSetIndex,
            account,
            true,
            true
        );
        if (!completed) return 0;
        if (bundleRoundSetRewardClaimed[bundleId][roundSetIndex][firstCommitKey]) return 0;
        if (_isBundleCompleterBanned(
                bundleQuestions, bundleRoundIds, votingEngine, protocolConfig, bundleId, roundSetIndex, account
            )) return 0;

        BundleQuestion storage firstQuestion = bundleQuestions[bundleId][0];
        uint256 firstRoundId = bundleRoundIds[bundleId][0][roundSetIndex];
        BundleRoundSetSnapshot storage snapshot = bundleRoundSetSnapshots[bundleId][roundSetIndex];
        if (snapshot.qualified) {
            if (!QuestionRewardPoolEscrowBundleLib.isRoundSetClaimOpen(
                    bundleRoundSetSnapshots, bundle, bundleId, roundSetIndex
                )) return 0;
            if (!qualifiedBundleRoundSetClaimants[bundleId][roundSetIndex][firstCommitKey]) return 0;
        } else if (!_isEligiblePendingBundleRoundSetCompleter(
                bundleQuestions,
                bundleRoundIds,
                registry,
                votingEngine,
                protocolConfig,
                bundle,
                bundleId,
                roundSetIndex,
                firstCommitKey,
                account
            )) {
            return 0;
        }
        BundleEqualSharePreview memory preview = _equalSharePreview(
            bundleQuestions,
            bundleRoundIds,
            registry,
            votingEngine,
            protocolConfig,
            bundle,
            snapshot,
            bundleId,
            roundSetIndex
        );
        if (preview.allocation == 0) return 0;
        (, claimableAmount,,) = QuestionRewardPoolEscrowClaimLib.computeEqualShareClaimSplit(
            votingEngine,
            firstQuestion.contentId,
            firstRoundId,
            firstCommitKey,
            frontend,
            EqualShareInputs({
                allocation: preview.allocation,
                frontendFeeAllocation: preview.frontendFeeAllocation,
                eligibleParticipants: preview.eligibleCompleters,
                claimedCount: preview.claimedCount
            })
        );
    }

    function _equalSharePreview(
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
        BundleRoundSetSnapshot storage snapshot,
        uint256 bundleId,
        uint256 roundSetIndex
    ) private view returns (BundleEqualSharePreview memory preview) {
        if (snapshot.qualified) {
            preview.allocation = snapshot.allocation;
            preview.frontendFeeAllocation = snapshot.frontendFeeAllocation;
            preview.eligibleCompleters = snapshot.eligibleCompleters;
            preview.claimedCount = snapshot.claimedCount;
            return preview;
        }
        if (bundle.pendingRecoveredRoundSets != 0 || roundSetIndex != bundle.completedRoundSets) return preview;
        if (!_hasRecordedRoundSet(bundleQuestions, bundleRoundIds, bundleId, roundSetIndex)) return preview;

        uint256 eligibleCompleters = _bundleRoundSetCompleterCount(
            bundleQuestions, bundleRoundIds, registry, votingEngine, protocolConfig, bundle, bundleId, roundSetIndex
        );
        if (eligibleCompleters < bundle.requiredCompleters) return preview;

        uint256 allocation = QuestionRewardPoolEscrowBundleLib.previewRoundSetAllocation(bundle);
        if (allocation == 0 || allocation > bundle.unallocatedAmount || allocation < eligibleCompleters) {
            return preview;
        }
        preview.allocation = allocation;
        preview.frontendFeeAllocation = (allocation * bundle.frontendFeeBps) / BPS_SCALE;
        preview.eligibleCompleters = eligibleCompleters;
    }

    function _hasRecordedRoundSet(
        mapping(uint256 => BundleQuestion[]) storage bundleQuestions,
        mapping(
            uint256
                => mapping(
                uint256 => mapping(uint256 => uint64)
            )
        ) storage bundleRoundIds,
        uint256 bundleId,
        uint256 roundSetIndex
    ) private view returns (bool) {
        BundleQuestion[] storage questions = bundleQuestions[bundleId];
        for (uint256 i = 0; i < questions.length;) {
            if (bundleRoundIds[bundleId][i][roundSetIndex] == 0) return false;
            unchecked {
                ++i;
            }
        }
        return questions.length != 0;
    }

    function _bundleRoundSetCompleterCount(
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
        uint256 roundSetIndex
    ) private view returns (uint256 completerCount) {
        BundleQuestion[] storage questions = bundleQuestions[bundleId];
        if (questions.length == 0) return 0;

        uint256 firstContentId = questions[0].contentId;
        uint256 firstRoundId = bundleRoundIds[bundleId][0][roundSetIndex];
        (,, uint16 commitCount,,,,,) = votingEngine.roundCore(firstContentId, firstRoundId);
        for (uint256 i = 0; i < commitCount;) {
            bytes32 commitKey = votingEngine.getRoundCommitKey(firstContentId, firstRoundId, i);
            if (_isEligiblePendingBundleRoundSetCompleter(
                    bundleQuestions,
                    bundleRoundIds,
                    registry,
                    votingEngine,
                    protocolConfig,
                    bundle,
                    bundleId,
                    roundSetIndex,
                    commitKey,
                    QuestionRewardPoolEscrowVoterLib.bundleCompleterAccount(
                        votingEngine, firstContentId, firstRoundId, commitKey
                    )
                )) {
                unchecked {
                    ++completerCount;
                }
            }
            unchecked {
                ++i;
            }
        }
    }

    function _isEligiblePendingBundleRoundSetCompleter(
        mapping(uint256 => BundleQuestion[]) storage bundleQuestions,
        mapping(
            uint256 => mapping(uint256 => mapping(uint256 => uint64))
        ) storage bundleRoundIds,
        ContentRegistry registry,
        RoundVotingEngine votingEngine,
        ProtocolConfig protocolConfig,
        BundleReward storage bundle,
        uint256 bundleId,
        uint256 roundSetIndex,
        bytes32 firstCommitKey,
        address account
    ) private view returns (bool) {
        if (account == address(0)) return false;
        if (_isBundleCompleterBanned(
                bundleQuestions, bundleRoundIds, votingEngine, protocolConfig, bundleId, roundSetIndex, account
            )) return false;
        return !QuestionRewardPoolEscrowBundleLib.isBundleExcludedVoter(
            bundleQuestions,
            bundleRoundIds,
            registry,
            votingEngine,
            protocolConfig,
            bundle,
            bundleId,
            roundSetIndex,
            account
        )
            && _bundleRoundSetCommitCompleted(
            bundleQuestions, bundleRoundIds, votingEngine, protocolConfig, bundle, bundleId, roundSetIndex, account
        )
            && _bundleRoundSetCommitBountyEligible(
            bundleQuestions,
            bundleRoundIds,
            votingEngine,
            protocolConfig,
            bundle,
            bundleId,
            roundSetIndex,
            firstCommitKey,
            account
        );
    }

    function _bundleRoundSetCommitCompleted(
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
    ) private view returns (bool completed) {
        (bool windowActive, uint64 bountyOpensAt, uint64 bountyClosesAt) = QuestionRewardPoolEscrowWindowLib.previewBundleWindowForRoundSet(
            votingEngine, bundle, bundleQuestions[bundleId], bundleRoundIds, bundleId, roundSetIndex
        );
        if (!windowActive) return false;
        (completed,,) = QuestionRewardPoolEscrowBundleLib.bundleRoundSetCommitStatus(
            bundleQuestions,
            bundleRoundIds,
            votingEngine,
            protocolConfig,
            bountyOpensAt,
            bountyClosesAt,
            bundleId,
            roundSetIndex,
            account,
            false,
            false
        );
    }

    function _bundleRoundSetCommitBountyEligible(
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
        bytes32 firstCommitKey,
        address account
    ) private view returns (bool) {
        if (bundle.bountyEligibility == BOUNTY_ELIGIBILITY_OPEN) return true;

        BundleQuestion[] storage questions = bundleQuestions[bundleId];
        for (uint256 i = 0; i < questions.length;) {
            uint256 roundId = bundleRoundIds[bundleId][i][roundSetIndex];
            bytes32 commitKey = firstCommitKey;
            if (i != 0) {
                (, commitKey,) = QuestionRewardPoolEscrowVoterLib.resolveRoundRewardClaim(
                    votingEngine, protocolConfig, questions[i].contentId, roundId, account
                );
            }
            if (commitKey == bytes32(0)) return false;
            (,,, uint8 credentialMask, uint8 freshCredentialMask,) =
                votingEngine.commitIdentityState(questions[i].contentId, roundId, commitKey);
            if (!QuestionRewardPoolEscrowEligibilityLib.isCommitEligibleForBounty(
                    bundle.bountyEligibility, credentialMask, freshCredentialMask
                )) {
                return false;
            }
            unchecked {
                ++i;
            }
        }
        return true;
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
