// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeCast } from "@openzeppelin/contracts/utils/math/SafeCast.sol";

import { ContentRegistry } from "../ContentRegistry.sol";
import { RoundVotingEngine } from "../RoundVotingEngine.sol";
import { IVoterIdNFT } from "../interfaces/IVoterIdNFT.sol";
import { QuestionRewardPoolEscrowBundleLib } from "./QuestionRewardPoolEscrowBundleLib.sol";
import { QuestionRewardPoolEscrowClaimLib } from "./QuestionRewardPoolEscrowClaimLib.sol";
import { QuestionRewardPoolEscrowEligibilityLib } from "./QuestionRewardPoolEscrowEligibilityLib.sol";
import { QuestionRewardPoolEscrowQualificationLib } from "./QuestionRewardPoolEscrowQualificationLib.sol";
import { QuestionRewardPoolEscrowTransferLib } from "./QuestionRewardPoolEscrowTransferLib.sol";
import { BundleReward, BundleQuestion, BundleRoundSetSnapshot } from "./QuestionRewardPoolEscrowTypes.sol";
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
    uint8 internal constant REWARD_ASSET_HREP = 0;
    uint8 internal constant REWARD_ASSET_USDC = 1;

    event QuestionBundleRewardCreated(
        uint256 indexed bundleId,
        address indexed funder,
        uint256 funderVoterId,
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
        uint256 voterId,
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
        IVoterIdNFT voterIdNFT,
        IERC20 hrepToken,
        IERC20 usdcToken,
        uint16 defaultFrontendFeeBps,
        uint256 bundleId,
        uint256[] calldata contentIds,
        address funder,
        uint8 asset,
        uint256 amount,
        uint256 requiredCompleters,
        uint256 requiredSettledRounds,
        uint256 bountyClosesAt,
        uint256 feedbackClosesAt,
        uint8 bountyEligibility
    ) external returns (uint256 rewardPoolId) {
        require(bundleId != 0, "Invalid bundle");
        require(bundleRewards[bundleId].id == 0, "Bundle exists");
        require(contentIds.length > 0, "No questions");
        require(funder != address(0), "Invalid funder");
        require(asset == REWARD_ASSET_HREP || asset == REWARD_ASSET_USDC, "Invalid asset");
        require(requiredCompleters >= MIN_REQUIRED_VOTERS, "Too few voters");
        require(requiredCompleters >= _requiredParticipantFloorForAmount(amount), "High-value floor");
        require(requiredSettledRounds >= 1, "Too few rounds");
        require(requiredSettledRounds <= MAX_REQUIRED_SETTLED_ROUNDS, "Too many rounds");
        require(amount >= requiredCompleters * requiredSettledRounds, "Amount too small");
        require(QuestionRewardPoolEscrowEligibilityLib.isValidPolicy(bountyEligibility), "Invalid eligibility");
        QuestionRewardPoolEscrowBundleLib.requireFundingCoversMaxCompleters(
            registry, contentIds, amount, requiredSettledRounds
        );
        require(bountyClosesAt > block.timestamp, "Bad close");
        uint256 normalizedFeedbackClosesAt = _normalizeFeedbackClosesAt(bountyClosesAt, feedbackClosesAt);

        uint256 fundedAmount = QuestionRewardPoolEscrowTransferLib.pullExactToken(
            _rewardToken(hrepToken, usdcToken, asset), funder, amount
        );
        (uint256 funderVoterId, address funderIdentity, uint256 funderNullifier) =
            _resolveFunderIdentity(voterIdNFT, funder);

        BundleReward storage bundle = bundleRewards[bundleId];
        bundle.id = bundleId.toUint64();
        bundle.bountyClosesAt = bountyClosesAt.toUint64();
        bundle.feedbackClosesAt = normalizedFeedbackClosesAt.toUint64();
        bundle.funder = funder;
        bundle.funderIdentity = funderIdentity;
        bundle.asset = asset;
        bundle.questionCount = uint32(contentIds.length);
        bundle.requiredCompleters = uint32(requiredCompleters);
        bundle.requiredSettledRounds = uint32(requiredSettledRounds);
        bundle.frontendFeeBps = defaultFrontendFeeBps;
        bundle.bountyEligibility = bountyEligibility;
        bundle.funderNullifier = funderNullifier;
        bundle.fundedAmount = fundedAmount;
        bundle.unallocatedAmount = fundedAmount;
        bundle.bountyEligibilityDataHash = QuestionRewardPoolEscrowEligibilityLib.eligibilityDataHash();
        bundle.nonRefundable = true;

        for (uint256 i = 0; i < contentIds.length;) {
            uint256 contentId = contentIds[i];
            require(registry.isContentActive(contentId), "Content not active");
            require(contentBundleId[contentId] == 0, "Bundled");
            contentBundleId[contentId] = bundleId;
            contentBundleIndex[contentId] = i;
            uint256 submitterNullifier =
                QuestionRewardPoolEscrowQualificationLib.resolveSubmitterNullifier(registry, voterIdNFT, contentId);
            bundleQuestions[bundleId].push(
                BundleQuestion({ contentId: contentId, submitterNullifier: submitterNullifier })
            );
            unchecked {
                ++i;
            }
        }

        emit QuestionBundleRewardCreated(
            bundleId,
            funder,
            funderVoterId,
            fundedAmount,
            requiredCompleters,
            contentIds.length,
            requiredSettledRounds,
            block.timestamp,
            bountyClosesAt,
            normalizedFeedbackClosesAt,
            defaultFrontendFeeBps,
            asset,
            bountyEligibility,
            bundle.bountyEligibilityDataHash
        );
        emit QuestionBundleEligibilitySet(bundleId, bountyEligibility);
        rewardPoolId = bundleId;
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
        IVoterIdNFT voterIdNFT,
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
            voterIdNFT,
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
        IVoterIdNFT voterIdNFT,
        IERC20 hrepToken,
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
            voterIdNFT,
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
                voterIdNFT,
                bundle,
                bundleId,
                roundSetIndex,
                msg.sender
            ),
            "Excluded voter"
        );
        require(
            _isBundleBountyEligible(
                bundleQuestions, bundleRoundIds, votingEngine, voterIdNFT, bundle, bundleId, roundSetIndex, msg.sender
            ),
            "Not bounty eligible"
        );

        (address frontend, bytes32 firstCommitKey) = _requireCompletedBundleRoundSet(
            bundleQuestions,
            bundleRoundIds,
            votingEngine,
            voterIdNFT,
            bundle.bountyClosesAt,
            bundleId,
            roundSetIndex,
            msg.sender
        );
        BundleQuestion storage firstQuestion = bundleQuestions[bundleId][0];
        uint256 firstRoundId = bundleRoundIds[bundleId][0][roundSetIndex];
        (uint256 voterId, bytes32 resolvedFirstCommitKey, address rewardRecipient) = QuestionRewardPoolEscrowVoterLib.resolveRoundRewardClaim(
            votingEngine, voterIdNFT, firstQuestion.contentId, firstRoundId, msg.sender
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
                snapshot.allocation,
                snapshot.frontendFeeAllocation,
                snapshot.eligibleCompleters,
                snapshot.claimedCount
            );
        require(grossAmount > 0, "No reward");

        bundleRoundSetRewardClaimed[bundleId][roundSetIndex][firstCommitKey] = true;
        unchecked {
            snapshot.claimedCount++;
            bundle.claimedCount++;
        }
        bundle.claimedAmount += grossAmount;

        (rewardAmount, reservedFrontendFee, frontendRecipient) = QuestionRewardPoolEscrowTransferLib.settleClaimPayout(
            _rewardToken(hrepToken, usdcToken, bundle.asset),
            rewardRecipient,
            rewardAmount,
            frontendRecipient,
            reservedFrontendFee
        );

        emit QuestionBundleRewardClaimed(
            bundleId,
            roundSetIndex,
            rewardRecipient,
            voterId,
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
        IVoterIdNFT voterIdNFT,
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
                voterIdNFT,
                bundle,
                bundleId,
                roundSetIndex,
                account
            )) return 0;
        if (!_isBundleBountyEligible(
                bundleQuestions, bundleRoundIds, votingEngine, voterIdNFT, bundle, bundleId, roundSetIndex, account
            )) return 0;

        (bool completed, address frontend, bytes32 firstCommitKey) = _bundleRoundSetCommitStatus(
            bundleQuestions,
            bundleRoundIds,
            votingEngine,
            voterIdNFT,
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
            snapshot.allocation,
            snapshot.frontendFeeAllocation,
            snapshot.eligibleCompleters,
            snapshot.claimedCount
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
        IVoterIdNFT voterIdNFT,
        IERC20 hrepToken,
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
            voterIdNFT,
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
                _rewardToken(hrepToken, usdcToken, bundle.asset), true, bundle.funder, treasury, refundAmount
            );
            emit QuestionBundleRewardForfeited(bundleId, treasury, refundAmount);
        } else {
            QuestionRewardPoolEscrowTransferLib.transferResidue(
                _rewardToken(hrepToken, usdcToken, bundle.asset), false, bundle.funder, address(0), refundAmount
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
        IVoterIdNFT voterIdNFT,
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
            voterIdNFT,
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
        IVoterIdNFT voterIdNFT,
        uint256 bundleId,
        BundleReward storage bundle,
        uint256 roundSetIndex
    ) private {
        if (bundleRoundSetSnapshots[bundleId][roundSetIndex].qualified) return;

        uint256 completerCount = _bundleRoundSetCompleterCount(
            bundleQuestions, bundleRoundIds, registry, votingEngine, voterIdNFT, bundle, bundleId, roundSetIndex
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
        IVoterIdNFT voterIdNFT,
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
                votingEngine, voterIdNFT, firstContentId, firstRoundId, commitKey
            );
            if (
                voter != address(0)
                    && !_isBundleExcludedVoter(
                        bundleQuestions,
                        bundleRoundIds,
                        registry,
                        votingEngine,
                        voterIdNFT,
                        bundle,
                        bundleId,
                        roundSetIndex,
                        voter
                    )
                    && _isBundleBountyEligible(
                        bundleQuestions,
                        bundleRoundIds,
                        votingEngine,
                        voterIdNFT,
                        bundle,
                        bundleId,
                        roundSetIndex,
                        voter
                    )
                    && _completedBundleRoundSetCommitIgnoringCleanup(
                        bundleQuestions,
                        bundleRoundIds,
                        votingEngine,
                        voterIdNFT,
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
        IVoterIdNFT voterIdNFT,
        uint64 bountyClosesAt,
        uint256 bundleId,
        uint256 roundSetIndex,
        address account
    ) private view returns (address frontend, bytes32 firstCommitKey) {
        (bool completed, address completedFrontend, bytes32 completedFirstCommitKey) = _bundleRoundSetCommitStatus(
            bundleQuestions,
            bundleRoundIds,
            votingEngine,
            voterIdNFT,
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
        IVoterIdNFT voterIdNFT,
        uint64 bountyClosesAt,
        uint256 bundleId,
        uint256 roundSetIndex,
        address account
    ) private view returns (bool completed) {
        (completed,,) = _bundleRoundSetCommitStatus(
            bundleQuestions,
            bundleRoundIds,
            votingEngine,
            voterIdNFT,
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
        IVoterIdNFT voterIdNFT,
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
            voterIdNFT,
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
        IVoterIdNFT voterIdNFT,
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
            voterIdNFT,
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
        IVoterIdNFT voterIdNFT,
        BundleReward storage bundle,
        uint256 bundleId,
        uint256 roundSetIndex,
        address account
    ) private view returns (bool) {
        address eligibilityAccount = _bundleBountyEligibilityAccount(
            bundleQuestions, bundleRoundIds, votingEngine, voterIdNFT, bundleId, roundSetIndex, account
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
        IVoterIdNFT voterIdNFT,
        uint256 bundleId,
        uint256 roundSetIndex,
        address account
    ) private view returns (address) {
        if (bundleQuestions[bundleId].length == 0) return account;
        BundleQuestion storage firstQuestion = bundleQuestions[bundleId][0];
        uint256 firstRoundId = bundleRoundIds[bundleId][0][roundSetIndex];
        if (firstRoundId == 0) return account;
        (uint256 voterId,,) = QuestionRewardPoolEscrowVoterLib.resolveRoundRewardClaim(
            votingEngine, voterIdNFT, firstQuestion.contentId, firstRoundId, account
        );
        if (voterId == 0) return account;
        IVoterIdNFT roundVoterIdNft = _roundVoterIdNft(votingEngine, voterIdNFT, firstQuestion.contentId, firstRoundId);
        address holder = roundVoterIdNft.getHolder(voterId);
        return holder == address(0) ? account : holder;
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

    function _resolveFunderIdentity(IVoterIdNFT voterIdNFT, address funder)
        private
        view
        returns (uint256 funderVoterId, address funderIdentity, uint256 funderNullifier)
    {
        if (address(voterIdNFT) == address(0)) {
            return (0, funder, 0);
        }
        funderVoterId = voterIdNFT.getTokenId(funder);
        if (funderVoterId == 0) {
            return (0, funder, 0);
        }

        funderIdentity = voterIdNFT.getHolder(funderVoterId);
        if (funderIdentity == address(0)) {
            funderIdentity = funder;
        }
        funderNullifier = voterIdNFT.getNullifier(funderVoterId);
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

    function _rewardToken(IERC20 hrepToken, IERC20 usdcToken, uint8 asset) private pure returns (IERC20 token) {
        return asset == REWARD_ASSET_HREP ? hrepToken : usdcToken;
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
