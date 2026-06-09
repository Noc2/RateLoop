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
import { RewardPool, CreateRewardPoolParams } from "./QuestionRewardPoolEscrowTypes.sol";
import { RoundLib } from "./RoundLib.sol";

library QuestionRewardPoolEscrowPoolActionsLib {
    using SafeCast for uint256;

    uint256 internal constant MIN_REQUIRED_VOTERS = 3;
    uint256 internal constant MIN_REQUIRED_SETTLED_ROUNDS = 1;
    uint256 internal constant MAX_REQUIRED_SETTLED_ROUNDS = 16;
    uint256 internal constant MAX_REWARD_POOL_ROUND_VOTERS = 200;
    uint256 internal constant MIN_REWARD_POOL_PARTICIPANTS = 3;
    uint256 internal constant HIGH_VALUE_REWARD_POOL_THRESHOLD = 1_000e6;
    uint256 internal constant MIN_HIGH_VALUE_PARTICIPANTS = 5;
    uint256 internal constant BPS_SCALE = 10_000;
    uint8 internal constant REWARD_ASSET_LREP = 0;
    uint8 internal constant REWARD_ASSET_USDC = 1;
    uint8 internal constant PAYOUT_DOMAIN_QUESTION_REWARD = 1;

    error RecoveredRoundPending();

    event RewardPoolCreated(
        uint256 indexed rewardPoolId,
        uint256 indexed contentId,
        address indexed funder,
        bytes32 funderIdentityKey,
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

    function createFundedRewardPool(
        mapping(uint256 => RewardPool) storage rewardPools,
        mapping(uint256 => address) storage rewardPoolPayerIdentity,
        mapping(uint256 => bytes32) storage rewardPoolPayerIdentityKey,
        ContentRegistry registry,
        RoundVotingEngine votingEngine,
        uint16 defaultFrontendFeeBps,
        uint256 nextRewardPoolId,
        uint256 fundedAmount,
        CreateRewardPoolParams memory params
    ) external returns (uint256 rewardPoolId, uint256 updatedNextRewardPoolId) {
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
        RoundVotingEngine votingEngine,
        uint256 rewardPoolId,
        uint8 asset,
        address expectedConsumer
    ) external {
        if (asset != REWARD_ASSET_USDC) return;
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
        emit RewardPoolClusterPayoutOracleSnapshotted(rewardPoolId, clusterPayoutOracle);
    }

    function refundExpiredRewardPool(
        mapping(uint256 => RewardPool) storage rewardPools,
        RoundVotingEngine votingEngine,
        IERC20 lrepToken,
        IERC20 usdcToken,
        uint256 rewardPoolId,
        uint256 claimGrace
    ) external returns (uint256 refundAmount) {
        RewardPool storage rewardPool = _getExistingRewardPool(rewardPools, rewardPoolId);
        _requireNoPendingRecoveredRounds(rewardPool);
        if (rewardPool.qualifiedRounds >= rewardPool.requiredSettledRounds || rewardPool.unallocatedRefunded) {
            return _refundCompleteRewardPool(votingEngine, lrepToken, usdcToken, rewardPoolId, rewardPool, claimGrace);
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
        require(!registry.isContentActive(rewardPool.contentId), "Content active");
        require(block.timestamp > registry.dormantKeyReleasableAt(rewardPool.contentId), "Revival active");
        QuestionRewardPoolEscrowWindowLib.activateRewardPoolWindowForRound(
            votingEngine, rewardPool, rewardPool.nextRoundToEvaluate
        );
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
        pool.bountyOpensAt = params.bountyWindowSeconds == 0 ? uint64(block.timestamp) : 0;
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
    }

    function _validateStoreInputs(ContentRegistry registry, uint256 fundedAmount, CreateRewardPoolParams memory params)
        private
        view
    {
        require(fundedAmount > 0, "Amount required");
        require(params.asset == REWARD_ASSET_LREP || params.asset == REWARD_ASSET_USDC, "Invalid asset");
        require(QuestionRewardPoolEscrowEligibilityLib.isValidPolicy(params.bountyEligibility), "Invalid eligibility");
        require(registry.isContentActive(params.contentId), "Content not active");
        require(params.requiredVoters >= MIN_REQUIRED_VOTERS, "Too few voters");
        require(params.requiredVoters >= _requiredParticipantFloorForAmount(fundedAmount), "High-value floor");
        require(params.requiredSettledRounds >= MIN_REQUIRED_SETTLED_ROUNDS, "Too few rounds");
        require(params.requiredSettledRounds <= MAX_REQUIRED_SETTLED_ROUNDS, "Too many rounds");
        require(fundedAmount >= params.requiredSettledRounds * params.requiredVoters * BPS_SCALE, "Amount too small");
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
        return currentRoundId == 0 ? 1 : currentRoundId + 1;
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
        return amount >= HIGH_VALUE_REWARD_POOL_THRESHOLD ? MIN_HIGH_VALUE_PARTICIPANTS : MIN_REWARD_POOL_PARTICIPANTS;
    }
}
