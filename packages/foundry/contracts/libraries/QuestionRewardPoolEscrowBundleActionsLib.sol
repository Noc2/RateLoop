// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeCast } from "@openzeppelin/contracts/utils/math/SafeCast.sol";

import { ContentRegistry } from "../ContentRegistry.sol";
import { ProtocolConfig } from "../ProtocolConfig.sol";
import { RoundVotingEngine } from "../RoundVotingEngine.sol";
import { IRaterIdentityRegistry } from "../interfaces/IRaterIdentityRegistry.sol";
import { QuestionRewardPoolEscrowBundleLib } from "./QuestionRewardPoolEscrowBundleLib.sol";
import { QuestionRewardPoolEscrowClaimLib, EqualShareInputs } from "./QuestionRewardPoolEscrowClaimLib.sol";
import { QuestionRewardPoolEscrowEligibilityLib } from "./QuestionRewardPoolEscrowEligibilityLib.sol";
import { QuestionRewardPoolEscrowQualificationLib } from "./QuestionRewardPoolEscrowQualificationLib.sol";
import { QuestionRewardPoolEscrowTransferLib } from "./QuestionRewardPoolEscrowTransferLib.sol";
import {
    BundleReward,
    BundleQuestion,
    BundleRoundSetSnapshot,
    CreateSubmissionBundleParams
} from "./QuestionRewardPoolEscrowTypes.sol";
import { QuestionRewardPoolEscrowVoterLib } from "./QuestionRewardPoolEscrowVoterLib.sol";
import { RoundLib } from "./RoundLib.sol";

