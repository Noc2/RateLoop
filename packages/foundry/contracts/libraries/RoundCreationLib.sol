// SPDX-License-Identifier: MIT
pragma solidity ^0.8.34;

import { SafeCast } from "@openzeppelin/contracts/utils/math/SafeCast.sol";

import { ContentRegistry } from "../ContentRegistry.sol";
import { ProtocolConfig } from "../ProtocolConfig.sol";
import { RatingLib } from "./RatingLib.sol";
import { RoundLib } from "./RoundLib.sol";

/// @title RoundCreationLib
/// @notice RoundVotingEngine round-creation path extracted to keep deployment bytecode below EIP-170.
library RoundCreationLib {
    using SafeCast for uint256;

    event RoundReferenceSnapshotted(uint256 indexed contentId, uint256 indexed roundId, uint16 roundReferenceRatingBps);
    event RoundConfigSnapshotted(
        uint256 indexed contentId,
        uint256 indexed roundId,
        uint32 epochDuration,
        uint32 maxDuration,
        uint16 minVoters,
        uint16 maxVoters
    );

    function snapshotRoundVotingConfig(
        mapping(uint256 => mapping(uint256 => RoundLib.RoundConfig)) storage roundConfigSnapshot,
        mapping(uint256 => mapping(uint256 => RatingLib.RatingConfig)) storage roundRatingConfigSnapshot,
        mapping(uint256 => mapping(uint256 => uint16)) storage roundReferenceRatingBpsSnapshot,
        mapping(uint256 => mapping(uint256 => uint256)) storage roundRevealGracePeriodSnapshot,
        ContentRegistry registry,
        ProtocolConfig protocolConfig,
        uint256 contentId,
        uint256 roundId
    ) external {
        RoundLib.RoundConfig memory roundCfg = registry.getContentRoundConfig(contentId);
        roundConfigSnapshot[contentId][roundId] = roundCfg;
        roundRatingConfigSnapshot[contentId][roundId] = protocolConfig.getRatingConfig();
        // FV-1 (2026-05-20 follow-up audit): reject snapshots of a zero-rating content so the
        // engine's per-round reference is always authoritative. Without this guard a zero
        // snapshot would have forced the engine to fall back to the live `registry.getRating`
        // value, which could shift between commit and reveal and silently invalidate every
        // commit hash in the round (voters cannot reveal, stakes forfeited to treasury).
        // `getRating` already floors at MIN_RATING_BPS = 100 for any rated content; this assert
        // surfaces the invariant on-chain so a future ContentRegistry change that produces a
        // zero rating breaks loudly at round-open rather than silently at reveal.
        uint16 referenceRatingBps = registry.getRating(contentId);
        require(referenceRatingBps != 0, "Zero rating snapshot");
        roundReferenceRatingBpsSnapshot[contentId][roundId] = referenceRatingBps;
        roundRevealGracePeriodSnapshot[contentId][roundId] = protocolConfig.revealGracePeriod();

        emit RoundConfigSnapshotted(
            contentId, roundId, roundCfg.epochDuration, roundCfg.maxDuration, roundCfg.minVoters, roundCfg.maxVoters
        );
        emit RoundReferenceSnapshotted(contentId, roundId, referenceRatingBps);
    }

    function snapshotRoundExternalConfig(
        mapping(uint256 => mapping(uint256 => bytes32)) storage roundDrandChainHashSnapshot,
        mapping(uint256 => mapping(uint256 => uint64)) storage roundDrandGenesisTimeSnapshot,
        mapping(uint256 => mapping(uint256 => uint64)) storage roundDrandPeriodSnapshot,
        mapping(uint256 => mapping(uint256 => address)) storage roundRaterRegistrySnapshot,
        mapping(uint256 => mapping(uint256 => address)) storage roundFrontendRegistrySnapshot,
        mapping(uint256 => mapping(uint256 => address)) storage roundAdvisoryVoteRecorderSnapshot,
        mapping(uint256 => mapping(uint256 => address)) storage roundConfidentialityEscrowSnapshot,
        ProtocolConfig protocolConfig,
        uint256 contentId,
        uint256 roundId
    ) external {
        roundDrandChainHashSnapshot[contentId][roundId] = protocolConfig.drandChainHash();
        roundDrandGenesisTimeSnapshot[contentId][roundId] = protocolConfig.drandGenesisTime();
        roundDrandPeriodSnapshot[contentId][roundId] = protocolConfig.drandPeriod();
        roundRaterRegistrySnapshot[contentId][roundId] = protocolConfig.raterRegistry();
        roundFrontendRegistrySnapshot[contentId][roundId] = protocolConfig.frontendRegistry();
        address advisoryRecorder = protocolConfig.advisoryVoteRecorder();
        roundAdvisoryVoteRecorderSnapshot[contentId][roundId] =
            advisoryRecorder == address(0) ? address(1) : advisoryRecorder;
        roundConfidentialityEscrowSnapshot[contentId][roundId] = protocolConfig.confidentialityEscrow();
    }

    function activateNewRound(
        mapping(uint256 => uint256) storage currentRoundId,
        mapping(uint256 => uint256) storage nextRoundId,
        mapping(uint256 => mapping(uint256 => RoundLib.Round)) storage rounds,
        uint256 contentId
    ) external returns (uint256 roundId) {
        nextRoundId[contentId]++;
        roundId = nextRoundId[contentId];
        currentRoundId[contentId] = roundId;

        rounds[contentId][roundId].startTime = block.timestamp.toUint48();
        rounds[contentId][roundId].state = RoundLib.RoundState.Open;
    }
}
