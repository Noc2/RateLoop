// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import {ProtocolConfig} from "../ProtocolConfig.sol";
import {IRaterIdentityRegistry} from "../interfaces/IRaterIdentityRegistry.sol";
import {RoundLib} from "./RoundLib.sol";
import {TlockVoteLib} from "./TlockVoteLib.sol";
import {TokenTransferLib} from "./TokenTransferLib.sol";
import {VotePreflightLib} from "./VotePreflightLib.sol";

interface IRoundCleanupActivityRegistry {
    function updateActivity(uint256 contentId) external;
}

/// @title RoundCleanupLib
/// @notice Shared refund and cleanup paths extracted from RoundVotingEngine to reduce runtime size.
library RoundCleanupLib {
    using SafeERC20 for IERC20;

    uint256 internal constant CLEANUP_INCENTIVE_BPS = 100; // 1%
    uint256 internal constant CLEANUP_INCENTIVE_MAX = 5e6; // 5 HREP

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

    function resolveClaimCommit(
        mapping(address => bytes32) storage roundVoterCommitHash,
        mapping(bytes32 => bytes32) storage roundIdentityCommitKey,
        mapping(bytes32 => address) storage roundCommitIdentityHolder,
        IRaterIdentityRegistry identityRegistry,
        address account
    ) external view returns (bytes32 commitKey, address rewardRecipient) {
        IRaterIdentityRegistry.ResolvedRater memory resolved =
            VotePreflightLib.resolveRater(identityRegistry, account);
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
        IERC20 hrepToken,
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

        hrepToken.safeTransfer(commitVoter, refundAmount);
    }

    function processUnrevealedVotes(
        RoundLib.Round storage round,
        bytes32[] storage commitKeys,
        mapping(bytes32 => RoundLib.Commit) storage roundCommits,
        mapping(uint256 => mapping(uint256 => uint256)) storage roundCleanupIncentivePaid,
        uint256 contentId,
        uint256 roundId,
        IERC20 hrepToken,
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
            uint256 refundedHrep,
            uint256 processedPastEpochCount,
            uint256 cleanupIncentive,
            uint256 updatedConsensusReserve
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
                    try TokenTransferLib.safeTransfer(hrepToken, commit.voter, amount) {
                        refundedHrep += amount;
                    } catch {
                        forfeitedToTreasury += amount;
                    }
                }
            }
        }

        uint256 cleanupIncentivePaid = roundCleanupIncentivePaid[contentId][roundId];
        cleanupIncentive = _cleanupIncentive(forfeitedToTreasury + addedToConsensusReserve, 5e6 - cleanupIncentivePaid);
        if (cleanupIncentive > 0) {
            roundCleanupIncentivePaid[contentId][roundId] = cleanupIncentivePaid + cleanupIncentive;
            uint256 fromReserve = addedToConsensusReserve < cleanupIncentive ? addedToConsensusReserve : cleanupIncentive;
            if (fromReserve > 0) {
                addedToConsensusReserve -= fromReserve;
                updatedConsensusReserve -= fromReserve;
            }
            uint256 fromTreasuryForfeiture = cleanupIncentive - fromReserve;
            if (fromTreasuryForfeiture > 0) {
                forfeitedToTreasury -= fromTreasuryForfeiture;
            }
            hrepToken.safeTransfer(cleanupCaller, cleanupIncentive);
        }

        if (forfeitedToTreasury > 0) {
            address currentTreasury = protocolConfig.treasury();
            if (currentTreasury != address(0)) {
                try TokenTransferLib.safeTransfer(hrepToken, currentTreasury, forfeitedToTreasury) {}
                catch {
                    updatedConsensusReserve += forfeitedToTreasury;
                }
            } else {
                updatedConsensusReserve += forfeitedToTreasury;
            }
        }

        if (forfeitedToTreasury == 0 && addedToConsensusReserve == 0 && refundedHrep == 0 && cleanupIncentive == 0) {
            revert NothingProcessed();
        }
    }

    function _cleanupIncentive(uint256 forfeitedAmount, uint256 remainingCap) private pure returns (uint256 incentive) {
        if (remainingCap == 0) return 0;
        incentive = forfeitedAmount * CLEANUP_INCENTIVE_BPS / 10_000;
        if (incentive > CLEANUP_INCENTIVE_MAX) incentive = CLEANUP_INCENTIVE_MAX;
        if (incentive > remainingCap) incentive = remainingCap;
    }
}
