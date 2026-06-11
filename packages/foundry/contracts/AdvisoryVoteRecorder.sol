// SPDX-License-Identifier: MIT
pragma solidity ^0.8.34;

import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";
import { ReentrancyGuardTransient } from "@openzeppelin/contracts/utils/ReentrancyGuardTransient.sol";
import { SafeCast } from "@openzeppelin/contracts/utils/math/SafeCast.sol";
import { ContentRegistry } from "./ContentRegistry.sol";
import { ProtocolConfig } from "./ProtocolConfig.sol";
import { RoundVotingEngine } from "./RoundVotingEngine.sol";
import { ILaunchDistributionPool } from "./interfaces/ILaunchDistributionPool.sol";
import { IConfidentialityEscrow } from "./interfaces/IConfidentialityEscrow.sol";
import { IRaterIdentityRegistry } from "./interfaces/IRaterIdentityRegistry.sol";
import { IRaterRegistryStatus } from "./interfaces/IRaterRegistryStatus.sol";
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
    error UnverifiedAdvisoryCapReached();
    error InvalidLaunchRewardPolicy();
    error TargetRoundOutOfWindow();
    error ConfidentialityGated();
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
    uint16 internal constant DEFAULT_MAX_UNVERIFIED_ADVISORY_COMMITS_PER_ROUND = 3;

    bool public paused;

    struct AdvisoryCommit {
        address voter;
        uint256 contentId;
        uint256 roundId;
        bytes32 commitHash;
        bytes32 ciphertextHash;
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
        bool revealedAfterSettlement;
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
        uint48 startTime;
        uint32 epochDuration;
        uint16 maxVoters;
    }

    struct AdvisoryIdentityContext {
        address holder;
        bytes32 identityKey;
        bool hasActiveHumanCredential;
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
        InvalidConfig,
        UnverifiedAdvisoryCapReached,
        ConfidentialityGated
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

    struct AdvisoryTlockData {
        bytes32 usedChainHash;
        uint48 revealableAfter;
        bytes32 ciphertextHash;
    }

    mapping(bytes32 => AdvisoryCommit) internal advisoryCommits;
    // Account aliases: delegated advisory commits write both the delegate and stable holder.
    mapping(uint256 => mapping(uint256 => mapping(address => bytes32))) public advisoryCommitKeyByRater;
    mapping(uint256 => mapping(uint256 => mapping(bytes32 => bytes32))) public advisoryCommitKeyByIdentity;
    // Account aliases: delegated advisory commits refresh both the delegate and stable holder cooldowns.
    mapping(uint256 => mapping(address => uint256)) internal _lastAdvisoryVoteTimestamp;
    mapping(uint256 => mapping(bytes32 => uint256)) internal _lastAdvisoryVoteTimestampByIdentity;
    mapping(uint256 => mapping(uint256 => bytes32[])) internal roundAdvisoryCommitKeys;
    mapping(uint256 => mapping(uint256 => uint16)) public roundUnverifiedAdvisoryCommitCount;

    event AdvisoryVoteRecorded(
        uint256 indexed contentId,
        uint256 indexed roundId,
        address indexed voter,
        bytes32 advisoryCommitKey,
        bytes32 commitHash,
        uint16 roundReferenceRatingBps,
        uint64 targetRound,
        bytes32 drandChainHash,
        bytes32 ciphertextHash,
        bytes ciphertext
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
        if (_isGatedContent(contentId, availability.roundId)) {
            availability.status = AdvisoryCommitAvailabilityStatus.ConfidentialityGated;
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

        (
            availability.roundReferenceRatingBps,,
            availability.drandChainHash,
            availability.drandGenesisTime,
            availability.drandPeriod,,
        ) = _resolvedAdvisoryRoundContext(contentId, availability.roundId, 0);
        availability.epochEnd = uint256(roundStart) + uint256(epochDuration);
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
        (bool capLoaded, uint16 maxUnverifiedCommits) = _maxUnverifiedAdvisoryCommitsPerRound();
        if (!capLoaded) {
            availability.status = AdvisoryCommitAvailabilityStatus.InvalidConfig;
            return availability;
        }
        if (
            _unverifiedAdvisoryCommitCapReached(contentId, availability.roundId, maxUnverifiedCommits)
                && !_hasActiveHumanCredentialForRound(contentId, availability.roundId, msg.sender)
        ) {
            availability.status = AdvisoryCommitAvailabilityStatus.UnverifiedAdvisoryCapReached;
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
        if (paused || votingEngine.paused()) revert Paused();
        if (commitHash == bytes32(0)) revert InvalidCommitHash();

        uint256 roundId = roundContext >> 16;
        if (roundId == 0) revert InvalidRound();
        if (_isGatedContent(contentId, roundId)) revert ConfidentialityGated();
        uint16 roundReferenceRatingBps = uint16(roundContext);

        AdvisoryIdentityContext memory identityContext = _validateAdvisoryCommitter(contentId, roundId);

        AdvisoryTlockData memory tlockData;
        {
            (uint48 roundStartTime, uint32 epochDuration, uint16 maxVoters) =
                _validateAdvisoryRoundForCommit(contentId, roundId, roundReferenceRatingBps);
            if (roundAdvisoryCommitKeys[contentId][roundId].length >= maxVoters) {
                revert MaxAdvisoryVotersReached();
            }
            if (!identityContext.hasActiveHumanCredential) {
                (bool capLoaded, uint16 maxUnverifiedCommits) = _maxUnverifiedAdvisoryCommitsPerRound();
                if (!capLoaded) revert InvalidLaunchRewardPolicy();
                if (_unverifiedAdvisoryCommitCapReached(contentId, roundId, maxUnverifiedCommits)) {
                    revert UnverifiedAdvisoryCapReached();
                }
            }
            tlockData = _validateAdvisoryCommitTlock(
                contentId, roundId, ciphertext, targetRound, drandChainHash, roundStartTime, epochDuration
            );
        }

        advisoryCommitKey = keccak256(abi.encodePacked(bytes1(0xa1), msg.sender, contentId, roundId, commitHash));

        AdvisoryCommit storage advisoryCommit = advisoryCommits[advisoryCommitKey];
        advisoryCommit.voter = msg.sender;
        advisoryCommit.contentId = contentId;
        advisoryCommit.roundId = roundId;
        advisoryCommit.commitHash = commitHash;
        advisoryCommit.ciphertextHash = tlockData.ciphertextHash;
        advisoryCommit.targetRound = targetRound;
        advisoryCommit.drandChainHash = drandChainHash;
        advisoryCommit.revealableAfter = tlockData.revealableAfter;
        advisoryCommit.roundReferenceRatingBps = roundReferenceRatingBps;
        advisoryCommit.identityKey = identityContext.identityKey;
        advisoryCommit.identityHolder = identityContext.holder;
        advisoryCommit.usedChainHashAtCommit = tlockData.usedChainHash;
        advisoryCommitKeyByRater[contentId][roundId][msg.sender] = advisoryCommitKey;
        if (identityContext.holder != msg.sender) {
            advisoryCommitKeyByRater[contentId][roundId][identityContext.holder] = advisoryCommitKey;
        }
        advisoryCommitKeyByIdentity[contentId][roundId][identityContext.identityKey] = advisoryCommitKey;
        _lastAdvisoryVoteTimestamp[contentId][msg.sender] = block.timestamp;
        if (identityContext.holder != msg.sender) {
            _lastAdvisoryVoteTimestamp[contentId][identityContext.holder] = block.timestamp;
        }
        _lastAdvisoryVoteTimestampByIdentity[contentId][identityContext.identityKey] = block.timestamp;
        protocolConfig.recordAdvisoryCooldown(
            contentId, msg.sender, identityContext.holder, identityContext.identityKey
        );
        roundAdvisoryCommitKeys[contentId][roundId].push(advisoryCommitKey);
        if (!identityContext.hasActiveHumanCredential) {
            roundUnverifiedAdvisoryCommitCount[contentId][roundId] += 1;
        }

        emit AdvisoryVoteRecorded(
            contentId,
            roundId,
            msg.sender,
            advisoryCommitKey,
            commitHash,
            roundReferenceRatingBps,
            targetRound,
            drandChainHash,
            tlockData.ciphertextHash,
            ciphertext
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

        bytes32 expectedCommitHash = TlockVoteLib.buildExpectedRbtsCommitHashFromCiphertextHash(
            isUp,
            predictedUpBps,
            salt,
            advisoryCommit.voter,
            advisoryCommit.contentId,
            advisoryCommit.roundId,
            advisoryCommit.roundReferenceRatingBps,
            advisoryCommit.targetRound,
            advisoryCommit.drandChainHash,
            advisoryCommit.ciphertextHash
        );
        if (expectedCommitHash != advisoryCommit.commitHash) revert HashMismatch();

        advisoryCommit.revealed = true;
        advisoryCommit.isUp = isUp;
        advisoryCommit.predictedUpBps = predictedUpBps;
        advisoryCommit.revealedAt = uint48(block.timestamp);
        (,,,,, bool rbtsScoringClosed,) =
            _resolvedAdvisoryRoundContext(advisoryCommit.contentId, advisoryCommit.roundId, 0);
        advisoryCommit.revealedAfterSettlement =
            _isTerminalRound(advisoryCommit.contentId, advisoryCommit.roundId) || rbtsScoringClosed;

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
        // Advisory reveals may still land briefly after settlement so fast-settling keepers do
        // not make the reveal impossible, but launch-credit scoring must only use advisory votes
        // revealed before the settled outcome and RBTS reward pools are known.
        if (advisoryCommit.revealedAt == 0) revert AdvisoryRevealedAfterSettlement();
        if (settledAt == 0 || advisoryCommit.revealedAfterSettlement || advisoryCommit.revealedAt > settledAt) {
            revert AdvisoryRevealedAfterSettlement();
        }
        (bool scored, bytes32 rbtsScoreSeed,,,) =
            votingEngine.rbtsRoundState(advisoryCommit.contentId, advisoryCommit.roundId);
        if (!scored) revert RoundNotSettled();
        if (revealedCount < 3) revert NotEnoughVotes();
        (,, uint256 cleanupRemaining,) =
            votingEngine.roundLifecycleState(advisoryCommit.contentId, advisoryCommit.roundId);
        if (cleanupRemaining != 0) {
            revert PendingCleanup();
        }

        if (rbtsScoreSeed == bytes32(0)) {
            advisoryCommit.launchCreditClaimed = true;
            emit AdvisoryLaunchCreditClaimed(
                advisoryCommit.contentId,
                advisoryCommit.roundId,
                _advisoryRewardRecipient(advisoryCommit),
                advisoryCommitKey,
                0,
                0
            );
            return (0, 0);
        }

        // M-Vote-5 (audit 2026-05-18): mirror the M-Vote-4 fix on the engine. Build the
        // revealed-and-staked subset once, then index directly into it for the reference and
        // peer draws so that a sybil cluster of unrevealed commits cannot bias the sampler
        // toward the first revealed commit after a contiguous unrevealed run.
        bytes32[] memory revealedKeys =
            _buildRevealedKeySet(advisoryCommit.contentId, advisoryCommit.roundId, voteCount);
        uint256 revealedLen = revealedKeys.length;
        if (revealedLen < 2) revert NotEnoughVotes();
        bytes32 seed = _buildAdvisorySamplerSeed(
            advisoryCommit.contentId,
            advisoryCommit.roundId,
            advisoryCommit.voter,
            advisoryCommit.identityKey,
            rbtsScoreSeed
        );
        uint256 referenceIndex = uint256(seed) % revealedLen;
        bytes32 referenceKey = revealedKeys[referenceIndex];
        uint256 peerIndex = _advisoryPeerIndex(seed, referenceIndex, revealedLen);
        bytes32 peerKey = revealedKeys[peerIndex];
        (,,,, bool peerRevealed, bool peerIsUp,) =
            votingEngine.commitCore(advisoryCommit.contentId, advisoryCommit.roundId, peerKey);
        if (!peerRevealed) revert NotEnoughVotes();

        (uint16 referencePredictedUpBps,,,,) =
            votingEngine.rbtsCommitState(advisoryCommit.contentId, advisoryCommit.roundId, referenceKey);
        scoreBps = RobustBtsMath.scoreBps(
            advisoryCommit.isUp, advisoryCommit.predictedUpBps, referencePredictedUpBps, peerIsUp
        );
        advisoryCommit.scoreBps = scoreBps;

        address launchPool = protocolConfig.launchDistributionPool();
        if (launchPool == address(0)) return (scoreBps, 0);
        if (_isIdentityBanned(advisoryCommit.contentId, advisoryCommit.roundId, advisoryCommit.identityKey)) {
            advisoryCommit.launchCreditClaimed = true;
            emit AdvisoryLaunchCreditClaimed(
                advisoryCommit.contentId,
                advisoryCommit.roundId,
                _advisoryRewardRecipient(advisoryCommit),
                advisoryCommitKey,
                scoreBps,
                0
            );
            return (scoreBps, 0);
        }

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
        (,,, uint48 readyAt) = votingEngine.roundLifecycleState(advisoryCommit.contentId, advisoryCommit.roundId);
        return launchDistributionPool.recordAdvisoryRaterRewardWithSourceReady(
            rewardRecipient,
            advisoryCommit.contentId,
            advisoryCommit.roundId,
            advisoryCommitKey,
            scoreBps,
            revealedCount,
            true,
            verifiedAnchorIds,
            readyAt
        );
    }

    function _buildAdvisorySamplerSeed(
        uint256 contentId,
        uint256 roundId,
        address voter,
        bytes32 identityKey,
        bytes32 rbtsScoreSeed
    ) internal view returns (bytes32) {
        return keccak256(
            abi.encode(
                "rateloop.advisory.rbts-sampler.v1",
                block.chainid,
                address(votingEngine),
                address(this),
                contentId,
                roundId,
                voter,
                identityKey,
                rbtsScoreSeed
            )
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
            bytes32 ciphertextHash,
            uint64 targetRound,
            bytes32 drandChainHash,
            uint48 revealableAfter,
            bool revealed,
            uint64 stakeAmount
        )
    {
        AdvisoryCommit storage advisoryCommit = advisoryCommits[advisoryCommitKey];
        return (
            advisoryCommit.ciphertextHash,
            advisoryCommit.targetRound,
            advisoryCommit.drandChainHash,
            advisoryCommit.revealableAfter,
            advisoryCommit.revealed,
            0
        );
    }

    function lastAdvisoryVoteTimestamp(uint256 contentId, address rater) public view returns (uint256 timestamp) {
        timestamp = _lastAdvisoryVoteTimestamp[contentId][rater];
        uint256 durableTimestamp = protocolConfig.advisoryCooldownTimestamp(contentId, rater);
        if (durableTimestamp > timestamp) timestamp = durableTimestamp;
    }

    function lastAdvisoryVoteTimestampByIdentity(uint256 contentId, bytes32 identityKey)
        public
        view
        returns (uint256 timestamp)
    {
        timestamp = _lastAdvisoryVoteTimestampByIdentity[contentId][identityKey];
        uint256 durableTimestamp = protocolConfig.advisoryCooldownTimestampByIdentity(contentId, identityKey);
        if (durableTimestamp > timestamp) timestamp = durableTimestamp;
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

    function _validateAdvisoryRoundForCommit(uint256 contentId, uint256 roundId, uint16 roundReferenceRatingBps)
        internal
        view
        returns (uint48 roundStartTime, uint32 epochDuration, uint16 maxVoters)
    {
        if (votingEngine.currentRoundId(contentId) != roundId) revert RoundNotOpen();
        (uint16 expectedReferenceRatingBps,,,,,, address advisoryVoteRecorder) =
            _resolvedAdvisoryRoundContext(contentId, roundId, 0);
        if (advisoryVoteRecorder != address(this)) revert InvalidRound();
        if (roundReferenceRatingBps == 0 || roundReferenceRatingBps != expectedReferenceRatingBps) {
            revert InvalidCommitHash();
        }

        RoundLib.RoundState state;
        uint16 stakedVoteCount;
        uint64 stakedTotalStake;
        uint48 thresholdReachedAt;
        (roundStartTime, state, stakedVoteCount,, stakedTotalStake, thresholdReachedAt,) =
            votingEngine.roundCore(contentId, roundId);

        uint32 maxDuration;
        (epochDuration, maxDuration,, maxVoters) = votingEngine.roundConfigSnapshot(contentId, roundId);
        if (epochDuration == 0 || maxDuration == 0 || maxVoters == 0) revert InvalidRound();
        if (state != RoundLib.RoundState.Open || block.timestamp >= uint256(roundStartTime) + uint256(maxDuration)) {
            revert RoundNotOpen();
        }
        if (block.timestamp >= uint256(roundStartTime) + uint256(epochDuration)) revert RoundNotOpen();
        if (stakedVoteCount == 0 || stakedTotalStake == 0) revert RoundNotOpen();
        if (thresholdReachedAt != 0) revert ThresholdReached();
    }

    function _validateAdvisoryCommitTlock(
        uint256 contentId,
        uint256 roundId,
        bytes calldata ciphertext,
        uint64 targetRound,
        bytes32 drandChainHash,
        uint48 roundStartTime,
        uint32 epochDuration
    ) internal view returns (AdvisoryTlockData memory tlockData) {
        uint256 epochEnd = _computeEpochEnd(roundStartTime, epochDuration);
        (bytes32 usedChainHash, uint256 targetRevealableAt) = _validateCommitTlockData(
            contentId, roundId, ciphertext, targetRound, drandChainHash, epochEnd, epochDuration
        );
        uint256 effectiveRevealableAfter = targetRevealableAt > epochEnd ? targetRevealableAt : epochEnd;
        tlockData = AdvisoryTlockData({
            usedChainHash: usedChainHash,
            revealableAfter: effectiveRevealableAfter.toUint48(),
            ciphertextHash: keccak256(ciphertext)
        });
    }

    function _validateCommitTlockData(
        uint256 contentId,
        uint256 roundId,
        bytes calldata ciphertext,
        uint64 targetRound,
        bytes32 drandChainHash,
        uint256 epochEnd,
        uint32 epochDuration
    ) internal view returns (bytes32 usedChainHash, uint256 targetRevealableAt) {
        bytes32 expectedChainHash;
        uint64 genesisTime;
        uint64 period;
        (, targetRevealableAt, expectedChainHash, genesisTime, period,,) =
            _resolvedAdvisoryRoundContext(contentId, roundId, targetRound);
        TlockVoteLib.validateCommitData(
            ciphertext, targetRound, drandChainHash, expectedChainHash, epochEnd, epochDuration, genesisTime, period
        );
        usedChainHash = expectedChainHash;
    }

    function _resolvedAdvisoryRoundContext(uint256 contentId, uint256 roundId, uint64 targetRound)
        internal
        view
        returns (
            uint16 referenceRatingBps,
            uint256 targetRevealableAt,
            bytes32 chainHash,
            uint64 genesisTime,
            uint64 period,
            bool rbtsScoringClosed,
            address advisoryVoteRecorder
        )
    {
        (
            referenceRatingBps,
            targetRevealableAt,
            chainHash,
            genesisTime,
            period,
            rbtsScoringClosed,
            advisoryVoteRecorder
        ) = votingEngine.advisoryRoundContext(contentId, roundId, targetRound);
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
        (,, bytes32 snapshotChainHash,,,,) =
            _resolvedAdvisoryRoundContext(advisoryCommit.contentId, advisoryCommit.roundId, advisoryCommit.targetRound);
        if (snapshotChainHash != committed) revert DrandChainHashMismatch();
    }

    function _roundRaterRegistry(uint256 contentId, uint256 roundId) internal view returns (IRaterIdentityRegistry) {
        address snapshot = votingEngine.roundRaterRegistrySnapshot(contentId, roundId);
        if (snapshot == address(0)) {
            snapshot = protocolConfig.raterRegistry();
        }
        return IRaterIdentityRegistry(snapshot);
    }

    function _isGatedContent(uint256 contentId, uint256 roundId) internal view returns (bool) {
        address escrow = address(uint160(votingEngine.roundConfidentialityEscrowSnapshotWord(contentId, roundId)));
        if (escrow == address(0)) {
            escrow = protocolConfig.confidentialityEscrow();
        }
        if (escrow == address(0)) return false;
        try IConfidentialityEscrow(escrow).confidentialityConfig(contentId) returns (
            IConfidentialityEscrow.ConfidentialityConfig memory config
        ) {
            return config.gated;
        } catch {
            return true;
        }
    }

    function _isIdentityBanned(uint256 contentId, uint256 roundId, bytes32 identityKey) internal view returns (bool) {
        if (identityKey == bytes32(0)) return false;
        address registryAddress = address(_roundRaterRegistry(contentId, roundId));
        if (registryAddress == address(0)) return false;
        try IRaterRegistryStatus(registryAddress).isIdentityKeyBanned(identityKey) returns (bool banned) {
            return banned;
        } catch {
            return false;
        }
    }

    function _maxUnverifiedAdvisoryCommitsPerRound() internal view returns (bool success, uint16 maxUnverifiedCommits) {
        address launchPool = protocolConfig.launchDistributionPool();
        if (launchPool == address(0)) {
            return (true, DEFAULT_MAX_UNVERIFIED_ADVISORY_COMMITS_PER_ROUND);
        }
        try ILaunchDistributionPool(launchPool).launchRewardPolicy() returns (
            uint16,
            uint16,
            uint16,
            uint16,
            uint16,
            uint64,
            uint16,
            uint16 maxUnverifiedCreditsPerRound,
            uint16,
            uint32,
            uint32,
            uint32,
            bool
        ) {
            return (true, maxUnverifiedCreditsPerRound);
        } catch {
            return (false, 0);
        }
    }

    function _unverifiedAdvisoryCommitCapReached(uint256 contentId, uint256 roundId, uint16 maxUnverifiedCommits)
        internal
        view
        returns (bool)
    {
        return roundUnverifiedAdvisoryCommitCount[contentId][roundId] >= maxUnverifiedCommits;
    }

    function _hasActiveHumanCredentialForRound(uint256 contentId, uint256 roundId, address rater)
        internal
        view
        returns (bool)
    {
        if (rater == address(0)) return false;
        try _roundRaterRegistry(contentId, roundId).hasActiveHumanCredential(rater) returns (bool active) {
            return active;
        } catch {
            return false;
        }
    }

    function _validateAdvisoryCommitter(uint256 contentId, uint256 roundId)
        internal
        view
        returns (AdvisoryIdentityContext memory context)
    {
        IRaterIdentityRegistry identityRegistry = _roundRaterRegistry(contentId, roundId);
        IRaterIdentityRegistry.ResolvedRater memory resolved =
            VotePreflightLib.validateVoterAndContent(identityRegistry, registry, msg.sender, contentId);
        context.holder = resolved.holder == address(0) ? msg.sender : resolved.holder;
        context.identityKey = resolved.identityKey;
        context.hasActiveHumanCredential = resolved.hasActiveHumanCredential;

        _validateAdvisoryCooldown(contentId, msg.sender, context.holder, context.identityKey);

        (bytes32 senderCommitHash,) = votingEngine.voterCommitKey(contentId, roundId, msg.sender);
        if (senderCommitHash != bytes32(0)) revert AlreadyCommitted();
        if (context.holder != msg.sender) {
            (bytes32 holderCommitHash,) = votingEngine.voterCommitKey(contentId, roundId, context.holder);
            if (holderCommitHash != bytes32(0)) revert AlreadyCommitted();
        }
        (bytes32 identityKeyCommitKey, bytes32 holderKey,) =
            votingEngine.identityCommitState(contentId, roundId, context.identityKey, context.holder);
        if (holderKey != bytes32(0) || identityKeyCommitKey != bytes32(0)) revert AlreadyCommitted();
        if (advisoryCommitKeyByRater[contentId][roundId][msg.sender] != bytes32(0)) revert AlreadyCommitted();
        if (context.holder != msg.sender && advisoryCommitKeyByRater[contentId][roundId][context.holder] != bytes32(0))
        {
            revert AlreadyCommitted();
        }
        if (advisoryCommitKeyByIdentity[contentId][roundId][context.identityKey] != bytes32(0)) {
            revert AlreadyCommitted();
        }
    }

    function _validateAdvisoryCooldown(uint256 contentId, address voter, address identityHolder, bytes32 identityKey)
        internal
        view
    {
        (uint256 lastVote, uint256 lastHolderVote, uint256 lastIdentityVote) =
            votingEngine.voteCooldownTimestamps(contentId, voter, identityHolder, identityKey);
        uint256 lastAdvisory = lastAdvisoryVoteTimestamp(contentId, voter);
        if (lastAdvisory > lastVote) lastVote = lastAdvisory;
        if (identityHolder != address(0) && identityHolder != voter) {
            uint256 lastHolderAdvisory = lastAdvisoryVoteTimestamp(contentId, identityHolder);
            if (lastHolderVote > lastVote) lastVote = lastHolderVote;
            if (lastHolderAdvisory > lastVote) lastVote = lastHolderAdvisory;
        }

        if (identityKey != bytes32(0)) {
            uint256 lastIdentityAdvisory = lastAdvisoryVoteTimestampByIdentity(contentId, identityKey);
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
        (, uint256 targetRevealableAfter,,,,,) =
            _resolvedAdvisoryRoundContext(advisoryCommit.contentId, advisoryCommit.roundId, advisoryCommit.targetRound);
        uint256 revealableAfter = advisoryCommit.revealableAfter;
        if (firstRealEpochEnd > revealableAfter) revealableAfter = firstRealEpochEnd;
        if (targetRevealableAfter > revealableAfter) revealableAfter = targetRevealableAfter;
        return revealableAfter;
    }

    function _isTerminalRound(uint256 contentId, uint256 roundId) internal view returns (bool) {
        (, RoundLib.RoundState state,,,,,) = votingEngine.roundCore(contentId, roundId);
        return state == RoundLib.RoundState.Settled || state == RoundLib.RoundState.Tied;
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
        (bytes32 voterCommitHash,) =
            votingEngine.voterCommitKey(advisoryCommit.contentId, advisoryCommit.roundId, advisoryCommit.voter);
        if (voterCommitHash != bytes32(0)) return true;
        if (advisoryCommit.identityHolder != address(0) && advisoryCommit.identityHolder != advisoryCommit.voter) {
            (bytes32 holderCommitHash,) = votingEngine.voterCommitKey(
                advisoryCommit.contentId, advisoryCommit.roundId, advisoryCommit.identityHolder
            );
            if (holderCommitHash != bytes32(0)) return true;
        }
        (bytes32 identityKeyCommitKey, bytes32 holderKey,) = votingEngine.identityCommitState(
            advisoryCommit.contentId, advisoryCommit.roundId, advisoryCommit.identityKey, advisoryCommit.identityHolder
        );
        if (advisoryCommit.identityHolder != address(0) && holderKey != bytes32(0)) {
            return true;
        }
        if (advisoryCommit.identityKey != bytes32(0) && identityKeyCommitKey != bytes32(0)) {
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
            (,, uint256 scoringWeight,,) = votingEngine.rbtsCommitState(contentId, roundId, candidate);
            if (revealed && stakeAmount > 0 && scoringWeight > 0) {
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
