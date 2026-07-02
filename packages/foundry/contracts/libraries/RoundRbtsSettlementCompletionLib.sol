// SPDX-License-Identifier: MIT
pragma solidity ^0.8.34;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeCast } from "@openzeppelin/contracts/utils/math/SafeCast.sol";

import { ContentRegistry } from "../ContentRegistry.sol";
import { ProtocolConfig } from "../ProtocolConfig.sol";
import { RoundLib } from "./RoundLib.sol";
import { RoundCleanupLib } from "./RoundCleanupLib.sol";
import { RoundSettlementDistributionLib } from "./RoundSettlementDistributionLib.sol";
import { RoundSettlementSideEffectsLib } from "./RoundSettlementSideEffectsLib.sol";
import { TokenTransferLib } from "./TokenTransferLib.sol";

/// @title RoundRbtsSettlementCompletionLib
/// @notice Keeps the voting-engine settlement completion path outside the engine runtime bytecode.
library RoundRbtsSettlementCompletionLib {
    using SafeCast for uint256;

    uint256 internal constant SETTLEMENT_CALLER_INCENTIVE_BPS = 100;
    uint256 internal constant SETTLEMENT_CALLER_INCENTIVE_MAX = 1e6;

    event RbtsRewardsScored(
        uint256 indexed contentId,
        uint256 indexed roundId,
        bytes32 scoreSeed,
        uint256 rewardWeight,
        uint256 rewardClaimants,
        uint256 forfeitedPool,
        uint256 forfeitClaimants,
        uint16 meanScoreBps
    );
    event SettlementCallerIncentivePaid(
        uint256 indexed contentId, uint256 indexed roundId, address indexed caller, uint256 amount
    );
    event SettlementCallerIncentiveSkipped(uint256 indexed contentId, uint256 indexed roundId, uint256 amount);
    event RoundSettled(uint256 indexed contentId, uint256 indexed roundId, bool upWins, uint256 losingPool);

    struct CompleteParams {
        uint256 accountedLrepBalance;
        uint256 contentId;
        uint256 roundId;
        uint256 weightedRewardStake;
        uint256 rbtsForfeitedPool;
        bytes32 scoreSeed;
        address caller;
    }

    function complete(
        IERC20 lrepToken,
        ContentRegistry registry,
        ProtocolConfig protocolConfig,
        RoundLib.Round storage round,
        mapping(uint256 => mapping(uint256 => bool)) storage roundRbtsScored,
        mapping(uint256 => mapping(uint256 => uint256)) storage roundRbtsRewardWeight,
        mapping(uint256 => mapping(uint256 => uint256)) storage roundRbtsRewardClaimants,
        mapping(uint256 => mapping(uint256 => uint256)) storage roundRbtsForfeitedPool,
        mapping(uint256 => mapping(uint256 => uint256)) storage roundRbtsForfeitClaimants,
        mapping(uint256 => mapping(uint256 => uint16)) storage roundRbtsMeanScoreBps,
        mapping(uint256 => mapping(uint256 => uint256)) storage roundVoterPool,
        mapping(uint256 => mapping(uint256 => uint256)) storage roundWinningStake,
        mapping(uint256 => mapping(uint256 => uint256)) storage roundStakeWithEligibleFrontend,
        mapping(uint256 => mapping(uint256 => uint256)) storage roundFrontendPool,
        mapping(uint256 => mapping(uint256 => address)) storage roundFrontendRegistrySnapshot,
        mapping(uint256 => mapping(uint256 => uint16)) storage roundReferenceRatingBpsSnapshot,
        mapping(uint256 => mapping(uint256 => uint64)) storage roundRatingUpEvidence,
        mapping(uint256 => mapping(uint256 => uint64)) storage roundRatingDownEvidence,
        mapping(uint256 => mapping(uint256 => bool)) storage pendingRatingSettlementReplay,
        mapping(uint256 => mapping(uint256 => bool)) storage pendingBundleObserverReplay,
        mapping(uint256 => mapping(uint256 => uint48)) storage roundClusterPayoutReadyAt,
        CompleteParams memory params
    ) external returns (uint256 accountedLrepBalance) {
        uint256 contentId = params.contentId;
        uint256 roundId = params.roundId;
        accountedLrepBalance = params.accountedLrepBalance;
        roundRbtsScored[contentId][roundId] = true;
        (uint256 remainingForfeitedPool, uint256 incentivePaid) = _paySettlementCallerIncentive(
            lrepToken, roundRbtsForfeitedPool, contentId, roundId, params.rbtsForfeitedPool, params.caller
        );
        if (incentivePaid > 0) accountedLrepBalance -= incentivePaid;

        round.state = RoundLib.RoundState.Settled;
        round.settledAt = block.timestamp.toUint48();
        if (roundClusterPayoutReadyAt[contentId][roundId] == 0) {
            roundClusterPayoutReadyAt[contentId][roundId] = round.settledAt;
        }

        uint256 treasuryPaid = RoundSettlementDistributionLib.distribute(
            lrepToken,
            protocolConfig,
            roundVoterPool,
            roundWinningStake,
            roundStakeWithEligibleFrontend,
            roundFrontendPool,
            roundFrontendRegistrySnapshot,
            contentId,
            roundId,
            params.weightedRewardStake,
            remainingForfeitedPool
        );
        if (treasuryPaid > 0) accountedLrepBalance -= treasuryPaid;

        if (!RoundSettlementSideEffectsLib.recordSettlement(
                registry,
                contentId,
                roundId,
                roundReferenceRatingBpsSnapshot[contentId][roundId],
                roundRatingUpEvidence[contentId][roundId],
                roundRatingDownEvidence[contentId][roundId]
            )) {
            pendingRatingSettlementReplay[contentId][roundId] = true;
        }
        RoundCleanupLib.notifyBundleRoundTerminal(
            pendingBundleObserverReplay[contentId], registry, contentId, roundId, true
        );
        emit RbtsRewardsScored(
            contentId,
            roundId,
            params.scoreSeed,
            roundRbtsRewardWeight[contentId][roundId],
            roundRbtsRewardClaimants[contentId][roundId],
            roundRbtsForfeitedPool[contentId][roundId],
            roundRbtsForfeitClaimants[contentId][roundId],
            roundRbtsMeanScoreBps[contentId][roundId]
        );
        emit RoundSettled(contentId, roundId, round.upWins, round.upWins ? round.downPool : round.upPool);
    }

    function _paySettlementCallerIncentive(
        IERC20 lrepToken,
        mapping(uint256 => mapping(uint256 => uint256)) storage roundRbtsForfeitedPool,
        uint256 contentId,
        uint256 roundId,
        uint256 forfeitedPool,
        address caller
    ) private returns (uint256 remainingForfeitedPool, uint256 incentivePaid) {
        remainingForfeitedPool = forfeitedPool;
        uint256 incentive = _settlementCallerIncentive(forfeitedPool);
        if (incentive == 0) return (remainingForfeitedPool, 0);

        try TokenTransferLib.safeTransfer(lrepToken, caller, incentive) {
            incentivePaid = incentive;
            remainingForfeitedPool = forfeitedPool - incentive;
            roundRbtsForfeitedPool[contentId][roundId] = remainingForfeitedPool;
            emit SettlementCallerIncentivePaid(contentId, roundId, caller, incentive);
        } catch {
            emit SettlementCallerIncentiveSkipped(contentId, roundId, incentive);
        }
    }

    function _settlementCallerIncentive(uint256 forfeitedPool) private pure returns (uint256 incentive) {
        incentive = forfeitedPool * SETTLEMENT_CALLER_INCENTIVE_BPS / 10_000;
        if (incentive > SETTLEMENT_CALLER_INCENTIVE_MAX) incentive = SETTLEMENT_CALLER_INCENTIVE_MAX;
    }
}
