// SPDX-License-Identifier: MIT
pragma solidity ^0.8.34;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeCast } from "@openzeppelin/contracts/utils/math/SafeCast.sol";

import { ContentRegistry } from "../ContentRegistry.sol";
import { IClusterPayoutOracle } from "../interfaces/IClusterPayoutOracle.sol";
import { ProtocolConfig } from "../ProtocolConfig.sol";
import { RoundVotingEngine } from "../RoundVotingEngine.sol";
import { QuestionRewardPoolEscrowEligibilityLib } from "./QuestionRewardPoolEscrowEligibilityLib.sol";
import { QuestionRewardPoolEscrowQualificationLib } from "./QuestionRewardPoolEscrowQualificationLib.sol";
import { QuestionRewardPoolEscrowTransferLib } from "./QuestionRewardPoolEscrowTransferLib.sol";
import { QuestionRewardPoolEscrowVoterLib } from "./QuestionRewardPoolEscrowVoterLib.sol";
import { QuestionRewardPoolEscrowWindowLib } from "./QuestionRewardPoolEscrowWindowLib.sol";
import { QuestionRewardParticipantFloorLib } from "./QuestionRewardParticipantFloorLib.sol";
import {
    RewardPool,
    RoundSnapshot,
    CreateRewardPoolParams,
    QUESTION_REWARD_CLAIM_GRACE
} from "./QuestionRewardPoolEscrowTypes.sol";
import { RoundLib } from "./RoundLib.sol";

