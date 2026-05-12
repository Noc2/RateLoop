// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { SafeCast } from "@openzeppelin/contracts/utils/math/SafeCast.sol";

import { RobustBtsMath } from "./RobustBtsMath.sol";
import { RoundLib } from "./RoundLib.sol";
import { TlockVoteLib } from "./TlockVoteLib.sol";

/// @title RoundRevealLib
/// @notice Shared reveal accounting extracted from RoundVotingEngine to reduce runtime size.
library RoundRevealLib {
    using SafeCast for uint256;

    error RoundNotOpen();
    error NoCommit();
    error AlreadyRevealed();
    error EpochNotEnded();
    error HashMismatch();

    struct RevealRbtsParams {
        uint256 currentEligibleFrontendStake;
        uint256 currentEligibleFrontendCount;
        uint256 contentId;
        uint256 roundId;
        bytes32 commitKey;
        bool isUp;
        uint16 predictedUpBps;
        bytes32 salt;
        uint16 roundReferenceRatingBps;
        uint16 minVoters;
        uint256 targetRoundRevealableAt;
        uint16 raterWeightBps;
    }

    function revealRbtsVote(
        RoundLib.Round storage round,
        RoundLib.Commit storage commit,
        mapping(uint256 => uint256) storage unrevealedCountByEpoch,
        mapping(bytes32 => bool) storage frontendEligibleAtCommit,
        mapping(address => uint256) storage perFrontendStake,
        RevealRbtsParams memory params
    )
        external
        returns (
            uint256 nextEligibleFrontendStake,
            uint256 nextEligibleFrontendCount,
            address voter,
            uint64 effectiveStake
        )
    {
        if (round.state != RoundLib.RoundState.Open) revert RoundNotOpen();
        if (commit.voter == address(0)) revert NoCommit();
        if (commit.revealed) revert AlreadyRevealed();
        RobustBtsMath.requireValidPrediction(params.predictedUpBps);

        uint256 revealNotBefore = commit.revealableAfter;
        if (params.targetRoundRevealableAt > revealNotBefore) {
            revealNotBefore = params.targetRoundRevealableAt;
        }
        if (block.timestamp < revealNotBefore) revert EpochNotEnded();

        bytes32 expectedHash = TlockVoteLib.buildExpectedRbtsCommitHash(
            params.isUp,
            params.predictedUpBps,
            params.salt,
            commit.voter,
            params.contentId,
            params.roundId,
            params.roundReferenceRatingBps,
            commit.targetRound,
            commit.drandChainHash,
            commit.ciphertext
        );
        if (params.commitKey != keccak256(abi.encodePacked(commit.voter, expectedHash))) revert HashMismatch();

        commit.revealed = true;
        commit.isUp = params.isUp;

        unrevealedCountByEpoch[commit.revealableAfter]--;
        commit.revealableAfter = block.timestamp.toUint48();
        round.revealedCount++;

        if (params.isUp) {
            round.upPool += commit.stakeAmount;
            round.upCount++;
        } else {
            round.downPool += commit.stakeAmount;
            round.downCount++;
        }

        effectiveStake = _effectiveStake(commit.stakeAmount, commit.epochIndex, params.raterWeightBps);
        if (params.isUp) {
            round.weightedUpPool += effectiveStake;
        } else {
            round.weightedDownPool += effectiveStake;
        }

        if (round.revealedCount >= params.minVoters && round.thresholdReachedAt == 0) {
            round.thresholdReachedAt = block.timestamp.toUint48();
        }

        nextEligibleFrontendStake = params.currentEligibleFrontendStake;
        nextEligibleFrontendCount = params.currentEligibleFrontendCount;
        if (commit.frontend != address(0) && frontendEligibleAtCommit[params.commitKey]) {
            nextEligibleFrontendStake += commit.stakeAmount;
            if (perFrontendStake[commit.frontend] == 0) {
                nextEligibleFrontendCount++;
            }
            perFrontendStake[commit.frontend] += commit.stakeAmount;
        }

        voter = commit.voter;
    }

    function _effectiveStake(uint64 stakeAmount, uint8 epochIndex, uint16 raterWeightBps) private pure returns (uint64) {
        if (stakeAmount == 0) return 0;
        uint256 epochWeightBps = RoundLib.epochWeightBps(epochIndex);
        return ((uint256(stakeAmount) * epochWeightBps * uint256(raterWeightBps)) / 100_000_000).toUint64();
    }
}
