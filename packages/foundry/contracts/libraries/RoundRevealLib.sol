// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { SafeCast } from "@openzeppelin/contracts/utils/math/SafeCast.sol";

import { RobustBtsMath } from "./RobustBtsMath.sol";
import { RoundLib } from "./RoundLib.sol";
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

    error RoundNotOpen();
    error NoCommit();
    error AlreadyRevealed();
    error EpochNotEnded();
    error HashMismatch();
    error NotEnoughVotes();
    error RevealGraceActive();

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
    }

    struct RbtsRoundTotals {
        uint256 rewardWeight;
        uint256 rewardClaimants;
        uint256 participationClaimants;
        uint256 participationWeight;
        uint256 forfeitedPool;
        uint256 forfeitClaimants;
    }

    struct ScoreRbtsResult {
        uint256 rewardWeight;
        uint256 rewardClaimants;
        uint256 participationClaimants;
        uint256 participationWeight;
        uint256 forfeitedPool;
        uint256 forfeitClaimants;
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

        if (params.isUp) {
            round.upPool += commit.stakeAmount;
            round.upCount++;
        } else {
            round.downPool += commit.stakeAmount;
            round.downCount++;
        }

        effectiveStake = _effectiveStake(commit.stakeAmount, commit.epochIndex);
        ratingEvidenceWeight = _ratingEvidenceWeight(commit.stakeAmount, commit.epochIndex);
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

    struct ScoreRbtsParams {
        uint256 contentId;
        uint256 roundId;
        uint256 revealedCount;
        bool upWins;
        uint16 minParticipants;
        uint16 scoreScaleBps;
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

        // M-Vote-2: the sampler SEED is hashed over the full COMMITTED set (every commitKey,
        // revealed or not, in commit order), so selective reveal cannot grind the seed.
        // The sampler INDEX SPACE is frozen to commits whose RBTS weight was recorded before
        // reveal threshold. This avoids block.timestamp ambiguity for post-threshold reveals
        // included in the same block as the quorum-closing reveal.
        uint256 committedCount = commitKeys.length;
        bytes32[] memory revealedKeysMem = new bytes32[](committedCount);
        bytes32 committedSetHash;
        uint256 revealedBuildIdx;
        uint256 economicCount;
        RbtsRoundTotals memory totals;
        for (uint256 i = 0; i < committedCount;) {
            bytes32 commitKey = commitKeys[i];
            committedSetHash = keccak256(abi.encodePacked(committedSetHash, commitKey));
            RoundLib.Commit storage revealedCommit = roundCommits[commitKey];
            if (revealedCommit.revealed) {
                if (commitRbtsWeight[commitKey] > 0) {
                    revealedKeysMem[revealedBuildIdx] = commitKey;
                    unchecked {
                        ++economicCount;
                    }
                    unchecked {
                        ++revealedBuildIdx;
                    }
                } else {
                    totals = _accountPostThresholdReveal(
                        commitRbtsStakeReturned,
                        commitRbtsForfeitedStake,
                        commitKey,
                        revealedCommit,
                        params.upWins,
                        totals
                    );
                }
            }
            unchecked {
                ++i;
            }
        }
        if (revealedBuildIdx < params.minParticipants) revert NotEnoughVotes();

        // Seed combines post-threshold entropy with M-Vote-2 (committed-set binding):
        // fixed after the commit set closes and invariant under selective reveal.
        result.scoreSeed = _rbtsScoreSeed(
            params.contentId, params.roundId, committedCount, committedSetHash, params.settlementEntropy
        );
        for (uint256 r = 0; r < revealedBuildIdx;) {
            bytes32 commitKey = revealedKeysMem[r];
            uint256 ownWeight = commitRbtsWeight[commitKey];
            uint16 scoreBps = _scoreRbtsCommitAt(
                roundCommits,
                commitPredictedUpBps,
                commitRbtsScoreBps,
                commitIdentityKey,
                revealedKeysMem,
                result.scoreSeed,
                r,
                revealedBuildIdx
            );

            if (ownWeight == 0 || economicCount < params.minParticipants) {
                if (ownWeight > 0) {
                    commitRbtsStakeReturned[commitKey] = roundCommits[commitKey].stakeAmount;
                }
                unchecked {
                    ++r;
                }
                continue;
            }

            totals = _accumulateRbtsCommitScore(
                roundCommits,
                commitRbtsRewardWeight,
                commitRbtsStakeReturned,
                commitRbtsForfeitedStake,
                commitKey,
                ownWeight,
                scoreBps,
                params.upWins,
                totals,
                params.scoreScaleBps
            );
            unchecked {
                ++r;
            }
        }

        result.rewardWeight = totals.rewardWeight;
        result.rewardClaimants = totals.rewardClaimants;
        result.participationWeight = totals.participationWeight;
        result.participationClaimants = totals.participationClaimants;
        result.forfeitedPool = totals.forfeitedPool;
        result.forfeitClaimants = totals.forfeitClaimants;
    }

    function captureRbtsSeed(
        mapping(uint256 => mapping(uint256 => bytes32)) storage roundRbtsSeedEntropy,
        uint256 contentId,
        uint256 roundId
    ) external {
        _captureRbtsSeed(roundRbtsSeedEntropy, contentId, roundId);
    }

    function refreshRbtsSeed(
        mapping(uint256 => mapping(uint256 => bytes32)) storage roundRbtsSeedEntropy,
        uint256 contentId,
        uint256 roundId
    ) external {
        uint256 seedWord = uint256(roundRbtsSeedEntropy[contentId][roundId]);
        if (seedWord < RBTS_SEED_BLOCK_FLAG) revert RevealGraceActive();
        uint256 seedBlock = seedWord ^ RBTS_SEED_BLOCK_FLAG;
        if (block.number <= seedBlock || blockhash(seedBlock) != bytes32(0)) revert RevealGraceActive();
        _captureRbtsSeed(roundRbtsSeedEntropy, contentId, roundId);
    }

    function finalizeRbtsSeed(
        mapping(uint256 => mapping(uint256 => bytes32)) storage roundRbtsSeedEntropy,
        uint256 contentId,
        uint256 roundId
    ) external returns (bytes32 settlementEntropy) {
        settlementEntropy = roundRbtsSeedEntropy[contentId][roundId];
        uint256 seedWord = uint256(settlementEntropy);
        if (seedWord < RBTS_SEED_BLOCK_FLAG) return settlementEntropy;

        uint256 seedBlock = seedWord ^ RBTS_SEED_BLOCK_FLAG;
        if (block.number <= seedBlock) revert RevealGraceActive();
        bytes32 seedBlockhash = blockhash(seedBlock);
        if (seedBlockhash == bytes32(0)) revert RevealGraceActive();
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
        roundRbtsSeedEntropy[contentId][roundId] = settlementEntropy;
        emit RbtsSeedCaptured(contentId, roundId, settlementEntropy);
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
        bytes32 seedBlockMarker = bytes32(RBTS_SEED_BLOCK_FLAG | block.number);
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
        mapping(bytes32 => uint256) storage commitRbtsRewardWeight,
        mapping(bytes32 => uint256) storage commitRbtsStakeReturned,
        mapping(bytes32 => uint256) storage commitRbtsForfeitedStake,
        bytes32 commitKey,
        uint256 ownWeight,
        uint16 scoreBps,
        bool upWins,
        RbtsRoundTotals memory totals,
        uint16 scoreScaleBps
    ) private returns (RbtsRoundTotals memory) {
        uint256 scoreWeight = (ownWeight * scoreBps) / scoreScaleBps;
        uint256 stakeAmount = roundCommits[commitKey].stakeAmount;
        uint256 stakeReturned = (stakeAmount * scoreBps) / scoreScaleBps;
        uint256 forfeitedStake = stakeAmount - stakeReturned;

        commitRbtsRewardWeight[commitKey] = scoreWeight;
        commitRbtsStakeReturned[commitKey] = stakeReturned;
        commitRbtsForfeitedStake[commitKey] = forfeitedStake;

        totals.rewardWeight += scoreWeight;
        totals.forfeitedPool += forfeitedStake;
        if (scoreWeight > 0) {
            if (roundCommits[commitKey].isUp == upWins) {
                totals.participationWeight += scoreWeight;
                unchecked {
                    ++totals.participationClaimants;
                }
            }
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

    function _accountPostThresholdReveal(
        mapping(bytes32 => uint256) storage commitRbtsStakeReturned,
        mapping(bytes32 => uint256) storage commitRbtsForfeitedStake,
        bytes32 commitKey,
        RoundLib.Commit storage commit,
        bool upWins,
        RbtsRoundTotals memory totals
    ) private returns (RbtsRoundTotals memory) {
        if (commit.stakeAmount == 0) return totals;
        if (commit.isUp == upWins) {
            commitRbtsStakeReturned[commitKey] = commit.stakeAmount;
            return totals;
        }
        commitRbtsForfeitedStake[commitKey] = commit.stakeAmount;
        totals.forfeitedPool += commit.stakeAmount;
        unchecked {
            ++totals.forfeitClaimants;
        }
        return totals;
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
    ///      - `committedCount` and `committedSetHash` (M-Vote-2: the FULL committed set in
    ///        commit order, not the revealed subset; selective reveal cannot move the seed),
    ///      - `settlementEntropy`, captured when reveal quorum first closes the commit set so
    ///        neither the last committer nor the settlement caller can overwrite the entropy while
    ///        choosing whether to proceed.
    ///      Together the post-threshold entropy + M-Vote-2 make the seed fixed after commits close
    ///      and invariant under any honest or adversarial reveal pattern.
    function _rbtsScoreSeed(
        uint256 contentId,
        uint256 roundId,
        uint256 committedCount,
        bytes32 committedSetHash,
        bytes32 settlementEntropy
    ) private view returns (bytes32 scoreSeed) {
        scoreSeed = keccak256(
            abi.encode(
                block.chainid, address(this), contentId, roundId, committedCount, committedSetHash, settlementEntropy
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
        // Deterministic sampler over the threshold-frozen scoring set.
        // slither-disable-next-line weak-prng
        uint256 drawn = uint256(keccak256(abi.encodePacked(seed, drawKey, ownIndex, domain))) % (count - 1);
        return drawn >= ownIndex ? drawn + 1 : drawn;
    }

    function _rbtsPeerIndex(bytes32 seed, bytes32 drawKey, uint256 ownIndex, uint256 referenceIndex, uint256 count)
        private
        pure
        returns (uint256)
    {
        // Deterministic sampler over the threshold-frozen scoring set.
        // slither-disable-next-line weak-prng
        uint256 drawn = uint256(keccak256(abi.encodePacked(seed, drawKey, ownIndex, uint8(2)))) % (count - 2);
        uint256 firstExcluded = ownIndex < referenceIndex ? ownIndex : referenceIndex;
        uint256 secondExcluded = ownIndex < referenceIndex ? referenceIndex : ownIndex;
        if (drawn >= firstExcluded) ++drawn;
        if (drawn >= secondExcluded) ++drawn;
        return drawn;
    }
}
