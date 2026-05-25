// SPDX-License-Identifier: MIT
pragma solidity ^0.8.34;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { SafeCast } from "@openzeppelin/contracts/utils/math/SafeCast.sol";

import { ProtocolConfig } from "../ProtocolConfig.sol";
import { ContentRegistry } from "../ContentRegistry.sol";
import { IRaterIdentityRegistry } from "../interfaces/IRaterIdentityRegistry.sol";
import { RoundLib } from "./RoundLib.sol";
import { TlockVoteLib } from "./TlockVoteLib.sol";
import { TokenTransferLib } from "./TokenTransferLib.sol";
import { VotePreflightLib } from "./VotePreflightLib.sol";

interface IRoundCleanupActivityRegistry {
    function updateActivity(uint256 contentId) external;
}

interface IQuestionBundleRoundObserver {
    function recordBundleQuestionTerminal(uint256 contentId, uint256 roundId, bool settled) external;
}

/// @title RoundCleanupLib
/// @notice Shared refund and cleanup paths extracted from RoundVotingEngine to reduce runtime size.
library RoundCleanupLib {
    using SafeERC20 for IERC20;
    using SafeCast for uint256;

    uint256 internal constant CLEANUP_INCENTIVE_BPS = 100; // 1%
    uint256 internal constant CLEANUP_INCENTIVE_MAX = 5e6; // 5 LREP

    error RoundNotCancelledOrTied();
    error AlreadyClaimed();
    error NoCommit();
    error NoStake();
    error VoteNotRevealed();
    error NothingProcessed();
    error RoundNotSettledOrTied();
    error IndexOutOfBounds();

    event RoundRevealFailed(uint256 indexed contentId, uint256 indexed roundId);
    event BundleObserverNotifyFailed(
        uint256 indexed contentId, uint256 indexed roundId, bool settled, bytes lowLevelError
    );
    event BundleObserverNotifyReplayed(uint256 indexed contentId, uint256 indexed roundId, bool settled);
    event ForfeitedFundsAddedToTreasury(uint256 indexed contentId, uint256 indexed roundId, uint256 amount);
    event ForfeitedFundsRetained(uint256 indexed contentId, uint256 indexed roundId, uint256 amount);
    /// @notice L-Cleanup-1: emitted when treasury was unset or rejected the forfeit transfer.
    ///         The engine accumulates the unpaid amount into `pendingTreasuryForfeitLrep` for
    ///         later flush via `flushPendingTreasuryForfeit()`.
    event TreasuryForfeitPending(uint256 indexed contentId, uint256 indexed roundId, uint256 amount);
    event CurrentEpochRefunded(uint256 indexed contentId, uint256 indexed roundId, uint256 amount);

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
        bytes calldata ciphertext,
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
        mapping(address => bytes32) storage roundHolderCommitKey,
        IRaterIdentityRegistry identityRegistry,
        address account
    ) external view returns (bytes32 commitKey, address rewardRecipient) {
        IRaterIdentityRegistry.ResolvedRater memory resolved = VotePreflightLib.resolveRater(identityRegistry, account);
        if (resolved.identityKey != bytes32(0)) {
            commitKey = roundIdentityCommitKey[resolved.identityKey];
            if (commitKey != bytes32(0)) {
                rewardRecipient = roundCommitIdentityHolder[commitKey];
                if (rewardRecipient == address(0)) {
                    rewardRecipient = resolved.holder == address(0) ? account : resolved.holder;
                }
                return (commitKey, rewardRecipient);
            }
        }
        address holder = resolved.holder == address(0) ? account : resolved.holder;
        commitKey = roundHolderCommitKey[holder];
        if (commitKey != bytes32(0)) {
            rewardRecipient = roundCommitIdentityHolder[commitKey];
            return (commitKey, rewardRecipient == address(0) ? holder : rewardRecipient);
        }

        if (holder != account) {
            bytes32 holderCommitHash = roundVoterCommitHash[holder];
            if (holderCommitHash != bytes32(0)) {
                commitKey = keccak256(abi.encodePacked(holder, holderCommitHash));
                rewardRecipient = roundCommitIdentityHolder[commitKey];
                return (commitKey, rewardRecipient == address(0) ? holder : rewardRecipient);
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

    function commitCore(mapping(bytes32 => RoundLib.Commit) storage roundCommits, bytes32 commitKey)
        external
        view
        returns (
            address voter,
            uint64 stakeAmount,
            address frontend,
            uint48 revealableAfter,
            bool revealed,
            bool isUp,
            uint8 epochIndex
        )
    {
        RoundLib.Commit storage c = roundCommits[commitKey];
        return (c.voter, c.stakeAmount, c.frontend, c.revealableAfter, c.revealed, c.isUp, c.epochIndex);
    }

    function commitRevealData(
        mapping(bytes32 => RoundLib.Commit) storage roundCommits,
        bytes32 commitKey,
        bytes32 effectiveDrandChainHash
    )
        external
        view
        returns (
            bytes32 ciphertextHash,
            uint64 targetRound,
            bytes32 drandChainHash,
            uint48 revealableAfter,
            bool revealed,
            uint64 stakeAmount
        )
    {
        RoundLib.Commit storage c = roundCommits[commitKey];
        bytes32 commitDrandChainHash = c.voter == address(0) ? bytes32(0) : effectiveDrandChainHash;
        return (c.ciphertextHash, c.targetRound, commitDrandChainHash, c.revealableAfter, c.revealed, c.stakeAmount);
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
        mapping(address => bytes32) storage roundHolderCommitKey,
        bytes32 commitKey,
        bytes32 identityKey,
        address identityHolder,
        address voter
    ) external {
        roundIdentityCommitKey[identityKey] = commitKey;
        roundCommitIdentityKey[commitKey] = identityKey;
        roundCommitIdentityHolder[commitKey] = identityHolder;
        if (identityHolder != address(0) && identityHolder != voter) {
            roundHolderCommitKey[identityHolder] = commitKey;
        }
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
        address identityHolder,
        bytes32 identityKey,
        uint64 stakeAmount64,
        uint256 stakeAmount
    ) external {
        round.voteCount++;
        round.totalStake += stakeAmount64;

        contentLastVoteTimestamp[voter] = block.timestamp;
        if (identityHolder != address(0) && identityHolder != voter) {
            contentLastVoteTimestamp[identityHolder] = block.timestamp;
        }
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

    function markRoundRevealFailed(
        RoundLib.Round storage round,
        mapping(uint256 => uint256) storage roundUnrevealedCleanupRemaining,
        mapping(uint256 => bool) storage pendingBundleObserverReplay,
        ContentRegistry registry,
        uint256 contentId,
        uint256 roundId
    ) external {
        round.state = RoundLib.RoundState.RevealFailed;
        round.settledAt = block.timestamp.toUint48();
        roundUnrevealedCleanupRemaining[roundId] = round.voteCount - round.revealedCount;
        notifyBundleRoundTerminal(pendingBundleObserverReplay, registry, contentId, roundId, false);
        emit RoundRevealFailed(contentId, roundId);
    }

    function notifyBundleRoundTerminal(
        mapping(uint256 => bool) storage pendingBundleObserverReplay,
        ContentRegistry registry,
        uint256 contentId,
        uint256 roundId,
        bool settled
    ) public {
        address bundleEscrow = registry.questionRewardPoolEscrow();
        if (bundleEscrow == address(0)) return;

        try IQuestionBundleRoundObserver(bundleEscrow).recordBundleQuestionTerminal(contentId, roundId, settled) {
            if (pendingBundleObserverReplay[roundId]) {
                delete pendingBundleObserverReplay[roundId];
            }
        } catch (bytes memory lowLevelError) {
            pendingBundleObserverReplay[roundId] = true;
            emit BundleObserverNotifyFailed(contentId, roundId, settled, lowLevelError);
        }
    }

    function replayBundleObserverNotify(
        mapping(uint256 => bool) storage pendingBundleObserverReplay,
        ContentRegistry registry,
        uint256 contentId,
        uint256 roundId,
        bool settled
    ) external {
        require(pendingBundleObserverReplay[roundId], "no pending replay");
        address bundleEscrow = registry.questionRewardPoolEscrow();
        if (bundleEscrow == address(0)) return;
        IQuestionBundleRoundObserver(bundleEscrow).recordBundleQuestionTerminal(contentId, roundId, settled);
        delete pendingBundleObserverReplay[roundId];
        emit BundleObserverNotifyReplayed(contentId, roundId, settled);
    }

    function processUnrevealedVotesForEngine(
        RoundLib.Round storage round,
        bytes32[] storage commitKeys,
        mapping(bytes32 => RoundLib.Commit) storage roundCommits,
        mapping(uint256 => mapping(uint256 => uint256)) storage roundCleanupIncentivePaid,
        mapping(uint256 => uint256) storage roundUnrevealedCleanupRemaining,
        uint256 contentId,
        uint256 roundId,
        IERC20 lrepToken,
        ProtocolConfig protocolConfig,
        uint256 accountedLrepBalance,
        address cleanupCaller,
        uint256 startIndex,
        uint256 count
    ) external returns (uint256 updatedAccountedLrepBalance, uint256 pendingTreasuryForfeitDelta) {
        if (
            round.state != RoundLib.RoundState.Settled && round.state != RoundLib.RoundState.Tied
                && round.state != RoundLib.RoundState.RevealFailed
        ) {
            revert RoundNotSettledOrTied();
        }

        if (startIndex >= commitKeys.length) revert IndexOutOfBounds();

        (
            uint256 forfeitedToTreasury,
            uint256 refundedLrep,
            uint256 processedPastEpochCount,
            uint256 cleanupIncentive,
            uint256 treasuryPaid
        ) = processUnrevealedVotes(
            round,
            commitKeys,
            roundCommits,
            roundCleanupIncentivePaid,
            contentId,
            roundId,
            lrepToken,
            protocolConfig,
            cleanupCaller,
            startIndex,
            count
        );

        updatedAccountedLrepBalance = accountedLrepBalance;
        uint256 paidOut = refundedLrep + cleanupIncentive + treasuryPaid;
        if (paidOut > 0) {
            updatedAccountedLrepBalance -= paidOut;
        }

        if (forfeitedToTreasury > 0) {
            if (treasuryPaid > 0) {
                emit ForfeitedFundsAddedToTreasury(contentId, roundId, forfeitedToTreasury);
            } else {
                // L-Cleanup-1: surface the unpaid amount so the engine can accumulate it into
                // its pending bucket. We keep emitting `ForfeitedFundsRetained` for backward
                // compatibility with indexers.
                emit ForfeitedFundsRetained(contentId, roundId, forfeitedToTreasury);
                pendingTreasuryForfeitDelta = forfeitedToTreasury;
            }
        }

        if (processedPastEpochCount > 0) {
            uint256 remaining = roundUnrevealedCleanupRemaining[roundId];
            if (remaining > 0) {
                roundUnrevealedCleanupRemaining[roundId] =
                    processedPastEpochCount >= remaining ? 0 : remaining - processedPastEpochCount;
            }
        }

        if (refundedLrep > 0) {
            emit CurrentEpochRefunded(contentId, roundId, refundedLrep);
        }
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
        address cleanupCaller,
        uint256 startIndex,
        uint256 count
    )
        public
        returns (
            uint256 forfeitedToTreasury,
            uint256 refundedLrep,
            uint256 processedPastEpochCount,
            uint256 cleanupIncentive,
            uint256 treasuryPaid
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

        for (uint256 i = startIndex; i < endIndex; i++) {
            RoundLib.Commit storage commit = roundCommits[commitKeys[i]];
            if (!commit.revealed && commit.stakeAmount > 0) {
                uint256 amount = commit.stakeAmount;
                commit.stakeAmount = 0;

                // L-Vote-1: only forfeit past-epoch unrevealed stakes when the round Actually
                // produced a winner (Settled) or definitively failed reveal (RevealFailed).
                // In a Tied round there's no winner by symmetry; refunding past-epoch
                // non-revealers preserves the no-punishment invariant for ties.
                if (
                    round.state == RoundLib.RoundState.RevealFailed
                        || (round.state == RoundLib.RoundState.Settled && commit.revealableAfter <= round.settledAt)
                ) {
                    processedPastEpochCount++;
                    forfeitedToTreasury += amount;
                } else {
                    if (commit.revealableAfter <= round.settledAt && round.state == RoundLib.RoundState.Tied) {
                        // Past-epoch in a Tied round counts toward the cleanup queue but is refunded.
                        processedPastEpochCount++;
                    }
                    try TokenTransferLib.safeTransfer(lrepToken, commit.voter, amount) {
                        refundedLrep += amount;
                    } catch {
                        forfeitedToTreasury += amount;
                    }
                }
            }
        }

        uint256 cleanupIncentivePaid = roundCleanupIncentivePaid[contentId][roundId];
        cleanupIncentive = _cleanupIncentive(forfeitedToTreasury, 5e6 - cleanupIncentivePaid);
        if (cleanupIncentive > 0) {
            forfeitedToTreasury -= cleanupIncentive;
            // Count the paid incentive toward the per-round 5 LREP cap across batches.
            roundCleanupIncentivePaid[contentId][roundId] = cleanupIncentivePaid + cleanupIncentive;
            lrepToken.safeTransfer(cleanupCaller, cleanupIncentive);
        }

        if (forfeitedToTreasury > 0) {
            address currentTreasury = protocolConfig.treasury();
            if (currentTreasury != address(0)) {
                try TokenTransferLib.safeTransfer(lrepToken, currentTreasury, forfeitedToTreasury) {
                    treasuryPaid = forfeitedToTreasury;
                } catch {
                    // L-Cleanup-1: treasury rejected or paused. The caller (engine) is
                    // responsible for accumulating the unpaid amount into the
                    // `pendingTreasuryForfeitLrep` bucket so a permissionless
                    // `flushPendingTreasuryForfeit()` can retry later. We surface the
                    // difference via the `treasuryPaid` return value (zero in this branch).
                    emit TreasuryForfeitPending(contentId, roundId, forfeitedToTreasury);
                }
            } else {
                emit TreasuryForfeitPending(contentId, roundId, forfeitedToTreasury);
            }
        }

        if (forfeitedToTreasury == 0 && refundedLrep == 0 && cleanupIncentive == 0) {
            revert NothingProcessed();
        }
    }

    /// @notice Compute the keeper cleanup incentive for forfeited stake.
    function _cleanupIncentive(uint256 forfeitedAmount, uint256 remainingCap) private pure returns (uint256 incentive) {
        if (remainingCap == 0) return 0;
        incentive = forfeitedAmount * CLEANUP_INCENTIVE_BPS / 10_000;
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
