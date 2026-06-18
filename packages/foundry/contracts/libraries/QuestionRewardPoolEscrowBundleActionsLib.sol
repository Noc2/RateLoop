// SPDX-License-Identifier: MIT
pragma solidity ^0.8.34;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeCast } from "@openzeppelin/contracts/utils/math/SafeCast.sol";

import { ContentRegistry } from "../ContentRegistry.sol";
import { IClusterPayoutOracle } from "../interfaces/IClusterPayoutOracle.sol";
import { ProtocolConfig } from "../ProtocolConfig.sol";
import { RoundVotingEngine } from "../RoundVotingEngine.sol";
import { IRaterIdentityRegistry } from "../interfaces/IRaterIdentityRegistry.sol";
import { IRaterRegistryStatus } from "../interfaces/IRaterRegistryStatus.sol";
import { QuestionRewardPoolEscrowBundleLib } from "./QuestionRewardPoolEscrowBundleLib.sol";
import {
    QuestionRewardPoolEscrowClaimLib,
    EqualShareInputs,
    WeightedShareInputs
} from "./QuestionRewardPoolEscrowClaimLib.sol";
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

    error BundleClusterPayoutSnapshotPending();

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
    uint256 private constant BASE_CLAIM_WEIGHT_BPS = 10_000;
    uint256 private constant MAX_CLAIM_WEIGHT_BPS = 20_000;
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
    event QuestionBundleRoundSetCorrelationSnapshotApplied(
        uint256 indexed bundleId,
        uint256 indexed roundSetIndex,
        uint64 correlationEpochId,
        uint256 rawEligibleCompleters,
        uint256 effectiveParticipantUnits,
        uint256 totalClaimWeight,
        bytes32 weightRoot
    );
    event QuestionBundleClusterPayoutOracleSnapshotted(uint256 indexed bundleId, address indexed clusterPayoutOracle);
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
        require(params.requiredCompleters >= MIN_REQUIRED_VOTERS, "Too few voters");
        require(params.requiredCompleters >= _requiredParticipantFloorForAmount(params.amount), "High-value floor");
        require(params.requiredSettledRounds >= 1, "Too few rounds");
        require(params.requiredSettledRounds <= MAX_REQUIRED_SETTLED_ROUNDS, "Too many rounds");
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

    function snapshotBundleClusterPayoutOracle(
        mapping(uint256 => address) storage bundleRewardClusterPayoutOracle,
        RoundVotingEngine votingEngine,
        uint256 bundleId,
        uint8 payoutDomain,
        address expectedConsumer
    ) external {
        address clusterPayoutOracle = votingEngine.protocolConfig().clusterPayoutOracle();
        if (clusterPayoutOracle == address(0)) return;
        try IClusterPayoutOracle(clusterPayoutOracle).roundPayoutSnapshotConsumer(payoutDomain) returns (
            address consumer
        ) {
            require(consumer == expectedConsumer, "Oracle consumer mismatch");
        } catch {
            revert("Invalid oracle");
        }
        bundleRewardClusterPayoutOracle[bundleId] = clusterPayoutOracle;
        emit QuestionBundleClusterPayoutOracleSnapshotted(bundleId, clusterPayoutOracle);
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
        mapping(uint256 => address) storage bundleRewardClusterPayoutOracle,
        mapping(uint256 => mapping(uint256 => uint256)) storage bundleQuestionTerminalSyncCursor,
        mapping(uint256 => mapping(uint256 => mapping(bytes32 => bool))) storage qualifiedBundleRoundSetClaimants,
        mapping(uint256 => uint256) storage contentBundleId,
        mapping(uint256 => uint256) storage contentBundleIndex,
        ContentRegistry registry,
        RoundVotingEngine votingEngine,
        ProtocolConfig protocolConfig,
        uint8 payoutDomain,
        uint256 contentId,
        uint256 roundId
    ) external {
        (, RoundLib.RoundState state,,,,, uint48 settledAt,) = votingEngine.roundCore(contentId, roundId);
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
            bundleRewardClusterPayoutOracle,
            bundleQuestionTerminalSyncCursor,
            qualifiedBundleRoundSetClaimants,
            registry,
            votingEngine,
            protocolConfig,
            payoutDomain,
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
        mapping(uint256 => address) storage bundleRewardClusterPayoutOracle,
        mapping(uint256 => mapping(uint256 => uint256)) storage bundleQuestionTerminalSyncCursor,
        mapping(uint256 => mapping(uint256 => mapping(bytes32 => bool))) storage qualifiedBundleRoundSetClaimants,
        mapping(uint256 => uint256) storage contentBundleId,
        mapping(uint256 => uint256) storage contentBundleIndex,
        ContentRegistry registry,
        RoundVotingEngine votingEngine,
        ProtocolConfig protocolConfig,
        uint8 payoutDomain,
        uint256 bundleId,
        uint256 maxRounds
    ) external returns (uint256 processedRounds, bool complete) {
        return _syncQuestionBundleTerminals(
            bundleRewards,
            bundleQuestions,
            bundleQuestionRecordedRounds,
            bundleRoundIds,
            bundleRoundSetSnapshots,
            bundleRewardClusterPayoutOracle,
            bundleQuestionTerminalSyncCursor,
            qualifiedBundleRoundSetClaimants,
            contentBundleId,
            contentBundleIndex,
            registry,
            votingEngine,
            protocolConfig,
            payoutDomain,
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
        mapping(uint256 => address) storage bundleRewardClusterPayoutOracle,
        mapping(uint256 => mapping(uint256 => uint256)) storage bundleQuestionTerminalSyncCursor,
        mapping(uint256 => mapping(uint256 => mapping(bytes32 => bool))) storage bundleRoundSetRewardClaimed,
        mapping(uint256 => mapping(uint256 => mapping(bytes32 => bool))) storage qualifiedBundleRoundSetClaimants,
        ContentRegistry registry,
        RoundVotingEngine votingEngine,
        ProtocolConfig protocolConfig,
        IERC20 lrepToken,
        IERC20 usdcToken,
        IClusterPayoutOracle.PayoutWeight memory payoutWeight,
        bytes32[] memory proof,
        uint8 payoutDomain,
        bool hasCorrelationProof,
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
            bundleRewardClusterPayoutOracle,
            bundleQuestionTerminalSyncCursor,
            qualifiedBundleRoundSetClaimants,
            registry,
            votingEngine,
            protocolConfig,
            payoutDomain,
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
            !_isBundleCompleterBanned(
                bundleQuestions, bundleRoundIds, votingEngine, protocolConfig, bundleId, roundSetIndex, msg.sender
            ),
            "Identity banned"
        );
        require(
            _wasBundleBountyEligibleAtQualification(
                qualifiedBundleRoundSetClaimants, bundleId, roundSetIndex, firstCommitKey
            ),
            "Not bounty eligible"
        );
        require(!bundleRoundSetRewardClaimed[bundleId][roundSetIndex][firstCommitKey], "Already claimed");
        BundleRoundSetSnapshot storage snapshot = bundleRoundSetSnapshots[bundleId][roundSetIndex];
        uint256 grossAmount;
        uint256 frontendFee;
        address frontendRecipient;
        uint256 reservedFrontendFee;
        uint256 claimWeight;
        bool clusterSnapshot = snapshot.totalClaimWeight != 0;
        if (clusterSnapshot) {
            claimWeight = _effectiveClusterBundleClaimWeight(
                bundleRewardClusterPayoutOracle,
                bundle,
                snapshot,
                bundleId,
                roundSetIndex,
                identityKey,
                firstCommitKey,
                rewardRecipient,
                payoutWeight,
                proof,
                payoutDomain,
                hasCorrelationProof
            );
            (grossAmount, rewardAmount, frontendFee, frontendRecipient, reservedFrontendFee) =
                QuestionRewardPoolEscrowClaimLib.computeWeightedClaimSplit(
                    votingEngine,
                    firstQuestion.contentId,
                    firstRoundId,
                    firstCommitKey,
                    frontend,
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
        } else {
            (grossAmount, rewardAmount, frontendFee, frontendRecipient) =
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
            reservedFrontendFee = frontendFee;
        }
        require(grossAmount > 0, "No reward");

        bundleRoundSetRewardClaimed[bundleId][roundSetIndex][firstCommitKey] = true;
        unchecked {
            snapshot.claimedCount++;
            bundle.claimedCount++;
        }
        if (clusterSnapshot) {
            snapshot.claimedWeight += claimWeight;
            snapshot.claimedAmount += grossAmount;
            snapshot.frontendFeeClaimedAmount += reservedFrontendFee;
            if (!snapshot.firstClaimPaid) snapshot.firstClaimPaid = true;
        }
        bundle.claimedAmount += grossAmount;

        uint256 bundleRedirectedFrontendFee;
        (rewardAmount, frontendFee, frontendRecipient, bundleRedirectedFrontendFee) =
            QuestionRewardPoolEscrowTransferLib.settleClaimPayout(
                _rewardToken(lrepToken, usdcToken, bundle.asset),
                rewardRecipient,
                rewardAmount,
                frontendRecipient,
                frontendFee
            );
        if (clusterSnapshot && bundleRedirectedFrontendFee > 0) {
            snapshot.frontendFeeClaimedAmount -= bundleRedirectedFrontendFee;
            snapshot.frontendFeeAllocation -= bundleRedirectedFrontendFee;
        }

        emit QuestionBundleRewardClaimed(
            bundleId,
            roundSetIndex,
            rewardRecipient,
            identityKey,
            rewardAmount,
            frontend,
            frontendRecipient,
            frontendFee,
            grossAmount
        );
    }

    function qualifyRecoveredBundleRoundSet(
        mapping(uint256 => BundleReward) storage bundleRewards,
        mapping(uint256 => BundleQuestion[]) storage bundleQuestions,
        mapping(uint256 => mapping(uint256 => uint32)) storage bundleQuestionRecordedRounds,
        mapping(uint256 => mapping(uint256 => mapping(uint256 => uint64))) storage bundleRoundIds,
        mapping(uint256 => mapping(uint256 => BundleRoundSetSnapshot)) storage bundleRoundSetSnapshots,
        mapping(uint256 => address) storage bundleRewardClusterPayoutOracle,
        mapping(uint256 => mapping(uint256 => uint256)) storage bundleQuestionTerminalSyncCursor,
        mapping(uint256 => mapping(uint256 => mapping(bytes32 => bool))) storage qualifiedBundleRoundSetClaimants,
        ContentRegistry registry,
        RoundVotingEngine votingEngine,
        ProtocolConfig protocolConfig,
        uint8 payoutDomain,
        uint256 bundleId,
        uint256 roundSetIndex,
        uint256 recoveredAllocation
    ) internal returns (bool qualified) {
        BundleReward storage bundle = _getExistingBundleReward(bundleRewards, bundleId);
        if (bundleRoundSetSnapshots[bundleId][roundSetIndex].qualified) return true;
        if (roundSetIndex >= bundle.requiredSettledRounds) return false;
        if (!_isBundleRoundSetComplete(bundleQuestions, bundleQuestionRecordedRounds, bundleId, roundSetIndex)) {
            return false;
        }
        _qualifyBundleRoundSet(
            bundleRewards,
            bundleQuestions,
            bundleQuestionRecordedRounds,
            bundleRoundIds,
            bundleRoundSetSnapshots,
            bundleRewardClusterPayoutOracle,
            bundleQuestionTerminalSyncCursor,
            qualifiedBundleRoundSetClaimants,
            registry,
            votingEngine,
            protocolConfig,
            payoutDomain,
            bundleId,
            bundle,
            roundSetIndex,
            true,
            recoveredAllocation
        );
        return bundleRoundSetSnapshots[bundleId][roundSetIndex].qualified;
    }

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
        if (bundle.id == 0 || !_isBundleRoundSetClaimOpen(bundleRoundSetSnapshots, bundle, bundleId, roundSetIndex)) {
            return 0;
        }
        if (_usesClusterPayoutSnapshot(bundleRewardClusterPayoutOracle, bundle)) return 0;
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
                qualifiedBundleRoundSetClaimants, bundleId, roundSetIndex, firstCommitKey
            )) return 0;
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

    function refundQuestionBundleReward(
        mapping(uint256 => BundleReward) storage bundleRewards,
        mapping(uint256 => BundleQuestion[]) storage bundleQuestions,
        mapping(uint256 => mapping(uint256 => uint32)) storage bundleQuestionRecordedRounds,
        mapping(uint256 => mapping(uint256 => mapping(uint256 => uint64))) storage bundleRoundIds,
        mapping(uint256 => mapping(uint256 => BundleRoundSetSnapshot)) storage bundleRoundSetSnapshots,
        mapping(uint256 => address) storage bundleRewardClusterPayoutOracle,
        mapping(uint256 => mapping(uint256 => uint256)) storage bundleQuestionTerminalSyncCursor,
        mapping(uint256 => mapping(uint256 => mapping(bytes32 => bool))) storage qualifiedBundleRoundSetClaimants,
        mapping(uint256 => uint256) storage contentBundleId,
        mapping(uint256 => uint256) storage contentBundleIndex,
        ContentRegistry registry,
        RoundVotingEngine votingEngine,
        IERC20 lrepToken,
        IERC20 usdcToken,
        uint8 payoutDomain,
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
            bundleRewardClusterPayoutOracle,
            bundleQuestionTerminalSyncCursor,
            qualifiedBundleRoundSetClaimants,
            contentBundleId,
            contentBundleIndex,
            registry,
            votingEngine,
            votingEngine.protocolConfig(),
            payoutDomain,
            bundleId,
            BUNDLE_REFUND_SYNC_ROUND_LIMIT
        );
        require(syncComplete, "Sync pending");
        bool bundleRoundSetQualificationPending = _qualifyPendingBundleRoundSet(
            bundleRewards,
            bundleQuestions,
            bundleQuestionRecordedRounds,
            bundleRoundIds,
            bundleRoundSetSnapshots,
            bundleRewardClusterPayoutOracle,
            bundleQuestionTerminalSyncCursor,
            qualifiedBundleRoundSetClaimants,
            registry,
            votingEngine,
            votingEngine.protocolConfig(),
            payoutDomain,
            bundleId,
            bundle
        );
        if (bundleRoundSetQualificationPending) revert BundleClusterPayoutSnapshotPending();
        require(bundle.pendingRecoveredRoundSets == 0);
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
        mapping(uint256 => address) storage bundleRewardClusterPayoutOracle,
        mapping(uint256 => mapping(uint256 => uint256)) storage bundleQuestionTerminalSyncCursor,
        mapping(uint256 => mapping(uint256 => mapping(bytes32 => bool))) storage qualifiedBundleRoundSetClaimants,
        mapping(uint256 => uint256) storage contentBundleId,
        mapping(uint256 => uint256) storage contentBundleIndex,
        ContentRegistry registry,
        RoundVotingEngine votingEngine,
        ProtocolConfig protocolConfig,
        uint8 payoutDomain,
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
            bundleRewardClusterPayoutOracle,
            bundleQuestionTerminalSyncCursor,
            qualifiedBundleRoundSetClaimants,
            registry,
            votingEngine,
            protocolConfig,
            payoutDomain,
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
            (uint48 startTime, RoundLib.RoundState state,,,,, uint48 settledAt,) =
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
        mapping(uint256 => address) storage bundleRewardClusterPayoutOracle,
        mapping(uint256 => mapping(uint256 => uint256)) storage bundleQuestionTerminalSyncCursor,
        mapping(uint256 => mapping(uint256 => mapping(bytes32 => bool))) storage qualifiedBundleRoundSetClaimants,
        ContentRegistry registry,
        RoundVotingEngine votingEngine,
        ProtocolConfig protocolConfig,
        uint8 payoutDomain,
        uint256 bundleId,
        BundleReward storage bundle
    ) private returns (bool qualificationPending) {
        if (bundle.pendingRecoveredRoundSets != 0) return false;
        uint256 roundSetIndex = bundle.completedRoundSets;
        if (roundSetIndex >= bundle.requiredSettledRounds) return false;
        if (bundleRoundSetSnapshots[bundleId][roundSetIndex].qualified) return false;
        if (!_isBundleRoundSetComplete(bundleQuestions, bundleQuestionRecordedRounds, bundleId, roundSetIndex)) {
            return false;
        }
        return _qualifyBundleRoundSet(
            bundleRewards,
            bundleQuestions,
            bundleQuestionRecordedRounds,
            bundleRoundIds,
            bundleRoundSetSnapshots,
            bundleRewardClusterPayoutOracle,
            bundleQuestionTerminalSyncCursor,
            qualifiedBundleRoundSetClaimants,
            registry,
            votingEngine,
            protocolConfig,
            payoutDomain,
            bundleId,
            bundle,
            roundSetIndex,
            false,
            0
        );
    }

    function _qualifyBundleRoundSet(
        mapping(uint256 => BundleReward) storage,
        mapping(uint256 => BundleQuestion[]) storage bundleQuestions,
        mapping(uint256 => mapping(uint256 => uint32)) storage bundleQuestionRecordedRounds,
        mapping(uint256 => mapping(uint256 => mapping(uint256 => uint64))) storage bundleRoundIds,
        mapping(uint256 => mapping(uint256 => BundleRoundSetSnapshot)) storage bundleRoundSetSnapshots,
        mapping(uint256 => address) storage bundleRewardClusterPayoutOracle,
        mapping(uint256 => mapping(uint256 => uint256)) storage bundleQuestionTerminalSyncCursor,
        mapping(uint256 => mapping(uint256 => mapping(bytes32 => bool))) storage qualifiedBundleRoundSetClaimants,
        ContentRegistry registry,
        RoundVotingEngine votingEngine,
        ProtocolConfig protocolConfig,
        uint8 payoutDomain,
        uint256 bundleId,
        BundleReward storage bundle,
        uint256 roundSetIndex,
        bool recovered,
        uint256 recoveredAllocation
    ) private returns (bool qualificationPending) {
        if (bundleRoundSetSnapshots[bundleId][roundSetIndex].qualified) return false;
        if (!QuestionRewardPoolEscrowWindowLib.activateBundleWindowForRoundSet(
                votingEngine, bundle, bundleQuestions[bundleId], bundleRoundIds, bundleId, roundSetIndex
            )) {
            if (recovered) return false;
            QuestionRewardPoolEscrowBundleLib.resetRoundSet(
                bundleQuestions,
                bundleQuestionRecordedRounds,
                bundleRoundIds,
                bundleQuestionTerminalSyncCursor,
                bundleId,
                roundSetIndex
            );
            return false;
        }

        uint256 completerCount = _bundleRoundSetCompleterCount(
            bundleQuestions, bundleRoundIds, registry, votingEngine, protocolConfig, bundle, bundleId, roundSetIndex
        );
        if (completerCount < bundle.requiredCompleters) {
            if (recovered) return false;
            QuestionRewardPoolEscrowBundleLib.resetRoundSet(
                bundleQuestions,
                bundleQuestionRecordedRounds,
                bundleRoundIds,
                bundleQuestionTerminalSyncCursor,
                bundleId,
                roundSetIndex
            );
            return false;
        }

        bool clusterSnapshot = _usesClusterPayoutSnapshot(bundleRewardClusterPayoutOracle, bundle);
        uint256 effectiveParticipantUnits = completerCount;
        uint256 totalClaimWeight;
        bytes32 clusterWeightRoot;
        bytes32 clusterSnapshotDigest;
        uint64 correlationEpochId;
        if (clusterSnapshot) {
            (IClusterPayoutOracle.RoundPayoutSnapshot memory payoutSnapshot, bool snapshotReady) = _finalizedBundlePayoutSnapshot(
                bundleQuestions,
                bundleRoundIds,
                bundleRewardClusterPayoutOracle,
                votingEngine,
                bundleId,
                roundSetIndex,
                payoutDomain
            );
            if (!snapshotReady) return true;
            require(payoutSnapshot.rawEligibleVoters == completerCount, "Cluster snapshot mismatch");
            effectiveParticipantUnits = payoutSnapshot.effectiveParticipantUnits;
            totalClaimWeight = payoutSnapshot.totalClaimWeight;
            uint256 minEffectiveUnits =
                bundle.requiredCompleters > MIN_REQUIRED_VOTERS ? bundle.requiredCompleters : MIN_REQUIRED_VOTERS;
            if (
                completerCount < bundle.requiredCompleters || effectiveParticipantUnits < minEffectiveUnits * BPS_SCALE
                    || totalClaimWeight == 0
            ) {
                if (recovered) return false;
                QuestionRewardPoolEscrowBundleLib.resetRoundSet(
                    bundleQuestions,
                    bundleQuestionRecordedRounds,
                    bundleRoundIds,
                    bundleQuestionTerminalSyncCursor,
                    bundleId,
                    roundSetIndex
                );
                return false;
            }
            address oracleAddr = bundleRewardClusterPayoutOracle[bundleId];
            clusterWeightRoot = payoutSnapshot.weightRoot;
            clusterSnapshotDigest =
                IClusterPayoutOracle(oracleAddr).roundPayoutSnapshotProposalDigest(payoutSnapshot.snapshotKey);
            correlationEpochId = payoutSnapshot.correlationEpochId;
        }

        uint256 allocation = recovered ? recoveredAllocation : _previewBundleRoundSetAllocation(bundle);
        uint256 allocationFloor = clusterSnapshot ? effectiveParticipantUnits : completerCount;
        if (allocation == 0 || allocation > bundle.unallocatedAmount || allocation < allocationFloor) {
            if (recovered) return false;
            QuestionRewardPoolEscrowBundleLib.resetRoundSet(
                bundleQuestions,
                bundleQuestionRecordedRounds,
                bundleRoundIds,
                bundleQuestionTerminalSyncCursor,
                bundleId,
                roundSetIndex
            );
            return false;
        }
        uint256 frontendFeeAllocation = (allocation * bundle.frontendFeeBps) / BPS_SCALE;

        if (!recovered) {
            unchecked {
                bundle.completedRoundSets++;
            }
        } else if (block.timestamp > bundle.claimDeadline) {
            bundle.claimDeadline = block.timestamp.toUint64();
        }
        bundle.unallocatedAmount -= allocation;

        bundleRoundSetSnapshots[bundleId][roundSetIndex] = BundleRoundSetSnapshot({
            qualified: true,
            claimedCount: 0,
            // FE-5 (2026-05-20 follow-up audit): use SafeCast.toUint32 for consistency with the
            // rest of the codebase. completerCount is currently bounded by uint16 commitCount so
            // the cast is sound, but raw uint32(x) bypasses the project's safe-cast policy.
            eligibleCompleters: effectiveParticipantUnits.toUint32(),
            rawEligibleCompleters: completerCount.toUint32(),
            allocation: allocation,
            frontendFeeAllocation: frontendFeeAllocation,
            totalClaimWeight: totalClaimWeight,
            claimedWeight: 0,
            claimedAmount: 0,
            frontendFeeClaimedAmount: 0,
            firstClaimPaid: false,
            clusterWeightRoot: clusterWeightRoot,
            clusterSnapshotDigest: clusterSnapshotDigest
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
        if (clusterSnapshot) {
            emit QuestionBundleRoundSetCorrelationSnapshotApplied(
                bundleId,
                roundSetIndex,
                correlationEpochId,
                completerCount,
                effectiveParticipantUnits,
                totalClaimWeight,
                clusterWeightRoot
            );
        }
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
        (,, uint16 commitCount,,,,,) = votingEngine.roundCore(firstContentId, firstRoundId);
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
        mapping(uint256 => mapping(uint256 => mapping(bytes32 => bool))) storage qualifiedBundleRoundSetClaimants,
        uint256 bundleId,
        uint256 roundSetIndex,
        bytes32 firstCommitKey
    ) private view returns (bool) {
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
        if (voter == address(0)) return false;
        if (_isBundleCompleterBanned(
                bundleQuestions, bundleRoundIds, votingEngine, protocolConfig, bundleId, roundSetIndex, voter
            )) {
            return false;
        }
        return !_isBundleExcludedVoter(
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

    function _usesClusterPayoutSnapshot(
        mapping(uint256 => address) storage bundleRewardClusterPayoutOracle,
        BundleReward storage bundle
    ) private view returns (bool) {
        return bundleRewardClusterPayoutOracle[bundle.id] != address(0);
    }

    function _bundleSnapshotRoundId(uint256 roundSetIndex) private pure returns (uint256) {
        return roundSetIndex + 1;
    }

    function _finalizedBundlePayoutSnapshot(
        mapping(uint256 => BundleQuestion[]) storage bundleQuestions,
        mapping(
            uint256
                => mapping(
                uint256 => mapping(uint256 => uint64)
            )
        ) storage bundleRoundIds,
        mapping(uint256 => address) storage bundleRewardClusterPayoutOracle,
        RoundVotingEngine votingEngine,
        uint256 bundleId,
        uint256 roundSetIndex,
        uint8 payoutDomain
    ) private view returns (IClusterPayoutOracle.RoundPayoutSnapshot memory payoutSnapshot, bool ready) {
        address oracleAddr = bundleRewardClusterPayoutOracle[bundleId];
        require(oracleAddr != address(0), "Oracle not pinned");
        IClusterPayoutOracle oracle = IClusterPayoutOracle(oracleAddr);
        uint256 snapshotRoundId = _bundleSnapshotRoundId(roundSetIndex);
        try oracle.getRoundPayoutSnapshot(payoutDomain, bundleId, bundleId, snapshotRoundId) returns (
            IClusterPayoutOracle.RoundPayoutSnapshot memory snapshot
        ) {
            payoutSnapshot = snapshot;
            ready = snapshot.status == IClusterPayoutOracle.SnapshotStatus.Finalized
                && (snapshot.totalClaimWeight == 0 || snapshot.weightRoot != bytes32(0));
            if (ready) {
                uint64 sourceReadyAt = _bundlePayoutSnapshotSourceReadyAt(
                    bundleQuestions, bundleRoundIds, votingEngine, bundleId, roundSetIndex
                );
                ready = sourceReadyAt != 0
                    && oracle.roundPayoutSnapshotConsumerFor(payoutDomain, bundleId, bundleId, snapshotRoundId)
                        == address(this)
                    && oracle.roundPayoutSnapshotProposedAt(payoutDomain, bundleId, bundleId, snapshotRoundId)
                        >= sourceReadyAt;
            }
        } catch {
            ready = false;
        }
    }

    function _bundlePayoutSnapshotSourceReadyAt(
        mapping(uint256 => BundleQuestion[]) storage bundleQuestions,
        mapping(
            uint256
                => mapping(
                uint256 => mapping(uint256 => uint64)
            )
        ) storage bundleRoundIds,
        RoundVotingEngine votingEngine,
        uint256 bundleId,
        uint256 roundSetIndex
    ) private view returns (uint64 readyAt) {
        BundleQuestion[] storage questions = bundleQuestions[bundleId];
        for (uint256 i; i < questions.length;) {
            uint256 questionRoundId = bundleRoundIds[bundleId][i][roundSetIndex];
            if (questionRoundId == 0) return 0;
            (,,, uint48 questionReadyAt) = votingEngine.roundLifecycleState(questions[i].contentId, questionRoundId);
            if (questionReadyAt == 0) return 0;
            if (questionReadyAt > readyAt) readyAt = questionReadyAt;
            unchecked {
                ++i;
            }
        }
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
        IClusterPayoutOracle.PayoutWeight memory payoutWeight,
        bytes32[] memory proof,
        uint8 payoutDomain,
        bool hasCorrelationProof
    ) private view returns (uint256) {
        require(hasCorrelationProof, "Cluster proof required");
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
        if (cursor == 0) return votingEngine.nextRoundIdForContent(contentId);
        (uint48 startTime, RoundLib.RoundState state,,,,,,) = votingEngine.roundCore(contentId, cursor);
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