library QuestionRewardPoolEscrowBundleActionsLib {
    using SafeCast for uint256;

    uint256 internal constant MIN_REQUIRED_VOTERS = 3;
    uint256 internal constant MAX_REQUIRED_SETTLED_ROUNDS = 16;
    uint256 internal constant MIN_REWARD_POOL_PARTICIPANTS = 3;
    uint256 internal constant HIGH_VALUE_REWARD_POOL_THRESHOLD = 1_000e6;
    uint256 internal constant MIN_HIGH_VALUE_PARTICIPANTS = 5;
    uint256 internal constant BPS_SCALE = 10_000;
    uint256 internal constant BUNDLE_CLAIM_GRACE = 7 days;
    uint256 internal constant BUNDLE_REFUND_GRACE = 98 days;
    uint8 internal constant REWARD_ASSET_LREP = 0;
    uint8 internal constant REWARD_ASSET_USDC = 1;

    event QuestionBundleRewardCreated(
        uint256 indexed bundleId,
        address indexed funder,
        bytes32 funderIdentityKey,
        uint256 amount,
        uint256 requiredCompleters,
        uint256 questionCount,
        uint256 requiredSettledRounds,
        uint256 bountyOpensAt,
        uint256 bountyClosesAt,
        uint256 feedbackClosesAt,
        uint256 frontendFeeBps,
        uint8 asset,
        uint8 bountyEligibility,
        bytes32 bountyEligibilityDataHash
    );
    event QuestionBundleEligibilitySet(uint256 indexed bundleId, uint8 indexed bountyEligibility);
    event QuestionBundleRoundRecorded(
        uint256 indexed bundleId,
        uint256 indexed contentId,
        uint256 indexed roundId,
        uint256 bundleIndex,
        uint256 roundSetIndex
    );
    event QuestionBundleRoundSetQualified(
        uint256 indexed bundleId, uint256 indexed roundSetIndex, uint256 allocation, uint256 frontendFeeAllocation
    );
    event QuestionBundleRewardClaimed(
        uint256 indexed bundleId,
        uint256 indexed roundSetIndex,
        address indexed claimant,
        bytes32 identityKey,
        uint256 amount,
        address frontend,
        address frontendRecipient,
        uint256 frontendFee,
        uint256 grossAmount
    );
    event QuestionBundleRewardRefunded(uint256 indexed bundleId, address indexed funder, uint256 amount);
    event QuestionBundleRewardForfeited(uint256 indexed bundleId, address indexed treasury, uint256 amount);

    function createSubmissionBundleFromRegistry(
        mapping(uint256 => BundleReward) storage bundleRewards,
        mapping(uint256 => BundleQuestion[]) storage bundleQuestions,
        mapping(uint256 => uint256) storage contentBundleId,
        mapping(uint256 => uint256) storage contentBundleIndex,
        ContentRegistry registry,
        ProtocolConfig protocolConfig,
        IERC20 lrepToken,
        IERC20 usdcToken,
        uint16 defaultFrontendFeeBps,
        CreateSubmissionBundleParams memory params
    ) external returns (uint256 rewardPoolId) {
        require(params.bundleId != 0, "Invalid bundle");
        require(bundleRewards[params.bundleId].id == 0, "Bundle exists");
        require(params.contentIds.length > 0, "No questions");
        require(params.funder != address(0), "Invalid funder");
        require(params.asset == REWARD_ASSET_LREP || params.asset == REWARD_ASSET_USDC, "Invalid asset");
        require(params.requiredCompleters >= MIN_REQUIRED_VOTERS, "Too few voters");
        require(params.requiredCompleters >= _requiredParticipantFloorForAmount(params.amount), "High-value floor");
        require(params.requiredSettledRounds >= 1, "Too few rounds");
        require(params.requiredSettledRounds <= MAX_REQUIRED_SETTLED_ROUNDS, "Too many rounds");
        require(params.amount >= params.requiredCompleters * params.requiredSettledRounds, "Amount too small");
        require(QuestionRewardPoolEscrowEligibilityLib.isValidPolicy(params.bountyEligibility), "Invalid eligibility");
        QuestionRewardPoolEscrowBundleLib.requireFundingCoversMaxCompleters(
            registry, params.contentIds, params.amount, params.requiredSettledRounds
        );
        require(params.bountyClosesAt > block.timestamp, "Bad close");
        uint256 normalizedFeedbackClosesAt = _normalizeFeedbackClosesAt(params.bountyClosesAt, params.feedbackClosesAt);

        uint256 fundedAmount = QuestionRewardPoolEscrowTransferLib.pullExactToken(
            _rewardToken(lrepToken, usdcToken, params.asset), params.funder, params.amount
        );
        (bytes32 funderIdentityKey, address funderIdentity) = _resolveFunderIdentity(protocolConfig, params.funder);

        _writeBundleRecord(
            bundleRewards[params.bundleId],
            params,
            fundedAmount,
            normalizedFeedbackClosesAt,
            defaultFrontendFeeBps,
            funderIdentityKey,
            funderIdentity
        );

        _registerBundleQuestions(bundleQuestions, contentBundleId, contentBundleIndex, registry, protocolConfig, params);

        emit QuestionBundleRewardCreated(
            params.bundleId,
            params.funder,
            funderIdentityKey,
            fundedAmount,
            params.requiredCompleters,
            params.contentIds.length,
            params.requiredSettledRounds,
            block.timestamp,
            params.bountyClosesAt,
            normalizedFeedbackClosesAt,
            defaultFrontendFeeBps,
            params.asset,
            params.bountyEligibility,
            bundleRewards[params.bundleId].bountyEligibilityDataHash
        );
        emit QuestionBundleEligibilitySet(params.bundleId, params.bountyEligibility);
        rewardPoolId = params.bundleId;
    }

    function _writeBundleRecord(
        BundleReward storage bundle,
        CreateSubmissionBundleParams memory params,
        uint256 fundedAmount,
        uint256 normalizedFeedbackClosesAt,
        uint16 defaultFrontendFeeBps,
        bytes32 funderIdentityKey,
        address funderIdentity
    ) private {
        bundle.id = params.bundleId.toUint64();
        bundle.bountyClosesAt = params.bountyClosesAt.toUint64();
        bundle.feedbackClosesAt = normalizedFeedbackClosesAt.toUint64();
        bundle.funder = params.funder;
        bundle.funderIdentity = funderIdentity;
        bundle.asset = params.asset;
        bundle.questionCount = uint32(params.contentIds.length);
        bundle.requiredCompleters = uint32(params.requiredCompleters);
        bundle.requiredSettledRounds = uint32(params.requiredSettledRounds);
        bundle.frontendFeeBps = defaultFrontendFeeBps;
        bundle.bountyEligibility = params.bountyEligibility;
        bundle.funderIdentityKey = funderIdentityKey;
        bundle.fundedAmount = fundedAmount;
        bundle.unallocatedAmount = fundedAmount;
        bundle.bountyEligibilityDataHash = QuestionRewardPoolEscrowEligibilityLib.eligibilityDataHash();
        bundle.nonRefundable = true;
    }

    function _registerBundleQuestions(
        mapping(uint256 => BundleQuestion[]) storage bundleQuestions,
        mapping(uint256 => uint256) storage contentBundleId,
        mapping(uint256 => uint256) storage contentBundleIndex,
        ContentRegistry registry,
        ProtocolConfig protocolConfig,
        CreateSubmissionBundleParams memory params
    ) private {
        uint256[] memory contentIds = params.contentIds;
        uint256 bundleId = params.bundleId;
        for (uint256 i = 0; i < contentIds.length;) {
            uint256 contentId = contentIds[i];
            require(registry.isContentActive(contentId), "Content not active");
            require(contentBundleId[contentId] == 0, "Bundled");
            contentBundleId[contentId] = bundleId;
            contentBundleIndex[contentId] = i;
            bytes32 submitterIdentityKey = registry.contentSubmitterIdentityKey(contentId);
            if (submitterIdentityKey == bytes32(0)) {
                submitterIdentityKey = QuestionRewardPoolEscrowVoterLib.identityKeyForCurrentRater(
                    protocolConfig, registry.getSubmitterIdentity(contentId)
                );
            }
            bundleQuestions[bundleId].push(
                BundleQuestion({ contentId: contentId, submitterIdentityKey: submitterIdentityKey })
            );
            unchecked {
                ++i;
            }
        }
    }

    function recordBundleQuestionTerminal(
        mapping(uint256 => BundleReward) storage bundleRewards,
        mapping(uint256 => mapping(uint256 => uint32)) storage bundleQuestionRecordedRounds,
        mapping(uint256 => mapping(uint256 => mapping(uint256 => uint64))) storage bundleRoundIds,
        mapping(uint256 => uint256) storage contentBundleId,
        mapping(uint256 => uint256) storage contentBundleIndex,
        uint256 contentId,
        uint256 roundId,
        bool settled
    ) external {
        _recordBundleQuestionTerminal(
            bundleRewards,
            bundleQuestionRecordedRounds,
            bundleRoundIds,
            contentBundleId,
            contentBundleIndex,
            contentId,
            roundId,
            settled
        );
    }

    function syncBundleQuestionTerminal(
        mapping(uint256 => BundleReward) storage bundleRewards,
        mapping(uint256 => BundleQuestion[]) storage bundleQuestions,
        mapping(uint256 => mapping(uint256 => uint32)) storage bundleQuestionRecordedRounds,
        mapping(uint256 => mapping(uint256 => mapping(uint256 => uint64))) storage bundleRoundIds,
        mapping(uint256 => mapping(uint256 => BundleRoundSetSnapshot)) storage bundleRoundSetSnapshots,
        mapping(uint256 => uint256) storage contentBundleId,
        mapping(uint256 => uint256) storage contentBundleIndex,
        ContentRegistry registry,
        RoundVotingEngine votingEngine,
        ProtocolConfig protocolConfig,
        uint256 contentId,
        uint256 roundId
    ) external {
        (, RoundLib.RoundState state,,,,,,,,, uint48 settledAt,,,) = votingEngine.rounds(contentId, roundId);
        require(settledAt != 0, "Round not terminal");
        _recordBundleQuestionTerminal(
            bundleRewards,
            bundleQuestionRecordedRounds,
            bundleRoundIds,
            contentBundleId,
            contentBundleIndex,
            contentId,
            roundId,
            state == RoundLib.RoundState.Settled
        );
        uint256 bundleId = contentBundleId[contentId];
        if (bundleId == 0) return;
        BundleReward storage bundle = bundleRewards[bundleId];
        if (bundle.refunded) return;
        _qualifyPendingBundleRoundSet(
            bundleRewards,
            bundleQuestions,
            bundleQuestionRecordedRounds,
            bundleRoundIds,
            bundleRoundSetSnapshots,
            registry,
            votingEngine,
            protocolConfig,
            bundleId,
            bundle
        );
    }

    function claimQuestionBundleReward(
        mapping(uint256 => BundleReward) storage bundleRewards,
        mapping(uint256 => BundleQuestion[]) storage bundleQuestions,
        mapping(uint256 => mapping(uint256 => uint32)) storage bundleQuestionRecordedRounds,
        mapping(uint256 => mapping(uint256 => mapping(uint256 => uint64))) storage bundleRoundIds,
        mapping(uint256 => mapping(uint256 => BundleRoundSetSnapshot)) storage bundleRoundSetSnapshots,
        mapping(uint256 => mapping(uint256 => mapping(bytes32 => bool))) storage bundleRoundSetRewardClaimed,
        ContentRegistry registry,
        RoundVotingEngine votingEngine,
        ProtocolConfig protocolConfig,
        IERC20 lrepToken,
        IERC20 usdcToken,
        uint256 bundleId,
        uint256 roundSetIndex
    ) external returns (uint256 rewardAmount) {
        BundleReward storage bundle = _getExistingBundleReward(bundleRewards, bundleId);
        _qualifyPendingBundleRoundSet(
            bundleRewards,
            bundleQuestions,
            bundleQuestionRecordedRounds,
            bundleRoundIds,
            bundleRoundSetSnapshots,
            registry,
            votingEngine,
            protocolConfig,
            bundleId,
            bundle
        );
        require(
            _isBundleRoundSetClaimOpen(bundleRoundSetSnapshots, bundle, bundleId, roundSetIndex), "Bundle not claimable"
        );

        require(
            !_isBundleExcludedVoter(
                bundleQuestions,
                bundleRoundIds,
                registry,
                votingEngine,
                protocolConfig,
                bundle,
                bundleId,
                roundSetIndex,
                msg.sender
            ),
            "Excluded voter"
        );
        require(
            _isBundleBountyEligible(
                bundleQuestions,
                bundleRoundIds,
                votingEngine,
                protocolConfig,
                bundle,
                bundleId,
                roundSetIndex,
                msg.sender
            ),
            "Not bounty eligible"
        );

        (address frontend, bytes32 firstCommitKey) = _requireCompletedBundleRoundSet(
            bundleQuestions,
            bundleRoundIds,
            votingEngine,
            protocolConfig,
            bundle.bountyClosesAt,
            bundleId,
            roundSetIndex,
            msg.sender
        );
        BundleQuestion storage firstQuestion = bundleQuestions[bundleId][0];
        uint256 firstRoundId = bundleRoundIds[bundleId][0][roundSetIndex];
        (bytes32 identityKey, bytes32 resolvedFirstCommitKey, address rewardRecipient) = QuestionRewardPoolEscrowVoterLib.resolveRoundRewardClaim(
            votingEngine, protocolConfig, firstQuestion.contentId, firstRoundId, msg.sender
        );
        require(resolvedFirstCommitKey == firstCommitKey, "Bundle incomplete");
        require(!bundleRoundSetRewardClaimed[bundleId][roundSetIndex][firstCommitKey], "Already claimed");
        BundleRoundSetSnapshot storage snapshot = bundleRoundSetSnapshots[bundleId][roundSetIndex];
        uint256 grossAmount;
        uint256 reservedFrontendFee;
        address frontendRecipient;
        (grossAmount, rewardAmount, reservedFrontendFee, frontendRecipient) =
            QuestionRewardPoolEscrowClaimLib.computeEqualShareClaimSplit(
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
        require(grossAmount > 0, "No reward");

        bundleRoundSetRewardClaimed[bundleId][roundSetIndex][firstCommitKey] = true;
        unchecked {
            snapshot.claimedCount++;
            bundle.claimedCount++;
        }
        bundle.claimedAmount += grossAmount;

        // M-Funds-1: bundle path uses equal-share, so the bucket isn't accumulated across
        // claimants — but we still consume the 4th return so the tuple matches and any future
        // weighted-bundle path inherits the corrected accounting trivially.
        uint256 bundleRedirectedFrontendFee;
        (rewardAmount, reservedFrontendFee, frontendRecipient, bundleRedirectedFrontendFee) =
            QuestionRewardPoolEscrowTransferLib.settleClaimPayout(
                _rewardToken(lrepToken, usdcToken, bundle.asset),
                rewardRecipient,
                rewardAmount,
                frontendRecipient,
                reservedFrontendFee
            );
        bundleRedirectedFrontendFee; // silence unused-local warnings; see comment above

        emit QuestionBundleRewardClaimed(
            bundleId,
            roundSetIndex,
            rewardRecipient,
            identityKey,
            rewardAmount,
            frontend,
            frontendRecipient,
            reservedFrontendFee,
            grossAmount
        );
    }

    function claimableQuestionBundleReward(
        mapping(uint256 => BundleReward) storage bundleRewards,
        mapping(uint256 => BundleQuestion[]) storage bundleQuestions,
        mapping(uint256 => mapping(uint256 => mapping(uint256 => uint64))) storage bundleRoundIds,
        mapping(uint256 => mapping(uint256 => BundleRoundSetSnapshot)) storage bundleRoundSetSnapshots,
        mapping(uint256 => mapping(uint256 => mapping(bytes32 => bool))) storage bundleRoundSetRewardClaimed,
        ContentRegistry registry,
        RoundVotingEngine votingEngine,
        ProtocolConfig protocolConfig,
        uint256 bundleId,
        uint256 roundSetIndex,
        address account
    ) external view returns (uint256 claimableAmount) {
        BundleReward storage bundle = bundleRewards[bundleId];
        if (bundle.id == 0 || !_isBundleRoundSetClaimOpen(bundleRoundSetSnapshots, bundle, bundleId, roundSetIndex)) {
            return 0;
        }
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
        if (!_isBundleBountyEligible(
                bundleQuestions, bundleRoundIds, votingEngine, protocolConfig, bundle, bundleId, roundSetIndex, account
            )) return 0;

        (bool completed, address frontend, bytes32 firstCommitKey) = _bundleRoundSetCommitStatus(
            bundleQuestions,
            bundleRoundIds,
            votingEngine,
            protocolConfig,
            bundle.bountyClosesAt,
            bundleId,
            roundSetIndex,
            account,
            true,
            true
        );
        if (!completed) return 0;
        if (bundleRoundSetRewardClaimed[bundleId][roundSetIndex][firstCommitKey]) return 0;

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

    function refundQuestionBundleReward(
        mapping(uint256 => BundleReward) storage bundleRewards,
        mapping(uint256 => BundleQuestion[]) storage bundleQuestions,
        mapping(uint256 => mapping(uint256 => uint32)) storage bundleQuestionRecordedRounds,
        mapping(uint256 => mapping(uint256 => mapping(uint256 => uint64))) storage bundleRoundIds,
        mapping(uint256 => mapping(uint256 => BundleRoundSetSnapshot)) storage bundleRoundSetSnapshots,
        ContentRegistry registry,
        RoundVotingEngine votingEngine,
        ProtocolConfig protocolConfig,
        IERC20 lrepToken,
        IERC20 usdcToken,
        uint256 bundleId
    ) external returns (uint256 refundAmount) {
        BundleReward storage bundle = _getExistingBundleReward(bundleRewards, bundleId);
        require(!bundle.refunded, "Already refunded");
        require(block.timestamp > bundle.bountyClosesAt, "Bundle active");
        require(block.timestamp > uint256(bundle.bountyClosesAt) + BUNDLE_REFUND_GRACE, "Grace");
        _qualifyPendingBundleRoundSet(
            bundleRewards,
            bundleQuestions,
            bundleQuestionRecordedRounds,
            bundleRoundIds,
            bundleRoundSetSnapshots,
            registry,
            votingEngine,
            protocolConfig,
            bundleId,
            bundle
        );
        if (bundle.completedRoundSets != 0) {
            QuestionRewardPoolEscrowBundleLib.requireCleanupComplete(
                bundleQuestions, bundleRoundIds, votingEngine, bundleId, bundle.completedRoundSets
            );
            if (bundle.bountyOpensAt == 0) {
                bundle.bountyOpensAt = uint64(block.timestamp + BUNDLE_CLAIM_GRACE);
                return 0;
            }
            require(block.timestamp > bundle.bountyOpensAt, "Grace");
        }
        refundAmount = bundle.fundedAmount - bundle.claimedAmount;
        require(refundAmount > 0, "No refund");

        bundle.refunded = true;
        if (bundle.nonRefundable) {
            address treasury = votingEngine.protocolConfig().treasury();
            QuestionRewardPoolEscrowTransferLib.transferResidue(
                _rewardToken(lrepToken, usdcToken, bundle.asset), true, bundle.funder, treasury, refundAmount
            );
            emit QuestionBundleRewardForfeited(bundleId, treasury, refundAmount);
        } else {
            QuestionRewardPoolEscrowTransferLib.transferResidue(
                _rewardToken(lrepToken, usdcToken, bundle.asset), false, bundle.funder, address(0), refundAmount
            );
            emit QuestionBundleRewardRefunded(bundleId, bundle.funder, refundAmount);
        }
    }

    function _recordBundleQuestionTerminal(
        mapping(uint256 => BundleReward) storage bundleRewards,
        mapping(uint256 => mapping(uint256 => uint32)) storage bundleQuestionRecordedRounds,
        mapping(uint256 => mapping(uint256 => mapping(uint256 => uint64))) storage bundleRoundIds,
        mapping(uint256 => uint256) storage contentBundleId,
        mapping(uint256 => uint256) storage contentBundleIndex,
        uint256 contentId,
        uint256 roundId,
        bool settled
    ) private {
        uint256 bundleId = contentBundleId[contentId];
        if (bundleId == 0) return;

        BundleReward storage bundle = _getExistingBundleReward(bundleRewards, bundleId);
        if (bundle.refunded) return;

        uint256 bundleIndex = contentBundleIndex[contentId];
        uint256 roundSetIndex = bundleQuestionRecordedRounds[bundleId][bundleIndex];
        if (roundSetIndex >= bundle.requiredSettledRounds) return;
        if (roundSetIndex < bundle.completedRoundSets) return;
        if (roundId <= bundleRoundIds[bundleId][bundleIndex][roundSetIndex]) return;
        if (roundSetIndex != 0) {
            unchecked {
                if (roundId <= bundleRoundIds[bundleId][bundleIndex][roundSetIndex - 1]) return;
            }
        }

        if (!settled) return;

        bundleRoundIds[bundleId][bundleIndex][roundSetIndex] = uint64(roundId);
        bundleQuestionRecordedRounds[bundleId][bundleIndex] = uint32(roundSetIndex + 1);
        emit QuestionBundleRoundRecorded(bundleId, contentId, roundId, bundleIndex, roundSetIndex);
    }

    function _qualifyPendingBundleRoundSet(
        mapping(uint256 => BundleReward) storage bundleRewards,
        mapping(uint256 => BundleQuestion[]) storage bundleQuestions,
        mapping(uint256 => mapping(uint256 => uint32)) storage bundleQuestionRecordedRounds,
        mapping(uint256 => mapping(uint256 => mapping(uint256 => uint64))) storage bundleRoundIds,
        mapping(uint256 => mapping(uint256 => BundleRoundSetSnapshot)) storage bundleRoundSetSnapshots,
        ContentRegistry registry,
        RoundVotingEngine votingEngine,
        ProtocolConfig protocolConfig,
        uint256 bundleId,
        BundleReward storage bundle
    ) private {
        uint256 roundSetIndex = bundle.completedRoundSets;
        if (roundSetIndex >= bundle.requiredSettledRounds) return;
        if (bundleRoundSetSnapshots[bundleId][roundSetIndex].qualified) return;
        if (!_isBundleRoundSetComplete(bundleQuestions, bundleQuestionRecordedRounds, bundleId, roundSetIndex)) return;
        _qualifyBundleRoundSet(
            bundleRewards,
            bundleQuestions,
            bundleQuestionRecordedRounds,
            bundleRoundIds,
            bundleRoundSetSnapshots,
            registry,
            votingEngine,
            protocolConfig,
            bundleId,
            bundle,
            roundSetIndex
        );
    }

    function _qualifyBundleRoundSet(
        mapping(uint256 => BundleReward) storage,
        mapping(uint256 => BundleQuestion[]) storage bundleQuestions,
        mapping(uint256 => mapping(uint256 => uint32)) storage bundleQuestionRecordedRounds,
        mapping(uint256 => mapping(uint256 => mapping(uint256 => uint64))) storage bundleRoundIds,
        mapping(uint256 => mapping(uint256 => BundleRoundSetSnapshot)) storage bundleRoundSetSnapshots,
        ContentRegistry registry,
        RoundVotingEngine votingEngine,
        ProtocolConfig protocolConfig,
        uint256 bundleId,
        BundleReward storage bundle,
        uint256 roundSetIndex
    ) private {
        if (bundleRoundSetSnapshots[bundleId][roundSetIndex].qualified) return;

        uint256 completerCount = _bundleRoundSetCompleterCount(
            bundleQuestions, bundleRoundIds, registry, votingEngine, protocolConfig, bundle, bundleId, roundSetIndex
        );
        if (completerCount < bundle.requiredCompleters) {
            QuestionRewardPoolEscrowBundleLib.resetRoundSet(
                bundleQuestions, bundleQuestionRecordedRounds, bundleRoundIds, bundleId, roundSetIndex
            );
            return;
        }

        uint256 allocation = _previewBundleRoundSetAllocation(bundle);
        if (allocation == 0 || allocation < completerCount) {
            QuestionRewardPoolEscrowBundleLib.resetRoundSet(
                bundleQuestions, bundleQuestionRecordedRounds, bundleRoundIds, bundleId, roundSetIndex
            );
            return;
        }
        uint256 frontendFeeAllocation = (allocation * bundle.frontendFeeBps) / BPS_SCALE;

        unchecked {
            bundle.completedRoundSets++;
        }
        if (bundle.bountyOpensAt != 0) bundle.bountyOpensAt = 0;
        bundle.unallocatedAmount -= allocation;

        bundleRoundSetSnapshots[bundleId][roundSetIndex] = BundleRoundSetSnapshot({
            qualified: true,
            claimedCount: 0,
            eligibleCompleters: uint32(completerCount),
            allocation: allocation,
            frontendFeeAllocation: frontendFeeAllocation
        });
        emit QuestionBundleRoundSetQualified(bundleId, roundSetIndex, allocation, frontendFeeAllocation);
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
        (,, uint16 commitCount,,,,,,,,,,,) = votingEngine.rounds(firstContentId, firstRoundId);
        for (uint256 i = 0; i < commitCount;) {
            bytes32 commitKey = votingEngine.getRoundCommitKey(firstContentId, firstRoundId, i);
            address voter = QuestionRewardPoolEscrowVoterLib.bundleCompleterAccount(
                votingEngine, firstContentId, firstRoundId, commitKey
            );
            if (
                voter != address(0)
                    && !_isBundleExcludedVoter(
                        bundleQuestions,
                        bundleRoundIds,
                        registry,
                        votingEngine,
                        protocolConfig,
                        bundle,
                        bundleId,
                        roundSetIndex,
                        voter
                    )
                    && _isBundleBountyEligible(
                        bundleQuestions,
                        bundleRoundIds,
                        votingEngine,
                        protocolConfig,
                        bundle,
                        bundleId,
                        roundSetIndex,
                        voter
                    )
                    && _completedBundleRoundSetCommitIgnoringCleanup(
                        bundleQuestions,
                        bundleRoundIds,
                        votingEngine,
                        protocolConfig,
                        bundle.bountyClosesAt,
                        bundleId,
                        roundSetIndex,
                        voter
                    )
            ) {
                unchecked {
                    completerCount++;
                }
            }
            unchecked {
                ++i;
            }
        }
    }

    function _requireCompletedBundleRoundSet(
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
        address account
    ) private view returns (address frontend, bytes32 firstCommitKey) {
        (bool completed, address completedFrontend, bytes32 completedFirstCommitKey) = _bundleRoundSetCommitStatus(
            bundleQuestions,
            bundleRoundIds,
            votingEngine,
            protocolConfig,
            bountyClosesAt,
            bundleId,
            roundSetIndex,
            account,
            true,
            true
        );
        require(completed, "Bundle incomplete");
        return (completedFrontend, completedFirstCommitKey);
    }

    function _completedBundleRoundSetCommitIgnoringCleanup(
        mapping(uint256 => BundleQuestion[]) storage bundleQuestions,
        mapping(
            uint256 => mapping(uint256 => mapping(uint256 => uint64))
        ) storage bundleRoundIds,
        RoundVotingEngine votingEngine,
        ProtocolConfig protocolConfig,
        uint64 bountyClosesAt,
        uint256 bundleId,
        uint256 roundSetIndex,
        address account
    ) private view returns (bool completed) {
        (completed,,) = _bundleRoundSetCommitStatus(
            bundleQuestions,
            bundleRoundIds,
            votingEngine,
            protocolConfig,
            bountyClosesAt,
            bundleId,
            roundSetIndex,
            account,
            false,
            false
        );
    }

    function _bundleRoundSetCommitStatus(
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
        bool requireCleanupComplete,
        bool trackFrontend
    ) private view returns (bool completed, address frontend, bytes32 firstCommitKey) {
        return QuestionRewardPoolEscrowBundleLib.bundleRoundSetCommitStatus(
            bundleQuestions,
            bundleRoundIds,
            votingEngine,
            protocolConfig,
            bountyClosesAt,
            bundleId,
            roundSetIndex,
            account,
            requireCleanupComplete,
            trackFrontend
        );
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

    function _isBundleBountyEligible(
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
    ) private view returns (bool) {
        address eligibilityAccount = _bundleBountyEligibilityAccount(
            bundleQuestions, bundleRoundIds, votingEngine, protocolConfig, bundleId, roundSetIndex, account
        );
        return QuestionRewardPoolEscrowEligibilityLib.isAccountEligibleForBounty(
            votingEngine.protocolConfig(), bundle.bountyEligibility, eligibilityAccount
        );
    }

    function _bundleBountyEligibilityAccount(
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
    ) private view returns (address) {
        if (bundleQuestions[bundleId].length == 0) return account;
        BundleQuestion storage firstQuestion = bundleQuestions[bundleId][0];
        uint256 firstRoundId = bundleRoundIds[bundleId][0][roundSetIndex];
        if (firstRoundId == 0) return account;
        (, bytes32 commitKey, address rewardRecipient) = QuestionRewardPoolEscrowVoterLib.resolveRoundRewardClaim(
            votingEngine, protocolConfig, firstQuestion.contentId, firstRoundId, account
        );
        if (commitKey == bytes32(0)) return account;
        return rewardRecipient == address(0) ? account : rewardRecipient;
    }

    function _isBundleRoundSetComplete(
        mapping(uint256 => BundleQuestion[]) storage bundleQuestions,
        mapping(uint256 => mapping(uint256 => uint32)) storage bundleQuestionRecordedRounds,
        uint256 bundleId,
        uint256 roundSetIndex
    ) private view returns (bool) {
        return QuestionRewardPoolEscrowBundleLib.isRoundSetComplete(
            bundleQuestions, bundleQuestionRecordedRounds, bundleId, roundSetIndex
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

    function _previewBundleRoundSetAllocation(BundleReward storage bundle) private view returns (uint256 allocation) {
        return QuestionRewardPoolEscrowBundleLib.previewRoundSetAllocation(bundle);
    }

    function _getExistingBundleReward(mapping(uint256 => BundleReward) storage bundleRewards, uint256 bundleId)
        private
        view
        returns (BundleReward storage bundle)
    {
        bundle = bundleRewards[bundleId];
        require(bundle.id != 0, "Bundle not found");
    }

    function _resolveFunderIdentity(ProtocolConfig protocolConfig, address funder)
        private
        view
        returns (bytes32 funderIdentityKey, address funderIdentity)
    {
        IRaterIdentityRegistry.ResolvedRater memory resolved =
            QuestionRewardPoolEscrowVoterLib.resolveCurrentRater(protocolConfig, funder);
        funderIdentityKey = resolved.identityKey;
        funderIdentity = resolved.holder;
        if (funderIdentity == address(0)) {
            funderIdentity = funder;
        }
    }

    function _rewardToken(IERC20 lrepToken, IERC20 usdcToken, uint8 asset) private pure returns (IERC20 token) {
        return asset == REWARD_ASSET_LREP ? lrepToken : usdcToken;
    }

    function _requiredParticipantFloorForAmount(uint256 amount) private pure returns (uint256) {
        return amount >= HIGH_VALUE_REWARD_POOL_THRESHOLD ? MIN_HIGH_VALUE_PARTICIPANTS : MIN_REWARD_POOL_PARTICIPANTS;
    }

    function _normalizeFeedbackClosesAt(uint256 bountyClosesAt, uint256 feedbackClosesAt)
        private
        view
        returns (uint256)
    {
        if (feedbackClosesAt == 0) {
            return bountyClosesAt;
        }
        require(feedbackClosesAt > block.timestamp, "Bad feedback close");
        if (bountyClosesAt != 0) {
            require(feedbackClosesAt <= bountyClosesAt, "Late feedback");
        }
        return feedbackClosesAt;
    }
}
