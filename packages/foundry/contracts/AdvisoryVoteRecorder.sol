// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";
import { ReentrancyGuardTransient } from "@openzeppelin/contracts/utils/ReentrancyGuardTransient.sol";
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
/// @notice Zero-stake commit-reveal votes that can bootstrap launch rewards without affecting round mechanics.
contract AdvisoryVoteRecorder is Ownable, ReentrancyGuardTransient {
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
    error AdvisoryRevealedAfterRealVote();
    error PendingCleanup();
    error NotEnoughVotes();
    error Paused();
    error IndexOutOfBounds();
    error MaxAdvisoryVotersReached();

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
    }

    mapping(bytes32 => AdvisoryCommit) internal advisoryCommits;
    mapping(uint256 => mapping(uint256 => mapping(address => bytes32))) public advisoryCommitKeyByRater;
    mapping(uint256 => mapping(uint256 => mapping(bytes32 => bytes32))) public advisoryCommitKeyByIdentity;
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

    /// @notice Record a zero-stake advisory commit for the active round.
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

        uint48 startTime;
        uint32 epochDuration;
        uint32 maxDuration;
        uint16 maxVoters;
        uint256 currentRoundId = votingEngine.currentRoundId(contentId);
        if (currentRoundId == roundId) {
            RoundLib.RoundState state;
            uint16 voteCount;
            uint16 revealedCount;
            uint64 totalStake;
            uint48 thresholdReachedAt;
            uint48 settledAt;
            (startTime, state, voteCount, revealedCount, totalStake, thresholdReachedAt, settledAt) =
                votingEngine.roundCore(contentId, roundId);
            voteCount;
            revealedCount;
            totalStake;
            settledAt;
            if (state != RoundLib.RoundState.Open) revert RoundNotOpen();
            if (thresholdReachedAt != 0) revert ThresholdReached();

            (epochDuration, maxDuration,, maxVoters) = votingEngine.roundConfigSnapshot(contentId, roundId);
            if (startTime == 0 || block.timestamp >= uint256(startTime) + maxDuration) revert RoundNotOpen();
            if (roundReferenceRatingBps != votingEngine.roundReferenceRatingBpsForRound(contentId, roundId)) {
                revert InvalidCommitHash();
            }
        } else {
            if (roundId != votingEngine.previewCommitRoundId(contentId)) revert InvalidRound();
            if (roundReferenceRatingBps != votingEngine.previewCommitReferenceRatingBps(contentId)) {
                revert InvalidCommitHash();
            }
            startTime = uint48(block.timestamp);
            RoundLib.RoundConfig memory contentRoundConfig = registry.getContentRoundConfig(contentId);
            epochDuration = contentRoundConfig.epochDuration;
            maxDuration = contentRoundConfig.maxDuration;
            maxVoters = contentRoundConfig.maxVoters;
        }

        if (maxDuration == 0 || epochDuration == 0 || maxVoters == 0) revert InvalidRound();
        if (roundReferenceRatingBps == 0) {
            revert InvalidCommitHash();
        }
        if (roundAdvisoryCommitKeys[contentId][roundId].length >= maxVoters) revert MaxAdvisoryVotersReached();

        IRaterIdentityRegistry identityRegistry = _roundRaterRegistry(contentId, roundId);
        IRaterIdentityRegistry.ResolvedRater memory resolved =
            VotePreflightLib.validateVoterAndContent(identityRegistry, registry, msg.sender, contentId);
        _validateAdvisoryCooldown(contentId, msg.sender, resolved.identityKey);

        if (votingEngine.voterCommitHash(contentId, roundId, msg.sender) != bytes32(0)) revert AlreadyCommitted();
        if (votingEngine.identityCommitKey(contentId, roundId, resolved.identityKey) != bytes32(0)) {
            revert AlreadyCommitted();
        }
        if (advisoryCommitKeyByRater[contentId][roundId][msg.sender] != bytes32(0)) revert AlreadyCommitted();
        if (advisoryCommitKeyByIdentity[contentId][roundId][resolved.identityKey] != bytes32(0)) {
            revert AlreadyCommitted();
        }
        advisoryCommitKey = keccak256(abi.encodePacked(bytes1(0xa1), msg.sender, contentId, roundId, commitHash));

        uint256 epochEnd = _computeEpochEnd(startTime, epochDuration);
        _validateCommitTlockData(contentId, roundId, ciphertext, targetRound, drandChainHash, epochEnd, epochDuration);
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
            revealableAfter: uint48(effectiveRevealableAfter),
            revealedAt: 0,
            roundReferenceRatingBps: roundReferenceRatingBps,
            predictedUpBps: 0,
            identityKey: resolved.identityKey,
            identityHolder: resolved.holder,
            revealed: false,
            isUp: false,
            launchCreditClaimed: false,
            scoreBps: 0
        });
        advisoryCommitKeyByRater[contentId][roundId][msg.sender] = advisoryCommitKey;
        advisoryCommitKeyByIdentity[contentId][roundId][resolved.identityKey] = advisoryCommitKey;
        lastAdvisoryVoteTimestamp[contentId][msg.sender] = block.timestamp;
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
        if (predictedUpBps > 10_000) revert HashMismatch();

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
        if (advisoryCommit.revealedAt == 0 || advisoryCommit.revealedAt > settledAt) {
            revert AdvisoryRevealedAfterSettlement();
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
        bytes32 referenceKey =
            _findRevealedCommitKey(advisoryCommit.contentId, advisoryCommit.roundId, voteCount, seed, bytes32(0));
        bytes32 peerKey = _findRevealedCommitKey(
            advisoryCommit.contentId,
            advisoryCommit.roundId,
            voteCount,
            keccak256(abi.encodePacked(seed, referenceKey)),
            referenceKey
        );
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
        (recorded, paidAmount) = launchDistributionPool.recordAdvisoryRaterReward(
            rewardRecipient,
            advisoryCommit.contentId,
            advisoryCommit.roundId,
            advisoryCommitKey,
            scoreBps,
            revealedCount,
            true,
            verifiedAnchorIds
        );
        if (!recorded) return (scoreBps, 0);

        advisoryCommit.launchCreditClaimed = true;

        emit AdvisoryLaunchCreditClaimed(
            advisoryCommit.contentId, advisoryCommit.roundId, rewardRecipient, advisoryCommitKey, scoreBps, paidAmount
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
    ) internal view {
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
    }

    function _roundRaterRegistry(uint256 contentId, uint256 roundId) internal view returns (IRaterIdentityRegistry) {
        address snapshot = votingEngine.roundRaterRegistrySnapshot(contentId, roundId);
        if (snapshot == address(0)) {
            snapshot = protocolConfig.raterRegistry();
        }
        return IRaterIdentityRegistry(snapshot);
    }

    function _validateAdvisoryCooldown(uint256 contentId, address voter, bytes32 identityKey) internal view {
        uint256 lastVote = votingEngine.voterLastVoteTimestamp(contentId, voter);
        uint256 lastAdvisory = lastAdvisoryVoteTimestamp[contentId][voter];
        if (lastAdvisory > lastVote) lastVote = lastAdvisory;

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
        (uint48 roundStart, RoundLib.RoundState state,, uint16 revealedCount,,, uint48 settledAt) =
            votingEngine.roundCore(advisoryCommit.contentId, advisoryCommit.roundId);
        if (roundStart == 0 || state != RoundLib.RoundState.Open || settledAt != 0) revert RoundNotOpen();
        if (revealedCount != 0) revert AdvisoryRevealedAfterRealVote();

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
            advisoryCommit.identityKey != bytes32(0)
                && votingEngine.identityCommitKey(
                        advisoryCommit.contentId, advisoryCommit.roundId, advisoryCommit.identityKey
                    ) != bytes32(0)
        ) {
            return true;
        }
        return false;
    }

    function _findRevealedCommitKey(
        uint256 contentId,
        uint256 roundId,
        uint16 voteCount,
        bytes32 seed,
        bytes32 excludedKey
    ) internal view returns (bytes32 commitKey) {
        if (voteCount == 0) revert NotEnoughVotes();
        uint256 startIndex = uint256(seed) % voteCount;
        for (uint256 offset = 0; offset < voteCount; offset++) {
            uint256 index = (startIndex + offset) % voteCount;
            bytes32 candidate = votingEngine.getRoundCommitKey(contentId, roundId, index);
            if (candidate == excludedKey) continue;
            (, uint64 stakeAmount,,, bool revealed,,) = votingEngine.commitCore(contentId, roundId, candidate);
            if (revealed && stakeAmount > 0) return candidate;
        }
        revert NotEnoughVotes();
    }
}
