// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { SafeCast } from "@openzeppelin/contracts/utils/math/SafeCast.sol";

import { PredictionRatingMath } from "./PredictionRatingMath.sol";
import { RoundLib } from "./RoundLib.sol";
import { TlockVoteLib } from "./TlockVoteLib.sol";

/// @title RoundRevealLib
/// @notice Shared reveal accounting extracted from RoundVotingEngine to reduce runtime size.
library RoundRevealLib {
    using SafeCast for uint256;

    uint64 internal constant ZERO_STAKE_BASE_WEIGHT = 100_000; // 0.1 LREP voting weight

    error RoundNotOpen();
    error NoCommit();
    error AlreadyRevealed();
    error EpochNotEnded();
    error HashMismatch();

    function revealVote(
        RoundLib.Round storage round,
        RoundLib.Commit storage commit,
        mapping(uint256 => uint256) storage unrevealedCountByEpoch,
        mapping(bytes32 => bool) storage frontendEligibleAtCommit,
        mapping(address => uint256) storage perFrontendStake,
        uint256 currentEligibleFrontendStake,
        uint256 currentEligibleFrontendCount,
        uint256 contentId,
        uint256 roundId,
        bytes32 commitKey,
        bool isUp,
        bytes32 salt,
        uint16 roundReferenceRatingBps,
        uint16 minVoters,
        uint256 targetRoundRevealableAt,
        uint16 raterWeightBps
    ) external returns (uint256 nextEligibleFrontendStake, uint256 nextEligibleFrontendCount, address voter) {
        if (round.state != RoundLib.RoundState.Open) revert RoundNotOpen();
        if (commit.voter == address(0)) revert NoCommit();
        if (commit.revealed) revert AlreadyRevealed();

        uint256 revealNotBefore = commit.revealableAfter;
        if (targetRoundRevealableAt > revealNotBefore) {
            revealNotBefore = targetRoundRevealableAt;
        }
        if (block.timestamp < revealNotBefore) revert EpochNotEnded();

        bytes32 expectedHash = TlockVoteLib.buildExpectedCommitHash(
            isUp,
            salt,
            commit.voter,
            contentId,
            roundId,
            roundReferenceRatingBps,
            commit.targetRound,
            commit.drandChainHash,
            commit.ciphertext
        );
        if (commitKey != keccak256(abi.encodePacked(commit.voter, expectedHash))) revert HashMismatch();

        commit.revealed = true;
        commit.isUp = isUp;

        unrevealedCountByEpoch[commit.revealableAfter]--;
        commit.revealableAfter = block.timestamp.toUint48();
        round.revealedCount++;

        if (isUp) {
            round.upPool += commit.stakeAmount;
            round.upCount++;
        } else {
            round.downPool += commit.stakeAmount;
            round.downCount++;
        }

        uint64 effectiveStake = _effectiveStake(commit.stakeAmount, commit.epochIndex, raterWeightBps);
        if (isUp) {
            round.weightedUpPool += effectiveStake;
        } else {
            round.weightedDownPool += effectiveStake;
        }

        if (round.revealedCount >= minVoters && round.thresholdReachedAt == 0) {
            round.thresholdReachedAt = block.timestamp.toUint48();
        }

        nextEligibleFrontendStake = currentEligibleFrontendStake;
        nextEligibleFrontendCount = currentEligibleFrontendCount;
        if (commit.frontend != address(0) && frontendEligibleAtCommit[commitKey]) {
            nextEligibleFrontendStake += commit.stakeAmount;
            if (perFrontendStake[commit.frontend] == 0) {
                nextEligibleFrontendCount++;
            }
            perFrontendStake[commit.frontend] += commit.stakeAmount;
        }

        voter = commit.voter;
    }

    function revealPrediction(
        RoundLib.Round storage round,
        RoundLib.Commit storage commit,
        mapping(uint256 => uint256) storage unrevealedCountByEpoch,
        mapping(bytes32 => bool) storage frontendEligibleAtCommit,
        mapping(address => uint256) storage perFrontendStake,
        uint256 currentEligibleFrontendStake,
        uint256 currentEligibleFrontendCount,
        uint256 contentId,
        uint256 roundId,
        bytes32 commitKey,
        uint16 opinionRatingBps,
        uint16 predictedCrowdRatingBps,
        bytes32 salt,
        uint16 roundReferenceRatingBps,
        uint16 minVoters,
        uint256 targetRoundRevealableAt,
        uint16 raterWeightBps,
        uint256 chainId,
        address engine,
        bytes32 scorerMetadataHash
    )
        external
        returns (
            uint256 nextEligibleFrontendStake,
            uint256 nextEligibleFrontendCount,
            address voter,
            bool isUp,
            uint64 effectiveStake
        )
    {
        if (round.state != RoundLib.RoundState.Open) revert RoundNotOpen();
        if (commit.voter == address(0)) revert NoCommit();
        if (commit.revealed) revert AlreadyRevealed();
        PredictionRatingMath.requireValidRating(opinionRatingBps);
        PredictionRatingMath.requireValidRating(predictedCrowdRatingBps);

        uint256 revealNotBefore = commit.revealableAfter;
        if (targetRoundRevealableAt > revealNotBefore) {
            revealNotBefore = targetRoundRevealableAt;
        }
        if (block.timestamp < revealNotBefore) revert EpochNotEnded();

        bytes32 expectedHash = TlockVoteLib.buildExpectedPredictionCommitHash(
            chainId,
            engine,
            commit.stakeAmount,
            scorerMetadataHash,
            opinionRatingBps,
            predictedCrowdRatingBps,
            salt,
            commit.voter,
            contentId,
            roundId,
            roundReferenceRatingBps,
            commit.targetRound,
            commit.drandChainHash,
            commit.ciphertext
        );
        if (commitKey != keccak256(abi.encodePacked(commit.voter, expectedHash))) revert HashMismatch();

        isUp = opinionRatingBps >= roundReferenceRatingBps;
        commit.revealed = true;
        commit.isUp = isUp;

        unrevealedCountByEpoch[commit.revealableAfter]--;
        commit.revealableAfter = block.timestamp.toUint48();
        round.revealedCount++;

        if (isUp) {
            round.upPool += commit.stakeAmount;
            round.upCount++;
        } else {
            round.downPool += commit.stakeAmount;
            round.downCount++;
        }

        effectiveStake = _effectiveStake(commit.stakeAmount, commit.epochIndex, raterWeightBps);
        if (isUp) {
            round.weightedUpPool += effectiveStake;
        } else {
            round.weightedDownPool += effectiveStake;
        }

        if (round.revealedCount >= minVoters && round.thresholdReachedAt == 0) {
            round.thresholdReachedAt = block.timestamp.toUint48();
        }

        nextEligibleFrontendStake = currentEligibleFrontendStake;
        nextEligibleFrontendCount = currentEligibleFrontendCount;
        if (commit.frontend != address(0) && frontendEligibleAtCommit[commitKey]) {
            nextEligibleFrontendStake += commit.stakeAmount;
            if (perFrontendStake[commit.frontend] == 0) {
                nextEligibleFrontendCount++;
            }
            perFrontendStake[commit.frontend] += commit.stakeAmount;
        }

        voter = commit.voter;
    }

    function _effectiveStake(uint64 stakeAmount, uint8 epochIndex, uint16 raterWeightBps) private pure returns (uint64) {
        uint256 epochWeightBps = RoundLib.epochWeightBps(epochIndex);
        uint256 baseWeight = stakeAmount == 0 ? ZERO_STAKE_BASE_WEIGHT : uint256(stakeAmount);
        return ((baseWeight * epochWeightBps * uint256(raterWeightBps)) / 100_000_000).toUint64();
    }
}
