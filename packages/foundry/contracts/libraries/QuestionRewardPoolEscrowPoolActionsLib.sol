// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeCast } from "@openzeppelin/contracts/utils/math/SafeCast.sol";

import { ContentRegistry } from "../ContentRegistry.sol";
import { RoundVotingEngine } from "../RoundVotingEngine.sol";
import { IVoterIdNFT } from "../interfaces/IVoterIdNFT.sol";
import { QuestionRewardPoolEscrowEligibilityLib } from "./QuestionRewardPoolEscrowEligibilityLib.sol";
import { QuestionRewardPoolEscrowTransferLib } from "./QuestionRewardPoolEscrowTransferLib.sol";
import { RewardPool } from "./QuestionRewardPoolEscrowTypes.sol";
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
    uint8 internal constant REWARD_ASSET_HREP = 0;
    uint8 internal constant REWARD_ASSET_USDC = 1;

    event RewardPoolCreated(
        uint256 indexed rewardPoolId,
        uint256 indexed contentId,
        address indexed funder,
        uint256 funderVoterId,
        uint256 amount,
        uint256 requiredVoters,
        uint256 requiredSettledRounds,
        uint256 startRoundId,
        uint256 bountyOpensAt,
        uint256 bountyClosesAt,
        uint256 feedbackClosesAt,
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

    function createRewardPool(
        mapping(uint256 => RewardPool) storage rewardPools,
        mapping(uint256 => uint256) storage rewardPoolSubmitterNullifier,
        mapping(uint256 => address) storage rewardPoolPayerIdentity,
        mapping(uint256 => uint256) storage rewardPoolPayerNullifier,
        ContentRegistry registry,
        RoundVotingEngine votingEngine,
        IVoterIdNFT voterIdNFT,
        IERC20 hrepToken,
        IERC20 usdcToken,
        uint16 defaultFrontendFeeBps,
        uint256 nextRewardPoolId,
        uint256 contentId,
        address funder,
        address payer,
        uint8 asset,
        uint256 amount,
        uint256 requiredVoters,
        uint256 requiredSettledRounds,
        uint256 bountyClosesAt,
        uint256 feedbackClosesAt,
        uint8 bountyEligibility,
        bool nonRefundable,
        uint8 bountyKind,
        uint256 relatedRoundId,
        bytes32 reasonHash
    ) external returns (uint256 rewardPoolId, uint256 updatedNextRewardPoolId) {
        uint256 fundedAmount = QuestionRewardPoolEscrowTransferLib.pullExactToken(
                _rewardToken(hrepToken, usdcToken, asset), funder, amount
            );

        rewardPoolId = nextRewardPoolId;
        updatedNextRewardPoolId = nextRewardPoolId + 1;
        _storeRewardPool(
            rewardPools,
            rewardPoolSubmitterNullifier,
            rewardPoolPayerIdentity,
            rewardPoolPayerNullifier,
            registry,
            votingEngine,
            voterIdNFT,
            defaultFrontendFeeBps,
            rewardPoolId,
            contentId,
            funder,
            payer,
            asset,
            fundedAmount,
            requiredVoters,
            requiredSettledRounds,
            bountyClosesAt,
            feedbackClosesAt,
            bountyEligibility,
            nonRefundable
        );

        if (bountyKind != 0) {
            _setRewardPoolPurpose(rewardPools, rewardPoolId, bountyKind, relatedRoundId, reasonHash);
        }
    }

    function _storeRewardPool(
        mapping(uint256 => RewardPool) storage rewardPools,
        mapping(uint256 => uint256) storage rewardPoolSubmitterNullifier,
        mapping(uint256 => address) storage rewardPoolPayerIdentity,
        mapping(uint256 => uint256) storage rewardPoolPayerNullifier,
        ContentRegistry registry,
        RoundVotingEngine votingEngine,
        IVoterIdNFT voterIdNFT,
        uint16 defaultFrontendFeeBps,
        uint256 rewardPoolId,
        uint256 contentId,
        address funder,
        address payer,
        uint8 asset,
        uint256 fundedAmount,
        uint256 requiredVoters,
        uint256 requiredSettledRounds,
        uint256 bountyClosesAt,
        uint256 feedbackClosesAt,
        uint8 bountyEligibility,
        bool nonRefundable
    ) private {
        uint256 amount = fundedAmount;
        require(amount > 0, "Amount required");
        require(asset == REWARD_ASSET_HREP || asset == REWARD_ASSET_USDC, "Invalid asset");
        require(QuestionRewardPoolEscrowEligibilityLib.isValidPolicy(bountyEligibility), "Invalid eligibility");
        require(registry.isContentActive(contentId), "Content not active");
        require(requiredVoters >= MIN_REQUIRED_VOTERS, "Too few voters");
        require(requiredVoters >= _requiredParticipantFloorForAmount(amount), "High-value floor");
        require(requiredSettledRounds >= MIN_REQUIRED_SETTLED_ROUNDS, "Too few rounds");
        require(requiredSettledRounds <= MAX_REQUIRED_SETTLED_ROUNDS, "Too many rounds");
        require(amount >= requiredSettledRounds * requiredVoters, "Amount too small");
        if (bountyClosesAt != 0) {
            require(bountyClosesAt > block.timestamp, "Bad close");
        }
        uint256 normalizedFeedbackClosesAt = _normalizeFeedbackClosesAt(bountyClosesAt, feedbackClosesAt);
        RoundLib.RoundConfig memory contentCfg = registry.getContentRoundConfig(contentId);
        require(requiredVoters <= contentCfg.maxVoters, "Voters exceed max");
        require(contentCfg.maxVoters <= MAX_REWARD_POOL_ROUND_VOTERS, "Voters exceed max");
        if (!nonRefundable) {
            require(amount >= requiredSettledRounds * uint256(contentCfg.maxVoters), "Amount too small");
            require(bountyClosesAt > block.timestamp, "Bad close");
        }

        uint256 currentRoundId = votingEngine.currentRoundId(contentId);
        uint256 startRoundId = currentRoundId == 0 ? 1 : currentRoundId + 1;
        (uint256 funderVoterId, address funderIdentity,) = _resolveFunderIdentity(voterIdNFT, funder);
        address effectivePayer = payer == address(0) ? funder : payer;
        (, address payerIdentity, uint256 payerNullifier) = _resolveFunderIdentity(voterIdNFT, effectivePayer);
        address submitterIdentity = registry.getSubmitterIdentity(contentId);
        uint256 submitterNullifier = registry.contentSubmitterNullifier(contentId);

        rewardPools[rewardPoolId] = RewardPool({
            id: rewardPoolId.toUint64(),
            contentId: contentId.toUint64(),
            startRoundId: startRoundId.toUint64(),
            nextRoundToEvaluate: startRoundId.toUint64(),
            challengedRoundId: 0,
            bountyOpensAt: uint64(block.timestamp),
            bountyClosesAt: bountyClosesAt.toUint64(),
            claimDeadline: bountyClosesAt.toUint64(),
            funder: funder,
            funderIdentity: funderIdentity,
            submitterIdentity: submitterIdentity,
            submitterVoterId: 0,
            submitterVoterIdNFT: address(0),
            asset: asset,
            fundedAmount: fundedAmount,
            unallocatedAmount: fundedAmount,
            claimedAmount: 0,
            requiredVoters: uint32(requiredVoters),
            requiredSettledRounds: uint32(requiredSettledRounds),
            qualifiedRounds: 0,
            refunded: false,
            unallocatedRefunded: false,
            frontendFeeBps: defaultFrontendFeeBps,
            bountyKind: 0,
            bountyEligibility: bountyEligibility,
            nonRefundable: nonRefundable,
            reasonHash: bytes32(0),
            bountyEligibilityDataHash: QuestionRewardPoolEscrowEligibilityLib.eligibilityDataHash()
        });
        rewardPoolSubmitterNullifier[rewardPoolId] = submitterNullifier;
        rewardPoolPayerIdentity[rewardPoolId] = payerIdentity;
        rewardPoolPayerNullifier[rewardPoolId] = payerNullifier;

        emit RewardPoolCreated(
            rewardPoolId,
            contentId,
            funder,
            funderVoterId,
            fundedAmount,
            requiredVoters,
            requiredSettledRounds,
            startRoundId,
            block.timestamp,
            bountyClosesAt,
            normalizedFeedbackClosesAt,
            defaultFrontendFeeBps,
            asset,
            bountyEligibility,
            rewardPools[rewardPoolId].bountyEligibilityDataHash,
            nonRefundable
        );
        emit RewardPoolEligibilitySet(rewardPoolId, bountyEligibility);
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
