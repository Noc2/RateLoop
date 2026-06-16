// SPDX-License-Identifier: MIT
pragma solidity ^0.8.34;

import { ContentRegistry } from "../ContentRegistry.sol";
import { ProtocolConfig } from "../ProtocolConfig.sol";
import { ContentRegistryTypes } from "./ContentRegistryTypes.sol";
import { RatingLib } from "./RatingLib.sol";
import { RoundCleanupLib } from "./RoundCleanupLib.sol";
import { RoundLib } from "./RoundLib.sol";

library RoundVotingReadLib {
    function previewCommitContext(
        mapping(uint256 => uint256) storage currentRoundId,
        mapping(uint256 => mapping(uint256 => RoundLib.Round)) storage rounds,
        mapping(uint256 => mapping(uint256 => RoundLib.RoundConfig)) storage roundConfigSnapshot,
        mapping(uint256 => mapping(uint256 => uint16)) storage roundReferenceRatingBpsSnapshot,
        mapping(uint256 => mapping(uint256 => uint256)) storage roundRevealGracePeriodSnapshot,
        mapping(uint256 => mapping(uint256 => uint256)) storage lastCommitRevealableAfter,
        mapping(uint256 => mapping(uint256 => uint16)) storage roundHumanVerifiedCommitCount,
        mapping(uint256 => mapping(uint256 => uint8)) storage roundContentDormantCountSnapshot,
        ContentRegistry registry,
        ProtocolConfig protocolConfig,
        uint256 contentId,
        uint16 minRbtsParticipants
    ) external view returns (uint256 openRoundId, uint16 referenceRatingBps) {
        openRoundId = currentRoundId[contentId];
        if (openRoundId != 0) {
            RoundLib.Round storage round = rounds[contentId][openRoundId];
            RoundLib.RoundConfig memory roundCfg =
                _roundConfig(roundConfigSnapshot, protocolConfig, contentId, openRoundId);
            (uint64 id, uint48 lastActivityAt, ContentRegistryTypes.ContentStatus status, uint8 dormantCount) =
                _contentLifecycle(registry, contentId);
            bool lifecycleStale = id == 0 || status != ContentRegistryTypes.ContentStatus.Active
                || dormantCount != roundContentDormantCountSnapshot[contentId][openRoundId];
            bool emptyRoundStale = round.state == RoundLib.RoundState.Open && round.voteCount == 0
                && round.totalStake == 0 && lastActivityAt > round.startTime && lastActivityAt <= block.timestamp;
            uint16 rbtsRevealQuorum = _rbtsRevealQuorum(roundCfg.minVoters, minRbtsParticipants);
            bool hrcCommitQuorum = roundHumanVerifiedCommitCount[contentId][openRoundId] >= rbtsRevealQuorum;
            bool cancelExpired = RoundLib.isExpired(round, roundCfg.maxDuration)
                && round.revealedCount < rbtsRevealQuorum && (round.voteCount < rbtsRevealQuorum || !hrcCommitQuorum);
            bool revealFailed = hrcCommitQuorum
                && RoundCleanupLib.canFinalizeRevealFailedRound(
                    round,
                    roundConfigSnapshot[contentId],
                    roundRevealGracePeriodSnapshot[contentId],
                    lastCommitRevealableAfter[contentId],
                    protocolConfig,
                    openRoundId,
                    minRbtsParticipants
                );

            if (!RoundLib.isTerminal(round) && !emptyRoundStale && !lifecycleStale && !cancelExpired && !revealFailed) {
                return (openRoundId, _roundReferenceRatingBps(roundReferenceRatingBpsSnapshot, contentId, openRoundId));
            }
        }

        openRoundId = registry.nextVotingRoundId(contentId);
        referenceRatingBps = registry.getRating(contentId);
    }

    function isDormancyBlocked(
        mapping(uint256 => uint256) storage currentRoundId,
        mapping(uint256 => mapping(uint256 => RoundLib.Round)) storage rounds,
        mapping(uint256 => mapping(uint256 => RoundLib.RoundConfig)) storage roundConfigSnapshot,
        mapping(uint256 => mapping(uint256 => uint16)) storage roundHumanVerifiedCommitCount,
        ProtocolConfig protocolConfig,
        uint256 contentId
    ) external view returns (bool) {
        uint256 roundId = currentRoundId[contentId];
        if (roundId == 0) return false;

        RoundLib.Round storage round = rounds[contentId][roundId];
        if (round.state != RoundLib.RoundState.Open || round.voteCount == 0 || round.totalStake == 0) return false;

        RoundLib.RoundConfig memory roundCfg = _roundConfig(roundConfigSnapshot, protocolConfig, contentId, roundId);
        if (round.revealedCount >= roundCfg.minVoters) return true;
        if (round.voteCount < roundCfg.minVoters) return false;
        if (roundHumanVerifiedCommitCount[contentId][roundId] < roundCfg.minVoters) return false;
        return true;
    }

    function _rbtsRevealQuorum(uint16 minVoters, uint16 minRbtsParticipants) private pure returns (uint16) {
        return minVoters > minRbtsParticipants ? minVoters : minRbtsParticipants;
    }

    function roundRatingConfigPacked(
        mapping(uint256 => mapping(uint256 => RatingLib.RatingConfig)) storage roundRatingConfigSnapshot,
        ProtocolConfig protocolConfig,
        uint256 contentId,
        uint256 roundId
    ) external view returns (uint256 massWord, uint256 penaltyWord) {
        RatingLib.RatingConfig memory cfg = roundRatingConfigSnapshot[contentId][roundId];
        if (cfg.confidenceMassInitial == 0) cfg = protocolConfig.getRatingConfig();
        return (
            uint128(cfg.confidenceMassInitial) | (uint256(uint128(cfg.confidenceMassMin)) << 128),
            uint128(cfg.confidenceMassMax) | (uint256(cfg.conservativePenaltyMaxBps) << 128)
                | (uint256(cfg.conservativePenaltyMinBps) << 144)
        );
    }

    function ratingCommitStateCompact(
        mapping(bytes32 => RoundLib.Commit) storage roundCommits,
        mapping(bytes32 => bytes32) storage commitIdentityKey,
        mapping(bytes32 => address) storage commitIdentityHolder,
        bytes32 commitKey
    ) external view returns (uint256 flags, bytes32 identityKey, address holder) {
        RoundLib.Commit storage commit = roundCommits[commitKey];
        return (
            (commit.revealed ? 1 : 0) | (commit.isUp ? 2 : 0) | (uint256(commit.stakeAmount) << 8)
                | (uint256(commit.epochIndex) << 72),
            commitIdentityKey[commitKey],
            commitIdentityHolder[commitKey]
        );
    }

    function _contentLifecycle(ContentRegistry registry, uint256 contentId)
        private
        view
        returns (uint64 id, uint48 lastActivityAt, ContentRegistryTypes.ContentStatus status, uint8 dormantCount)
    {
        (id,,,, lastActivityAt, status, dormantCount,,,) = registry.contents(contentId);
    }

    function _roundConfig(
        mapping(uint256 => mapping(uint256 => RoundLib.RoundConfig)) storage roundConfigSnapshot,
        ProtocolConfig protocolConfig,
        uint256 contentId,
        uint256 roundId
    ) private view returns (RoundLib.RoundConfig memory cfg) {
        cfg = roundConfigSnapshot[contentId][roundId];
        if (cfg.epochDuration == 0) {
            (cfg.epochDuration, cfg.maxDuration, cfg.minVoters, cfg.maxVoters) = protocolConfig.config();
        }
    }

    function _roundReferenceRatingBps(
        mapping(uint256 => mapping(uint256 => uint16)) storage roundReferenceRatingBpsSnapshot,
        uint256 contentId,
        uint256 roundId
    ) private view returns (uint16 referenceRatingBps) {
        referenceRatingBps = roundReferenceRatingBpsSnapshot[contentId][roundId];
    }
}
