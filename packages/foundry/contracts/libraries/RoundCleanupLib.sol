// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import { ProtocolConfig } from "../ProtocolConfig.sol";
import { IRaterIdentityRegistry } from "../interfaces/IRaterIdentityRegistry.sol";
import { RoundLib } from "./RoundLib.sol";
import { TlockVoteLib } from "./TlockVoteLib.sol";
import { TokenTransferLib } from "./TokenTransferLib.sol";
import { VotePreflightLib } from "./VotePreflightLib.sol";

interface IRoundCleanupActivityRegistry {
    function updateActivity(uint256 contentId) external;
}

/// @title RoundCleanupLib
/// @notice Shared refund and cleanup paths extracted from RoundVotingEngine to reduce runtime size.
library RoundCleanupLib {
    using SafeERC20 for IERC20;

    uint256 internal constant CLEANUP_INCENTIVE_BPS = 100; // 1%
    uint256 internal constant CLEANUP_INCENTIVE_MAX = 5e6; // 5 LREP

    /// @notice Cleanup incentive rate applied to refunded stake (refunds go back to voters
    ///         rather than to the treasury or consensus reserve, so the incentive on this
    ///         portion is funded out of the engine's consensus reserve and capped by the
    ///         per-round 5 LREP envelope shared with the forfeit-driven incentive).
    /// @dev Tuned lower than `CLEANUP_INCENTIVE_BPS` (1%) because refunds carry no
    ///      treasury / reserve credit to pay from. Set as a constant so future tuning is a
    ///      one-line change; keep below `CLEANUP_INCENTIVE_BPS` to avoid making refund-only
    ///      cleanups more attractive than forfeit-heavy ones.
    uint256 internal constant REFUND_CLEANUP_INCENTIVE_BPS = 25; // 0.25%

    error RoundNotCancelledOrTied();
    error AlreadyClaimed();
    error NoCommit();
    error NoStake();
    error VoteNotRevealed();
    error NothingProcessed();

    function targetRoundRevealableAt(
        mapping(uint256 => bytes32) storage roundDrandChainHashSnapshot,
        mapping(uint256 => uint64) storage roundDrandGenesisTimeSnapshot,
        mapping(uint256 => uint64) storage roundDrandPeriodSnapshot,
        ProtocolConfig protocolConfig,
        uint256 roundId,
        uint64 targetRound
    ) external view returns (uint256) {
        uint64 genesisTime = roundDrandGenesisTimeSnapshot[roundId];
        uint64 period = roundDrandPeriodSnapshot[roundId];
        if (roundDrandChainHashSnapshot[roundId] == bytes32(0) || genesisTime == 0 || period == 0) {
            genesisTime = protocolConfig.drandGenesisTime();
            period = protocolConfig.drandPeriod();
        }
        if (targetRound == 0 || genesisTime == 0 || period == 0) revert TlockVoteLib.TargetRoundOutOfWindow();
        return uint256(genesisTime) + (uint256(targetRound) - 1) * uint256(period);
    }

    function validateCommitTlockData(
        mapping(uint256 => bytes32) storage roundDrandChainHashSnapshot,
        mapping(uint256 => uint64) storage roundDrandGenesisTimeSnapshot,
        mapping(uint256 => uint64) storage roundDrandPeriodSnapshot,
        ProtocolConfig protocolConfig,
        uint256 roundId,
        bytes memory ciphertext,
        uint64 targetRound,
        bytes32 drandChainHash,
        uint256 epochEnd,
        uint256 epochDuration
    ) external view {
        bytes32 chainHash = roundDrandChainHashSnapshot[roundId];
        uint64 genesisTime = roundDrandGenesisTimeSnapshot[roundId];
        uint64 period = roundDrandPeriodSnapshot[roundId];

        if (chainHash == bytes32(0) || genesisTime == 0 || period == 0) {
            chainHash = protocolConfig.drandChainHash();
            genesisTime = protocolConfig.drandGenesisTime();
            period = protocolConfig.drandPeriod();
        }

        TlockVoteLib.validateCommitData(
            ciphertext, targetRound, drandChainHash, chainHash, epochEnd, epochDuration, genesisTime, period
        );
    }

    function canFinalizeRevealFailedRound(
        RoundLib.Round storage round,
        mapping(uint256 => RoundLib.RoundConfig) storage roundConfigSnapshot,
        mapping(uint256 => uint256) storage roundRevealGracePeriodSnapshot,
        mapping(uint256 => uint256) storage lastCommitRevealableAfter,
        ProtocolConfig protocolConfig,
        uint256 roundId,
        uint16 minRbtsParticipants
    ) external view returns (bool) {
        if (round.state != RoundLib.RoundState.Open) return false;

        RoundLib.RoundConfig memory roundCfg = _getRoundConfig(roundConfigSnapshot, protocolConfig, roundId);
        uint16 rbtsRevealQuorum = _rbtsRevealQuorum(roundCfg.minVoters, minRbtsParticipants);
        if (round.voteCount < rbtsRevealQuorum) return false;
        if (round.revealedCount >= rbtsRevealQuorum) return false;

        uint256 finalizationTime = _getRevealFailedFinalizationTime(
            round,
            roundConfigSnapshot,
            roundRevealGracePeriodSnapshot,
            lastCommitRevealableAfter,
            protocolConfig,
            roundId
        );
        return finalizationTime != 0 && block.timestamp >= finalizationTime;
    }

    function isSettlementRevealGraceElapsed(
        RoundLib.Round storage round,
        mapping(uint256 => RoundLib.RoundConfig) storage roundConfigSnapshot,
        mapping(uint256 => uint256) storage roundRevealGracePeriodSnapshot,
        mapping(uint256 => uint256) storage lastCommitRevealableAfter,
        ProtocolConfig protocolConfig,
        uint256 roundId
    ) external view returns (bool) {
        uint256 lastRevealableAt = lastCommitRevealableAfter[roundId];
        if (lastRevealableAt == 0) return false;

        uint256 revealBase = lastRevealableAt;
        if (round.thresholdReachedAt == 0) {
            RoundLib.RoundConfig memory roundCfg = _getRoundConfig(roundConfigSnapshot, protocolConfig, roundId);
            uint256 votingWindowEnd = uint256(round.startTime) + roundCfg.maxDuration;
            if (votingWindowEnd > revealBase) revealBase = votingWindowEnd;
        }

        return block.timestamp
            >= revealBase + _getRoundRevealGracePeriod(roundRevealGracePeriodSnapshot, protocolConfig, roundId);
    }

    function pastEpochUnrevealedCount(
        mapping(uint256 => uint256) storage epochUnrevealedCount,
        RoundLib.Round storage round,
        RoundLib.RoundConfig memory roundCfg
    ) external view returns (uint256 total) {
        uint256 epochEnd = round.startTime + roundCfg.epochDuration;
        uint256 maxEpochEnd = round.startTime + roundCfg.maxDuration + roundCfg.epochDuration;
        while (epochEnd <= block.timestamp && epochEnd <= maxEpochEnd) {
            total += epochUnrevealedCount[epochEnd];
            epochEnd += roundCfg.epochDuration;
        }
    }

    function resolveClaimCommit(
        mapping(address => bytes32) storage roundVoterCommitHash,
        mapping(bytes32 => bytes32) storage roundIdentityCommitKey,
        mapping(bytes32 => address) storage roundCommitIdentityHolder,
        IRaterIdentityRegistry identityRegistry,
        address account
    ) external view returns (bytes32 commitKey, address rewardRecipient) {
        IRaterIdentityRegistry.ResolvedRater memory resolved = VotePreflightLib.resolveRater(identityRegistry, account);
        if (resolved.identityKey != bytes32(0)) {
            commitKey = roundIdentityCommitKey[resolved.identityKey];
            if (commitKey != bytes32(0)) {
                rewardRecipient = resolved.holder == address(0) ? account : resolved.holder;
                return (commitKey, rewardRecipient);
            }
        }

        bytes32 directCommitHash = roundVoterCommitHash[account];
        if (directCommitHash != bytes32(0)) {
            commitKey = keccak256(abi.encodePacked(account, directCommitHash));
            rewardRecipient = roundCommitIdentityHolder[commitKey];
            return (commitKey, rewardRecipient == address(0) ? account : rewardRecipient);
        }

        return (bytes32(0), account);
    }

    function recordCommitIndexes(
        bytes32[] storage roundCommitHashes,
        mapping(uint256 => uint256) storage epochUnrevealedCount,
        mapping(uint256 => uint256) storage lastCommitRevealableAfter,
        mapping(address => bytes32) storage roundVoterCommitHash,
        uint256 roundId,
        bytes32 commitKey,
        uint256 epochEnd,
        uint256 effectiveRevealableAfter,
        address voter,
        bytes32 commitHash
    ) external {
        roundCommitHashes.push(commitKey);
        epochUnrevealedCount[epochEnd]++;
        if (effectiveRevealableAfter > lastCommitRevealableAfter[roundId]) {
            lastCommitRevealableAfter[roundId] = effectiveRevealableAfter;
        }

        roundVoterCommitHash[voter] = commitHash;
    }

    function recordIdentityCommitIndex(
        mapping(bytes32 => bytes32) storage roundIdentityCommitKey,
        mapping(bytes32 => bytes32) storage roundCommitIdentityKey,
        mapping(bytes32 => address) storage roundCommitIdentityHolder,
        bytes32 commitKey,
        bytes32 identityKey,
        address identityHolder
    ) external {
        roundIdentityCommitKey[identityKey] = commitKey;
        roundCommitIdentityKey[commitKey] = identityKey;
        roundCommitIdentityHolder[commitKey] = identityHolder;
    }

    function recordCommitAccounting(
        RoundLib.Round storage round,
        mapping(address => uint256) storage contentLastVoteTimestamp,
        mapping(bytes32 => uint256) storage contentLastVoteTimestampByIdentity,
        mapping(uint256 => mapping(bytes32 => uint256)) storage contentRoundIdentityStake,
        address registry,
        uint256 contentId,
        uint256 roundId,
        address voter,
        bytes32 identityKey,
        uint64 stakeAmount64,
        uint256 stakeAmount
    ) external {
        round.voteCount++;
        round.totalStake += stakeAmount64;

        contentLastVoteTimestamp[voter] = block.timestamp;
        contentLastVoteTimestampByIdentity[identityKey] = block.timestamp;
        contentRoundIdentityStake[roundId][identityKey] += stakeAmount;

        // Vote commits still refresh UI activity timestamps, but not the dormancy anchor.
        IRoundCleanupActivityRegistry(registry).updateActivity(contentId);
    }

    function claimCancelledRoundRefund(
        RoundLib.Round storage round,
        mapping(address => bool) storage refundClaims,
        mapping(bytes32 => bool) storage refundCommitClaims,
        mapping(bytes32 => RoundLib.Commit) storage roundCommits,
        IERC20 lrepToken,
        bytes32 commitKey
    ) external returns (uint256 refundAmount, address commitVoter) {
        if (
            round.state != RoundLib.RoundState.Cancelled && round.state != RoundLib.RoundState.Tied
                && round.state != RoundLib.RoundState.RevealFailed
        ) {
            revert RoundNotCancelledOrTied();
        }
        if (refundCommitClaims[commitKey]) revert AlreadyClaimed();

        RoundLib.Commit storage commit = roundCommits[commitKey];
        commitVoter = commit.voter;
        if (refundClaims[commitVoter]) revert AlreadyClaimed();
        refundAmount = commit.stakeAmount;
        if (refundAmount == 0) revert NoStake();
        if (round.state != RoundLib.RoundState.Cancelled && !commit.revealed) revert VoteNotRevealed();

        commit.stakeAmount = 0;
        refundCommitClaims[commitKey] = true;
        refundClaims[commitVoter] = true;

        lrepToken.safeTransfer(commitVoter, refundAmount);
    }

    function processUnrevealedVotes(
        RoundLib.Round storage round,
        bytes32[] storage commitKeys,
        mapping(bytes32 => RoundLib.Commit) storage roundCommits,
        mapping(uint256 => mapping(uint256 => uint256)) storage roundCleanupIncentivePaid,
        uint256 contentId,
        uint256 roundId,
        IERC20 lrepToken,
        ProtocolConfig protocolConfig,
        uint256 consensusReserve,
        address cleanupCaller,
        uint256 startIndex,
        uint256 count
    )
        external
        returns (
            uint256 forfeitedToTreasury,
            uint256 addedToConsensusReserve,
            uint256 refundedLrep,
            uint256 processedPastEpochCount,
            uint256 cleanupIncentive,
            uint256 updatedConsensusReserve,
            uint256 deferredCleanupBounty
        )
    {
        uint256 len = commitKeys.length;
        // Treat `count == 0` and any `count` whose remaining range covers the rest of the
        // array as "process all". Use `unchecked` because callers may pass `type(uint256).max`
        // as a sentinel and `startIndex + count` would otherwise revert with Panic(0x11).
        uint256 endIndex;
        unchecked {
            uint256 candidate = startIndex + count;
            endIndex = (count == 0 || candidate < startIndex || candidate > len) ? len : candidate;
        }
        updatedConsensusReserve = consensusReserve;

        for (uint256 i = startIndex; i < endIndex; i++) {
            RoundLib.Commit storage commit = roundCommits[commitKeys[i]];
            if (!commit.revealed && commit.stakeAmount > 0) {
                uint256 amount = commit.stakeAmount;
                commit.stakeAmount = 0;

                if (round.state == RoundLib.RoundState.RevealFailed || commit.revealableAfter <= round.settledAt) {
                    processedPastEpochCount++;
                    if (round.state == RoundLib.RoundState.Settled) {
                        addedToConsensusReserve += amount;
                        updatedConsensusReserve += amount;
                    } else {
                        forfeitedToTreasury += amount;
                    }
                } else {
                    try TokenTransferLib.safeTransfer(lrepToken, commit.voter, amount) {
                        refundedLrep += amount;
                    } catch {
                        forfeitedToTreasury += amount;
                    }
                }
            }
        }

        uint256 cleanupIncentivePaid = roundCleanupIncentivePaid[contentId][roundId];
        cleanupIncentive = _cleanupIncentive(
            forfeitedToTreasury + addedToConsensusReserve, refundedLrep, 5e6 - cleanupIncentivePaid
        );
        if (cleanupIncentive > 0) {
            // Drain the forfeit/reserve pots first (they're the natural source); whatever
            // remains for refund-only rounds is paid out of the engine's consensus reserve
            // so that refunded voters are not shorted by the keeper bounty.
            uint256 remainingIncentive = cleanupIncentive;
            uint256 fromReserve =
                addedToConsensusReserve < remainingIncentive ? addedToConsensusReserve : remainingIncentive;
            if (fromReserve > 0) {
                addedToConsensusReserve -= fromReserve;
                updatedConsensusReserve -= fromReserve;
                remainingIncentive -= fromReserve;
            }
            uint256 fromTreasuryForfeiture =
                forfeitedToTreasury < remainingIncentive ? forfeitedToTreasury : remainingIncentive;
            if (fromTreasuryForfeiture > 0) {
                forfeitedToTreasury -= fromTreasuryForfeiture;
                remainingIncentive -= fromTreasuryForfeiture;
            }
            if (remainingIncentive > 0) {
                // Refund-only path: pay what we can out of the engine's consensus reserve.
                // `_cleanupIncentive` only knows the per-round 5 LREP cap, not the live reserve
                // balance, so for refund-only batches the residual can exceed the reserve --
                // most commonly the zero-reserve case at protocol startup. Pay what the reserve
                // covers immediately; defer the rest as a per-(round, keeper) IOU that the
                // keeper can later collect via `claimDeferredCleanupBounty` once the reserve
                // has been topped up. The processed votes have already had their stake zeroed
                // so a later batch on the same range cannot recompute this incentive
                // (codex PR #12 review).
                uint256 fromRefundReserve =
                    updatedConsensusReserve < remainingIncentive ? updatedConsensusReserve : remainingIncentive;
                updatedConsensusReserve -= fromRefundReserve;
                if (fromRefundReserve < remainingIncentive) {
                    deferredCleanupBounty = remainingIncentive - fromRefundReserve;
                    cleanupIncentive -= deferredCleanupBounty;
                }
            }
            // Count BOTH the immediately-paid and the deferred portions toward the per-round
            // 5 LREP cap so deferral cannot be used to bypass the envelope across batches.
            if (cleanupIncentive > 0 || deferredCleanupBounty > 0) {
                roundCleanupIncentivePaid[contentId][roundId] =
                    cleanupIncentivePaid + cleanupIncentive + deferredCleanupBounty;
            }
            if (cleanupIncentive > 0) {
                lrepToken.safeTransfer(cleanupCaller, cleanupIncentive);
            }
        }

        if (forfeitedToTreasury > 0) {
            address currentTreasury = protocolConfig.treasury();
            if (currentTreasury != address(0)) {
                try TokenTransferLib.safeTransfer(lrepToken, currentTreasury, forfeitedToTreasury) { }
                catch {
                    updatedConsensusReserve += forfeitedToTreasury;
                }
            } else {
                updatedConsensusReserve += forfeitedToTreasury;
            }
        }

        if (forfeitedToTreasury == 0 && addedToConsensusReserve == 0 && refundedLrep == 0 && cleanupIncentive == 0) {
            revert NothingProcessed();
        }
    }

    /// @notice Compute the keeper cleanup incentive for a batch.
    /// @dev `forfeitedAmount` covers the treasury-forfeit + consensus-reserve contributions
    ///      and is charged at `CLEANUP_INCENTIVE_BPS` (1%). Refunded stake is charged at the
    ///      lower `REFUND_CLEANUP_INCENTIVE_BPS` (0.25%) because the incentive on that
    ///      portion must come out of the engine's consensus reserve rather than from the
    ///      cleaned-up funds themselves. Both contributions share the round's 5 LREP cap.
    function _cleanupIncentive(uint256 forfeitedAmount, uint256 refundedAmount, uint256 remainingCap)
        private
        pure
        returns (uint256 incentive)
    {
        if (remainingCap == 0) return 0;
        incentive = forfeitedAmount * CLEANUP_INCENTIVE_BPS / 10_000;
        incentive += refundedAmount * REFUND_CLEANUP_INCENTIVE_BPS / 10_000;
        if (incentive > CLEANUP_INCENTIVE_MAX) incentive = CLEANUP_INCENTIVE_MAX;
        if (incentive > remainingCap) incentive = remainingCap;
    }

    function _getRevealFailedFinalizationTime(
        RoundLib.Round storage round,
        mapping(uint256 => RoundLib.RoundConfig) storage roundConfigSnapshot,
        mapping(uint256 => uint256) storage roundRevealGracePeriodSnapshot,
        mapping(uint256 => uint256) storage lastCommitRevealableAfter,
        ProtocolConfig protocolConfig,
        uint256 roundId
    ) private view returns (uint256) {
        RoundLib.RoundConfig memory roundCfg = _getRoundConfig(roundConfigSnapshot, protocolConfig, roundId);
        uint256 lastRevealableAt = lastCommitRevealableAfter[roundId];
        if (lastRevealableAt == 0) return 0;

        uint256 votingWindowEnd = uint256(round.startTime) + roundCfg.maxDuration;
        uint256 revealBase = lastRevealableAt > votingWindowEnd ? lastRevealableAt : votingWindowEnd;
        return revealBase + _getRoundRevealGracePeriod(roundRevealGracePeriodSnapshot, protocolConfig, roundId);
    }

    function _getRoundConfig(
        mapping(uint256 => RoundLib.RoundConfig) storage roundConfigSnapshot,
        ProtocolConfig protocolConfig,
        uint256 roundId
    ) private view returns (RoundLib.RoundConfig memory cfg) {
        cfg = roundConfigSnapshot[roundId];
        if (cfg.epochDuration == 0) {
            (cfg.epochDuration, cfg.maxDuration, cfg.minVoters, cfg.maxVoters) = protocolConfig.config();
        }
    }

    function _getRoundRevealGracePeriod(
        mapping(uint256 => uint256) storage roundRevealGracePeriodSnapshot,
        ProtocolConfig protocolConfig,
        uint256 roundId
    ) private view returns (uint256 gracePeriod) {
        gracePeriod = roundRevealGracePeriodSnapshot[roundId];
        if (gracePeriod == 0) return protocolConfig.revealGracePeriod();
    }

    function _rbtsRevealQuorum(uint16 minVoters, uint16 minRbtsParticipants) private pure returns (uint16) {
        return minVoters < minRbtsParticipants ? minRbtsParticipants : minVoters;
    }
}
