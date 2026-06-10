// SPDX-License-Identifier: MIT
pragma solidity ^0.8.34;

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
import { QuestionRewardPoolEscrowWindowLib } from "./QuestionRewardPoolEscrowWindowLib.sol";
import { QuestionRewardParticipantFloorLib } from "./QuestionRewardParticipantFloorLib.sol";
import {
    BundleReward,
    BundleQuestion,
    BundleRoundSetSnapshot,
    CreateSubmissionBundleParams,
    BOUNTY_ELIGIBILITY_OPEN
} from "./QuestionRewardPoolEscrowTypes.sol";
import { QuestionRewardPoolEscrowVoterLib } from "./QuestionRewardPoolEscrowVoterLib.sol";
import { RoundLib } from "./RoundLib.sol";

library QuestionRewardPoolEscrowBundleActionsLib {
    using SafeCast for uint256;

    uint256 internal constant MIN_REQUIRED_VOTERS = 3;
    uint256 internal constant MAX_REQUIRED_SETTLED_ROUNDS = 16;
    uint256 internal constant BPS_SCALE = 10_000;
    uint256 internal constant BUNDLE_CLAIM_GRACE = 7 days;
    uint256 internal constant BUNDLE_REFUND_GRACE = 98 days;
    /// @dev L-Funds-A: maximum terminal-round positions advanced inside a single
    ///      `refundQuestionBundleReward` call. Raised from 64 → 512 so funders can single-tx
    ///      refund a bundle with up to ~5x the prior cap without needing a separate caller to
    ///      advance the cursor first. Bundles whose unprocessed terminal-round set exceeds this
    ///      cap can still drain the cursor incrementally via the existing
    ///      `syncQuestionBundleTerminals` external entrypoint.
    uint256 internal constant BUNDLE_REFUND_SYNC_ROUND_LIMIT = 512;
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
        uint256 bountyStartBy,
        uint256 bountyWindowSeconds,
        uint256 feedbackWindowSeconds,
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

    /// @notice FE-6 (2026-05-20 follow-up audit): emitted when `_recordBundleQuestionTerminal`
    ///         skips a terminal event without recording it. Off-chain monitors can subscribe to
    ///         detect stuck bundle progression caused by ordering / refund / cursor mismatch
    ///         rather than inferring the skip from the absence of `QuestionBundleRoundRecorded`.
    /// @param reasonCode 1 = bundle refunded, 2 = roundSet beyond required, 3 = roundSet behind
    ///                   completed cursor, 4 = roundId not strictly greater than the current
    ///                   set's recorded round, 5 = roundId not strictly greater than the prior
    ///                   set's recorded round, 6 = round terminal was non-settled (rejected /
    ///                   cancelled). reasonCode = 0 reserved.
    event QuestionBundleTerminalSkipped(
        uint256 indexed bundleId, uint256 indexed contentId, uint256 indexed roundId, uint8 reasonCode
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
        mapping(uint256 => mapping(uint256 => uint256)) storage bundleQuestionTerminalSyncCursor,
        ContentRegistry registry,
        RoundVotingEngine votingEngine,
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
        require(
            params.asset != REWARD_ASSET_USDC || protocolConfig.clusterPayoutOracle() == address(0),
            "Cluster bundle unsupported"
        );
        require(params.requiredCompleters >= MIN_REQUIRED_VOTERS, "Too few voters");
        require(params.requiredCompleters >= _requiredParticipantFloorForAmount(params.amount), "High-value floor");
        require(params.requiredSettledRounds >= 1, "Too few rounds");
        require(params.requiredSettledRounds <= MAX_REQUIRED_SETTLED_ROUNDS, "Too many rounds");
        require(params.amount >= params.requiredCompleters * params.requiredSettledRounds, "Amount too small");
        require(QuestionRewardPoolEscrowEligibilityLib.isValidPolicy(params.bountyEligibility), "Invalid eligibility");
        _requireCompletersMatchSettlementVoters(registry, params.contentIds, params.requiredCompleters);
        QuestionRewardPoolEscrowBundleLib.requireFundingCoversMaxCompleters(
            registry, params.contentIds, params.amount, params.requiredSettledRounds
        );
        uint256 normalizedFeedbackWindowSeconds = QuestionRewardPoolEscrowWindowLib.validateWindow(
            params.bountyStartBy, params.bountyWindowSeconds, params.feedbackWindowSeconds, false
        );

        uint256 fundedAmount = QuestionRewardPoolEscrowTransferLib.pullExactToken(
            _rewardToken(lrepToken, usdcToken, params.asset), params.funder, params.amount
        );
        (bytes32 funderIdentityKey, address funderIdentity) = _resolveFunderIdentity(protocolConfig, params.funder);

        _writeBundleRecord(
            bundleRewards[params.bundleId],
            params,
            fundedAmount,
            normalizedFeedbackWindowSeconds,
            defaultFrontendFeeBps,
            funderIdentityKey,
            funderIdentity
        );

        _registerBundleQuestions(
            bundleQuestions,
            contentBundleId,
            contentBundleIndex,
            bundleQuestionTerminalSyncCursor,
            registry,
            votingEngine,
            protocolConfig,
            params
        );

        emit QuestionBundleRewardCreated(
            params.bundleId,
            params.funder,
            funderIdentityKey,
            fundedAmount,
            params.requiredCompleters,
            params.contentIds.length,
            params.requiredSettledRounds,
            params.bountyStartBy,
            params.bountyWindowSeconds,
            normalizedFeedbackWindowSeconds,
            defaultFrontendFeeBps,
            params.asset,
            params.bountyEligibility,
            bundleRewards[params.bundleId].bountyEligibilityDataHash
        );
        emit QuestionBundleEligibilitySet(params.bundleId, params.bountyEligibility);
        rewardPoolId = params.bundleId;
    }

    function _requireCompletersMatchSettlementVoters(
        ContentRegistry registry,
        uint256[] memory contentIds,
        uint256 requiredCompleters
    ) private view {
        for (uint256 i = 0; i < contentIds.length;) {
            RoundLib.RoundConfig memory contentCfg = registry.getContentRoundConfig(contentIds[i]);
            require(requiredCompleters == contentCfg.minVoters, "Voters mismatch");
            unchecked {
                i++;
            }
        }
    }

    function _writeBundleRecord(
        BundleReward storage bundle,
        CreateSubmissionBundleParams memory params,
        uint256 fundedAmount,
        uint256 normalizedFeedbackWindowSeconds,
        uint16 defaultFrontendFeeBps,
        bytes32 funderIdentityKey,
        address funderIdentity
    ) private {
        bundle.id = params.bundleId.toUint64();
        bundle.bountyStartBy = params.bountyStartBy.toUint64();
        bundle.bountyWindowSeconds = params.bountyWindowSeconds.toUint32();
        bundle.feedbackWindowSeconds = normalizedFeedbackWindowSeconds.toUint32();
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
        mapping(uint256 => mapping(uint256 => uint256)) storage bundleQuestionTerminalSyncCursor,
        ContentRegistry registry,
        RoundVotingEngine votingEngine,
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
            bundleQuestionTerminalSyncCursor[bundleId][i] = _initialBundleSyncCursor(votingEngine, contentId);
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
        mapping(uint256 => mapping(uint256 => uint256)) storage bundleQuestionTerminalSyncCursor,
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
            bundleQuestionTerminalSyncCursor,
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
        mapping(uint256 => mapping(uint256 => uint256)) storage bundleQuestionTerminalSyncCursor,
        mapping(uint256 => mapping(uint256 => mapping(bytes32 => bool))) storage qualifiedBundleRoundSetClaimants,
        mapping(uint256 => uint256) storage contentBundleId,
        mapping(uint256 => uint256) storage contentBundleIndex,
        ContentRegistry registry,
        RoundVotingEngine votingEngine,
        ProtocolConfig protocolConfig,
        uint256 contentId,
        uint256 roundId
    ) external {
        (, RoundLib.RoundState state,,,,, uint48 settledAt) = votingEngine.roundCore(contentId, roundId);
        require(_isTerminalRound(state, settledAt), "Round not terminal");
        _recordBundleQuestionTerminal(
            bundleRewards,
            bundleQuestionRecordedRounds,
            bundleRoundIds,
            bundleQuestionTerminalSyncCursor,
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
            bundleQuestionTerminalSyncCursor,
            qualifiedBundleRoundSetClaimants,
            registry,
            votingEngine,
            protocolConfig,
            bundleId,
            bundle
        );
    }

    function syncQuestionBundleTerminals(
        mapping(uint256 => BundleReward) storage bundleRewards,
        mapping(uint256 => BundleQuestion[]) storage bundleQuestions,
        mapping(uint256 => mapping(uint256 => uint32)) storage bundleQuestionRecordedRounds,
        mapping(uint256 => mapping(uint256 => mapping(uint256 => uint64))) storage bundleRoundIds,
        mapping(uint256 => mapping(uint256 => BundleRoundSetSnapshot)) storage bundleRoundSetSnapshots,
        mapping(uint256 => mapping(uint256 => uint256)) storage bundleQuestionTerminalSyncCursor,
        mapping(uint256 => mapping(uint256 => mapping(bytes32 => bool))) storage qualifiedBundleRoundSetClaimants,
        mapping(uint256 => uint256) storage contentBundleId,
        mapping(uint256 => uint256) storage contentBundleIndex,
        ContentRegistry registry,
        RoundVotingEngine votingEngine,
        ProtocolConfig protocolConfig,
        uint256 bundleId,
        uint256 maxRounds
    ) external returns (uint256 processedRounds, bool complete) {
        return _syncQuestionBundleTerminals(
            bundleRewards,
            bundleQuestions,
            bundleQuestionRecordedRounds,
            bundleRoundIds,
            bundleRoundSetSnapshots,
            bundleQuestionTerminalSyncCursor,
            qualifiedBundleRoundSetClaimants,
            contentBundleId,
            contentBundleIndex,
            registry,
            votingEngine,
            protocolConfig,
            bundleId,
            maxRounds
        );
    }

    function claimQuestionBundleReward(
        mapping(uint256 => BundleReward) storage bundleRewards,
        mapping(uint256 => BundleQuestion[]) storage bundleQuestions,
        mapping(uint256 => mapping(uint256 => uint32)) storage bundleQuestionRecordedRounds,
        mapping(uint256 => mapping(uint256 => mapping(uint256 => uint64))) storage bundleRoundIds,
        mapping(uint256 => mapping(uint256 => BundleRoundSetSnapshot)) storage bundleRoundSetSnapshots,
        mapping(uint256 => mapping(uint256 => uint256)) storage bundleQuestionTerminalSyncCursor,
        mapping(uint256 => mapping(uint256 => mapping(bytes32 => bool))) storage bundleRoundSetRewardClaimed,
        mapping(uint256 => mapping(uint256 => mapping(bytes32 => bool))) storage qualifiedBundleRoundSetClaimants,
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
            bundleQuestionTerminalSyncCursor,
            qualifiedBundleRoundSetClaimants,
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
        (address frontend, bytes32 firstCommitKey) = _requireCompletedBundleRoundSet(
            bundleQuestions,
            bundleRoundIds,
            votingEngine,
            protocolConfig,
            bundle.bountyOpensAt,
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
        require(
            _wasBundleBountyEligibleAtQualification(
                bundle, qualifiedBundleRoundSetClaimants, bundleId, roundSetIndex, firstCommitKey
            ),
            "Not bounty eligible"
        );
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

        // M-Funds-1 / L-Funds-4: bundle path uses equal-share, so the bucket isn't accumulated
        // across claimants — the fee redirect (if any) is absorbed into the voter's reward by
        // `settleClaimPayout` and does not require a bucket adjustment. If a future weighted
        // bundle path is added, that path must track `frontendFeeClaimedAmount` and apply the
        // M-Funds-1 decrement; the unused-here local makes the missing accounting explicit.
        uint256 bundleRedirectedFrontendFee;
        (rewardAmount, reservedFrontendFee, frontendRecipient, bundleRedirectedFrontendFee) =
            QuestionRewardPoolEscrowTransferLib.settleClaimPayout(
                _rewardToken(lrepToken, usdcToken, bundle.asset),
                rewardRecipient,
                rewardAmount,
                frontendRecipient,
                reservedFrontendFee
            );
        // Equal-share bundle does not maintain a per-bundle frontend-fee bucket; the redirect is
        // absorbed at payout time. Silence the unused-local while documenting intent.
        bundleRedirectedFrontendFee;

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
        mapping(uint256 => mapping(uint256 => mapping(bytes32 => bool))) storage qualifiedBundleRoundSetClaimants,
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

        (bool completed, address frontend, bytes32 firstCommitKey) = _bundleRoundSetCommitStatus(
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
        if (!_wasBundleBountyEligibleAtQualification(
                bundle, qualifiedBundleRoundSetClaimants, bundleId, roundSetIndex, firstCommitKey
            )) return 0;
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
        mapping(uint256 => mapping(uint256 => uint256)) storage bundleQuestionTerminalSyncCursor,
        mapping(uint256 => mapping(uint256 => mapping(bytes32 => bool))) storage qualifiedBundleRoundSetClaimants,
        mapping(uint256 => uint256) storage contentBundleId,
        mapping(uint256 => uint256) storage contentBundleIndex,
        ContentRegistry registry,
        RoundVotingEngine votingEngine,
        IERC20 lrepToken,
        IERC20 usdcToken,
        uint256 bundleId
    ) external returns (uint256 refundAmount) {
        BundleReward storage bundle = _getExistingBundleReward(bundleRewards, bundleId);
        require(!bundle.refunded, "Already refunded");
        uint64 refundClock = QuestionRewardPoolEscrowWindowLib.bundleRefundClock(bundle);
        require(refundClock != 0 && block.timestamp > refundClock, "Bundle active");
        require(block.timestamp > uint256(refundClock) + BUNDLE_REFUND_GRACE, "Grace");
        (, bool syncComplete) = _syncQuestionBundleTerminals(
            bundleRewards,
            bundleQuestions,
            bundleQuestionRecordedRounds,
            bundleRoundIds,
            bundleRoundSetSnapshots,
            bundleQuestionTerminalSyncCursor,
            qualifiedBundleRoundSetClaimants,
            contentBundleId,
            contentBundleIndex,
            registry,
            votingEngine,
            votingEngine.protocolConfig(),
            bundleId,
            BUNDLE_REFUND_SYNC_ROUND_LIMIT
        );
        require(syncComplete, "Sync pending");
        _qualifyPendingBundleRoundSet(
            bundleRewards,
            bundleQuestions,
            bundleQuestionRecordedRounds,
            bundleRoundIds,
            bundleRoundSetSnapshots,
            bundleQuestionTerminalSyncCursor,
            qualifiedBundleRoundSetClaimants,
            registry,
            votingEngine,
            votingEngine.protocolConfig(),
            bundleId,
            bundle
        );
        if (bundle.completedRoundSets != 0) {
            QuestionRewardPoolEscrowBundleLib.requireCleanupComplete(
                bundleQuestions, bundleRoundIds, votingEngine, bundleId, bundle.completedRoundSets
            );
            if (bundle.claimDeadline == 0) {
                bundle.claimDeadline = uint64(block.timestamp);
                return 0;
            }
            require(block.timestamp > uint256(bundle.claimDeadline) + BUNDLE_CLAIM_GRACE, "Grace");
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
        mapping(uint256 => mapping(uint256 => uint256)) storage bundleQuestionTerminalSyncCursor,
        mapping(uint256 => uint256) storage contentBundleId,
        mapping(uint256 => uint256) storage contentBundleIndex,
        uint256 contentId,
        uint256 roundId,
        bool settled
    ) private {
        uint256 bundleId = contentBundleId[contentId];
        if (bundleId == 0) return;

        BundleReward storage bundle = _getExistingBundleReward(bundleRewards, bundleId);
        if (bundle.refunded) {
            emit QuestionBundleTerminalSkipped(bundleId, contentId, roundId, 1);
            return;
        }

        uint256 bundleIndex = contentBundleIndex[contentId];
        _advanceBundleQuestionTerminalSyncCursor(bundleQuestionTerminalSyncCursor, bundleId, bundleIndex, roundId);

        uint256 roundSetIndex = bundleQuestionRecordedRounds[bundleId][bundleIndex];
        if (roundSetIndex >= bundle.requiredSettledRounds) {
            emit QuestionBundleTerminalSkipped(bundleId, contentId, roundId, 2);
            return;
        }
        if (roundSetIndex < bundle.completedRoundSets) {
            emit QuestionBundleTerminalSkipped(bundleId, contentId, roundId, 3);
            return;
        }
        if (roundId <= bundleRoundIds[bundleId][bundleIndex][roundSetIndex]) {
            emit QuestionBundleTerminalSkipped(bundleId, contentId, roundId, 4);
            return;
        }
        if (roundSetIndex != 0) {
            unchecked {
                if (roundId <= bundleRoundIds[bundleId][bundleIndex][roundSetIndex - 1]) {
                    emit QuestionBundleTerminalSkipped(bundleId, contentId, roundId, 5);
                    return;
                }
            }
        }

        if (!settled) {
            emit QuestionBundleTerminalSkipped(bundleId, contentId, roundId, 6);
            return;
        }

        bundleRoundIds[bundleId][bundleIndex][roundSetIndex] = uint64(roundId);
        bundleQuestionRecordedRounds[bundleId][bundleIndex] = uint32(roundSetIndex + 1);
        emit QuestionBundleRoundRecorded(bundleId, contentId, roundId, bundleIndex, roundSetIndex);
    }

    function _syncQuestionBundleTerminals(
        mapping(uint256 => BundleReward) storage bundleRewards,
        mapping(uint256 => BundleQuestion[]) storage bundleQuestions,
        mapping(uint256 => mapping(uint256 => uint32)) storage bundleQuestionRecordedRounds,
        mapping(uint256 => mapping(uint256 => mapping(uint256 => uint64))) storage bundleRoundIds,
        mapping(uint256 => mapping(uint256 => BundleRoundSetSnapshot)) storage bundleRoundSetSnapshots,
        mapping(uint256 => mapping(uint256 => uint256)) storage bundleQuestionTerminalSyncCursor,
        mapping(uint256 => mapping(uint256 => mapping(bytes32 => bool))) storage qualifiedBundleRoundSetClaimants,
        mapping(uint256 => uint256) storage contentBundleId,
        mapping(uint256 => uint256) storage contentBundleIndex,
        ContentRegistry registry,
        RoundVotingEngine votingEngine,
        ProtocolConfig protocolConfig,
        uint256 bundleId,
        uint256 maxRounds
    ) private returns (uint256 processedRounds, bool complete) {
        require(maxRounds != 0, "No rounds");
        BundleReward storage bundle = _getExistingBundleReward(bundleRewards, bundleId);
        if (bundle.refunded) return (0, true);

        BundleQuestion[] storage questions = bundleQuestions[bundleId];
        complete = true;
        for (uint256 i = 0; i < questions.length;) {
            if (processedRounds >= maxRounds) return (processedRounds, false);
            (uint256 processedQuestionRounds, bool questionComplete) = _syncBundleQuestionTerminalsForQuestion(
                bundleRewards,
                bundleQuestions,
                bundleQuestionRecordedRounds,
                bundleRoundIds,
                bundleQuestionTerminalSyncCursor,
                contentBundleId,
                contentBundleIndex,
                votingEngine,
                bundle,
                bundleId,
                i,
                maxRounds - processedRounds
            );
            processedRounds += processedQuestionRounds;
            if (!questionComplete) complete = false;
            unchecked {
                ++i;
            }
        }

        _qualifyPendingBundleRoundSet(
            bundleRewards,
            bundleQuestions,
            bundleQuestionRecordedRounds,
            bundleRoundIds,
            bundleRoundSetSnapshots,
            bundleQuestionTerminalSyncCursor,
            qualifiedBundleRoundSetClaimants,
            registry,
            votingEngine,
            protocolConfig,
            bundleId,
            bundle
        );
    }

    function _syncBundleQuestionTerminalsForQuestion(
        mapping(uint256 => BundleReward) storage bundleRewards,
        mapping(uint256 => BundleQuestion[]) storage bundleQuestions,
        mapping(uint256 => mapping(uint256 => uint32)) storage bundleQuestionRecordedRounds,
        mapping(uint256 => mapping(uint256 => mapping(uint256 => uint64))) storage bundleRoundIds,
        mapping(uint256 => mapping(uint256 => uint256)) storage bundleQuestionTerminalSyncCursor,
        mapping(uint256 => uint256) storage contentBundleId,
        mapping(uint256 => uint256) storage contentBundleIndex,
        RoundVotingEngine votingEngine,
        BundleReward storage bundle,
        uint256 bundleId,
        uint256 bundleIndex,
        uint256 maxRounds
    ) private returns (uint256 processedRounds, bool complete) {
        uint256 contentId = bundleQuestions[bundleId][bundleIndex].contentId;
        uint256 cursor = bundleQuestionTerminalSyncCursor[bundleId][bundleIndex];
        if (cursor == 0) {
            cursor = _fallbackBundleSyncCursor(bundleQuestionRecordedRounds, bundleRoundIds, bundleId, bundleIndex);
            bundleQuestionTerminalSyncCursor[bundleId][bundleIndex] = cursor;
        }

        uint256 currentRoundId = votingEngine.currentRoundId(contentId);
        if (currentRoundId == 0 || cursor > currentRoundId) return (0, true);

        while (cursor <= currentRoundId) {
            if (processedRounds >= maxRounds) return (processedRounds, false);
            (uint48 startTime, RoundLib.RoundState state,,,,, uint48 settledAt) =
                votingEngine.roundCore(contentId, cursor);
            if (startTime == 0) {
                bundleQuestionTerminalSyncCursor[bundleId][bundleIndex] = ++cursor;
                processedRounds++;
                continue;
            }
            if (bundle.bountyClosesAt != 0 && startTime > bundle.bountyClosesAt) {
                bundleQuestionTerminalSyncCursor[bundleId][bundleIndex] = currentRoundId + 1;
                return (processedRounds, true);
            }
            if (!_isTerminalRound(state, settledAt)) return (processedRounds, false);

            _recordBundleQuestionTerminal(
                bundleRewards,
                bundleQuestionRecordedRounds,
                bundleRoundIds,
                bundleQuestionTerminalSyncCursor,
                contentBundleId,
                contentBundleIndex,
                contentId,
                cursor,
                state == RoundLib.RoundState.Settled
            );
            cursor = bundleQuestionTerminalSyncCursor[bundleId][bundleIndex];
            if (cursor == 0) {
                cursor = _fallbackBundleSyncCursor(bundleQuestionRecordedRounds, bundleRoundIds, bundleId, bundleIndex);
            }
            processedRounds++;
        }
        complete = true;
    }

    function _qualifyPendingBundleRoundSet(
        mapping(uint256 => BundleReward) storage bundleRewards,
        mapping(uint256 => BundleQuestion[]) storage bundleQuestions,
        mapping(uint256 => mapping(uint256 => uint32)) storage bundleQuestionRecordedRounds,
        mapping(uint256 => mapping(uint256 => mapping(uint256 => uint64))) storage bundleRoundIds,
        mapping(uint256 => mapping(uint256 => BundleRoundSetSnapshot)) storage bundleRoundSetSnapshots,
        mapping(uint256 => mapping(uint256 => uint256)) storage bundleQuestionTerminalSyncCursor,
        mapping(uint256 => mapping(uint256 => mapping(bytes32 => bool))) storage qualifiedBundleRoundSetClaimants,
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
            bundleQuestionTerminalSyncCursor,
            qualifiedBundleRoundSetClaimants,
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
        mapping(uint256 => mapping(uint256 => uint256)) storage bundleQuestionTerminalSyncCursor,
        mapping(uint256 => mapping(uint256 => mapping(bytes32 => bool))) storage qualifiedBundleRoundSetClaimants,
        ContentRegistry registry,
        RoundVotingEngine votingEngine,
        ProtocolConfig protocolConfig,
        uint256 bundleId,
        BundleReward storage bundle,
        uint256 roundSetIndex
    ) private {
        if (bundleRoundSetSnapshots[bundleId][roundSetIndex].qualified) return;
        if (!QuestionRewardPoolEscrowWindowLib.activateBundleWindowForRoundSet(
                votingEngine, bundle, bundleQuestions[bundleId], bundleRoundIds, bundleId, roundSetIndex
            )) {
            QuestionRewardPoolEscrowBundleLib.resetRoundSet(
                bundleQuestions,
                bundleQuestionRecordedRounds,
                bundleRoundIds,
                bundleQuestionTerminalSyncCursor,
                bundleId,
                roundSetIndex
            );
            return;
        }

        uint256 completerCount = _bundleRoundSetCompleterCount(
            bundleQuestions, bundleRoundIds, registry, votingEngine, protocolConfig, bundle, bundleId, roundSetIndex
        );
        if (completerCount < bundle.requiredCompleters) {
            QuestionRewardPoolEscrowBundleLib.resetRoundSet(
                bundleQuestions,
                bundleQuestionRecordedRounds,
                bundleRoundIds,
                bundleQuestionTerminalSyncCursor,
                bundleId,
                roundSetIndex
            );
            return;
        }

        uint256 allocation = _previewBundleRoundSetAllocation(bundle);
        if (allocation == 0 || allocation < completerCount) {
            QuestionRewardPoolEscrowBundleLib.resetRoundSet(
                bundleQuestions,
                bundleQuestionRecordedRounds,
                bundleRoundIds,
                bundleQuestionTerminalSyncCursor,
                bundleId,
                roundSetIndex
            );
            return;
        }
        uint256 frontendFeeAllocation = (allocation * bundle.frontendFeeBps) / BPS_SCALE;

        unchecked {
            bundle.completedRoundSets++;
        }
        bundle.unallocatedAmount -= allocation;

        bundleRoundSetSnapshots[bundleId][roundSetIndex] = BundleRoundSetSnapshot({
            qualified: true,
            claimedCount: 0,
            // FE-5 (2026-05-20 follow-up audit): use SafeCast.toUint32 for consistency with the
            // rest of the codebase. completerCount is currently bounded by uint16 commitCount so
            // the cast is sound, but raw uint32(x) bypasses the project's safe-cast policy.
            eligibleCompleters: completerCount.toUint32(),
            allocation: allocation,
            frontendFeeAllocation: frontendFeeAllocation
        });
        _markBundleRoundSetCompleters(
            bundleQuestions,
            bundleRoundIds,
            registry,
            votingEngine,
            protocolConfig,
            qualifiedBundleRoundSetClaimants,
            bundle,
            bundleId,
            roundSetIndex
        );
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
        (,, uint16 commitCount,,,,) = votingEngine.roundCore(firstContentId, firstRoundId);
        for (uint256 i = 0; i < commitCount;) {
            bytes32 commitKey = votingEngine.getRoundCommitKey(firstContentId, firstRoundId, i);
            if (_isEligibleBundleRoundSetCompleter(
                    bundleQuestions,
                    bundleRoundIds,
                    registry,
                    votingEngine,
                    protocolConfig,
                    bundle,
                    bundleId,
                    roundSetIndex,
                    commitKey
                )) {
                unchecked {
                    completerCount++;
                }
            }
            unchecked {
                ++i;
            }
        }
    }

    function _markBundleRoundSetCompleters(
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
        mapping(uint256 => mapping(uint256 => mapping(bytes32 => bool))) storage qualifiedBundleRoundSetClaimants,
        BundleReward storage bundle,
        uint256 bundleId,
        uint256 roundSetIndex
    ) private {
        BundleQuestion[] storage questions = bundleQuestions[bundleId];
        if (questions.length == 0) return;

        uint256 firstContentId = questions[0].contentId;
        uint256 firstRoundId = bundleRoundIds[bundleId][0][roundSetIndex];
        (,, uint16 commitCount,,,,) = votingEngine.roundCore(firstContentId, firstRoundId);
        for (uint256 i = 0; i < commitCount;) {
            bytes32 commitKey = votingEngine.getRoundCommitKey(firstContentId, firstRoundId, i);
            if (_isEligibleBundleRoundSetCompleter(
                    bundleQuestions,
                    bundleRoundIds,
                    registry,
                    votingEngine,
                    protocolConfig,
                    bundle,
                    bundleId,
                    roundSetIndex,
                    commitKey
                )) {
                qualifiedBundleRoundSetClaimants[bundleId][roundSetIndex][commitKey] = true;
            }
            unchecked {
                ++i;
            }
        }
    }

    function _wasBundleBountyEligibleAtQualification(
        BundleReward storage bundle,
        mapping(uint256 => mapping(uint256 => mapping(bytes32 => bool))) storage qualifiedBundleRoundSetClaimants,
        uint256 bundleId,
        uint256 roundSetIndex,
        bytes32 firstCommitKey
    ) private view returns (bool) {
        if (bundle.bountyEligibility == BOUNTY_ELIGIBILITY_OPEN) return true;
        return qualifiedBundleRoundSetClaimants[bundleId][roundSetIndex][firstCommitKey];
    }

    function _isEligibleBundleRoundSetCompleter(
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
        bytes32 firstCommitKey
    ) private view returns (bool) {
        BundleQuestion[] storage questions = bundleQuestions[bundleId];
        uint256 firstContentId = questions[0].contentId;
        uint256 firstRoundId = bundleRoundIds[bundleId][0][roundSetIndex];
        address voter = QuestionRewardPoolEscrowVoterLib.bundleCompleterAccount(
            votingEngine, firstContentId, firstRoundId, firstCommitKey
        );
        return voter != address(0)
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
            && _completedBundleRoundSetCommitIgnoringCleanup(
            bundleQuestions,
            bundleRoundIds,
            votingEngine,
            protocolConfig,
            bundle.bountyOpensAt,
            bundle.bountyClosesAt,
            bundleId,
            roundSetIndex,
            voter
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
            voter
        );
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
        uint64 bountyOpensAt,
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
            bountyOpensAt,
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
        uint64 bountyOpensAt,
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
            bountyOpensAt,
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
        uint64 bountyOpensAt,
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
            bountyOpensAt,
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
        return QuestionRewardParticipantFloorLib.requiredParticipantFloorForAmount(amount);
    }

    function _initialBundleSyncCursor(RoundVotingEngine votingEngine, uint256 contentId)
        private
        view
        returns (uint256 cursor)
    {
        cursor = votingEngine.currentRoundId(contentId);
        if (cursor == 0) return 1;
        (uint48 startTime, RoundLib.RoundState state,,,,,) = votingEngine.roundCore(contentId, cursor);
        if (startTime == 0 || state != RoundLib.RoundState.Open) return cursor + 1;
    }

    function _fallbackBundleSyncCursor(
        mapping(uint256 => mapping(uint256 => uint32)) storage bundleQuestionRecordedRounds,
        mapping(uint256 => mapping(uint256 => mapping(uint256 => uint64))) storage bundleRoundIds,
        uint256 bundleId,
        uint256 bundleIndex
    ) private view returns (uint256 cursor) {
        uint256 recordedRounds = bundleQuestionRecordedRounds[bundleId][bundleIndex];
        if (recordedRounds == 0) return 1;
        return uint256(bundleRoundIds[bundleId][bundleIndex][recordedRounds - 1]) + 1;
    }

    function _advanceBundleQuestionTerminalSyncCursor(
        mapping(uint256 => mapping(uint256 => uint256)) storage bundleQuestionTerminalSyncCursor,
        uint256 bundleId,
        uint256 bundleIndex,
        uint256 roundId
    ) private {
        if (bundleQuestionTerminalSyncCursor[bundleId][bundleIndex] == roundId) {
            bundleQuestionTerminalSyncCursor[bundleId][bundleIndex] = roundId + 1;
        }
    }

    function _isTerminalRound(RoundLib.RoundState state, uint48 settledAt) private pure returns (bool) {
        return state != RoundLib.RoundState.Open || settledAt != 0;
    }
}