library QuestionRewardPoolEscrowPoolActionsLib {
    using SafeCast for uint256;

    uint256 internal constant MIN_REQUIRED_VOTERS = 3;
    uint256 internal constant MIN_REQUIRED_SETTLED_ROUNDS = 1;
    uint256 internal constant MAX_REQUIRED_SETTLED_ROUNDS = 16;
    uint256 internal constant MAX_REWARD_POOL_ROUND_VOTERS = 200;
    uint256 internal constant BPS_SCALE = 10_000;
    uint8 internal constant REWARD_ASSET_LREP = 0;
    uint8 internal constant REWARD_ASSET_USDC = 1;
    uint8 internal constant PAYOUT_DOMAIN_QUESTION_REWARD = 1;

    error RecoveredRoundPending();
    error RecoveredReplacementSnapshotAvailable();
    error PreQualificationRejectedRoundPending();
    error PreQualificationRejectedReplacementSnapshotAvailable();

    event RewardPoolCreated(
        uint256 indexed rewardPoolId,
        uint256 indexed contentId,
        address indexed funder,
        bytes32 funderIdentityKey,
        address payerIdentity,
        bytes32 payerIdentityKey,
        address submitterIdentity,
        bytes32 submitterIdentityKey,
        uint256 amount,
        uint256 requiredVoters,
        uint256 requiredSettledRounds,
        uint256 startRoundId,
        uint256 bountyStartBy,
        uint256 bountyWindowSeconds,
        uint256 feedbackWindowSeconds,
        uint256 frontendFeeBps,
        uint8 asset,
        uint8 bountyEligibility,
        bytes32 bountyEligibilityDataHash,
        bool nonRefundable
    );
    event RewardPoolPurposeSet(
        uint256 indexed rewardPoolId, uint8 indexed bountyKind, uint256 indexed challengedRoundId, bytes32 reasonHash
    );
    event RewardPoolEligibilitySet(uint256 indexed rewardPoolId, uint8 indexed bountyEligibility);
    event RewardPoolClusterPayoutOracleSnapshotted(uint256 indexed rewardPoolId, address indexed clusterPayoutOracle);
    event RecoveredSnapshotRoundAbandoned(
        uint256 indexed rewardPoolId, uint256 indexed contentId, uint256 indexed roundId, uint256 allocation
    );
    event PreQualificationRejectedSnapshotRoundAbandoned(
        uint256 indexed rewardPoolId, uint256 indexed contentId, uint256 indexed roundId
    );

    function createRewardPool(
        mapping(uint256 => RewardPool) storage rewardPools,
        mapping(uint256 => address) storage rewardPoolPayerIdentity,
        mapping(uint256 => bytes32) storage rewardPoolPayerIdentityKey,
        ContentRegistry registry,
        RoundVotingEngine votingEngine,
        IERC20 lrepToken,
        IERC20 usdcToken,
        uint16 defaultFrontendFeeBps,
        uint256 nextRewardPoolId,
        CreateRewardPoolParams memory params
    ) external returns (uint256 rewardPoolId, uint256 updatedNextRewardPoolId) {
        uint256 fundedAmount = QuestionRewardPoolEscrowTransferLib.pullExactToken(
                _rewardToken(lrepToken, usdcToken, params.asset), params.funder, params.amount
            );

        rewardPoolId = nextRewardPoolId;
        updatedNextRewardPoolId = nextRewardPoolId + 1;
        _storeRewardPool(
            rewardPools,
            rewardPoolPayerIdentity,
            rewardPoolPayerIdentityKey,
            registry,
            votingEngine,
            defaultFrontendFeeBps,
            rewardPoolId,
            fundedAmount,
            params
        );

        if (params.bountyKind != 0) {
            _setRewardPoolPurpose(
                rewardPools, rewardPoolId, params.bountyKind, params.relatedRoundId, params.reasonHash
            );
        }
    }

    function snapshotRewardPoolClusterPayoutOracle(
        mapping(uint256 => address) storage rewardPoolClusterPayoutOracle,
        mapping(uint256 => uint64) storage rewardPoolClusterPayoutOraclePinnedAt,
        RoundVotingEngine votingEngine,
        uint256 rewardPoolId,
        uint8 asset,
        address expectedConsumer
    ) external {
        if (asset != REWARD_ASSET_LREP && asset != REWARD_ASSET_USDC) return;
        address clusterPayoutOracle = votingEngine.protocolConfig().clusterPayoutOracle();
        if (clusterPayoutOracle == address(0)) return;
        try IClusterPayoutOracle(clusterPayoutOracle)
            .roundPayoutSnapshotConsumer(PAYOUT_DOMAIN_QUESTION_REWARD) returns (
            address consumer
        ) {
            require(consumer == expectedConsumer, "Oracle consumer mismatch");
        } catch {
            revert("Invalid oracle");
        }
        rewardPoolClusterPayoutOracle[rewardPoolId] = clusterPayoutOracle;
        rewardPoolClusterPayoutOraclePinnedAt[rewardPoolId] = uint64(block.timestamp);
        emit RewardPoolClusterPayoutOracleSnapshotted(rewardPoolId, clusterPayoutOracle);
    }

    function refundExpiredRewardPool(
        mapping(uint256 => RewardPool) storage rewardPools,
        RoundVotingEngine votingEngine,
        IERC20 lrepToken,
        IERC20 usdcToken,
        uint256 rewardPoolId
    ) external returns (uint256 refundAmount) {
        RewardPool storage rewardPool = _getExistingRewardPool(rewardPools, rewardPoolId);
        _requireNoPendingRecoveredRounds(rewardPool);
        _requireNoPendingPreQualificationRejectedRounds(rewardPool);
        if (rewardPool.qualifiedRounds >= rewardPool.requiredSettledRounds || rewardPool.unallocatedRefunded) {
            return _refundCompleteRewardPool(
                votingEngine, lrepToken, usdcToken, rewardPoolId, rewardPool, QUESTION_REWARD_CLAIM_GRACE
            );
        }

        QuestionRewardPoolEscrowWindowLib.activateRewardPoolWindowForRound(
            votingEngine, rewardPool, rewardPool.nextRoundToEvaluate
        );
        (bool expired, uint64 bountyClosesAt) = QuestionRewardPoolEscrowWindowLib.rewardPoolExpired(rewardPool);
        require(expired, "Not expired");
        return
            _refundUnallocatedRewardPool(votingEngine, lrepToken, usdcToken, rewardPoolId, rewardPool, bountyClosesAt);
    }

    function refundInactiveRewardPool(
        mapping(uint256 => RewardPool) storage rewardPools,
        ContentRegistry registry,
        RoundVotingEngine votingEngine,
        IERC20 lrepToken,
        IERC20 usdcToken,
        uint256 rewardPoolId
    ) external returns (uint256 refundAmount) {
        RewardPool storage rewardPool = _getExistingRewardPool(rewardPools, rewardPoolId);
        _requireNoPendingRecoveredRounds(rewardPool);
        _requireNoPendingPreQualificationRejectedRounds(rewardPool);
        require(!registry.isContentActive(rewardPool.contentId), "Content active");
        require(block.timestamp > registry.dormantKeyReleasableAt(rewardPool.contentId), "Revival active");
        QuestionRewardPoolEscrowWindowLib.activateRewardPoolWindowForRound(
            votingEngine, rewardPool, rewardPool.nextRoundToEvaluate
        );
        return _refundUnallocatedRewardPool(
            votingEngine, lrepToken, usdcToken, rewardPoolId, rewardPool, rewardPool.bountyClosesAt
        );
    }

    function refundExpiredRecoveredRewardPool(
        mapping(uint256 => RewardPool) storage rewardPools,
        mapping(uint256 => address) storage rewardPoolPayerIdentity,
        mapping(uint256 => bytes32) storage rewardPoolPayerIdentityKey,
        mapping(uint256 => mapping(uint256 => RoundSnapshot)) storage roundSnapshots,
        mapping(uint256 => mapping(uint256 => bool)) storage rejectedRecoveredRound,
        mapping(uint256 => mapping(uint256 => bool)) storage reopenedRecoveredRound,
        mapping(uint256 => address) storage rewardPoolClusterPayoutOracle,
        mapping(uint256 => uint64) storage rewardPoolClusterPayoutOraclePinnedAt,
        RoundVotingEngine votingEngine,
        IERC20 lrepToken,
        IERC20 usdcToken,
        uint256 rewardPoolId,
        uint256[] calldata roundIds
    ) external returns (uint256 refundAmount) {
        RewardPool storage rewardPool = _getExistingRewardPool(rewardPools, rewardPoolId);
        _requireNoPendingPreQualificationRejectedRounds(rewardPool);
        bool completeRecoveredExit = uint256(rewardPool.qualifiedRounds) + uint256(rewardPool.pendingRecoveredRounds)
                >= uint256(rewardPool.requiredSettledRounds) || rewardPool.unallocatedRefunded;
        _requireRecoveredRefundGrace(rewardPool, QUESTION_REWARD_CLAIM_GRACE);
        _abandonRecoveredRounds(
            rewardPool,
            rewardPoolPayerIdentity,
            rewardPoolPayerIdentityKey,
            roundSnapshots,
            rejectedRecoveredRound,
            reopenedRecoveredRound,
            rewardPoolClusterPayoutOracle,
            rewardPoolClusterPayoutOraclePinnedAt,
            votingEngine,
            rewardPoolId,
            roundIds,
            QUESTION_REWARD_CLAIM_GRACE,
            PAYOUT_DOMAIN_QUESTION_REWARD
        );
        if (completeRecoveredExit) {
            rewardPool.unallocatedAmount = 0;
            return _refundCompleteRewardPool(
                votingEngine, lrepToken, usdcToken, rewardPoolId, rewardPool, QUESTION_REWARD_CLAIM_GRACE
            );
        }

        QuestionRewardPoolEscrowWindowLib.activateRewardPoolWindowForRound(
            votingEngine, rewardPool, rewardPool.nextRoundToEvaluate
        );
        (bool expired, uint64 bountyClosesAt) = QuestionRewardPoolEscrowWindowLib.rewardPoolExpired(rewardPool);
        require(expired, "Not expired");
        return
            _refundUnallocatedRewardPool(votingEngine, lrepToken, usdcToken, rewardPoolId, rewardPool, bountyClosesAt);
    }

    function refundInactiveRecoveredRewardPool(
        mapping(uint256 => RewardPool) storage rewardPools,
        mapping(uint256 => address) storage rewardPoolPayerIdentity,
        mapping(uint256 => bytes32) storage rewardPoolPayerIdentityKey,
        mapping(uint256 => mapping(uint256 => RoundSnapshot)) storage roundSnapshots,
        mapping(uint256 => mapping(uint256 => bool)) storage rejectedRecoveredRound,
        mapping(uint256 => mapping(uint256 => bool)) storage reopenedRecoveredRound,
        mapping(uint256 => address) storage rewardPoolClusterPayoutOracle,
        mapping(uint256 => uint64) storage rewardPoolClusterPayoutOraclePinnedAt,
        ContentRegistry registry,
        RoundVotingEngine votingEngine,
        IERC20 lrepToken,
        IERC20 usdcToken,
        uint256 rewardPoolId,
        uint256[] calldata roundIds
    ) external returns (uint256 refundAmount) {
        RewardPool storage rewardPool = _getExistingRewardPool(rewardPools, rewardPoolId);
        _requireNoPendingPreQualificationRejectedRounds(rewardPool);
        require(!registry.isContentActive(rewardPool.contentId), "Content active");
        require(block.timestamp > registry.dormantKeyReleasableAt(rewardPool.contentId), "Revival active");
        _abandonRecoveredRounds(
            rewardPool,
            rewardPoolPayerIdentity,
            rewardPoolPayerIdentityKey,
            roundSnapshots,
            rejectedRecoveredRound,
            reopenedRecoveredRound,
            rewardPoolClusterPayoutOracle,
            rewardPoolClusterPayoutOraclePinnedAt,
            votingEngine,
            rewardPoolId,
            roundIds,
            QUESTION_REWARD_CLAIM_GRACE,
            PAYOUT_DOMAIN_QUESTION_REWARD
        );
        QuestionRewardPoolEscrowWindowLib.activateRewardPoolWindowForRound(
            votingEngine, rewardPool, rewardPool.nextRoundToEvaluate
        );
        return _refundUnallocatedRewardPool(
            votingEngine, lrepToken, usdcToken, rewardPoolId, rewardPool, rewardPool.bountyClosesAt
        );
    }

    function refundPreQualificationRejectedRewardPool(
        mapping(uint256 => RewardPool) storage rewardPools,
        mapping(uint256 => address) storage rewardPoolPayerIdentity,
        mapping(uint256 => bytes32) storage rewardPoolPayerIdentityKey,
        mapping(uint256 => mapping(uint256 => bool)) storage preQualificationRejectedRound,
        mapping(uint256 => address) storage rewardPoolClusterPayoutOracle,
        mapping(uint256 => uint64) storage rewardPoolClusterPayoutOraclePinnedAt,
        ContentRegistry registry,
        RoundVotingEngine votingEngine,
        IERC20 lrepToken,
        IERC20 usdcToken,
        uint256 rewardPoolId,
        uint256[] calldata roundIds,
        bool inactive
    ) external returns (uint256 refundAmount) {
        RewardPool storage rewardPool = _getExistingRewardPool(rewardPools, rewardPoolId);
        _requireNoPendingRecoveredRounds(rewardPool);
        if (inactive) {
            require(!registry.isContentActive(rewardPool.contentId), "Content active");
            require(block.timestamp > registry.dormantKeyReleasableAt(rewardPool.contentId), "Revival active");
        } else {
            _requireExpiredPreQualificationRefund(votingEngine, rewardPool);
        }
        _abandonPreQualificationRejectedRounds(
            rewardPool,
            rewardPoolPayerIdentity,
            rewardPoolPayerIdentityKey,
            preQualificationRejectedRound,
            rewardPoolClusterPayoutOracle,
            rewardPoolClusterPayoutOraclePinnedAt,
            votingEngine,
            rewardPoolId,
            roundIds,
            PAYOUT_DOMAIN_QUESTION_REWARD
        );
        if (rewardPool.pendingPreQualificationRejectedRounds != 0) return 0;
        if (
            !inactive
                && (rewardPool.qualifiedRounds >= rewardPool.requiredSettledRounds || rewardPool.unallocatedRefunded)
        ) {
            return _refundCompleteRewardPool(
                votingEngine, lrepToken, usdcToken, rewardPoolId, rewardPool, QUESTION_REWARD_CLAIM_GRACE
            );
        }

        if (!inactive) {
            (bool expired, uint64 bountyClosesAt) = QuestionRewardPoolEscrowWindowLib.rewardPoolExpired(rewardPool);
            require(expired, "Not expired");
            return _refundUnallocatedRewardPool(
                votingEngine, lrepToken, usdcToken, rewardPoolId, rewardPool, bountyClosesAt
            );
        }
        return _refundUnallocatedRewardPool(
            votingEngine, lrepToken, usdcToken, rewardPoolId, rewardPool, rewardPool.bountyClosesAt
        );
    }

    function _storeRewardPool(
        mapping(uint256 => RewardPool) storage rewardPools,
        mapping(uint256 => address) storage rewardPoolPayerIdentity,
        mapping(uint256 => bytes32) storage rewardPoolPayerIdentityKey,
        ContentRegistry registry,
        RoundVotingEngine votingEngine,
        uint16 defaultFrontendFeeBps,
        uint256 rewardPoolId,
        uint256 fundedAmount,
        CreateRewardPoolParams memory params
    ) private {
        _validateStoreInputs(registry, fundedAmount, params);

        uint256 normalizedFeedbackWindowSeconds = QuestionRewardPoolEscrowWindowLib.validateWindow(
            params.bountyStartBy, params.bountyWindowSeconds, params.feedbackWindowSeconds, params.nonRefundable
        );
        uint256 startRoundId = _nextStartRoundId(votingEngine, params.contentId);
        ProtocolConfig protocolConfig = votingEngine.protocolConfig();

        (address funderIdentity, bytes32 funderIdentityKey) = _resolveFunderIdentity(protocolConfig, params.funder);
        address effectivePayer = params.payer == address(0) ? params.funder : params.payer;
        (address payerIdentity, bytes32 payerIdentityKey) = _resolveFunderIdentity(protocolConfig, effectivePayer);
        (address submitterIdentity, bytes32 submitterIdentityKey) =
            _resolveSubmitterIdentity(registry, protocolConfig, params.contentId);

        RewardPool storage pool = rewardPools[rewardPoolId];
        pool.id = rewardPoolId.toUint64();
        pool.contentId = params.contentId.toUint64();
        pool.startRoundId = startRoundId.toUint64();
        pool.nextRoundToEvaluate = startRoundId.toUint64();
        pool.bountyStartBy = params.bountyStartBy.toUint64();
        pool.bountyOpensAt = uint64(block.timestamp);
        if (params.nonRefundable && params.bountyWindowSeconds != 0) {
            pool.bountyClosesAt = params.bountyStartBy.toUint64();
            pool.feedbackClosesAt = params.bountyStartBy.toUint64();
            pool.claimDeadline = params.bountyStartBy.toUint64();
        }
        pool.bountyWindowSeconds = params.bountyWindowSeconds.toUint32();
        pool.feedbackWindowSeconds = normalizedFeedbackWindowSeconds.toUint32();
        pool.funder = params.funder;
        pool.funderIdentity = funderIdentity;
        pool.submitterIdentity = submitterIdentity;
        pool.funderIdentityKey = funderIdentityKey;
        pool.submitterIdentityKey = submitterIdentityKey;
        pool.asset = params.asset;
        pool.fundedAmount = fundedAmount;
        pool.unallocatedAmount = fundedAmount;
        pool.requiredVoters = uint32(params.requiredVoters);
        pool.requiredSettledRounds = uint32(params.requiredSettledRounds);
        pool.frontendFeeBps = defaultFrontendFeeBps;
        pool.bountyEligibility = params.bountyEligibility;
        pool.nonRefundable = params.nonRefundable;
        pool.bountyEligibilityDataHash = QuestionRewardPoolEscrowEligibilityLib.eligibilityDataHash();
        rewardPoolPayerIdentity[rewardPoolId] = payerIdentity;
        rewardPoolPayerIdentityKey[rewardPoolId] = payerIdentityKey;

        emit RewardPoolCreated(
            rewardPoolId,
            params.contentId,
            params.funder,
            funderIdentityKey,
            payerIdentity,
            payerIdentityKey,
            submitterIdentity,
            submitterIdentityKey,
            fundedAmount,
            params.requiredVoters,
            params.requiredSettledRounds,
            startRoundId,
            params.bountyStartBy,
            params.bountyWindowSeconds,
            normalizedFeedbackWindowSeconds,
            defaultFrontendFeeBps,
            params.asset,
            params.bountyEligibility,
            pool.bountyEligibilityDataHash,
            params.nonRefundable
        );
        emit RewardPoolEligibilitySet(rewardPoolId, params.bountyEligibility);
        if (params.nonRefundable && params.bountyWindowSeconds != 0) {
            emit QuestionRewardPoolEscrowWindowLib.RewardPoolWindowActivated(
                rewardPoolId,
                params.contentId,
                startRoundId,
                block.timestamp,
                params.bountyStartBy,
                params.bountyStartBy
            );
        }
    }

    function _validateStoreInputs(ContentRegistry registry, uint256 fundedAmount, CreateRewardPoolParams memory params)
        private
        view
    {
        require(fundedAmount > 0, "Amount required");
        require(params.asset == REWARD_ASSET_LREP || params.asset == REWARD_ASSET_USDC, "Invalid asset");
        require(QuestionRewardPoolEscrowEligibilityLib.isValidPolicy(params.bountyEligibility), "Invalid eligibility");
        require(registry.isContentActive(params.contentId), "Content not active");
        if (params.nonRefundable) require(params.bountyWindowSeconds != 0, "Bounty window required");
        require(params.requiredVoters >= MIN_REQUIRED_VOTERS, "Too few voters");
        require(params.requiredVoters >= _requiredParticipantFloorForAmount(fundedAmount), "High-value floor");
        require(params.requiredSettledRounds == MIN_REQUIRED_SETTLED_ROUNDS, "One round only");
        RoundLib.RoundConfig memory contentCfg = registry.getContentRoundConfig(params.contentId);
        require(params.requiredVoters == contentCfg.minVoters, "Voters mismatch");
        require(params.requiredVoters <= contentCfg.maxVoters, "Voters exceed max");
        require(contentCfg.maxVoters <= MAX_REWARD_POOL_ROUND_VOTERS, "Voters exceed max");
        require(
            fundedAmount >= params.requiredSettledRounds * uint256(contentCfg.maxVoters) * BPS_SCALE, "Amount too small"
        );
    }

    function _nextStartRoundId(RoundVotingEngine votingEngine, uint256 contentId) private view returns (uint256) {
        uint256 currentRoundId = votingEngine.currentRoundId(contentId);
        return currentRoundId == 0 ? votingEngine.nextRoundIdForContent(contentId) : currentRoundId;
    }

    function _resolveSubmitterIdentity(ContentRegistry registry, ProtocolConfig protocolConfig, uint256 contentId)
        private
        view
        returns (address submitterIdentity, bytes32 submitterIdentityKey)
    {
        submitterIdentity = registry.getSubmitterIdentity(contentId);
        submitterIdentityKey = registry.contentSubmitterIdentityKey(contentId);
        if (submitterIdentityKey == bytes32(0) && submitterIdentity != address(0)) {
            submitterIdentityKey =
                QuestionRewardPoolEscrowVoterLib.identityKeyForCurrentRater(protocolConfig, submitterIdentity);
        }
    }

    function _setRewardPoolPurpose(
        mapping(uint256 => RewardPool) storage rewardPools,
        uint256 rewardPoolId,
        uint8 bountyKind,
        uint256 challengedRoundId,
        bytes32 reasonHash
    ) private {
        require(bountyKind == 1 || bountyKind == 2, "Invalid bounty kind");
        require(challengedRoundId != 0, "Invalid round");

        RewardPool storage rewardPool = rewardPools[rewardPoolId];
        require(rewardPool.id != 0, "Bounty not found");
        rewardPool.bountyKind = bountyKind;
        rewardPool.challengedRoundId = challengedRoundId.toUint64();
        rewardPool.reasonHash = reasonHash;

        emit RewardPoolPurposeSet(rewardPoolId, bountyKind, challengedRoundId, reasonHash);
    }

    function _refundUnallocatedRewardPool(
        RoundVotingEngine votingEngine,
        IERC20 lrepToken,
        IERC20 usdcToken,
        uint256 rewardPoolId,
        RewardPool storage rewardPool,
        uint64 bountyClosesAt
    ) private returns (uint256 refundAmount) {
        require(!rewardPool.refunded, "Already refunded");
        require(!rewardPool.unallocatedRefunded, "Already refunded");
        require(rewardPool.qualifiedRounds < rewardPool.requiredSettledRounds, "Bounty complete");
        // Always enforce this: a finished cursor round must be advanced/qualified before refunding, even
        // when the window never activated (bountyClosesAt == 0). Gating this on bountyClosesAt != 0 let an
        // empty leading round skip the check and drain funds owed to a later qualifiable round's voters.
        QuestionRewardPoolEscrowQualificationLib.requireNoPendingFinishedRound(
            votingEngine, rewardPool.contentId, rewardPool.nextRoundToEvaluate, rewardPool.bountyOpensAt, bountyClosesAt
        );
        refundAmount = rewardPool.unallocatedAmount;
        require(refundAmount > 0, "No refund");
        rewardPool.unallocatedRefunded = true;
        rewardPool.unallocatedAmount = 0;
        rewardPool.fundedAmount -= refundAmount;
        _transferRewardPoolResidue(votingEngine, lrepToken, usdcToken, rewardPoolId, rewardPool, refundAmount);
    }

    function _requireNoPendingRecoveredRounds(RewardPool storage rewardPool) private view {
        if (rewardPool.pendingRecoveredRounds != 0) revert RecoveredRoundPending();
    }

    function _requireNoPendingPreQualificationRejectedRounds(RewardPool storage rewardPool) private view {
        if (rewardPool.pendingPreQualificationRejectedRounds != 0) {
            revert PreQualificationRejectedRoundPending();
        }
    }

    function _requireRecoveredRefundGrace(RewardPool storage rewardPool, uint256 claimGrace) private view {
        uint256 claimDeadline = rewardPool.claimDeadline;
        require(claimDeadline != 0, "Grace");
        require(block.timestamp > claimDeadline + claimGrace, "Grace");
    }

    function _abandonRecoveredRounds(
        RewardPool storage rewardPool,
        mapping(uint256 => address) storage rewardPoolPayerIdentity,
        mapping(uint256 => bytes32) storage rewardPoolPayerIdentityKey,
        mapping(uint256 => mapping(uint256 => RoundSnapshot)) storage roundSnapshots,
        mapping(uint256 => mapping(uint256 => bool)) storage rejectedRecoveredRound,
        mapping(uint256 => mapping(uint256 => bool)) storage reopenedRecoveredRound,
        mapping(uint256 => address) storage rewardPoolClusterPayoutOracle,
        mapping(uint256 => uint64) storage rewardPoolClusterPayoutOraclePinnedAt,
        RoundVotingEngine votingEngine,
        uint256 rewardPoolId,
        uint256[] calldata roundIds,
        uint256 claimGrace,
        uint8 payoutDomain
    ) private {
        uint256 pendingRecoveredRounds = rewardPool.pendingRecoveredRounds;
        require(pendingRecoveredRounds != 0, "Recovered round pending");
        require(roundIds.length != 0, "Round required");
        address oracleAddr = rewardPoolClusterPayoutOracle[rewardPoolId];
        uint64 pinnedAt = rewardPoolClusterPayoutOraclePinnedAt[rewardPoolId];

        for (uint256 i = 0; i < roundIds.length;) {
            uint256 roundId = roundIds[i];
            require(rejectedRecoveredRound[rewardPoolId][roundId], "Round not recovered");
            if (reopenedRecoveredRound[rewardPoolId][roundId]) {
                _requireRecoveredRefundGrace(rewardPool, claimGrace);
            } else if (_hasRecoveredReplacementSnapshot(
                    rewardPoolPayerIdentity,
                    rewardPoolPayerIdentityKey,
                    rewardPoolClusterPayoutOracle,
                    rewardPoolClusterPayoutOraclePinnedAt,
                    oracleAddr,
                    pinnedAt,
                    votingEngine,
                    rewardPool,
                    rewardPoolId,
                    roundId,
                    payoutDomain
                )) {
                revert RecoveredReplacementSnapshotAvailable();
            }
            RoundSnapshot storage snapshot = roundSnapshots[rewardPoolId][roundId];
            require(!snapshot.qualified, "Round qualified");
            uint256 allocation = snapshot.allocation;

            delete roundSnapshots[rewardPoolId][roundId];
            rejectedRecoveredRound[rewardPoolId][roundId] = false;
            reopenedRecoveredRound[rewardPoolId][roundId] = false;
            unchecked {
                --pendingRecoveredRounds;
                ++i;
            }
            emit RecoveredSnapshotRoundAbandoned(rewardPoolId, rewardPool.contentId, roundId, allocation);
        }

        rewardPool.pendingRecoveredRounds = pendingRecoveredRounds.toUint32();
        _requireNoPendingRecoveredRounds(rewardPool);
    }

    function _abandonPreQualificationRejectedRounds(
        RewardPool storage rewardPool,
        mapping(uint256 => address) storage rewardPoolPayerIdentity,
        mapping(uint256 => bytes32) storage rewardPoolPayerIdentityKey,
        mapping(uint256 => mapping(uint256 => bool)) storage preQualificationRejectedRound,
        mapping(uint256 => address) storage rewardPoolClusterPayoutOracle,
        mapping(uint256 => uint64) storage rewardPoolClusterPayoutOraclePinnedAt,
        RoundVotingEngine votingEngine,
        uint256 rewardPoolId,
        uint256[] calldata roundIds,
        uint8 payoutDomain
    ) private {
        uint256 pendingPreQualificationRejectedRounds = rewardPool.pendingPreQualificationRejectedRounds;
        require(pendingPreQualificationRejectedRounds != 0, "Prequalification round pending");
        require(roundIds.length != 0, "Round required");
        address oracleAddr = rewardPoolClusterPayoutOracle[rewardPoolId];
        uint64 pinnedAt = rewardPoolClusterPayoutOraclePinnedAt[rewardPoolId];

        for (uint256 i; i < roundIds.length;) {
            uint256 roundId = roundIds[i];
            require(preQualificationRejectedRound[rewardPoolId][roundId], "Round not skipped");
            if (uint256(rewardPool.nextRoundToEvaluate) != roundId + pendingPreQualificationRejectedRounds) {
                revert PreQualificationRejectedRoundPending();
            }
            if (_hasRecoveredReplacementSnapshot(
                    rewardPoolPayerIdentity,
                    rewardPoolPayerIdentityKey,
                    rewardPoolClusterPayoutOracle,
                    rewardPoolClusterPayoutOraclePinnedAt,
                    oracleAddr,
                    pinnedAt,
                    votingEngine,
                    rewardPool,
                    rewardPoolId,
                    roundId,
                    payoutDomain
                )) {
                revert PreQualificationRejectedReplacementSnapshotAvailable();
            }
            preQualificationRejectedRound[rewardPoolId][roundId] = false;
            unchecked {
                --pendingPreQualificationRejectedRounds;
                ++i;
            }
            emit PreQualificationRejectedSnapshotRoundAbandoned(rewardPoolId, rewardPool.contentId, roundId);
        }

        rewardPool.pendingPreQualificationRejectedRounds = pendingPreQualificationRejectedRounds.toUint32();
    }

    function _hasRecoveredReplacementSnapshot(
        mapping(uint256 => address) storage rewardPoolPayerIdentity,
        mapping(uint256 => bytes32) storage rewardPoolPayerIdentityKey,
        mapping(uint256 => address) storage rewardPoolClusterPayoutOracle,
        mapping(uint256 => uint64) storage rewardPoolClusterPayoutOraclePinnedAt,
        address oracleAddr,
        uint64 pinnedAt,
        RoundVotingEngine votingEngine,
        RewardPool storage rewardPool,
        uint256 rewardPoolId,
        uint256 roundId,
        uint8 payoutDomain
    ) private view returns (bool) {
        if (oracleAddr == address(0) || pinnedAt == 0) return false;

        IClusterPayoutOracle oracle = IClusterPayoutOracle(oracleAddr);
        IClusterPayoutOracle.RoundPayoutSnapshot memory snapshot;
        try oracle.getRoundPayoutSnapshot(payoutDomain, rewardPoolId, rewardPool.contentId, roundId) returns (
            IClusterPayoutOracle.RoundPayoutSnapshot memory loadedSnapshot
        ) {
            snapshot = loadedSnapshot;
        } catch {
            return false;
        }
        if (
            snapshot.status != IClusterPayoutOracle.SnapshotStatus.Proposed
                && snapshot.status != IClusterPayoutOracle.SnapshotStatus.Challenged
                && snapshot.status != IClusterPayoutOracle.SnapshotStatus.Finalized
        ) {
            return false;
        }

        uint64 proposedAt =
            oracle.roundPayoutSnapshotProposedAt(payoutDomain, rewardPoolId, rewardPool.contentId, roundId);
        if (proposedAt < pinnedAt) return false;
        (,,, uint48 readyAt) = votingEngine.roundLifecycleState(rewardPool.contentId, roundId);
        if (readyAt == 0 || proposedAt < readyAt) return false;
        if (
            oracle.roundPayoutSnapshotConsumerFor(payoutDomain, rewardPoolId, rewardPool.contentId, roundId)
                != address(this)
        ) {
            return false;
        }

        bytes32 snapshotKey = oracle.roundPayoutSnapshotKey(payoutDomain, rewardPoolId, rewardPool.contentId, roundId);
        bytes32 snapshotDigest = oracle.roundPayoutSnapshotProposalDigest(snapshotKey);
        if (oracle.rejectedRoundPayoutSnapshotDigests(snapshotKey, snapshotDigest)) return false;
        if (oracle.rejectedRoundPayoutSnapshotRoots(snapshotKey, snapshot.weightRoot)) return false;
        if (oracle.isRoundPayoutSnapshotRejectedByCorrelationEpoch(
                payoutDomain, rewardPoolId, rewardPool.contentId, roundId
            )) {
            return false;
        }
        if (snapshot.status != IClusterPayoutOracle.SnapshotStatus.Finalized) return true;
        if (!oracle.isRoundPayoutSnapshotOutsideVetoWindow(payoutDomain, rewardPoolId, rewardPool.contentId, roundId)) {
            return true;
        }

        (, bool canQualify,,,,) = QuestionRewardPoolEscrowQualificationLib.previewRoundQualificationWithClusterSnapshot(
            rewardPoolPayerIdentity,
            rewardPoolPayerIdentityKey,
            rewardPoolClusterPayoutOracle,
            rewardPoolClusterPayoutOraclePinnedAt,
            votingEngine,
            rewardPool,
            roundId,
            payoutDomain
        );
        if (!canQualify) return false;
        return true;
    }

    function _requireExpiredPreQualificationRefund(RoundVotingEngine votingEngine, RewardPool storage rewardPool)
        private
    {
        if (rewardPool.qualifiedRounds >= rewardPool.requiredSettledRounds || rewardPool.unallocatedRefunded) return;
        QuestionRewardPoolEscrowWindowLib.activateRewardPoolWindowForRound(
            votingEngine, rewardPool, rewardPool.nextRoundToEvaluate
        );
        (bool expired,) = QuestionRewardPoolEscrowWindowLib.rewardPoolExpired(rewardPool);
        require(expired, "Not expired");
    }

    function _refundCompleteRewardPool(
        RoundVotingEngine votingEngine,
        IERC20 lrepToken,
        IERC20 usdcToken,
        uint256 rewardPoolId,
        RewardPool storage rewardPool,
        uint256 claimGrace
    ) private returns (uint256 refundAmount) {
        uint256 claimDeadline = rewardPool.claimDeadline;
        require(claimDeadline != 0, "Grace");
        require(block.timestamp > claimDeadline + claimGrace, "Grace");

        refundAmount = rewardPool.fundedAmount - rewardPool.claimedAmount;
        require(refundAmount > 0, "No refund");
        rewardPool.refunded = true;
        rewardPool.claimDeadline = 0;
        _transferRewardPoolResidue(votingEngine, lrepToken, usdcToken, rewardPoolId, rewardPool, refundAmount);
    }

    function _transferRewardPoolResidue(
        RoundVotingEngine votingEngine,
        IERC20 lrepToken,
        IERC20 usdcToken,
        uint256 rewardPoolId,
        RewardPool storage rewardPool,
        uint256 amount
    ) private {
        QuestionRewardPoolEscrowTransferLib.transferRewardPoolResidue(
            _rewardToken(lrepToken, usdcToken, rewardPool.asset),
            votingEngine,
            rewardPoolId,
            rewardPool.funder,
            rewardPool.nonRefundable,
            amount
        );
    }

    function _getExistingRewardPool(mapping(uint256 => RewardPool) storage rewardPools, uint256 rewardPoolId)
        private
        view
        returns (RewardPool storage rewardPool)
    {
        rewardPool = rewardPools[rewardPoolId];
        require(rewardPool.id != 0, "Bounty not found");
    }

    function _resolveFunderIdentity(ProtocolConfig protocolConfig, address funder)
        private
        view
        returns (address funderIdentity, bytes32 funderIdentityKey)
    {
        funderIdentity = QuestionRewardPoolEscrowVoterLib.resolveCurrentRater(protocolConfig, funder).holder;
        if (funderIdentity == address(0)) funderIdentity = funder;
        funderIdentityKey = QuestionRewardPoolEscrowVoterLib.identityKeyForCurrentRater(protocolConfig, funder);
    }

    function _rewardToken(IERC20 lrepToken, IERC20 usdcToken, uint8 asset) private pure returns (IERC20 token) {
        return asset == REWARD_ASSET_LREP ? lrepToken : usdcToken;
    }

    function _requiredParticipantFloorForAmount(uint256 amount) private pure returns (uint256) {
        return QuestionRewardParticipantFloorLib.requiredParticipantFloorForAmount(amount);
    }
}
