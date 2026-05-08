// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { SafeCast } from "@openzeppelin/contracts/utils/math/SafeCast.sol";

import { ContentRegistry } from "../ContentRegistry.sol";
import { RatingLib } from "./RatingLib.sol";
import { RatingMath } from "./RatingMath.sol";
import { IParticipationPool } from "../interfaces/IParticipationPool.sol";
import { IRoundRewardDistributor } from "../interfaces/IRoundRewardDistributor.sol";

/// @title RoundSettlementSideEffectsLib
/// @notice Moves best-effort post-settlement external calls out of RoundVotingEngine runtime bytecode.
library RoundSettlementSideEffectsLib {
    using SafeCast for uint256;
    using SafeCast for int256;

    enum SideEffectFailureStage {
        ParticipationRateQuery,
        VoterParticipationRewardsSnapshot,
        RatingStateUpdate,
        MeaningfulActivityRecord
    }

    event SettlementSideEffectFailed(
        uint256 indexed contentId, uint256 indexed roundId, address indexed target, SideEffectFailureStage stage
    );

    function recordSettlement(
        ContentRegistry registry,
        RatingLib.RatingConfig memory ratingConfig,
        IParticipationPool participationPool,
        address rewardDistributor,
        uint256 contentId,
        uint256 roundId,
        uint16 referenceRatingBps,
        uint256 weightedWinningStake,
        uint64 upPool,
        uint64 downPool,
        bool usePredictionRating,
        uint256,
        uint256 predictionEvidence,
        uint16 predictionFinalRatingBps
    ) external {
        // The two rating-state precondition reads share the SettlementSideEffectFailed/RatingStateUpdate
        // stage with the eventual update call: any failure along this chain means "the rating state was
        // not updated for this round," and downstream observers handle all three the same way.
        // getSlashConfigForContent in particular may transitively call protocolConfig.slashConfig(),
        // so guard it (and the symmetric getRatingState read) so a misbehaving config contract
        // cannot brick settleRound.
        RatingLib.RatingState memory previousState;
        RatingLib.SlashConfig memory slashConfig;
        bool ratingUpdatePossible;
        try registry.getRatingState(contentId) returns (RatingLib.RatingState memory s) {
            previousState = s;
            try registry.getSlashConfigForContent(contentId) returns (RatingLib.SlashConfig memory c) {
                slashConfig = c;
                ratingUpdatePossible = true;
            } catch {
                emit SettlementSideEffectFailed(
                    contentId, roundId, address(registry), SideEffectFailureStage.RatingStateUpdate
                );
            }
        } catch {
            emit SettlementSideEffectFailed(
                contentId, roundId, address(registry), SideEffectFailureStage.RatingStateUpdate
            );
        }

        address participationPoolAddress = address(participationPool);
        uint256 participationRateBps = 0;
        bool hasParticipationRate = false;

        if (participationPoolAddress != address(0)) {
            try participationPool.getCurrentRateBps() returns (uint256 rate) {
                participationRateBps = rate;
                hasParticipationRate = true;
            } catch {
                emit SettlementSideEffectFailed(
                    contentId, roundId, participationPoolAddress, SideEffectFailureStage.ParticipationRateQuery
                );
            }
        }

        if (ratingUpdatePossible) {
            RatingLib.RatingState memory nextState = usePredictionRating
                ? _applyPredictionSettlement(
                    predictionFinalRatingBps, predictionEvidence, previousState, ratingConfig, slashConfig
                )
                : _applyBinarySettlement(referenceRatingBps, upPool, downPool, previousState, ratingConfig, slashConfig);
            try registry.updateRatingState(contentId, roundId, referenceRatingBps, nextState) { }
            catch {
                emit SettlementSideEffectFailed(
                    contentId, roundId, address(registry), SideEffectFailureStage.RatingStateUpdate
                );
            }
        }

        try registry.recordMeaningfulActivity(contentId) { }
        catch {
            emit SettlementSideEffectFailed(
                contentId, roundId, address(registry), SideEffectFailureStage.MeaningfulActivityRecord
            );
        }

        if (participationPoolAddress != address(0) && hasParticipationRate) {
            if (rewardDistributor != address(0)) {
                try IRoundRewardDistributor(rewardDistributor)
                    .snapshotParticipationRewards(
                        contentId, roundId, participationPoolAddress, participationRateBps, weightedWinningStake
                    ) { }
                catch {
                    emit SettlementSideEffectFailed(
                        contentId, roundId, rewardDistributor, SideEffectFailureStage.VoterParticipationRewardsSnapshot
                    );
                }
            }
        }
    }

    function _applyBinarySettlement(
        uint16 referenceRatingBps,
        uint64 upPool,
        uint64 downPool,
        RatingLib.RatingState memory previousState,
        RatingLib.RatingConfig memory ratingConfig,
        RatingLib.SlashConfig memory slashConfig
    ) private view returns (RatingLib.RatingState memory nextState) {
        (nextState,,) = RatingMath.applySettlement(
            referenceRatingBps, upPool, downPool, previousState, ratingConfig, slashConfig, uint48(block.timestamp)
        );
    }

    function _applyPredictionSettlement(
        uint16 predictionFinalRatingBps,
        uint256 predictionEvidence,
        RatingLib.RatingState memory previousState,
        RatingLib.RatingConfig memory ratingConfig,
        RatingLib.SlashConfig memory slashConfig
    ) private view returns (RatingLib.RatingState memory nextState) {
        uint16 clampedRatingBps = RatingMath.clampRatingBps(predictionFinalRatingBps);
        uint256 previousConfidenceMass =
            previousState.confidenceMass == 0 ? ratingConfig.confidenceMassInitial : previousState.confidenceMass;
        uint256 confidenceGain = (predictionEvidence * ratingConfig.confidenceGainBps) / RatingLib.BPS_SCALE;
        uint256 nextConfidenceMass = previousConfidenceMass + confidenceGain;
        if (nextConfidenceMass < ratingConfig.confidenceMassMin) {
            nextConfidenceMass = ratingConfig.confidenceMassMin;
        }
        if (nextConfidenceMass > ratingConfig.confidenceMassMax) {
            nextConfidenceMass = ratingConfig.confidenceMassMax;
        }

        nextState.ratingLogitX18 = RatingMath.ratingBpsToLogitX18(clampedRatingBps).toInt128();
        nextState.confidenceMass = nextConfidenceMass.toUint128();
        nextState.effectiveEvidence = (uint256(previousState.effectiveEvidence) + predictionEvidence).toUint128();
        nextState.settledRounds = previousState.settledRounds + 1;
        nextState.ratingBps = clampedRatingBps;
        nextState.conservativeRatingBps =
            RatingMath.computeConservativeRatingBps(clampedRatingBps, nextConfidenceMass, ratingConfig);
        nextState.lastUpdatedAt = uint48(block.timestamp);

        bool canTrackLowRating = uint256(nextState.effectiveEvidence) >= slashConfig.minSlashEvidence
            && nextState.settledRounds >= slashConfig.minSlashSettledRounds;
        if (canTrackLowRating && nextState.conservativeRatingBps < slashConfig.slashThresholdBps) {
            nextState.lowSince = previousState.lowSince == 0 ? uint48(block.timestamp) : previousState.lowSince;
        }
    }
}
