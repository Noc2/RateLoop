// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";
import { ReentrancyGuardTransient } from "@openzeppelin/contracts/utils/ReentrancyGuardTransient.sol";
import { SafeCast } from "@openzeppelin/contracts/utils/math/SafeCast.sol";
import { ContentRegistry } from "./ContentRegistry.sol";
import { ProtocolConfig } from "./ProtocolConfig.sol";
import { RoundVotingEngine } from "./RoundVotingEngine.sol";
import { ILaunchDistributionPool } from "./interfaces/ILaunchDistributionPool.sol";
import { IRaterIdentityRegistry } from "./interfaces/IRaterIdentityRegistry.sol";
import { LaunchRaterRewardLib } from "./libraries/LaunchRaterRewardLib.sol";
import { RobustBtsMath } from "./libraries/RobustBtsMath.sol";
import { RoundLib } from "./libraries/RoundLib.sol";
import { TlockVoteLib } from "./libraries/TlockVoteLib.sol";
import { VotePreflightLib } from "./libraries/VotePreflightLib.sol";

/// @title AdvisoryVoteRecorder
/// @notice Zero-stake commit-reveal votes that can bootstrap launch rewards without affecting vote/stake accounting.
contract AdvisoryVoteRecorder is Ownable, ReentrancyGuardTransient {
    using SafeCast for uint256;

    error InvalidAddress();
    error InvalidCommitHash();
    error InvalidRound();
    error RoundNotOpen();
    error RoundNotSettled();
    error ThresholdReached();
    error AlreadyCommitted();
    error AlreadyRevealed();
    error EpochNotEnded();
    error HashMismatch();
    error NoCommit();
    error VoteNotRevealed();
    error AdvisoryRevealedAfterSettlement();
    error PendingCleanup();
    error NotEnoughVotes();
    error Paused();
    error IndexOutOfBounds();
    error MaxAdvisoryVotersReached();
    error TargetRoundOutOfWindow();
    /// @notice Reveal-time drand chain hash differs from the value used at commit-time.
    /// @dev Surfaces silent desync between the ciphertext (encrypted under the commit-time
    ///      chain hash) and the round snapshot — without this check the tlock decryption
    ///      would simply fail off-chain and the voter would forfeit credit with no on-chain
    ///      signal.
    error DrandChainHashMismatch();

    RoundVotingEngine public immutable votingEngine;
    ContentRegistry public immutable registry;
    ProtocolConfig public immutable protocolConfig;

    uint256 internal constant ADVISORY_VOTE_COOLDOWN = 24 hours;

    bool public paused;

    struct AdvisoryCommit {
        address voter;
        uint256 contentId;
        uint256 roundId;
        bytes32 commitHash;
        bytes ciphertext;
        uint64 targetRound;
        bytes32 drandChainHash;
        uint48 revealableAfter;
        uint48 revealedAt;
        uint16 roundReferenceRatingBps;
        uint16 predictedUpBps;
        bytes32 identityKey;
        address identityHolder;
        bool revealed;
        bool isUp;
        bool launchCreditClaimed;
        uint16 scoreBps;
        /// @notice Drand chain hash actually used at commit-time to validate the ciphertext.
        /// @dev When the round snapshot is empty at commit-time the recorder falls back to
        ///      `protocolConfig.drandChainHash()` for preview-style commits. A later round
        ///      snapshot (set when the round is opened) or a governance config change can
        ///      desynchronize the ciphertext from the on-chain round metadata. Persisting the
        ///      commit-time value lets `_assertRevealDrandChainHashUnchanged` reject reveals
        ///      whose snapshot no longer matches, surfacing the inconsistency on-chain rather
        ///      than letting it manifest as a silent tlock-decryption failure off-chain.
        bytes32 usedChainHashAtCommit;
    }

    struct PreparedAdvisoryRound {
        uint256 roundId;
        uint48 startTime;
        uint32 epochDuration;
        uint32 maxDuration;
        uint16 maxVoters;
        uint16 roundReferenceRatingBps;
    }

    enum AdvisoryCommitAvailabilityStatus {
        Available,
        Paused,
        ContentInactive,
        NoStakedRound,
        RoundNotOpen,
        OutsideBlindEpoch,
        ThresholdReached,
        MaxAdvisoryVotersReached,
        InvalidConfig
    }

    struct AdvisoryCommitAvailability {
        bool canCommit;
        AdvisoryCommitAvailabilityStatus status;
        uint256 roundId;
        uint16 roundReferenceRatingBps;
        uint256 epochEnd;
        bytes32 drandChainHash;
        uint64 drandGenesisTime;
        uint64 drandPeriod;
        uint64 minTargetRound;
        uint64 maxTargetRound;
    }

    mapping(bytes32 => AdvisoryCommit) internal advisoryCommits;
    // Account aliases: delegated advisory commits write both the delegate and stable holder.
    mapping(uint256 => mapping(uint256 => mapping(address => bytes32))) public advisoryCommitKeyByRater;
    mapping(uint256 => mapping(uint256 => mapping(bytes32 => bytes32))) public advisoryCommitKeyByIdentity;
    // Account aliases: delegated advisory commits refresh both the delegate and stable holder cooldowns.
    mapping(uint256 => mapping(address => uint256)) public lastAdvisoryVoteTimestamp;
    mapping(uint256 => mapping(bytes32 => uint256)) public lastAdvisoryVoteTimestampByIdentity;
    mapping(uint256 => mapping(uint256 => bytes32[])) internal roundAdvisoryCommitKeys;

    event AdvisoryVoteRecorded(
        uint256 indexed contentId,
        uint256 indexed roundId,
        address indexed voter,
        bytes32 advisoryCommitKey,
        bytes32 commitHash,
        uint16 roundReferenceRatingBps,
        uint64 targetRound,
        bytes32 drandChainHash
    );
    event AdvisoryVoteRevealed(
        uint256 indexed contentId,
        uint256 indexed roundId,
        address indexed voter,
        bytes32 advisoryCommitKey,
        bool isUp,
        uint16 predictedUpBps
    );
    event AdvisoryLaunchCreditClaimed(
        uint256 indexed contentId,
        uint256 indexed roundId,
        address indexed voter,
        bytes32 advisoryCommitKey,
        uint16 scoreBps,
        uint256 paidAmount
    );
    event PausedUpdated(bool paused);

    constructor(address _votingEngine, address _registry, address owner_) Ownable(owner_) {
        if (_votingEngine == address(0) || _registry == address(0) || owner_ == address(0)) revert InvalidAddress();
        votingEngine = RoundVotingEngine(_votingEngine);
        registry = ContentRegistry(_registry);
        protocolConfig = ProtocolConfig(RoundVotingEngine(_votingEngine).protocolConfig());
    }

    function setPaused(bool value) external onlyOwner {
        paused = value;
        emit PausedUpdated(value);
    }

    function advisoryCommitAvailability(uint256 contentId)
        external
        view
        returns (AdvisoryCommitAvailability memory availability)
    {
        if (paused) {
            availability.status = AdvisoryCommitAvailabilityStatus.Paused;
            return availability;
        }
        if (!registry.isContentActive(contentId)) {
            availability.status = AdvisoryCommitAvailabilityStatus.ContentInactive;
            return availability;
        }

        availability.roundId = votingEngine.currentRoundId(contentId);
        if (availability.roundId == 0) {
            availability.status = AdvisoryCommitAvailabilityStatus.NoStakedRound;
            return availability;
        }

        (
            uint48 roundStart,
            RoundLib.RoundState state,
            uint16 voteCount,,
            uint64 totalStake,
            uint48 thresholdReachedAt,
            uint48 settledAt
        ) = votingEngine.roundCore(contentId, availability.roundId);
        (uint32 epochDuration, uint32 maxDuration,, uint16 maxVoters) =
            votingEngine.roundConfigSnapshot(contentId, availability.roundId);
        if (roundStart == 0 || epochDuration == 0 || maxDuration == 0 || maxVoters == 0) {
            availability.status = AdvisoryCommitAvailabilityStatus.InvalidConfig;
            return availability;
        }

        availability.roundReferenceRatingBps =
            votingEngine.roundReferenceRatingBpsForRound(contentId, availability.roundId);
        availability.epochEnd = uint256(roundStart) + uint256(epochDuration);
        (availability.drandChainHash, availability.drandGenesisTime, availability.drandPeriod) =
            _resolvedRoundDrandConfig(contentId, availability.roundId);
        if (
            availability.drandChainHash == bytes32(0) || availability.drandGenesisTime == 0
                || availability.drandPeriod == 0 || availability.epochEnd < availability.drandGenesisTime
        ) {
            availability.status = AdvisoryCommitAvailabilityStatus.InvalidConfig;
            return availability;
        }

        availability.minTargetRound =
            _targetRoundAtOrAfter(availability.epochEnd, availability.drandGenesisTime, availability.drandPeriod);
        availability.maxTargetRound = _targetRoundAt(
            availability.epochEnd + 2 * uint256(availability.drandPeriod),
            availability.drandGenesisTime,
            availability.drandPeriod
        );
        if (
            availability.minTargetRound == 0 || availability.maxTargetRound == 0
                || availability.minTargetRound > availability.maxTargetRound
        ) {
            availability.status = AdvisoryCommitAvailabilityStatus.InvalidConfig;
            return availability;
        }

        if (state != RoundLib.RoundState.Open || settledAt != 0 || block.timestamp >= uint256(roundStart) + maxDuration)
        {
            availability.status = AdvisoryCommitAvailabilityStatus.RoundNotOpen;
            return availability;
        }
        if (block.timestamp >= availability.epochEnd) {
            availability.status = AdvisoryCommitAvailabilityStatus.OutsideBlindEpoch;
            return availability;
        }
        if (voteCount == 0 || totalStake == 0) {
            availability.status = AdvisoryCommitAvailabilityStatus.NoStakedRound;
            return availability;
        }
        if (thresholdReachedAt != 0) {
            availability.status = AdvisoryCommitAvailabilityStatus.ThresholdReached;
            return availability;
        }
        if (roundAdvisoryCommitKeys[contentId][availability.roundId].length >= maxVoters) {
            availability.status = AdvisoryCommitAvailabilityStatus.MaxAdvisoryVotersReached;
            return availability;
        }

        availability.canCommit = true;
        availability.status = AdvisoryCommitAvailabilityStatus.Available;
    }

    /// @notice Record a zero-stake advisory commit for the active staked voteable round.
    /// @dev Uses the same commit-hash preimage as RoundVotingEngine.commitVote.
    function recordAdvisoryVote(
        uint256 contentId,
        uint256 roundContext,
        uint64 targetRound,
        bytes32 drandChainHash,
        bytes32 commitHash,
        bytes calldata ciphertext
    ) external nonReentrant returns (bytes32 advisoryCommitKey) {
        if (paused) revert Paused();
        if (commitHash == bytes32(0)) revert InvalidCommitHash();

        uint256 roundId = roundContext >> 16;
        if (roundId == 0) revert InvalidRound();
        uint16 roundReferenceRatingBps = uint16(roundContext);

        IRaterIdentityRegistry identityRegistry = _roundRaterRegistry(contentId, roundId);
        IRaterIdentityRegistry.ResolvedRater memory resolved =
            VotePreflightLib.validateVoterAndContent(identityRegistry, registry, msg.sender, contentId);
        address identityHolder = resolved.holder == address(0) ? msg.sender : resolved.holder;
        _validateAdvisoryCooldown(contentId, msg.sender, identityHolder, resolved.identityKey);

        if (votingEngine.voterCommitHash(contentId, roundId, msg.sender) != bytes32(0)) revert AlreadyCommitted();
        if (
            identityHolder != msg.sender
                && votingEngine.voterCommitHash(contentId, roundId, identityHolder) != bytes32(0)
        ) {
            revert AlreadyCommitted();
        }
        if (votingEngine.holderCommitKey(contentId, roundId, identityHolder) != bytes32(0)) revert AlreadyCommitted();
        if (votingEngine.identityCommitKey(contentId, roundId, resolved.identityKey) != bytes32(0)) {
            revert AlreadyCommitted();
        }
        if (advisoryCommitKeyByRater[contentId][roundId][msg.sender] != bytes32(0)) revert AlreadyCommitted();
        if (identityHolder != msg.sender && advisoryCommitKeyByRater[contentId][roundId][identityHolder] != bytes32(0))
        {
            revert AlreadyCommitted();
        }
        if (advisoryCommitKeyByIdentity[contentId][roundId][resolved.identityKey] != bytes32(0)) {
            revert AlreadyCommitted();
        }

        PreparedAdvisoryRound memory preparedRound;
        (
            preparedRound.roundId,
            preparedRound.startTime,
            preparedRound.epochDuration,
            preparedRound.maxDuration,
            preparedRound.maxVoters,
            preparedRound.roundReferenceRatingBps
        ) = votingEngine.prepareAdvisoryRound(contentId, roundContext);
        if (preparedRound.roundId != roundId) revert InvalidRound();
        if (preparedRound.roundReferenceRatingBps != roundReferenceRatingBps || roundReferenceRatingBps == 0) {
            revert InvalidCommitHash();
        }
        if (preparedRound.maxDuration == 0 || preparedRound.epochDuration == 0 || preparedRound.maxVoters == 0) {
            revert InvalidRound();
        }
        if (roundAdvisoryCommitKeys[contentId][roundId].length >= preparedRound.maxVoters) {
            revert MaxAdvisoryVotersReached();
        }

        advisoryCommitKey = keccak256(abi.encodePacked(bytes1(0xa1), msg.sender, contentId, roundId, commitHash));

        uint256 epochEnd = _computeEpochEnd(preparedRound.startTime, preparedRound.epochDuration);
        bytes32 usedChainHash = _validateCommitTlockData(
            contentId, roundId, ciphertext, targetRound, drandChainHash, epochEnd, preparedRound.epochDuration
        );
        uint256 targetRevealableAt = votingEngine.targetRoundRevealableTimestamp(contentId, roundId, targetRound);
        uint256 effectiveRevealableAfter = targetRevealableAt > epochEnd ? targetRevealableAt : epochEnd;

        advisoryCommits[advisoryCommitKey] = AdvisoryCommit({
            voter: msg.sender,
            contentId: contentId,
            roundId: roundId,
            commitHash: commitHash,
            ciphertext: ciphertext,
            targetRound: targetRound,
            drandChainHash: drandChainHash,
            revealableAfter: effectiveRevealableAfter.toUint48(),
            revealedAt: 0,
            roundReferenceRatingBps: roundReferenceRatingBps,
            predictedUpBps: 0,
            identityKey: resolved.identityKey,
            identityHolder: identityHolder,
            revealed: false,
            isUp: false,
            launchCreditClaimed: false,
            scoreBps: 0,
            usedChainHashAtCommit: usedChainHash
        });
        advisoryCommitKeyByRater[contentId][roundId][msg.sender] = advisoryCommitKey;
        if (identityHolder != msg.sender) {
            advisoryCommitKeyByRater[contentId][roundId][identityHolder] = advisoryCommitKey;
        }
        advisoryCommitKeyByIdentity[contentId][roundId][resolved.identityKey] = advisoryCommitKey;
        lastAdvisoryVoteTimestamp[contentId][msg.sender] = block.timestamp;
        if (identityHolder != msg.sender) {
            lastAdvisoryVoteTimestamp[contentId][identityHolder] = block.timestamp;
        }
        lastAdvisoryVoteTimestampByIdentity[contentId][resolved.identityKey] = block.timestamp;
        roundAdvisoryCommitKeys[contentId][roundId].push(advisoryCommitKey);

        emit AdvisoryVoteRecorded(
            contentId,
            roundId,
            msg.sender,
            advisoryCommitKey,
            commitHash,
            roundReferenceRatingBps,
            targetRound,
            drandChainHash
        );
    }

    function revealAdvisoryVote(bytes32 advisoryCommitKey, bool isUp, uint16 predictedUpBps, bytes32 salt)
        external
        nonReentrant
    {
        AdvisoryCommit storage advisoryCommit = advisoryCommits[advisoryCommitKey];
        if (advisoryCommit.voter == address(0)) revert NoCommit();
        if (advisoryCommit.revealed) revert AlreadyRevealed();
        // L-Vote-8: reject the 0%/100% prediction endpoints that collapse the BTS
        // information score to peer-signal-only.
        RobustBtsMath.requireValidUserPrediction(predictedUpBps);
        _assertRevealDrandChainHashUnchanged(advisoryCommit);

        uint256 effectiveRevealableAfter = _effectiveRevealableAfter(advisoryCommit);
        if (block.timestamp < effectiveRevealableAfter) revert EpochNotEnded();

        bytes32 expectedCommitHash = TlockVoteLib.buildExpectedRbtsCommitHash(
            isUp,
            predictedUpBps,
            salt,
            advisoryCommit.voter,
            advisoryCommit.contentId,
            advisoryCommit.roundId,
            advisoryCommit.roundReferenceRatingBps,
            advisoryCommit.targetRound,
            advisoryCommit.drandChainHash,
            advisoryCommit.ciphertext
        );
        if (expectedCommitHash != advisoryCommit.commitHash) revert HashMismatch();

        advisoryCommit.revealed = true;
        advisoryCommit.isUp = isUp;
        advisoryCommit.predictedUpBps = predictedUpBps;
        advisoryCommit.revealedAt = uint48(block.timestamp);

        emit AdvisoryVoteRevealed(
            advisoryCommit.contentId,
            advisoryCommit.roundId,
            advisoryCommit.voter,
            advisoryCommitKey,
            isUp,
            predictedUpBps
        );
    }

    function claimAdvisoryLaunchCredit(bytes32 advisoryCommitKey)
        external
        nonReentrant
        returns (uint16 scoreBps, uint256 paidAmount)
    {
        AdvisoryCommit storage advisoryCommit = advisoryCommits[advisoryCommitKey];
        if (advisoryCommit.voter == address(0)) revert NoCommit();
        if (!advisoryCommit.revealed) revert VoteNotRevealed();
        if (advisoryCommit.launchCreditClaimed) return (advisoryCommit.scoreBps, 0);

        (
            uint48 startTime,
            RoundLib.RoundState state,
            uint16 voteCount,
            uint16 revealedCount,
            uint64 totalStake,
            uint48 thresholdReachedAt,
            uint48 settledAt
        ) = votingEngine.roundCore(advisoryCommit.contentId, advisoryCommit.roundId);
        totalStake;
        thresholdReachedAt;
        if (state != RoundLib.RoundState.Settled) revert RoundNotSettled();
        // M-Vote-1: mirror the reveal-time grace window allowed by `_effectiveRevealableAfter`
        // (I-Vote-A fix). Without this, advisory reveals that landed inside
        // `ProtocolConfig.revealGracePeriod` past `settledAt` would still revert at claim time
        // — losing the launch credit the grace fix was meant to preserve.
        if (advisoryCommit.revealedAt == 0) revert AdvisoryRevealedAfterSettlement();
        if (advisoryCommit.revealedAt > settledAt) {
            uint256 grace = protocolConfig.revealGracePeriod();
            if (settledAt == 0 || grace == 0 || uint256(advisoryCommit.revealedAt) > uint256(settledAt) + grace) {
                revert AdvisoryRevealedAfterSettlement();
            }
        }
        if (!votingEngine.roundRbtsScored(advisoryCommit.contentId, advisoryCommit.roundId)) revert RoundNotSettled();
        if (revealedCount < 3) revert NotEnoughVotes();
        if (votingEngine.roundUnrevealedCleanupRemaining(advisoryCommit.contentId, advisoryCommit.roundId) != 0) {
            revert PendingCleanup();
        }

        bytes32 seed = keccak256(
            abi.encodePacked(
                block.chainid,
                address(this),
                advisoryCommitKey,
                votingEngine.roundRbtsRewardWeight(advisoryCommit.contentId, advisoryCommit.roundId),
                votingEngine.roundRbtsForfeitedPool(advisoryCommit.contentId, advisoryCommit.roundId)
            )
        );
        // M-Vote-5 (audit 2026-05-18): mirror the M-Vote-4 fix on the engine. Build the
        // revealed-and-staked subset once, then index directly into it for the reference and
        // peer draws so that a sybil cluster of unrevealed commits cannot bias the sampler
        // toward the first revealed commit after a contiguous unrevealed run.
        bytes32[] memory revealedKeys =
            _buildRevealedKeySet(advisoryCommit.contentId, advisoryCommit.roundId, voteCount);
        uint256 revealedLen = revealedKeys.length;
        if (revealedLen < 2) revert NotEnoughVotes();
        uint256 referenceIndex = uint256(seed) % revealedLen;
        bytes32 referenceKey = revealedKeys[referenceIndex];
        uint256 peerIndex = _advisoryPeerIndex(seed, referenceIndex, revealedLen);
        bytes32 peerKey = revealedKeys[peerIndex];
        (,,,, bool peerRevealed, bool peerIsUp,) =
            votingEngine.commitCore(advisoryCommit.contentId, advisoryCommit.roundId, peerKey);
        if (!peerRevealed) revert NotEnoughVotes();

        scoreBps = RobustBtsMath.scoreBps(
            advisoryCommit.isUp,
            advisoryCommit.predictedUpBps,
            votingEngine.commitPredictedUpBps(advisoryCommit.contentId, advisoryCommit.roundId, referenceKey),
            peerIsUp
        );
        advisoryCommit.scoreBps = scoreBps;

        address launchPool = protocolConfig.launchDistributionPool();
        if (launchPool == address(0)) return (scoreBps, 0);

        address rewardRecipient = _advisoryRewardRecipient(advisoryCommit);
        ILaunchDistributionPool launchDistributionPool = ILaunchDistributionPool(launchPool);
        if (
            _hasCountedCommitForAdvisory(advisoryCommit)
                || launchDistributionPool.raterRoundCreditRecorded(
                    rewardRecipient, advisoryCommit.contentId, advisoryCommit.roundId
                )
        ) {
            advisoryCommit.launchCreditClaimed = true;
            emit AdvisoryLaunchCreditClaimed(
                advisoryCommit.contentId, advisoryCommit.roundId, rewardRecipient, advisoryCommitKey, scoreBps, 0
            );
            return (scoreBps, 0);
        }

        uint32 minAnchorCredentialAgeSeconds = launchDistributionPool.launchAnchorCredentialAgeSeconds();
        bytes32[] memory verifiedAnchorIds = LaunchRaterRewardLib.collectAnchorIds(
            protocolConfig,
            votingEngine,
            registry,
            advisoryCommit.contentId,
            advisoryCommit.roundId,
            rewardRecipient,
            voteCount,
            startTime,
            minAnchorCredentialAgeSeconds
        );
        bool recorded;
        (recorded, paidAmount) = _recordAdvisoryLaunchCredit(
            launchDistributionPool,
            advisoryCommit,
            rewardRecipient,
            advisoryCommitKey,
            scoreBps,
            revealedCount,
            verifiedAnchorIds
        );
        if (!recorded) return (scoreBps, 0);

        advisoryCommit.launchCreditClaimed = true;

        emit AdvisoryLaunchCreditClaimed(
            advisoryCommit.contentId, advisoryCommit.roundId, rewardRecipient, advisoryCommitKey, scoreBps, paidAmount
        );
    }

    function _recordAdvisoryLaunchCredit(
        ILaunchDistributionPool launchDistributionPool,
        AdvisoryCommit storage advisoryCommit,
        address rewardRecipient,
        bytes32 advisoryCommitKey,
        uint16 scoreBps,
        uint16 revealedCount,
        bytes32[] memory verifiedAnchorIds
    ) internal returns (bool recorded, uint256 paidAmount) {
        return launchDistributionPool.recordAdvisoryRaterRewardWithSourceReady(
                rewardRecipient,
                advisoryCommit.contentId,
                advisoryCommit.roundId,
                advisoryCommitKey,
                scoreBps,
                revealedCount,
                true,
                verifiedAnchorIds,
                votingEngine.roundClusterPayoutReadyAt(advisoryCommit.contentId, advisoryCommit.roundId)
            );
    }

    function advisoryCommitCore(bytes32 advisoryCommitKey)
        external
        view
        returns (
            address voter,
            uint256 contentId,
            uint256 roundId,
            bytes32 commitHash,
            uint48 revealableAfter,
            bool revealed,
            bool isUp,
            uint16 predictedUpBps,
            bool launchCreditClaimed,
            uint16 scoreBps
        )
    {
        AdvisoryCommit storage advisoryCommit = advisoryCommits[advisoryCommitKey];
        return (
            advisoryCommit.voter,
            advisoryCommit.contentId,
            advisoryCommit.roundId,
            advisoryCommit.commitHash,
            advisoryCommit.revealableAfter,
            advisoryCommit.revealed,
            advisoryCommit.isUp,
            advisoryCommit.predictedUpBps,
            advisoryCommit.launchCreditClaimed,
            advisoryCommit.scoreBps
        );
    }

    function advisoryCommitRevealData(bytes32 advisoryCommitKey)
        external
        view
        returns (
            bytes memory ciphertext,
            uint64 targetRound,
            bytes32 drandChainHash,
            uint48 revealableAfter,
            bool revealed,
            uint64 stakeAmount
        )
    {
        AdvisoryCommit storage advisoryCommit = advisoryCommits[advisoryCommitKey];
        return (
            advisoryCommit.ciphertext,
            advisoryCommit.targetRound,
            advisoryCommit.drandChainHash,
            advisoryCommit.revealableAfter,
            advisoryCommit.revealed,
            0
        );
    }

    function getRoundAdvisoryCommitKey(uint256 contentId, uint256 roundId, uint256 index)
        external
        view
        returns (bytes32)
    {
        bytes32[] storage commitKeys = roundAdvisoryCommitKeys[contentId][roundId];
        if (index >= commitKeys.length) revert IndexOutOfBounds();
        return commitKeys[index];
    }

    function roundAdvisoryCommitCount(uint256 contentId, uint256 roundId) external view returns (uint256) {
        return roundAdvisoryCommitKeys[contentId][roundId].length;
    }

    function _computeEpochEnd(uint48 startTime, uint32 epochDuration) internal view returns (uint256) {
        uint256 elapsed = block.timestamp - uint256(startTime);
        uint256 epochIdx = elapsed / epochDuration;
        return uint256(startTime) + (epochIdx + 1) * epochDuration;
    }

    function _validateCommitTlockData(
        uint256 contentId,
        uint256 roundId,
        bytes calldata ciphertext,
        uint64 targetRound,
        bytes32 drandChainHash,
        uint256 epochEnd,
        uint32 epochDuration
    ) internal view returns (bytes32 usedChainHash) {
        (bytes32 expectedChainHash, uint64 genesisTime, uint64 period) =
            votingEngine.roundDrandConfig(contentId, roundId);
        if (expectedChainHash == bytes32(0) || genesisTime == 0 || period == 0) {
            expectedChainHash = protocolConfig.drandChainHash();
            genesisTime = protocolConfig.drandGenesisTime();
            period = protocolConfig.drandPeriod();
        }
        TlockVoteLib.validateCommitData(
            ciphertext, targetRound, drandChainHash, expectedChainHash, epochEnd, epochDuration, genesisTime, period
        );
        usedChainHash = expectedChainHash;
    }

    function _resolvedRoundDrandConfig(uint256 contentId, uint256 roundId)
        internal
        view
        returns (bytes32 chainHash, uint64 genesisTime, uint64 period)
    {
        (chainHash, genesisTime, period) = votingEngine.roundDrandConfig(contentId, roundId);
        if (chainHash == bytes32(0) || genesisTime == 0 || period == 0) {
            chainHash = protocolConfig.drandChainHash();
            genesisTime = protocolConfig.drandGenesisTime();
            period = protocolConfig.drandPeriod();
        }
    }

    function _targetRoundAt(uint256 timestamp, uint64 genesisTime, uint64 period) internal pure returns (uint64) {
        if (period == 0 || timestamp < genesisTime) return 0;
        return uint64(((timestamp - genesisTime) / period) + 1);
    }

    function _targetRoundAtOrAfter(uint256 timestamp, uint64 genesisTime, uint64 period)
        internal
        pure
        returns (uint64)
    {
        if (period == 0 || timestamp < genesisTime) return 0;
        uint256 elapsed = timestamp - genesisTime;
        return uint64(((elapsed + uint256(period) - 1) / uint256(period)) + 1);
    }

    /// @notice Reject the reveal if the drand chain hash used at commit-time no longer matches
    ///         the value the round snapshot would resolve to today.
    /// @dev `_validateCommitTlockData` falls back to live `protocolConfig.drandChainHash` for
    ///      preview commits (when the round snapshot is still empty). Once the round is opened
    ///      its snapshot becomes authoritative, and a subsequent governance rotation of
    ///      `protocolConfig.drandChainHash` would otherwise let a commit's ciphertext go
    ///      undecryptable without any on-chain error — voters would silently forfeit credit.
    ///      This check forces the inconsistency into a clear revert at reveal-time so callers
    ///      and indexers can detect it.
    function _assertRevealDrandChainHashUnchanged(AdvisoryCommit storage advisoryCommit) internal view {
        bytes32 committed = advisoryCommit.usedChainHashAtCommit;
        (bytes32 snapshotChainHash,,) = votingEngine.roundDrandConfig(advisoryCommit.contentId, advisoryCommit.roundId);
        if (snapshotChainHash == bytes32(0)) {
            snapshotChainHash = protocolConfig.drandChainHash();
        }
        if (snapshotChainHash != committed) revert DrandChainHashMismatch();
    }

    function _roundRaterRegistry(uint256 contentId, uint256 roundId) internal view returns (IRaterIdentityRegistry) {
        address snapshot = votingEngine.roundRaterRegistrySnapshot(contentId, roundId);
        if (snapshot == address(0)) {
            snapshot = protocolConfig.raterRegistry();
        }
        return IRaterIdentityRegistry(snapshot);
    }

    function _validateAdvisoryCooldown(uint256 contentId, address voter, address identityHolder, bytes32 identityKey)
        internal
        view
    {
        uint256 lastVote = votingEngine.voterLastVoteTimestamp(contentId, voter);
        uint256 lastAdvisory = lastAdvisoryVoteTimestamp[contentId][voter];
        if (lastAdvisory > lastVote) lastVote = lastAdvisory;
        if (identityHolder != address(0) && identityHolder != voter) {
            uint256 lastHolderVote = votingEngine.voterLastVoteTimestamp(contentId, identityHolder);
            uint256 lastHolderAdvisory = lastAdvisoryVoteTimestamp[contentId][identityHolder];
            if (lastHolderVote > lastVote) lastVote = lastHolderVote;
            if (lastHolderAdvisory > lastVote) lastVote = lastHolderAdvisory;
        }

        if (identityKey != bytes32(0)) {
            uint256 lastIdentityVote = votingEngine.identityLastVoteTimestamp(contentId, identityKey);
            uint256 lastIdentityAdvisory = lastAdvisoryVoteTimestampByIdentity[contentId][identityKey];
            if (lastIdentityVote > lastVote) lastVote = lastIdentityVote;
            if (lastIdentityAdvisory > lastVote) lastVote = lastIdentityAdvisory;
        }

        if (lastVote > 0 && block.timestamp < lastVote + ADVISORY_VOTE_COOLDOWN) {
            revert VotePreflightLib.CooldownActive();
        }
    }

    function _effectiveRevealableAfter(AdvisoryCommit storage advisoryCommit) internal view returns (uint256) {
        (uint48 roundStart, RoundLib.RoundState state,,,,, uint48 settledAt) =
            votingEngine.roundCore(advisoryCommit.contentId, advisoryCommit.roundId);
        if (roundStart == 0) revert RoundNotOpen();
        // I-Vote-A: allow advisory reveals during a brief grace window after settledAt so a
        // fast-settle keeper does not silently close the door on every pending advisory reveal
        // that already passed its tlock. `settleRound` flips state → Settled/Tied AND writes
        // `settledAt` in the same tx, so we must accept both states (in addition to Open) when
        // still inside `ProtocolConfig.revealGracePeriod`. Outside the grace window — and for
        // any non-open / non-grace state (e.g. Cancelled) — we still revert. The grace scales
        // with epoch duration via ProtocolConfig.
        if (state == RoundLib.RoundState.Settled || state == RoundLib.RoundState.Tied) {
            uint256 grace = protocolConfig.revealGracePeriod();
            if (settledAt == 0 || grace == 0 || block.timestamp > uint256(settledAt) + grace) {
                revert RoundNotOpen();
            }
        } else if (state != RoundLib.RoundState.Open) {
            revert RoundNotOpen();
        }

        (uint32 epochDuration,,,) = votingEngine.roundConfigSnapshot(advisoryCommit.contentId, advisoryCommit.roundId);
        if (epochDuration == 0) {
            (epochDuration,,,) = protocolConfig.config();
        }
        if (epochDuration == 0) revert InvalidRound();

        uint256 firstRealEpochEnd = uint256(roundStart) + uint256(epochDuration);
        uint256 targetRevealableAfter = votingEngine.targetRoundRevealableTimestamp(
            advisoryCommit.contentId, advisoryCommit.roundId, advisoryCommit.targetRound
        );
        uint256 revealableAfter = advisoryCommit.revealableAfter;
        if (firstRealEpochEnd > revealableAfter) revealableAfter = firstRealEpochEnd;
        if (targetRevealableAfter > revealableAfter) revealableAfter = targetRevealableAfter;
        return revealableAfter;
    }

    function _advisoryRewardRecipient(AdvisoryCommit storage advisoryCommit) internal view returns (address) {
        if (advisoryCommit.identityHolder != address(0)) return advisoryCommit.identityHolder;
        if (advisoryCommit.identityKey != bytes32(0)) {
            IRaterIdentityRegistry identityRegistry =
                _roundRaterRegistry(advisoryCommit.contentId, advisoryCommit.roundId);
            if (address(identityRegistry) != address(0)) {
                try identityRegistry.resolveRater(advisoryCommit.voter) returns (
                    IRaterIdentityRegistry.ResolvedRater memory resolved
                ) {
                    if (resolved.identityKey == advisoryCommit.identityKey && resolved.holder != address(0)) {
                        return resolved.holder;
                    }
                } catch { }
            }
        }
        return advisoryCommit.voter;
    }

    function _hasCountedCommitForAdvisory(AdvisoryCommit storage advisoryCommit) internal view returns (bool) {
        if (
            votingEngine.voterCommitHash(advisoryCommit.contentId, advisoryCommit.roundId, advisoryCommit.voter)
                != bytes32(0)
        ) {
            return true;
        }
        if (
            advisoryCommit.identityHolder != address(0) && advisoryCommit.identityHolder != advisoryCommit.voter
                && votingEngine.voterCommitHash(
                        advisoryCommit.contentId, advisoryCommit.roundId, advisoryCommit.identityHolder
                    ) != bytes32(0)
        ) {
            return true;
        }
        if (
            advisoryCommit.identityHolder != address(0)
                && votingEngine.holderCommitKey(
                        advisoryCommit.contentId, advisoryCommit.roundId, advisoryCommit.identityHolder
                    ) != bytes32(0)
        ) {
            return true;
        }
        if (
            advisoryCommit.identityKey != bytes32(0)
                && votingEngine.identityCommitKey(
                        advisoryCommit.contentId, advisoryCommit.roundId, advisoryCommit.identityKey
                    ) != bytes32(0)
        ) {
            return true;
        }
        return false;
    }

    /// @notice Build the threshold-scored revealed-and-staked subset of the engine's committed set for a round.
    /// @dev M-Vote-5 (audit 2026-05-18): the prior `_findRevealedCommitKey` did a forward scan
    ///      over the committed set, which let a sybil cluster of contiguous unrevealed commits
    ///      absorb the sampler probability mass for the first revealed commit after the run.
    ///      Materializing the revealed subset once and indexing directly into it restores
    ///      uniform sampling — mirroring the M-Vote-4 fix in `RoundRevealLib._scoreRbtsCommitAt`.
    ///      The RBTS scoring-weight check also excludes real votes revealed after threshold,
    ///      including those that share the threshold timestamp in the same block.
    function _buildRevealedKeySet(uint256 contentId, uint256 roundId, uint16 voteCount)
        internal
        view
        returns (bytes32[] memory revealedKeys)
    {
        if (voteCount == 0) revert NotEnoughVotes();
        revealedKeys = new bytes32[](voteCount);
        uint256 revealedIdx;
        for (uint256 i = 0; i < voteCount;) {
            bytes32 candidate = votingEngine.getRoundCommitKey(contentId, roundId, i);
            (, uint64 stakeAmount,,, bool revealed,,) = votingEngine.commitCore(contentId, roundId, candidate);
            if (revealed && stakeAmount > 0 && votingEngine.commitRbtsScoringWeight(contentId, roundId, candidate) > 0)
            {
                revealedKeys[revealedIdx] = candidate;
                unchecked {
                    ++revealedIdx;
                }
            }
            unchecked {
                ++i;
            }
        }
        assembly {
            mstore(revealedKeys, revealedIdx)
        }
    }

    /// @notice Uniform peer-index draw excluding `referenceIndex` over the revealed set.
    /// @dev Single-exclusion analogue of `RoundRevealLib._rbtsPeerIndex`. The advisory voter
    ///      is not in the engine's revealed set (zero-stake parallel structure), so only the
    ///      reference draw is excluded from the peer draw.
    function _advisoryPeerIndex(bytes32 seed, uint256 referenceIndex, uint256 count) internal pure returns (uint256) {
        // Deterministic sampler over the threshold-frozen revealed set.
        // slither-disable-next-line weak-prng
        uint256 drawn = uint256(keccak256(abi.encodePacked(seed, uint8(1)))) % (count - 1);
        return drawn >= referenceIndex ? drawn + 1 : drawn;
    }
}
