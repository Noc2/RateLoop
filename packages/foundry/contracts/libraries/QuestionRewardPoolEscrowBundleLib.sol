// SPDX-License-Identifier: MIT
pragma solidity ^0.8.34;

import { ContentRegistry } from "../ContentRegistry.sol";
import { ProtocolConfig } from "../ProtocolConfig.sol";
import { RoundVotingEngine } from "../RoundVotingEngine.sol";
import { BundleReward, BundleQuestion, BundleRoundSetSnapshot } from "./QuestionRewardPoolEscrowTypes.sol";
import { QuestionRewardPoolEscrowClaimLib } from "./QuestionRewardPoolEscrowClaimLib.sol";
import { QuestionRewardPoolEscrowQualificationLib } from "./QuestionRewardPoolEscrowQualificationLib.sol";
import { QuestionRewardPoolEscrowVoterLib } from "./QuestionRewardPoolEscrowVoterLib.sol";
import { RoundLib } from "./RoundLib.sol";

library QuestionRewardPoolEscrowBundleLib {
    uint256 internal constant BPS_SCALE = 10_000;

    function isRoundSetClaimOpen(
        mapping(uint256 => mapping(uint256 => BundleRoundSetSnapshot)) storage bundleRoundSetSnapshots,
        BundleReward storage bundle,
        uint256 bundleId,
        uint256 roundSetIndex
    ) external view returns (bool) {
        if (bundle.refunded || roundSetIndex >= bundle.requiredSettledRounds) return false;
        BundleRoundSetSnapshot storage snapshot = bundleRoundSetSnapshots[bundleId][roundSetIndex];
        if (!snapshot.qualified) return false;
        if (snapshot.totalClaimWeight != 0) return snapshot.claimedWeight < snapshot.totalClaimWeight;
        return snapshot.claimedCount < snapshot.eligibleCompleters;
    }

    function requireCleanupComplete(
        mapping(uint256 => BundleQuestion[]) storage bundleQuestions,
        mapping(
            uint256
                => mapping(
                uint256 => mapping(uint256 => uint64)
            )
        ) storage bundleRoundIds,
        RoundVotingEngine votingEngine,
        uint256 bundleId,
        uint256 completedRoundSets
    ) external view {
        BundleQuestion[] storage questions = bundleQuestions[bundleId];
        for (uint256 roundSetIndex = 0; roundSetIndex < completedRoundSets;) {
            for (uint256 i = 0; i < questions.length;) {
                uint256 roundId = bundleRoundIds[bundleId][i][roundSetIndex];
                (,, uint256 cleanupRemaining,) = votingEngine.roundLifecycleState(questions[i].contentId, roundId);
                require(cleanupRemaining == 0, "Cleanup pending");
                unchecked {
                    ++i;
                }
            }
            unchecked {
                ++roundSetIndex;
            }
        }
    }

    function bundleRoundSetCommitStatus(
        mapping(uint256 => BundleQuestion[]) storage bundleQuestions,
        mapping(
            uint256
                => mapping(
                uint256 => mapping(uint256 => uint64)
            )
        ) storage bundleRoundIds,
        RoundVotingEngine votingEngine,
        ProtocolConfig protocolConfig,
        uint64 bountyOpensAt,
        uint64 bountyClosesAt,
        uint256 bundleId,
        uint256 roundSetIndex,
        address account,
        bool requireCleanupComplete_,
        bool trackFrontend
    ) external view returns (bool completed, address frontend, bytes32 firstCommitKey) {
        (completed, firstCommitKey) = _bundleRoundSetCompletion(
            bundleQuestions,
            bundleRoundIds,
            votingEngine,
            protocolConfig,
            bountyOpensAt,
            bountyClosesAt,
            bundleId,
            roundSetIndex,
            account,
            requireCleanupComplete_
        );
        if (!completed) return (false, address(0), bytes32(0));
        if (trackFrontend) {
            frontend = _bundleRoundSetFrontend(
                bundleQuestions,
                bundleRoundIds,
                votingEngine,
                protocolConfig,
                bountyOpensAt,
                bountyClosesAt,
                bundleId,
                roundSetIndex,
                account
            );
        }
        return (true, frontend, firstCommitKey);
    }

    function _bundleRoundSetCompletion(
        mapping(uint256 => BundleQuestion[]) storage bundleQuestions,
        mapping(
            uint256
                => mapping(
                uint256 => mapping(uint256 => uint64)
            )
        ) storage bundleRoundIds,
        RoundVotingEngine votingEngine,
        ProtocolConfig protocolConfig,
        uint64 bountyOpensAt,
        uint64 bountyClosesAt,
        uint256 bundleId,
        uint256 roundSetIndex,
        address account,
        bool requireCleanupComplete_
    ) private view returns (bool completed, bytes32 firstCommitKey) {
        BundleQuestion[] storage questions = bundleQuestions[bundleId];
        bytes32 firstCompleterKey;
        for (uint256 i = 0; i < questions.length;) {
            uint256 roundId = bundleRoundIds[bundleId][i][roundSetIndex];
            uint256 contentId = questions[i].contentId;
            (bytes32 commitKey, bytes32 completerKey) = _bundleQuestionCompletion(
                votingEngine, protocolConfig, bountyOpensAt, contentId, roundId, account, bountyClosesAt
            );
            if (commitKey == bytes32(0)) return (false, bytes32(0));
            if (requireCleanupComplete_) {
                (,, uint256 cleanupRemaining,) = votingEngine.roundLifecycleState(contentId, roundId);
                if (cleanupRemaining > 0) return (false, bytes32(0));
            }
            if (i == 0) {
                firstCompleterKey = completerKey;
                firstCommitKey = commitKey;
            } else if (completerKey != firstCompleterKey) {
                return (false, bytes32(0));
            }
            unchecked {
                ++i;
            }
        }
        return (true, firstCommitKey);
    }

    function _bundleQuestionCompletion(
        RoundVotingEngine votingEngine,
        ProtocolConfig protocolConfig,
        uint64 bountyOpensAt,
        uint256 contentId,
        uint256 roundId,
        address account,
        uint64 bountyClosesAt
    ) private view returns (bytes32 commitKey, bytes32 completerKey) {
        if (roundId == 0) return (bytes32(0), bytes32(0));
        (commitKey, completerKey) = _resolveBundleCompleter(votingEngine, protocolConfig, contentId, roundId, account);
        if (commitKey == bytes32(0)) return (bytes32(0), bytes32(0));
        (bool revealed,) = QuestionRewardPoolEscrowVoterLib.timelyRevealedCommitFrontend(
            votingEngine, contentId, roundId, commitKey, bountyOpensAt, bountyClosesAt
        );
        if (!revealed) return (bytes32(0), bytes32(0));
    }

    function _bundleRoundSetFrontend(
        mapping(uint256 => BundleQuestion[]) storage bundleQuestions,
        mapping(
            uint256
                => mapping(
                uint256 => mapping(uint256 => uint64)
            )
        ) storage bundleRoundIds,
        RoundVotingEngine votingEngine,
        ProtocolConfig protocolConfig,
        uint64 bountyOpensAt,
        uint64 bountyClosesAt,
        uint256 bundleId,
        uint256 roundSetIndex,
        address account
    ) private view returns (address frontend) {
        BundleQuestion[] storage questions = bundleQuestions[bundleId];
        address frontendRecipient;
        for (uint256 i = 0; i < questions.length;) {
            BundleQuestion storage question = questions[i];
            uint256 roundId = bundleRoundIds[bundleId][i][roundSetIndex];
            (bytes32 commitKey,) =
                _resolveBundleCompleter(votingEngine, protocolConfig, question.contentId, roundId, account);
            (bool revealed, address questionFrontend) = QuestionRewardPoolEscrowVoterLib.timelyRevealedCommitFrontend(
                votingEngine, question.contentId, roundId, commitKey, bountyOpensAt, bountyClosesAt
            );
            if (!revealed) return address(0);
            address questionFrontendRecipient;
            if (questionFrontend != address(0)) {
                questionFrontendRecipient = QuestionRewardPoolEscrowClaimLib.frontendRewardRecipient(
                    votingEngine, question.contentId, roundId, questionFrontend
                );
            }
            if (i == 0) {
                frontend = questionFrontend;
                frontendRecipient = questionFrontendRecipient;
            } else if (questionFrontend != frontend) {
                frontend = address(0);
            }
            (,,,,, bool questionFrontendEligible) =
                votingEngine.commitIdentityState(question.contentId, roundId, commitKey);
            if (questionFrontend != address(0) && !questionFrontendEligible) {
                frontend = address(0);
            }
            if (
                questionFrontend != address(0)
                    && (questionFrontendRecipient == address(0) || questionFrontendRecipient != frontendRecipient)
            ) {
                frontend = address(0);
            }
            unchecked {
                ++i;
            }
        }
    }

    function _resolveBundleCompleter(
        RoundVotingEngine votingEngine,
        ProtocolConfig protocolConfig,
        uint256 contentId,
        uint256 roundId,
        address account
    ) private view returns (bytes32 commitKey, bytes32 completerKey) {
        bytes32 identityKey;
        address rewardRecipient;
        (identityKey, commitKey, rewardRecipient) = QuestionRewardPoolEscrowVoterLib.resolveRoundRewardClaim(
            votingEngine, protocolConfig, contentId, roundId, account
        );
        if (commitKey != bytes32(0)) {
            completerKey = keccak256(abi.encodePacked(identityKey, rewardRecipient));
        }
    }

    function isRoundSetComplete(
        mapping(uint256 => BundleQuestion[]) storage bundleQuestions,
        mapping(uint256 => mapping(uint256 => uint32)) storage bundleQuestionRecordedRounds,
        uint256 bundleId,
        uint256 roundSetIndex
    ) external view returns (bool) {
        BundleQuestion[] storage questions = bundleQuestions[bundleId];
        for (uint256 i = 0; i < questions.length;) {
            if (bundleQuestionRecordedRounds[bundleId][i] <= roundSetIndex) return false;
            unchecked {
                ++i;
            }
        }
        return true;
    }

    function resetRoundSet(
        mapping(uint256 => BundleQuestion[]) storage bundleQuestions,
        mapping(uint256 => mapping(uint256 => uint32)) storage bundleQuestionRecordedRounds,
        mapping(uint256 => mapping(uint256 => mapping(uint256 => uint64))) storage bundleRoundIds,
        mapping(uint256 => mapping(uint256 => uint256)) storage bundleQuestionTerminalSyncCursor,
        uint256 bundleId,
        uint256 roundSetIndex
    ) external {
        BundleQuestion[] storage questions = bundleQuestions[bundleId];
        for (uint256 i = 0; i < questions.length;) {
            uint256 recordedRounds = bundleQuestionRecordedRounds[bundleId][i];
            uint256 failedRoundId = bundleRoundIds[bundleId][i][roundSetIndex];
            uint256 rewindTo = failedRoundId == 0
                ? (roundSetIndex == 0 ? 1 : uint256(bundleRoundIds[bundleId][i][roundSetIndex - 1]) + 1)
                : failedRoundId + 1;
            uint256 cursor = bundleQuestionTerminalSyncCursor[bundleId][i];
            if (cursor == 0 || cursor > rewindTo) {
                bundleQuestionTerminalSyncCursor[bundleId][i] = rewindTo;
            }
            for (uint256 j = roundSetIndex + 1; j < recordedRounds;) {
                delete bundleRoundIds[bundleId][i][j];
                unchecked {
                    ++j;
                }
            }
            bundleQuestionRecordedRounds[bundleId][i] = uint32(roundSetIndex);
            unchecked {
                ++i;
            }
        }
    }

    function previewRoundSetAllocation(BundleReward storage bundle) external view returns (uint256 allocation) {
        if (bundle.completedRoundSets >= bundle.requiredSettledRounds) return 0;
        uint256 remainingRoundSets = uint256(bundle.requiredSettledRounds) - bundle.completedRoundSets;
        allocation =
            remainingRoundSets == 1 ? bundle.unallocatedAmount : bundle.fundedAmount / bundle.requiredSettledRounds;
        if (allocation > bundle.unallocatedAmount) return 0;
    }

    function requireFundingCoversMaxCompleters(
        ContentRegistry registry,
        uint256[] calldata contentIds,
        uint256 amount,
        uint256 requiredSettledRounds
    ) external view {
        uint256 maxRoundVoters;
        for (uint256 i = 0; i < contentIds.length;) {
            RoundLib.RoundConfig memory cfg = registry.getContentRoundConfig(contentIds[i]);
            if (cfg.maxVoters > maxRoundVoters) {
                maxRoundVoters = cfg.maxVoters;
            }
            unchecked {
                ++i;
            }
        }
        require(amount >= maxRoundVoters * requiredSettledRounds * BPS_SCALE, "Amount too small");
    }

    function isBundleExcludedVoter(
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
    ) external view returns (bool) {
        BundleQuestion[] storage questions = bundleQuestions[bundleId];
        for (uint256 i = 0; i < questions.length;) {
            BundleQuestion storage question = questions[i];
            uint256 roundId = bundleRoundIds[bundleId][i][roundSetIndex];
            (bytes32 identityKey,, address rewardRecipient) = QuestionRewardPoolEscrowVoterLib.resolveRoundRewardClaim(
                votingEngine, protocolConfig, question.contentId, roundId, account
            );
            address claimant = rewardRecipient == address(0) ? account : rewardRecipient;
            if (claimant == bundle.funder || claimant == bundle.funderIdentity) {
                return true;
            }
            address submitterIdentity = registry.getSubmitterIdentity(question.contentId);
            if (QuestionRewardPoolEscrowQualificationLib.isExcludedRater(
                    identityKey,
                    claimant,
                    bundle.funder,
                    bundle.funderIdentity,
                    bundle.funderIdentityKey,
                    submitterIdentity,
                    question.submitterIdentityKey
                )) {
                return true;
            }
            unchecked {
                ++i;
            }
        }
        return false;
    }
}
