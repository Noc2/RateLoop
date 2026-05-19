// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { ContentRegistry } from "../ContentRegistry.sol";
import { ProtocolConfig } from "../ProtocolConfig.sol";
import { RoundVotingEngine } from "../RoundVotingEngine.sol";
import { BundleReward, BundleQuestion, BundleRoundSetSnapshot } from "./QuestionRewardPoolEscrowTypes.sol";
import { QuestionRewardPoolEscrowClaimLib } from "./QuestionRewardPoolEscrowClaimLib.sol";
import { QuestionRewardPoolEscrowQualificationLib } from "./QuestionRewardPoolEscrowQualificationLib.sol";
import { QuestionRewardPoolEscrowVoterLib } from "./QuestionRewardPoolEscrowVoterLib.sol";
import { RoundLib } from "./RoundLib.sol";

library QuestionRewardPoolEscrowBundleLib {
    function isRoundSetClaimOpen(
        mapping(uint256 => mapping(uint256 => BundleRoundSetSnapshot)) storage bundleRoundSetSnapshots,
        BundleReward storage bundle,
        uint256 bundleId,
        uint256 roundSetIndex
    ) external view returns (bool) {
        if (bundle.refunded || roundSetIndex >= bundle.requiredSettledRounds) return false;
        BundleRoundSetSnapshot storage snapshot = bundleRoundSetSnapshots[bundleId][roundSetIndex];
        return snapshot.qualified && snapshot.claimedCount < snapshot.eligibleCompleters;
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
                require(
                    votingEngine.roundUnrevealedCleanupRemaining(questions[i].contentId, roundId) == 0,
                    "Cleanup pending"
                );
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
        uint64 bountyClosesAt,
        uint256 bundleId,
        uint256 roundSetIndex,
        address account,
        bool requireCleanupComplete_,
        bool trackFrontend
    ) external view returns (bool completed, address frontend, bytes32 firstCommitKey) {
        BundleQuestion[] storage questions = bundleQuestions[bundleId];
        address frontendRecipient;
        for (uint256 i = 0; i < questions.length;) {
            BundleQuestion storage question = questions[i];
            uint256 roundId = bundleRoundIds[bundleId][i][roundSetIndex];
            if (roundId == 0) return (false, address(0), bytes32(0));
            if (
                requireCleanupComplete_ && votingEngine.roundUnrevealedCleanupRemaining(question.contentId, roundId) > 0
            ) {
                return (false, address(0), bytes32(0));
            }
            (, bytes32 commitKey,) = QuestionRewardPoolEscrowVoterLib.resolveRoundRewardClaim(
                votingEngine, protocolConfig, question.contentId, roundId, account
            );
            if (commitKey == bytes32(0)) return (false, address(0), bytes32(0));
            (bool revealed, address questionFrontend) = QuestionRewardPoolEscrowVoterLib.timelyRevealedCommitFrontend(
                votingEngine, question.contentId, roundId, commitKey, bountyClosesAt
            );
            if (!revealed) return (false, address(0), bytes32(0));
            if (trackFrontend) {
                address questionFrontendRecipient;
                if (questionFrontend != address(0)) {
                    questionFrontendRecipient = QuestionRewardPoolEscrowClaimLib.frontendRewardRecipient(
                        votingEngine, question.contentId, roundId, questionFrontend
                    );
                }
                if (i == 0) {
                    frontend = questionFrontend;
                    firstCommitKey = commitKey;
                    frontendRecipient = questionFrontendRecipient;
                } else if (questionFrontend != frontend) {
                    frontend = address(0);
                }
                if (
                    questionFrontend != address(0)
                        && !votingEngine.frontendEligibleAtCommit(question.contentId, roundId, commitKey)
                ) {
                    frontend = address(0);
                }
                if (
                    questionFrontend != address(0)
                        && (questionFrontendRecipient == address(0) || questionFrontendRecipient != frontendRecipient)
                ) {
                    frontend = address(0);
                }
            }
            unchecked {
                ++i;
            }
        }
        return (true, frontend, firstCommitKey);
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
        uint256 bundleId,
        uint256 roundSetIndex
    ) external {
        BundleQuestion[] storage questions = bundleQuestions[bundleId];
        for (uint256 i = 0; i < questions.length;) {
            uint256 recordedRounds = bundleQuestionRecordedRounds[bundleId][i];
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
        require(amount >= maxRoundVoters * requiredSettledRounds, "Amount too small");
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
