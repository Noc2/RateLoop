// SPDX-License-Identifier: MIT
pragma solidity ^0.8.34;

import { Blockhash } from "@openzeppelin/contracts/utils/Blockhash.sol";
import { SafeCast } from "@openzeppelin/contracts/utils/math/SafeCast.sol";

import { RobustBtsMath } from "./RobustBtsMath.sol";
import { RoundLib } from "./RoundLib.sol";
import { RewardMath } from "./RewardMath.sol";
import { TlockVoteLib } from "./TlockVoteLib.sol";
import { VotePreflightLib } from "./VotePreflightLib.sol";

/// @title RoundRevealLib
/// @notice Shared reveal accounting extracted from RoundVotingEngine to reduce runtime size.
library RoundRevealLib {
    using SafeCast for uint256;

    uint64 internal constant RATING_EVIDENCE_BASE_UNIT = 1_000_000;
    uint64 internal constant RATING_EVIDENCE_STAKE_BONUS_CAP = 10_000_000;
    uint64 internal constant RATING_EVIDENCE_MAX_STAKE_BONUS = 1_000_000;
    uint256 internal constant RBTS_SEED_BLOCK_FLAG = 1 << 255;
    uint256 internal constant RBTS_SEED_TIMESTAMP_SHIFT = 64;

    error RoundNotOpen();
    error NoCommit();
    error AlreadyRevealed();
    error EpochNotEnded();
    error HashMismatch();
    error NotEnoughVotes();
    error RevealGraceActive();
    error RbtsSeedUnavailable();

    event RbtsSeedCaptured(uint256 indexed contentId, uint256 indexed roundId, bytes32 entropy);

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
        bytes32 drandChainHash;
        bool countForSettlement;
    }

    struct RbtsRoundTotals {
        uint256 rewardWeight;
        uint256 rewardClaimants;
        uint256 participationClaimants;
        uint256 participationWeight;
        uint256 forfeitedPool;
        uint256 forfeitClaimants;
        uint16 meanScoreBps;
    }

    struct ScoreRbtsResult {
        uint256 rewardWeight;
        uint256 rewardClaimants;
        uint256 participationClaimants;
        uint256 participationWeight;
        uint256 forfeitedPool;
        uint256 forfeitClaimants;
        uint16 meanScoreBps;
        bytes32 scoreSeed;
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
            uint64 effectiveStake,
            uint64 ratingEvidenceWeight
        )
    {
        if (round.state != RoundLib.RoundState.Open) revert RoundNotOpen();
        if (commit.voter == address(0)) revert NoCommit();
        if (commit.revealed) revert AlreadyRevealed();
        // L-Vote-8: stricter user-prediction bounds reject 0%/100% endpoints that would
        // collapse the BTS information score to peer-signal-only.
        RobustBtsMath.requireValidUserPrediction(params.predictedUpBps);

        uint256 revealNotBefore = commit.revealableAfter;
        if (params.targetRoundRevealableAt > revealNotBefore) {
            revealNotBefore = params.targetRoundRevealableAt;
        }
        if (block.timestamp < revealNotBefore) revert EpochNotEnded();

        bytes32 expectedHash = TlockVoteLib.buildExpectedRbtsCommitHashFromCiphertextHash(
            params.isUp,
            params.predictedUpBps,
            params.salt,
            commit.voter,
            params.contentId,
            params.roundId,
            params.roundReferenceRatingBps,
            commit.targetRound,
            params.drandChainHash,
            commit.ciphertextHash
        );
        if (params.commitKey != keccak256(abi.encodePacked(commit.voter, expectedHash))) revert HashMismatch();

        // Cache the epoch-end key (stored in commit.revealableAfter prior to reveal)
        // before flipping `revealed`, since after the flip the same field is
        // repurposed as the reveal timestamp. Honor the "check revealed first"
        // invariant for the dual-purpose slot.
        uint256 epochEndKey = commit.revealableAfter;
        commit.revealed = true;
        commit.isUp = params.isUp;

        unrevealedCountByEpoch[epochEndKey]--;
        commit.revealableAfter = block.timestamp.toUint48();
        round.revealedCount++;

        effectiveStake = _effectiveStake(commit.stakeAmount, commit.epochIndex);
        ratingEvidenceWeight = _ratingEvidenceWeight(commit.stakeAmount, commit.epochIndex);
        if (params.countForSettlement) {
            if (params.isUp) {
                round.upPool += commit.stakeAmount;
                round.upCount++;
                round.weightedUpPool += effectiveStake;
            } else {
                round.downPool += commit.stakeAmount;
                round.downCount++;
                round.weightedDownPool += effectiveStake;
            }
        }

        if (round.revealedCount >= params.minVoters && round.thresholdReachedAt == 0) {
            round.thresholdReachedAt = block.timestamp.toUint48();
        }

        nextEligibleFrontendStake = params.currentEligibleFrontendStake;
        nextEligibleFrontendCount = params.currentEligibleFrontendCount;
        if (params.countForSettlement && commit.frontend != address(0) && frontendEligibleAtCommit[params.commitKey]) {
            nextEligibleFrontendStake += commit.stakeAmount;
            if (perFrontendStake[commit.frontend] == 0) {
                nextEligibleFrontendCount++;
            }
            perFrontendStake[commit.frontend] += commit.stakeAmount;
        }

        voter = commit.voter;
    }

    struct ScoreRbtsParams {
        uint256 contentId;
        uint256 roundId;
        uint256 revealedCount;
        uint16 minParticipants;
        bytes32 settlementEntropy;
        uint48 thresholdReachedAt;
    }

    function scoreRbtsRewards(
        bytes32[] storage commitKeys,
        mapping(bytes32 => RoundLib.Commit) storage roundCommits,
        mapping(bytes32 => uint16) storage commitPredictedUpBps,
        mapping(bytes32 => uint256) storage commitRbtsWeight,
        mapping(bytes32 => uint16) storage commitRbtsScoreBps,
        mapping(bytes32 => uint256) storage commitRbtsRewardWeight,
        mapping(bytes32 => uint256) storage commitRbtsStakeReturned,
        mapping(bytes32 => uint256) storage commitRbtsForfeitedStake,
        mapping(bytes32 => bytes32) storage commitIdentityKey,
        ScoreRbtsParams memory params
    ) external returns (ScoreRbtsResult memory result) {
        if (params.revealedCount < params.minParticipants) revert NotEnoughVotes();

        if (params.thresholdReachedAt == 0) revert NotEnoughVotes();

        // The sampler seed is hashed over the settlement-closed scoring set
        // (revealed commits with RBTS weight, in commit order), so unrevealed
        // current-epoch commits that are allowed to settle/refund cannot grind reward draws.
        // The engine rejects reveals after closure, keeping the sampler index space stable
        // between seed capture and final settlement.
        uint256 committedCount = commitKeys.length;
        bytes32[] memory revealedKeysMem = new bytes32[](committedCount);
        bytes32 scoringSetHash;
        uint256 revealedBuildIdx;
        uint256 economicCount;
        RbtsRoundTotals memory totals;
        for (uint256 i = 0; i < committedCount;) {
            bytes32 commitKey = commitKeys[i];
            RoundLib.Commit storage revealedCommit = roundCommits[commitKey];
            if (revealedCommit.revealed) {
                if (commitRbtsWeight[commitKey] > 0) {
                    scoringSetHash = keccak256(abi.encodePacked(scoringSetHash, commitKey));
                    revealedKeysMem[revealedBuildIdx] = commitKey;
                    unchecked {
                        ++economicCount;
                    }
                    unchecked {
                        ++revealedBuildIdx;
                    }
                } else {
                    totals = _accountPostThresholdReveal(
                        commitRbtsStakeReturned, commitRbtsForfeitedStake, commitKey, revealedCommit, totals
                    );
                }
            }
            unchecked {
                ++i;
            }
        }
        if (revealedBuildIdx < params.minParticipants) revert NotEnoughVotes();

        if (params.settlementEntropy == bytes32(0)) revert RbtsSeedUnavailable();

        // Seed combines delayed closure entropy with the settlement-closed scoring set.
        result.scoreSeed = _rbtsScoreSeed(
            params.contentId, params.roundId, revealedBuildIdx, scoringSetHash, params.settlementEntropy
        );
        (uint256 weightedScoreSum, uint256 scoreWeightSum) = _scoreRbtsRevealedSet(
            roundCommits,
            commitPredictedUpBps,
            commitRbtsWeight,
            commitRbtsScoreBps,
            commitIdentityKey,
            revealedKeysMem,
            result.scoreSeed,
            revealedBuildIdx
        );

        if (economicCount < params.minParticipants || scoreWeightSum == 0) {
            _returnScoredStakes(
                roundCommits, commitRbtsWeight, commitRbtsStakeReturned, revealedKeysMem, revealedBuildIdx
            );
            return result;
        }

        uint16 meanScoreBps = uint16(weightedScoreSum / scoreWeightSum);
        totals = _settleRbtsRevealedSet(
            roundCommits,
            commitRbtsWeight,
            commitRbtsScoreBps,
            commitRbtsRewardWeight,
            commitRbtsStakeReturned,
            commitRbtsForfeitedStake,
            revealedKeysMem,
            revealedBuildIdx,
            meanScoreBps
        );

        result.rewardWeight = totals.rewardWeight;
        result.rewardClaimants = totals.rewardClaimants;
        result.participationWeight = totals.participationWeight;
        result.participationClaimants = totals.participationClaimants;
        result.forfeitedPool = totals.forfeitedPool;
        result.forfeitClaimants = totals.forfeitClaimants;
        result.meanScoreBps = meanScoreBps;
    }

    function captureRbtsSeed(
        mapping(uint256 => mapping(uint256 => bytes32)) storage roundRbtsSeedEntropy,
        uint256 contentId,
        uint256 roundId
    ) external {
        _captureRbtsSeed(roundRbtsSeedEntropy, contentId, roundId);
    }

    function isExpiredRbtsSeed(
        mapping(uint256 => mapping(uint256 => bytes32)) storage roundRbtsSeedEntropy,
        uint256 contentId,
        uint256 roundId
    ) public view returns (bool) {
        uint256 seedWord = uint256(roundRbtsSeedEntropy[contentId][roundId]);
        if (seedWord < RBTS_SEED_BLOCK_FLAG) return false;
        uint256 seedBlock = uint64(seedWord);
        return block.number > seedBlock && Blockhash.blockHash(seedBlock) == bytes32(0);
    }

    function refreshExpiredRbtsSeed(
        mapping(uint256 => mapping(uint256 => bytes32)) storage roundRbtsSeedEntropy,
        uint256 contentId,
        uint256 roundId
    ) external returns (bool refreshed) {
        bytes32 currentMarker = roundRbtsSeedEntropy[contentId][roundId];
        uint256 seedWord = uint256(currentMarker);
        if (seedWord < RBTS_SEED_BLOCK_FLAG) return false;

        uint256 seedBlock = uint64(seedWord);
        if (block.number <= seedBlock || Blockhash.blockHash(seedBlock) != bytes32(0)) return false;

        bytes32 refreshedMarker = bytes32((seedWord & ~uint256(type(uint64).max)) | uint256(block.number.toUint64()));
        roundRbtsSeedEntropy[contentId][roundId] = refreshedMarker;
        emit RbtsSeedCaptured(contentId, roundId, refreshedMarker);
        return true;
    }

    function finalizeRbtsSeed(
        mapping(uint256 => mapping(uint256 => bytes32)) storage roundRbtsSeedEntropy,
        uint256 contentId,
        uint256 roundId
    ) external returns (bytes32 settlementEntropy) {
        settlementEntropy = roundRbtsSeedEntropy[contentId][roundId];
        uint256 seedWord = uint256(settlementEntropy);
        if (seedWord < RBTS_SEED_BLOCK_FLAG) return settlementEntropy;

        uint256 seedBlock = uint64(seedWord);
        if (block.number <= seedBlock) revert RevealGraceActive();
        bytes32 seedBlockhash = Blockhash.blockHash(seedBlock);
        if (seedBlockhash == bytes32(0)) {
            emit RbtsSeedCaptured(contentId, roundId, bytes32(0));
            revert RbtsSeedUnavailable();
        }
        settlementEntropy = keccak256(
            abi.encode(
                "rateloop.rbts.delayed-seed.v1",
                block.chainid,
                address(this),
                contentId,
                roundId,
                seedBlock,
                seedBlockhash
            )
        );
        emit RbtsSeedCaptured(contentId, roundId, settlementEntropy);
        return settlementEntropy;
    }

    function _effectiveStake(uint64 stakeAmount, uint8 epochIndex) private pure returns (uint64) {
        if (stakeAmount == 0) return 0;
        uint256 epochWeightBps = RoundLib.epochWeightBps(epochIndex);
        return ((uint256(stakeAmount) * epochWeightBps) / 10_000).toUint64();
    }

    function _captureRbtsSeed(
        mapping(uint256 => mapping(uint256 => bytes32)) storage roundRbtsSeedEntropy,
        uint256 contentId,
        uint256 roundId
    ) private {
        bytes32 seedBlockMarker = bytes32(
            RBTS_SEED_BLOCK_FLAG | (uint256(block.timestamp.toUint48()) << RBTS_SEED_TIMESTAMP_SHIFT)
                | uint256(block.number.toUint64())
        );
        roundRbtsSeedEntropy[contentId][roundId] = seedBlockMarker;
        emit RbtsSeedCaptured(contentId, roundId, seedBlockMarker);
    }

    function _ratingEvidenceWeight(uint64 stakeAmount, uint8 epochIndex) private pure returns (uint64) {
        uint256 stakeForBonus =
            stakeAmount > RATING_EVIDENCE_STAKE_BONUS_CAP ? RATING_EVIDENCE_STAKE_BONUS_CAP : stakeAmount;
        uint256 stakeBonus = (stakeForBonus * RATING_EVIDENCE_MAX_STAKE_BONUS) / RATING_EVIDENCE_STAKE_BONUS_CAP;
        uint256 rawEvidence = uint256(RATING_EVIDENCE_BASE_UNIT) + stakeBonus;
        uint256 epochWeightBps = RoundLib.epochWeightBps(epochIndex);
        return ((rawEvidence * epochWeightBps) / 10_000).toUint64();
    }

    function _accumulateRbtsCommitScore(
        mapping(bytes32 => RoundLib.Commit) storage roundCommits,
        mapping(bytes32 => uint256) storage commitRbtsWeight,
        mapping(bytes32 => uint16) storage commitRbtsScoreBps,
        mapping(bytes32 => uint256) storage commitRbtsRewardWeight,
        mapping(bytes32 => uint256) storage commitRbtsStakeReturned,
        mapping(bytes32 => uint256) storage commitRbtsForfeitedStake,
        bytes32 commitKey,
        uint16 meanScoreBps,
        uint256 positiveSpreadWeight,
        RbtsRoundTotals memory totals
    ) private returns (RbtsRoundTotals memory) {
        uint16 scoreBps = commitRbtsScoreBps[commitKey];
        uint256 scoreWeight =
            RewardMath.calculatePositiveScoreSpreadWeight(commitRbtsWeight[commitKey], scoreBps, meanScoreBps);
        uint256 stakeAmount = roundCommits[commitKey].stakeAmount;
        uint256 forfeitedStake = positiveSpreadWeight == 0
            ? 0
            : RewardMath.calculateNegativeScoreSpreadForfeit(stakeAmount, scoreBps, meanScoreBps);
        uint256 stakeReturned = stakeAmount - forfeitedStake;

        commitRbtsRewardWeight[commitKey] = scoreWeight;
        commitRbtsStakeReturned[commitKey] = stakeReturned;
        commitRbtsForfeitedStake[commitKey] = forfeitedStake;

        totals.rewardWeight += scoreWeight;
        totals.forfeitedPool += forfeitedStake;
        totals.meanScoreBps = meanScoreBps;
        if (commitRbtsWeight[commitKey] > 0) {
            totals.participationWeight += commitRbtsWeight[commitKey];
            unchecked {
                ++totals.participationClaimants;
            }
        }
        if (scoreWeight > 0) {
            unchecked {
                ++totals.rewardClaimants;
            }
        }
        if (forfeitedStake > 0) {
            unchecked {
                ++totals.forfeitClaimants;
            }
        }
        return totals;
    }

    function _scoreRbtsRevealedSet(
        mapping(bytes32 => RoundLib.Commit) storage roundCommits,
        mapping(bytes32 => uint16) storage commitPredictedUpBps,
        mapping(bytes32 => uint256) storage commitRbtsWeight,
        mapping(bytes32 => uint16) storage commitRbtsScoreBps,
        mapping(bytes32 => bytes32) storage commitIdentityKey,
        bytes32[] memory revealedKeys,
        bytes32 scoreSeed,
        uint256 revealedCount
    ) private returns (uint256 weightedScoreSum, uint256 scoreWeightSum) {
        for (uint256 r = 0; r < revealedCount;) {
            bytes32 commitKey = revealedKeys[r];
            uint16 scoreBps = _scoreRbtsCommitAt(
                roundCommits,
                commitPredictedUpBps,
                commitRbtsScoreBps,
                commitIdentityKey,
                revealedKeys,
                scoreSeed,
                r,
                revealedCount
            );
            uint256 ownWeight = commitRbtsWeight[commitKey];
            if (ownWeight > 0) {
                weightedScoreSum += ownWeight * scoreBps;
                scoreWeightSum += ownWeight;
            }
            unchecked {
                ++r;
            }
        }
    }

    function _settleRbtsRevealedSet(
        mapping(bytes32 => RoundLib.Commit) storage roundCommits,
        mapping(bytes32 => uint256) storage commitRbtsWeight,
        mapping(bytes32 => uint16) storage commitRbtsScoreBps,
        mapping(bytes32 => uint256) storage commitRbtsRewardWeight,
        mapping(bytes32 => uint256) storage commitRbtsStakeReturned,
        mapping(bytes32 => uint256) storage commitRbtsForfeitedStake,
        bytes32[] memory revealedKeys,
        uint256 revealedCount,
        uint16 meanScoreBps
    ) private returns (RbtsRoundTotals memory totals) {
        uint256 positiveSpreadWeight;
        for (uint256 r = 0; r < revealedCount;) {
            bytes32 commitKey = revealedKeys[r];
            positiveSpreadWeight += RewardMath.calculatePositiveScoreSpreadWeight(
                commitRbtsWeight[commitKey], commitRbtsScoreBps[commitKey], meanScoreBps
            );
            unchecked {
                ++r;
            }
        }

        for (uint256 r = 0; r < revealedCount;) {
            totals = _accumulateRbtsCommitScore(
                roundCommits,
                commitRbtsWeight,
                commitRbtsScoreBps,
                commitRbtsRewardWeight,
                commitRbtsStakeReturned,
                commitRbtsForfeitedStake,
                revealedKeys[r],
                meanScoreBps,
                positiveSpreadWeight,
                totals
            );
            unchecked {
                ++r;
            }
        }
    }

    function _accountPostThresholdReveal(
        mapping(bytes32 => uint256) storage commitRbtsStakeReturned,
        mapping(bytes32 => uint256) storage commitRbtsForfeitedStake,
        bytes32 commitKey,
        RoundLib.Commit storage commit,
        RbtsRoundTotals memory totals
    ) private returns (RbtsRoundTotals memory) {
        if (commit.stakeAmount == 0) return totals;
        commitRbtsStakeReturned[commitKey] = commit.stakeAmount;
        commitRbtsForfeitedStake[commitKey] = 0;
        return totals;
    }

    function _returnScoredStakes(
        mapping(bytes32 => RoundLib.Commit) storage roundCommits,
        mapping(bytes32 => uint256) storage commitRbtsWeight,
        mapping(bytes32 => uint256) storage commitRbtsStakeReturned,
        bytes32[] memory revealedKeys,
        uint256 revealedCount
    ) private {
        for (uint256 i = 0; i < revealedCount;) {
            bytes32 commitKey = revealedKeys[i];
            if (commitRbtsWeight[commitKey] > 0) {
                commitRbtsStakeReturned[commitKey] = roundCommits[commitKey].stakeAmount;
            }
            unchecked {
                ++i;
            }
        }
    }

    function _scoreRbtsCommitAt(
        mapping(bytes32 => RoundLib.Commit) storage roundCommits,
        mapping(bytes32 => uint16) storage commitPredictedUpBps,
        mapping(bytes32 => uint16) storage commitRbtsScoreBps,
        mapping(bytes32 => bytes32) storage commitIdentityKey,
        bytes32[] memory revealedKeys,
        bytes32 scoreSeed,
        uint256 ownRevealedIdx,
        uint256 revealedCount
    ) private returns (uint16) {
        bytes32 commitKey = revealedKeys[ownRevealedIdx];
        bytes32 drawKey = _rbtsDrawKey(roundCommits, commitIdentityKey, commitKey);

        // M-Vote-4 (audit 2026-05-17): sample directly over the revealed set produced by the
        // first pass. Every revealed voter has equal probability of being drawn as reference
        // or peer for any other revealed voter; the unrevealed set carries no sampler weight.
        // The seed itself is still hashed over the full committed set (M-Vote-2), so selective
        // reveal cannot grind it.
        uint256 referenceIndex = _rbtsOtherIndex(scoreSeed, drawKey, ownRevealedIdx, revealedCount, 1);
        bytes32 referenceKey = revealedKeys[referenceIndex];
        uint256 peerIndex = _rbtsPeerIndex(scoreSeed, drawKey, ownRevealedIdx, referenceIndex, revealedCount);
        bytes32 peerKey = revealedKeys[peerIndex];
        return
            _scoreRbtsCommit(roundCommits, commitPredictedUpBps, commitRbtsScoreBps, commitKey, referenceKey, peerKey);
    }

    function _scoreRbtsCommit(
        mapping(bytes32 => RoundLib.Commit) storage roundCommits,
        mapping(bytes32 => uint16) storage commitPredictedUpBps,
        mapping(bytes32 => uint16) storage commitRbtsScoreBps,
        bytes32 commitKey,
        bytes32 referenceKey,
        bytes32 peerKey
    ) private returns (uint16 scoreBps) {
        scoreBps = RobustBtsMath.scoreBps(
            roundCommits[commitKey].isUp,
            commitPredictedUpBps[commitKey],
            commitPredictedUpBps[referenceKey],
            roundCommits[peerKey].isUp
        );
        commitRbtsScoreBps[commitKey] = scoreBps;
    }

    /// @notice Compute the RBTS sampler seed.
    /// @dev The seed binds:
    ///      - `block.chainid` and `address(this)` (cross-chain / cross-engine replay protection),
    ///      - `contentId` / `roundId` (per-round uniqueness),
    ///      - `scoringSetCount` and `scoringSetHash` (the settlement-closed RBTS
    ///        scoring set in commit order, excluding unrevealed current-epoch commits that are
    ///        allowed to settle/refund),
    ///      - `settlementEntropy`, captured when settlement closes the scoring set so
    ///        neither the last committer nor the settlement caller can overwrite the entropy while
    ///        choosing whether to proceed.
    ///      Together the delayed entropy and closed scoring set make the seed fixed after closure
    ///      and invariant to non-scoring commits.
    function _rbtsScoreSeed(
        uint256 contentId,
        uint256 roundId,
        uint256 scoringSetCount,
        bytes32 scoringSetHash,
        bytes32 settlementEntropy
    ) private view returns (bytes32 scoreSeed) {
        scoreSeed = keccak256(
            abi.encode(
                block.chainid, address(this), contentId, roundId, scoringSetCount, scoringSetHash, settlementEntropy
            )
        );
    }

    function _rbtsDrawKey(
        mapping(bytes32 => RoundLib.Commit) storage roundCommits,
        mapping(bytes32 => bytes32) storage commitIdentityKey,
        bytes32 commitKey
    ) private view returns (bytes32) {
        bytes32 identityKey = commitIdentityKey[commitKey];
        if (identityKey != bytes32(0)) return identityKey;
        return VotePreflightLib.addressIdentityKey(roundCommits[commitKey].voter);
    }

    function _rbtsOtherIndex(bytes32 seed, bytes32 drawKey, uint256 ownIndex, uint256 count, uint8 domain)
        private
        pure
        returns (uint256)
    {
        // Deterministic sampler over the settlement-closed scoring set.
        // slither-disable-next-line weak-prng
        uint256 drawn = uint256(keccak256(abi.encodePacked(seed, drawKey, ownIndex, domain))) % (count - 1);
        return drawn >= ownIndex ? drawn + 1 : drawn;
    }

    function _rbtsPeerIndex(bytes32 seed, bytes32 drawKey, uint256 ownIndex, uint256 referenceIndex, uint256 count)
        private
        pure
        returns (uint256)
    {
        // Deterministic sampler over the settlement-closed scoring set.
        // slither-disable-next-line weak-prng
        uint256 drawn = uint256(keccak256(abi.encodePacked(seed, drawKey, ownIndex, uint8(2)))) % (count - 2);
        uint256 firstExcluded = ownIndex < referenceIndex ? ownIndex : referenceIndex;
        uint256 secondExcluded = ownIndex < referenceIndex ? referenceIndex : ownIndex;
        if (drawn >= firstExcluded) ++drawn;
        if (drawn >= secondExcluded) ++drawn;
        return drawn;
    }
}
