// SPDX-License-Identifier: MIT
pragma solidity ^0.8.34;

import { Initializable } from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import { ReentrancyGuardTransient } from "@openzeppelin/contracts/utils/ReentrancyGuardTransient.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { IERC20Permit } from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Permit.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { SafeCast } from "@openzeppelin/contracts/utils/math/SafeCast.sol";

import { ContentRegistry } from "./ContentRegistry.sol";
import { ProtocolConfig } from "./ProtocolConfig.sol";
import { RoundVotingEngineStorage } from "./RoundVotingEngineStorage.sol";
import { RoundLib } from "./libraries/RoundLib.sol";
import { RatingLib } from "./libraries/RatingLib.sol";
import { RoundSettlementSideEffectsLib } from "./libraries/RoundSettlementSideEffectsLib.sol";
import { ContentRegistryTypes } from "./libraries/ContentRegistryTypes.sol";
import { RoundCommitStorageLib } from "./libraries/RoundCommitStorageLib.sol";
import { RoundCleanupLib } from "./libraries/RoundCleanupLib.sol";
import { RoundCreationLib } from "./libraries/RoundCreationLib.sol";
import { RoundRevealLib } from "./libraries/RoundRevealLib.sol";
import { RoundVotingReadLib } from "./libraries/RoundVotingReadLib.sol";
import { VotePreflightLib } from "./libraries/VotePreflightLib.sol";
import { IClusterPayoutOracle } from "./interfaces/IClusterPayoutOracle.sol";
import { IRoundPayoutSnapshotConsumer } from "./interfaces/IRoundPayoutSnapshotConsumer.sol";
import { IRaterIdentityRegistry } from "./interfaces/IRaterIdentityRegistry.sol";
import { IRoundVotingCommitReveal } from "./interfaces/IRoundVotingCommitReveal.sol";
import { IRoundVotingSettlement } from "./interfaces/IRoundVotingSettlement.sol";

/// @title RoundVotingEngine
/// @notice Per-content round-based commit-reveal voting with keeper-assisted/self-reveal and RBTS settlement.
/// @dev Flow: commitVote (stores ciphertext hash, drand metadata, and commit hash) → epoch ends → revealVote
///      (caller supplies plaintext consistent with the commit hash) → settleRound (≥3 revealed votes) or
///      finalizeRevealFailedRound().
///      Rounds accumulate votes across 20-minute epochs. After each epoch, keepers normally derive reveal plaintext
///      off-chain from drand/tlock and submit reveals, while voters can also self-reveal if needed.
///      Accepted tlock tradeoff: the contract enforces lightweight tlock metadata guardrails on chain but does not
///      prove that the ciphertext decrypts to the committed plaintext. Invalid or mismatched ciphertexts are handled
///      economically: unrevealed votes lose reward eligibility and their stake is forfeited after final reveal grace.
///      If the 20-minute voting window passes below commit quorum the round cancels with refunds; once commit quorum exists,
///      any unrevealed vote can finalize as RevealFailed only after the round stops accepting votes
///      and the final reveal grace deadline has passed.
///      Epoch-weighting: epoch-1 (blind) = 100% public-verdict weight; epoch-2+ (informed) = 25%.
///      LREP stake rewards wait for finalized RBTS settlement weights from the correlation oracle.
contract RoundVotingEngine is
    IRoundVotingCommitReveal,
    IRoundVotingSettlement,
    IRoundPayoutSnapshotConsumer,
    RoundVotingEngineStorage,
    Initializable,
    ReentrancyGuardTransient
{
    using SafeERC20 for IERC20;
    using SafeCast for uint256;

    // --- Custom Errors ---
    error InvalidAddress();
    error InvalidStake();
    error Unauthorized();
    error SelfVote();
    error ContentNotActive();
    error CooldownActive();
    error CiphertextTooLarge();
    error InvalidCiphertext();
    error InvalidCommitHash();
    error DrandChainHashMismatch();
    error TargetRoundOutOfWindow();
    error RoundNotOpen();
    error RoundNotExpired();
    error RoundNotSettledOrTied();
    error RoundNotCancelledOrTied();
    error ThresholdReached();
    error RevealGraceActive();
    error NotEnoughVotes();
    error AlreadyCommitted();
    error AlreadyRevealed();
    error AlreadyClaimed();
    error MaxVotersReached();
    error EpochNotEnded();
    error HashMismatch();
    error NoCommit();
    error NoStake();
    error VoteNotRevealed();
    error IndexOutOfBounds();
    error UnrevealedPastEpochVotes();
    error NothingProcessed();

    // --- Access Control Roles ---
    bytes32 internal constant PAUSER_ROLE = keccak256("PAUSER_ROLE");

    // --- Constants ---
    uint256 internal constant MIN_STAKE = 1e6; // 1 LREP; zero-LREP ratings use AdvisoryVoteRecorder
    uint256 internal constant MAX_STAKE = 10e6; // 10 LREP (6 decimals)
    uint256 internal constant VOTE_COOLDOWN = 24 hours; // Time-based cooldown per content per voter
    uint16 internal constant MIN_RBTS_PARTICIPANTS = 3;
    uint8 internal constant PAYOUT_DOMAIN_RBTS_SETTLEMENT = 5;
    address internal constant DISABLED_ADVISORY_VOTE_RECORDER = address(1);

    // --- Events ---
    event VoteCommitted(
        uint256 indexed contentId,
        uint256 indexed roundId,
        address indexed voter,
        bytes32 commitHash,
        uint16 roundReferenceRatingBps,
        uint64 targetRound,
        bytes32 drandChainHash,
        uint256 stake,
        bytes32 ciphertextHash,
        bytes ciphertext
    );
    event RoundReferenceSnapshotted(uint256 indexed contentId, uint256 indexed roundId, uint16 roundReferenceRatingBps);
    event RoundConfigSnapshotted(
        uint256 indexed contentId,
        uint256 indexed roundId,
        uint32 epochDuration,
        uint32 maxDuration,
        uint16 minVoters,
        uint16 maxVoters
    );
    event VoteRevealed(uint256 indexed contentId, uint256 indexed roundId, address indexed voter, bool isUp);
    event RbtsVoteRevealed(
        uint256 indexed contentId,
        uint256 indexed roundId,
        address indexed voter,
        bool isUp,
        uint16 predictedUpBps,
        uint256 effectiveWeight
    );
    event RbtsRewardsScored(
        uint256 indexed contentId,
        uint256 indexed roundId,
        bytes32 scoreSeed,
        uint256 rewardWeight,
        uint256 rewardClaimants,
        uint256 forfeitedPool,
        uint256 forfeitClaimants,
        uint16 meanScoreBps
    );
    event RbtsSettlementPending(uint256 indexed contentId, uint256 indexed roundId, address indexed oracle);
    event RbtsSettlementSnapshotApplied(
        uint256 indexed contentId,
        uint256 indexed roundId,
        bytes32 snapshotDigest,
        uint32 effectiveParticipantUnits,
        bool forfeitsEnabled
    );
    event RbtsSettlementSnapshotTimedOut(uint256 indexed contentId, uint256 indexed roundId);
    event RbtsSettlementModuleUpdated(address indexed module);
    event RbtsSeedCaptured(uint256 indexed contentId, uint256 indexed roundId, bytes32 entropy);
    event SettlementCallerIncentivePaid(
        uint256 indexed contentId, uint256 indexed roundId, address indexed caller, uint256 amount
    );
    event SettlementCallerIncentiveSkipped(uint256 indexed contentId, uint256 indexed roundId, uint256 amount);
    event RoundSettled(uint256 indexed contentId, uint256 indexed roundId, bool upWins, uint256 losingPool);
    event RoundCancelled(uint256 indexed contentId, uint256 indexed roundId);
    event RoundTied(uint256 indexed contentId, uint256 indexed roundId);
    event RoundRevealFailed(uint256 indexed contentId, uint256 indexed roundId);
    /// @notice L-Cleanup-1: emitted when accumulated treasury-rejected forfeits are
    ///         successfully flushed to treasury via `flushPendingTreasuryForfeit`.
    event PendingTreasuryForfeitFlushed(address indexed treasury, uint256 amount);
    /// @notice Emitted when `_notifyBundleRoundTerminal` invocation of
    ///         `recordBundleQuestionTerminal` on the bundle escrow reverts. The terminal signal
    ///         is captured in `pendingBundleObserverReplay` so an admin can call
    ///         `replayBundleObserverNotify` once the transient failure has been resolved.
    event BundleObserverNotifyFailed(
        uint256 indexed contentId, uint256 indexed roundId, bool settled, bytes lowLevelError
    );
    /// @notice Emitted when `replayBundleObserverNotify` successfully forwards a previously
    ///         failed terminal signal to the bundle escrow.
    event BundleObserverNotifyReplayed(uint256 indexed contentId, uint256 indexed roundId, bool settled);
    event CancelledRoundRefundClaimed(
        uint256 indexed contentId, uint256 indexed roundId, address indexed voter, uint256 amount
    );
    event ForfeitedFundsAddedToTreasury(uint256 indexed contentId, uint256 indexed roundId, uint256 amount);
    event CurrentEpochRefunded(uint256 indexed contentId, uint256 indexed roundId, uint256 amount);
    event TreasuryFeeDistributed(uint256 indexed contentId, uint256 indexed roundId, uint256 amount);
    event Paused(address account);
    event Unpaused(address account);
    event RoleUpdated(bytes32 indexed role, address indexed account, bool indexed enabled);

    bytes32 private constant PAUSABLE_STORAGE_LOCATION =
        0xcd5ed15c6e187e77e9aee88184c21f4f2182ab5827cb3b7e07fbedcd63f03300;
    bytes32 private constant ACCESS_CONTROL_STORAGE_LOCATION =
        0x02dd7bc7dec4dceedda775e58dd541e08a116c6c53815c0bd028192f7b626800;

    struct RoleData {
        mapping(address account => bool) hasRole;
    }

    struct AccessControlStorage {
        mapping(bytes32 role => RoleData) roles;
    }

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(address _governance, address _lrepToken, address _registry, address _protocolConfig)
        public
        initializer
    {
        _initialize(_governance, _lrepToken, _registry, _protocolConfig, address(0));
    }

    function initializeWithRbtsSettlementModule(
        address _governance,
        address _lrepToken,
        address _registry,
        address _protocolConfig,
        address _rbtsSettlementModule
    ) public initializer {
        _initialize(_governance, _lrepToken, _registry, _protocolConfig, _rbtsSettlementModule);
    }

    function _initialize(
        address _governance,
        address _lrepToken,
        address _registry,
        address _protocolConfig,
        address _rbtsSettlementModule
    ) private {
        if (_governance == address(0)) revert InvalidAddress();
        if (_lrepToken == address(0)) revert InvalidAddress();
        if (_registry == address(0)) revert InvalidAddress();
        if (_protocolConfig == address(0)) revert InvalidAddress();

        _grantRole(bytes32(0), _governance);
        _grantRole(PAUSER_ROLE, _governance);

        lrepToken = IERC20(_lrepToken);
        registry = ContentRegistry(_registry);
        protocolConfig = ProtocolConfig(_protocolConfig);
        if (_rbtsSettlementModule != address(0)) {
            _setRbtsSettlementModule(_rbtsSettlementModule);
        }
    }

    /// @notice Recover LREP sent directly to this contract outside accounted protocol flows.
    /// @dev Admin-only and naturally reentrancy-safe: a re-entrant call would compute
    ///      `balanceOf - accountedLrepBalance == 0` after the first transfer, draining nothing.
    function recoverSurplusLrep() external onlyRole(bytes32(0)) {
        lrepToken.safeTransfer(msg.sender, lrepToken.balanceOf(address(this)) - accountedLrepBalance);
    }

    function _hasRole(bytes32 role, address account) private view returns (bool) {
        return _accessControlStorage().roles[role].hasRole[account];
    }

    function setRole(bytes32 role, address account, bool enabled) external onlyRole(bytes32(0)) {
        assembly ("memory-safe") {
            if and(iszero(or(enabled, role)), eq(account, caller())) { revert(0x00, 0x00) }
            mstore(0x00, role)
            mstore(0x20, ACCESS_CONTROL_STORAGE_LOCATION)
            let roleSlot := keccak256(0x00, 0x40)
            mstore(0x00, account)
            mstore(0x20, roleSlot)
            let accountSlot := keccak256(0x00, 0x40)
            if iszero(eq(sload(accountSlot), enabled)) {
                sstore(accountSlot, enabled)
                log4(
                    0x00,
                    0x00,
                    0x5f0ecfd1ea5555d5b4b6140b49c92365beaf40d0a057dc34a9746990cd4ce8d4,
                    role,
                    account,
                    enabled
                )
            }
        }
    }

    function nextRoundIdForContent(uint256 contentId) external view returns (uint256) {
        return registry.nextVotingRoundId(contentId);
    }

    modifier onlyRole(bytes32 role) {
        _checkRole(role, msg.sender);
        _;
    }

    function _checkRole(bytes32 role, address account) internal view {
        if (!_hasRole(role, account)) {
            revert Unauthorized();
        }
    }

    function _grantRole(bytes32 role, address account) internal {
        assembly ("memory-safe") {
            mstore(0x00, role)
            mstore(0x20, ACCESS_CONTROL_STORAGE_LOCATION)
            let roleSlot := keccak256(0x00, 0x40)
            mstore(0x00, account)
            mstore(0x20, roleSlot)
            sstore(keccak256(0x00, 0x40), 1)
            log4(0x00, 0x00, 0x5f0ecfd1ea5555d5b4b6140b49c92365beaf40d0a057dc34a9746990cd4ce8d4, role, account, 1)
        }
    }

    function _accessControlStorage() private pure returns (AccessControlStorage storage $) {
        assembly ("memory-safe") {
            $.slot := ACCESS_CONTROL_STORAGE_LOCATION
        }
    }

    function rewardDistributorConfigShape()
        external
        view
        returns (address registry_, address lrepToken_, address protocolConfig_)
    {
        return (address(registry), address(lrepToken), address(protocolConfig));
    }

    /// @notice Transfer LREP reward tokens to a recipient. Only callable by RewardDistributor.
    function transferReward(address recipient, uint256 lrepAmount) external {
        if (!protocolConfig.isRewardDistributorForEngine(msg.sender, address(this))) revert Unauthorized();
        if (recipient == address(0)) {
            assembly ("memory-safe") {
                revert(0, 0)
            }
        }
        accountedLrepBalance -= lrepAmount;
        lrepToken.safeTransfer(recipient, lrepAmount);
    }

    // =========================================================================
    // COMMIT PHASE
    // =========================================================================

    /// @notice Narrow view of a commit that omits hash/target metadata. Used by off-chain iterators
    ///         and by reward distributor paths that read many claim-relevant commits in one call.
    /// @dev Returned fields mirror the claim-relevant subset of RoundLib.Commit.
    function commitCore(uint256 contentId, uint256 roundId, bytes32 commitKey)
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
        return RoundCleanupLib.commitCore(commits[contentId][roundId], commitKey);
    }

    /// @notice Reveal/decryption data for keeper and manual reveal flows.
    /// @dev Keeps the full `commits` storage mapping internal so deployed bytecode does not
    ///      include Solidity's large auto-getter for the full struct.
    function commitRevealData(uint256 contentId, uint256 roundId, bytes32 commitKey)
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
        return RoundCleanupLib.commitRevealData(
            commits[contentId][roundId], commitKey, _getRoundDrandChainHash(contentId, roundId)
        );
    }

    /// @notice Open the current rating round before preparing a blind vote.
    /// @dev Commits no vote and records no stake; it only fixes the round start/config/drand
    ///      snapshots so the caller can encrypt against deterministic commit timing.
    function openRound(uint256 contentId) external whenNotPaused nonReentrant {
        VotePreflightLib.validateRoundOpenerRecordNexus(
            IRaterIdentityRegistry(protocolConfig.raterRegistry()),
            registry,
            msg.sender,
            contentId,
            protocolConfig.confidentialityEscrow()
        );
        uint256 roundId = _getOrCreateRound(contentId);
        RoundLib.Round storage round = rounds[contentId][roundId];
        RoundLib.RoundConfig memory roundCfg = _getRoundConfig(contentId, roundId);
        if (!RoundLib.acceptsVotes(round, roundCfg.maxDuration) || round.thresholdReachedAt != 0) {
            revert RoundNotOpen();
        }
    }

    /// @notice Open the first rewardable round from `ContentRegistry` during question submission.
    /// @dev The registry already reserved `allocatedRoundId`, avoiding a callback into the
    ///      registry while its submission reentrancy guard is active.
    function openInitialRoundFromRegistry(uint256 contentId, uint256 allocatedRoundId)
        external
        whenNotPaused
        nonReentrant
    {
        if (msg.sender != address(registry)) revert Unauthorized();
        if (allocatedRoundId == 0 || currentRoundId[contentId] != 0) revert RoundNotOpen();
        _activateAllocatedRound(contentId, allocatedRoundId);
    }

    /// @notice Commit a blind vote on content. Direction is hidden via tlock encryption.
    /// @param contentId The content being voted on.
    /// @param roundContext Packed expected round ID and reference score: `(roundId << 16) | ratingBps`.
    /// @param targetRound drand round targeted by the ciphertext.
    /// @param drandChainHash drand chain hash bound into the commitment.
    /// @param commitHash keccak256(abi.encodePacked(isUp, predictedUpBps, salt, voter, contentId, roundId, roundReferenceRatingBps, targetRound, drandChainHash, keccak256(ciphertext))).
    /// @param ciphertext Tlock-encrypted payload (decryptable after epoch end via drand).
    /// @param stakeAmount Amount of LREP tokens to stake (1-10).
    /// @param frontend Address of frontend operator for fee distribution.
    function commitVote(
        uint256 contentId,
        uint256 roundContext,
        uint64 targetRound,
        bytes32 drandChainHash,
        bytes32 commitHash,
        bytes calldata ciphertext,
        uint256 stakeAmount,
        address frontend
    ) external nonReentrant whenNotPaused {
        _commitVote(
            msg.sender,
            contentId,
            roundContext,
            targetRound,
            drandChainHash,
            commitHash,
            ciphertext,
            stakeAmount,
            frontend
        );
    }

    /// @notice Commit a blind vote after attempting an EIP-2612 permit for the LREP stake.
    /// @dev The permit call is front-run tolerant: if the signature was already consumed but
    ///      allowance exists, the subsequent stake transfer succeeds; if allowance is absent,
    ///      `_commitVote` fails closed on `safeTransferFrom`.
    function commitVoteWithPermit(
        uint256 contentId,
        uint256 roundContext,
        uint64 targetRound,
        bytes32 drandChainHash,
        bytes32 commitHash,
        bytes calldata ciphertext,
        uint256 stakeAmount,
        address frontend,
        uint256 permitDeadline,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external nonReentrant whenNotPaused {
        try IERC20Permit(address(lrepToken)).permit(msg.sender, address(this), stakeAmount, permitDeadline, v, r, s) { }
            catch { }
        _commitVote(
            msg.sender,
            contentId,
            roundContext,
            targetRound,
            drandChainHash,
            commitHash,
            ciphertext,
            stakeAmount,
            frontend
        );
    }

    function _commitVote(
        address voter,
        uint256 contentId,
        uint256 roundContext,
        uint64 targetRound,
        bytes32 drandChainHash,
        bytes32 commitHash,
        bytes calldata ciphertext,
        uint256 stakeAmount,
        address frontend
    ) internal {
        if (stakeAmount < MIN_STAKE || stakeAmount > MAX_STAKE) revert InvalidStake();
        if (commitHash == bytes32(0)) revert InvalidCommitHash();

        uint64 stakeAmount64 = stakeAmount.toUint64();

        uint256 roundId = currentRoundId[contentId];
        if (roundId == 0) revert RoundNotOpen();
        uint256 expectedRoundId = roundContext >> 16;
        if (roundId != expectedRoundId) revert InvalidCommitHash();
        RoundLib.Round storage round = rounds[contentId][roundId];
        _requireRoundContentLifecycleActive(contentId, roundId);
        RoundLib.RoundConfig memory roundCfg = _getRoundConfig(contentId, roundId);
        uint16 roundReferenceRatingBps = uint16(roundContext);
        uint16 expectedReferenceRatingBps = _getRoundReferenceRatingBps(contentId, roundId);
        if (roundReferenceRatingBps != expectedReferenceRatingBps) revert InvalidCommitHash();

        // Round must be Open and not expired
        if (!RoundLib.acceptsVotes(round, roundCfg.maxDuration)) revert RoundNotOpen();
        if (round.thresholdReachedAt != 0) revert ThresholdReached();
        if (round.voteCount == 0 && round.totalStake == 0 && registry.votingEngine() != address(this)) {
            revert RoundNotOpen();
        }

        IRaterIdentityRegistry roundRaterRegistry = _getRoundRaterRegistry(contentId, roundId);
        IRaterIdentityRegistry.ResolvedRater memory resolved = VotePreflightLib.validateVoterContentRecordNexus(
            roundRaterRegistry, registry, voter, contentId, roundConfidentialityEscrowSnapshot[contentId][roundId]
        );
        (uint8 credentialMask, uint8 freshCredentialMask) =
            _credentialStatusBits(roundRaterRegistry, resolved.holder, resolved.hasActiveHumanCredential);
        VotePreflightLib.validateNoAdvisoryConflict(
            _getRoundAdvisoryVoteRecorder(contentId, roundId),
            contentId,
            roundId,
            voter,
            resolved.holder,
            resolved.identityKey,
            VOTE_COOLDOWN
        );

        bytes32 commitKey = VotePreflightLib.prepareCommit(
            voterCommitHash,
            identityCommitKey,
            holderCommitKey,
            lastVoteTimestamp,
            lastVoteTimestampByIdentity,
            identityRoundStake,
            VotePreflightLib.CommitPreflightParams({
                voter: voter,
                identityHolder: resolved.holder,
                contentId: contentId,
                roundId: roundId,
                identityKey: resolved.identityKey,
                cooldownWindow: VOTE_COOLDOWN,
                maxStake: MAX_STAKE,
                stakeAmount: stakeAmount,
                commitHash: commitHash,
                roundVoteCount: round.voteCount,
                maxVoters: roundCfg.maxVoters
            })
        );
        (uint256 epochEnd, uint8 epochIdx) = _computeCommitEpoch(round, roundCfg);
        _validateCommitTlockData(
            contentId, roundId, ciphertext, targetRound, drandChainHash, epochEnd, roundCfg.epochDuration
        );
        bytes32 ciphertextHash = keccak256(ciphertext);
        // Transfer LREP stake after all lightweight validation passes.
        lrepToken.safeTransferFrom(voter, address(this), stakeAmount);
        accountedLrepBalance += stakeAmount;

        uint256 effectiveRevealableAfter = _targetRoundRevealableAt(contentId, roundId, targetRound);
        if (effectiveRevealableAfter < epochEnd) effectiveRevealableAfter = epochEnd;
        RoundCommitStorageLib.storeCommittedVote(
            commits[contentId][roundId],
            commitCommittedAt[contentId][roundId],
            frontendEligibleAtCommit[contentId][roundId],
            roundCommitHashes[contentId][roundId],
            epochUnrevealedCount[contentId][roundId],
            lastCommitRevealableAfter[contentId],
            voterCommitHash[contentId][roundId],
            identityCommitKey[contentId][roundId],
            commitIdentityKey[contentId][roundId],
            commitIdentityHolder[contentId][roundId],
            holderCommitKey[contentId][roundId],
            commitCredentialMask[contentId][roundId],
            commitFreshCredentialMask[contentId][roundId],
            hasCommits,
            roundFrontendRegistrySnapshot[contentId][roundId],
            RoundCommitStorageLib.StoreParams({
                contentId: contentId,
                roundId: roundId,
                commitKey: commitKey,
                voter: voter,
                stakeAmount64: stakeAmount64,
                ciphertextHash: ciphertextHash,
                frontend: frontend,
                epochEnd: epochEnd,
                effectiveRevealableAfter: effectiveRevealableAfter,
                targetRound: targetRound,
                epochIdx: epochIdx,
                commitHash: commitHash,
                identityKey: resolved.identityKey,
                identityHolder: resolved.holder,
                credentialMask: credentialMask,
                freshCredentialMask: freshCredentialMask
            })
        );
        _recordCommitAccounting(
            round, contentId, roundId, voter, resolved.holder, resolved.identityKey, stakeAmount64, stakeAmount
        );
        if (resolved.hasActiveHumanCredential) {
            roundHumanVerifiedCommitCount[contentId][roundId] += 1;
        }

        emit VoteCommitted(
            contentId,
            roundId,
            voter,
            commitHash,
            expectedReferenceRatingBps,
            targetRound,
            drandChainHash,
            stakeAmount,
            ciphertextHash,
            ciphertext
        );
    }

    function _computeCommitEpoch(RoundLib.Round storage round, RoundLib.RoundConfig memory roundCfg)
        internal
        view
        returns (uint256 epochEnd, uint8 epochIdx)
    {
        epochEnd = RoundLib.computeEpochEnd(round, roundCfg.epochDuration, block.timestamp);
        epochIdx = RoundLib.computeEpochIndex(round, roundCfg.epochDuration, block.timestamp);
    }

    function _validateCommitTlockData(
        uint256 contentId,
        uint256 roundId,
        bytes calldata ciphertext,
        uint64 targetRound,
        bytes32 drandChainHash,
        uint256 epochEnd,
        uint256 epochDuration
    ) internal view {
        RoundCleanupLib.validateCommitTlockData(
            roundDrandChainHashSnapshot[contentId],
            roundDrandGenesisTimeSnapshot[contentId],
            roundDrandPeriodSnapshot[contentId],
            protocolConfig,
            roundId,
            ciphertext,
            targetRound,
            drandChainHash,
            epochEnd,
            epochDuration
        );
    }

    function _recordCommitAccounting(
        RoundLib.Round storage round,
        uint256 contentId,
        uint256 roundId,
        address voter,
        address identityHolder,
        bytes32 identityKey,
        uint64 stakeAmount64,
        uint256 stakeAmount
    ) internal {
        RoundCleanupLib.recordCommitAccounting(
            round,
            lastVoteTimestamp[contentId],
            lastVoteTimestampByIdentity[contentId],
            identityRoundStake[contentId],
            address(registry),
            contentId,
            roundId,
            voter,
            identityHolder,
            identityKey,
            stakeAmount64,
            stakeAmount
        );
    }

    function _credentialStatusBits(
        IRaterIdentityRegistry identityRegistry,
        address holder,
        bool hasActiveHumanCredential
    ) private view returns (uint8 credentialMask, uint8 freshCredentialMask) {
        if (holder != address(0) && address(identityRegistry) != address(0)) {
            try identityRegistry.credentialStatusBits(holder) returns (uint8 activeMask, uint8 freshMask) {
                return (activeMask, freshMask);
            } catch { }
        }
        if (hasActiveHumanCredential) {
            credentialMask = uint8(1 << 3);
        }
    }

    /// @dev Get or create the active round for a content item.
    function _getOrCreateRound(uint256 contentId) internal returns (uint256) {
        uint256 roundId = currentRoundId[contentId];
        if (roundId > 0 && !RoundLib.isTerminal(rounds[contentId][roundId])) {
            RoundLib.Round storage round = rounds[contentId][roundId];
            RoundLib.RoundConfig memory roundCfg = _getRoundConfig(contentId, roundId);
            if (_isRoundContentLifecycleStale(contentId, roundId)) {
                _markRoundCancelled(contentId, roundId, round);
            } else if (_isEmptyRoundStaleSinceActivity(contentId, round)) {
                _markRoundCancelled(contentId, roundId, round);
            } else if (_canCancelExpiredRound(contentId, roundId, round, roundCfg)) {
                _markRoundCancelled(contentId, roundId, round);
            } else if (_canFinalizeRevealFailedRound(contentId, roundId, round)) {
                _markRoundRevealFailed(contentId, roundId, round);
            } else {
                return roundId;
            }
        }

        return _activateAllocatedRound(contentId, registry.reserveNextVotingRound(contentId));
    }

    function _activateAllocatedRound(uint256 contentId, uint256 allocatedRoundId) internal returns (uint256 roundId) {
        roundId = RoundCreationLib.activateNewRound(currentRoundId, nextRoundId, rounds, contentId, allocatedRoundId);
        _snapshotRoundContentLifecycle(contentId, roundId);
        RoundCreationLib.snapshotRoundVotingConfig(
            roundConfigSnapshot,
            roundRatingConfigSnapshot,
            roundReferenceRatingBpsSnapshot,
            roundRevealGracePeriodSnapshot,
            registry,
            protocolConfig,
            contentId,
            roundId
        );
        RoundCreationLib.snapshotRoundExternalConfig(
            roundDrandChainHashSnapshot,
            roundDrandGenesisTimeSnapshot,
            roundDrandPeriodSnapshot,
            roundRaterRegistrySnapshot,
            roundFrontendRegistrySnapshot,
            roundAdvisoryVoteRecorderSnapshot,
            roundConfidentialityEscrowSnapshot,
            protocolConfig,
            contentId,
            roundId
        );
    }

    function _markRoundRevealFailed(uint256 contentId, uint256 roundId, RoundLib.Round storage round) internal {
        RoundCleanupLib.markRoundRevealFailed(
            round,
            roundUnrevealedCleanupRemaining[contentId],
            pendingBundleObserverReplay[contentId],
            registry,
            contentId,
            roundId
        );
    }

    function _markRoundCancelled(uint256 contentId, uint256 roundId, RoundLib.Round storage round) internal {
        round.state = RoundLib.RoundState.Cancelled;
        _notifyBundleRoundTerminal(contentId, roundId, false);
        emit RoundCancelled(contentId, roundId);
    }

    function _notifyBundleRoundTerminal(uint256 contentId, uint256 roundId, bool settled) internal {
        RoundCleanupLib.notifyBundleRoundTerminal(
            pendingBundleObserverReplay[contentId], registry, contentId, roundId, settled
        );
    }

    /// @notice Replay a previously failed bundle observer terminal notification.
    /// @dev Gated on `DEFAULT_ADMIN_ROLE` because the bundle escrow trusts only the engine to
    ///      drive its terminal-round accounting. `_recordBundleQuestionTerminal` is idempotent
    ///      (it enforces strictly increasing `roundId` per bundle index), so calling this for
    ///      a round that has since been observed via another path is a safe no-op aside from
    ///      flag-clearing.
    /// @param contentId Content whose round failed to notify.
    /// @param roundId Round id that failed to notify.
    function replayBundleObserverNotify(uint256 contentId, uint256 roundId)
        external
        onlyRole(bytes32(0))
        returns (bool settled)
    {
        // Derive `settled` from the engine's authoritative round state rather than accepting
        // it from the admin caller, so a replay can never desync the escrow's bundle
        // accounting from the engine's view of the round (I-Vote-3, audit 2026-05-17).
        settled = rounds[contentId][roundId].state == RoundLib.RoundState.Settled;
        RoundCleanupLib.replayBundleObserverNotify(
            pendingBundleObserverReplay[contentId], registry, contentId, roundId, settled
        );
    }

    /// @notice Retry a pending-rating settlement record that failed during round settlement.
    /// @dev Permissionless because the target registry still authenticates `msg.sender` as this
    ///      engine, and the registry-side record operation is idempotent once pending state exists.
    function replayPendingRatingSettlement(uint256 contentId, uint256 roundId)
        external
        nonReentrant
        returns (bool recorded)
    {
        require(pendingRatingSettlementReplay[contentId][roundId], "no pending replay");
        if (rounds[contentId][roundId].state != RoundLib.RoundState.Settled) revert RoundNotSettledOrTied();
        recorded = _recordPendingRatingSettlement(contentId, roundId);
        if (recorded) {
            delete pendingRatingSettlementReplay[contentId][roundId];
        }
    }

    function setRbtsSettlementModule(address module) external onlyRole(bytes32(0)) {
        _setRbtsSettlementModule(module);
    }

    function _setRbtsSettlementModule(address module) private {
        if (module == address(0) || module.code.length == 0) revert InvalidAddress();
        rbtsSettlementModule = module;
        emit RbtsSettlementModuleUpdated(module);
    }

    function _delegateRbtsSettlementModule() private {
        address module = rbtsSettlementModule;
        if (module == address(0) || module.code.length == 0) revert InvalidAddress();
        assembly ("memory-safe") {
            let ptr := mload(0x40)
            calldatacopy(ptr, 0, calldatasize())
            let ok := delegatecall(gas(), module, ptr, calldatasize(), 0, 0)
            let size := returndatasize()
            if iszero(ok) {
                returndatacopy(ptr, 0, size)
                revert(ptr, size)
            }
        }
    }

    // =========================================================================
    // ROUND EXPIRY
    // =========================================================================

    /// @notice Cancel an expired round that didn't reach the minimum voter threshold. Permissionless.
    /// @dev The min-RBTS-quorum lockout only engages once at least one commit in the round has
    ///      originated from a human-credential-verified identity. A pure-sybil attacker (no HRC)
    ///      reaching N >= 3 commits at min stake can no longer grief honest content into a
    ///      `RevealFailed` cycle (~80 min per cycle) -- the round remains
    ///      refund-cancellable until any HRC voter participates.
    ///      Trade-off: this slightly weakens the "min-stake universal" property by one bit, but
    ///      eliminates the cheapest cancel-griefing vector. HRC voters are unaffected; the
    ///      moment any HRC commit lands the original lockout applies and the round proceeds
    ///      through the normal reveal/settle path.
    function cancelExpiredRound(uint256 contentId, uint256 roundId) external nonReentrant {
        RoundLib.Round storage round = rounds[contentId][roundId];
        if (round.state != RoundLib.RoundState.Open) revert RoundNotOpen();
        RoundLib.RoundConfig memory roundCfg = _getRoundConfig(contentId, roundId);
        if (!RoundLib.isExpired(round, roundCfg.maxDuration)) revert RoundNotExpired();
        // Cancel-lockout requires BOTH commit quorum AND at least one HRC-verified commit. All-sybil
        // rounds (no HRC participation) stay refund-cancellable so they cannot be used to grief.
        if (!_canCancelExpiredRound(contentId, roundId, round, roundCfg)) {
            revert ThresholdReached();
        }

        _markRoundCancelled(contentId, roundId, round);
    }

    /// @notice Finalize a round whose reveal quorum never materialized after commit quorum was already reached.
    function finalizeRevealFailedRound(uint256 contentId, uint256 roundId) external nonReentrant {
        RoundLib.Round storage round = rounds[contentId][roundId];
        if (round.state != RoundLib.RoundState.Open) revert RoundNotOpen();
        RoundLib.RoundConfig memory roundCfg = _getRoundConfig(contentId, roundId);
        // L-5: `RoundCreationLib.snapshotRoundVotingConfig` refuses to snapshot a
        // below-RBTS quorum config, so the engine can use the stored minVoters directly
        // without re-deriving max(minVoters, MIN_RBTS_PARTICIPANTS) on the hot path.
        uint16 rbtsRevealQuorum = roundCfg.minVoters;
        if (round.voteCount < rbtsRevealQuorum) revert NotEnoughVotes();
        if (round.revealedCount >= rbtsRevealQuorum) revert ThresholdReached();
        if (!_canFinalizeRevealFailedRound(contentId, roundId, round)) revert RevealGraceActive();

        _markRoundRevealFailed(contentId, roundId, round);
    }

    // =========================================================================
    // REVEAL PHASE (keeper-assisted / self-reveal)
    // =========================================================================

    /// @notice Reveal a Robust BTS vote and crowd-frequency prediction for a specific commit by commit key.
    /// @dev `predictedUpBps` is the voter's expected share of revealed raters who vote up, encoded as 0-10000 BPS.
    function revealVoteByCommitKey(
        uint256 contentId,
        uint256 roundId,
        bytes32 commitKey,
        bool isUp,
        uint16 predictedUpBps,
        bytes32 salt
    ) external nonReentrant {
        _revealRbtsVoteInternal(contentId, roundId, commitKey, isUp, predictedUpBps, salt);
    }

    // =========================================================================
    // SETTLEMENT
    // =========================================================================

    /// @notice Settle a round after ≥minVoters votes have been revealed. Permissionless.
    /// @dev Public verdict uses epoch-weighted stake pools while RBTS settlement weights finalize LREP accounting.
    ///      Rating update uses bounded binary signal evidence so public rating movement is
    ///      compatible with absolute Robust BTS reports without making it a raw stake vote.
    function settleRound(uint256 contentId, uint256 roundId) external nonReentrant {
        RoundLib.Round storage round = rounds[contentId][roundId];

        if (round.state != RoundLib.RoundState.Open) revert RoundNotOpen();

        RoundLib.RoundConfig memory roundCfg = _getRoundConfig(contentId, roundId);
        _requireRoundContentLifecycleActive(contentId, roundId);

        // Must have enough revealed votes for both the round config and Robust BTS.
        if (round.revealedCount < roundCfg.minVoters) revert NotEnoughVotes();

        uint256 unrevealedPastEpochCount;
        bool scoringClosed = roundRbtsSeedEntropy[contentId][roundId] != bytes32(0);
        if (!scoringClosed && round.voteCount > round.revealedCount) {
            unrevealedPastEpochCount = _pastEpochUnrevealedCount(contentId, roundId, round, roundCfg);
            if (unrevealedPastEpochCount > 0) {
                if (!_isSettlementRevealGraceElapsed(contentId, roundId, round)) revert UnrevealedPastEpochVotes();
                roundUnrevealedCleanupRemaining[contentId][roundId] = unrevealedPastEpochCount;
            }
        } else if (scoringClosed) {
            unrevealedPastEpochCount = roundUnrevealedCleanupRemaining[contentId][roundId];
        }

        bool upWins;

        // Record the public verdict from epoch-weighted binary pools. Robust BTS scores
        // settle LREP rewards later; they do not override the binary signal used for rating movement.
        upWins = round.weightedUpPool > round.weightedDownPool;
        if (round.weightedUpPool == round.weightedDownPool) {
            if (round.upPool == round.downPool) {
                round.state = RoundLib.RoundState.Tied;
                round.settledAt = block.timestamp.toUint48();
                _notifyBundleRoundTerminal(contentId, roundId, false);
                emit RoundTied(contentId, roundId);
                return;
            }
            // Tiebreak: smaller raw pool wins. Rationale: identical weighted pools with
            // different raw pools means the smaller-raw side achieved the same weight with
            // fewer tokens -> more concentration in early epochs -> "more informed" voters.
            // This inverts the conventional raw-majority-breaks-tie convention intentionally.
            upWins = round.upPool < round.downPool;
        }
        if (!scoringClosed) {
            RoundRevealLib.captureRbtsSeed(roundRbtsSeedEntropy, roundRbtsScoringClosedAt, contentId, roundId);
            address rbtsSettlementOracle = protocolConfig.clusterPayoutOracle();
            if (rbtsSettlementOracle == address(0)) revert InvalidAddress();
            roundRbtsSettlementOracle[contentId][roundId] = rbtsSettlementOracle;
            round.upWins = upWins;
            round.state = RoundLib.RoundState.SettlementPending;
            if (unrevealedPastEpochCount == 0) {
                roundClusterPayoutReadyAt[contentId][roundId] = block.timestamp.toUint48();
            }
            emit RbtsSettlementPending(contentId, roundId, rbtsSettlementOracle);
            return;
        }
        revert RoundNotOpen();
    }

    function applyRbtsSettlementSnapshot(
        uint256,
        uint256,
        IClusterPayoutOracle.PayoutWeight[] calldata,
        bytes32[][] calldata
    ) external nonReentrant {
        _delegateRbtsSettlementModule();
    }

    function _recordPendingRatingSettlement(uint256 contentId, uint256 roundId) internal returns (bool recorded) {
        recorded = RoundSettlementSideEffectsLib.recordSettlement(
            registry,
            contentId,
            roundId,
            _getRoundReferenceRatingBps(contentId, roundId),
            roundRatingUpEvidence[contentId][roundId],
            roundRatingDownEvidence[contentId][roundId]
        );
    }

    // =========================================================================
    // REFUNDS (cancelled/tied/reveal-failed rounds)
    // =========================================================================

    /// @notice Claim refund for a cancelled, tied, or reveal-failed round. Pull-based.
    /// @dev AUDIT NOTE (I-7): No forfeiture deadline is intentional — refundable terminal-round stakes
    ///      belong to voters indefinitely. Adding a deadline would create a governance extraction vector.
    function claimCancelledRoundRefund(uint256 contentId, uint256 roundId) external nonReentrant {
        RoundLib.Round storage round = rounds[contentId][roundId];

        (bytes32 commitKey,) = _resolveClaimCommit(contentId, roundId, msg.sender);
        if (commitKey == bytes32(0)) revert RoundCleanupLib.NoCommit();
        (uint256 refundAmount, address refundRecipient) = RoundCleanupLib.claimCancelledRoundRefund(
            round,
            cancelledRoundRefundClaimed[contentId][roundId],
            cancelledRoundRefundCommitClaimed[contentId][roundId],
            commits[contentId][roundId],
            lrepToken,
            commitKey
        );
        accountedLrepBalance -= refundAmount;

        emit CancelledRoundRefundClaimed(contentId, roundId, refundRecipient, refundAmount);
    }

    // =========================================================================
    // UNREVEALED VOTE PROCESSING
    // =========================================================================

    /// @notice Process unrevealed votes in batches after settlement. Permissionless.
    /// @dev For settled rounds: unrevealed votes from past epochs are forfeited to treasury.
    ///      Current/future-epoch votes at settlement time are refunded because they had no chance.
    ///      For tied and reveal-failed rounds: all unrevealed votes are refunded — neither state
    ///      has a winner, and a reveal-liveness failure is systemic, not the voter's fault.
    function processUnrevealedVotes(uint256 contentId, uint256 roundId, uint256 startIndex, uint256 count)
        external
        nonReentrant
    {
        RoundLib.Round storage round = rounds[contentId][roundId];
        (uint256 newAccountedBalance, uint256 pendingDelta) = RoundCleanupLib.processUnrevealedVotesForEngine(
            round,
            roundCommitHashes[contentId][roundId],
            commits[contentId][roundId],
            roundCleanupIncentivePaid,
            roundUnrevealedCleanupRemaining[contentId],
            contentId,
            roundId,
            lrepToken,
            protocolConfig,
            accountedLrepBalance,
            roundRbtsScoringClosedAt[contentId][roundId],
            msg.sender,
            startIndex,
            count
        );
        accountedLrepBalance = newAccountedBalance;
        // L-Cleanup-1: accumulate any treasury-rejected forfeit into the pending bucket so a
        // later `flushPendingTreasuryForfeit` (permissionless) can retry the transfer. Without
        // this, the unpaid LREP would stay in the engine but be inaccessible: commits are
        // zeroed and `recoverSurplusLrep` can't touch funds still on the accounted side.
        if (pendingDelta > 0) {
            _pendingTreasuryForfeitLrep += pendingDelta;
        }
        if (
            (round.state == RoundLib.RoundState.Settled || round.state == RoundLib.RoundState.SettlementPending)
                && roundUnrevealedCleanupRemaining[contentId][roundId] == 0
                && roundClusterPayoutReadyAt[contentId][roundId] == 0
        ) {
            roundClusterPayoutReadyAt[contentId][roundId] = block.timestamp.toUint48();
        }
    }

    /// @notice L-Cleanup-1: permissionless retry of pending treasury forfeits accumulated by
    ///         `processUnrevealedVotes` when treasury was unset or the transfer reverted.
    ///         Decrements `accountedLrepBalance` only on successful transfer; the bucket
    ///         survives failed flushes so callers can retry once treasury is healthy.
    function flushPendingTreasuryForfeit() external nonReentrant {
        uint256 amount = _pendingTreasuryForfeitLrep;
        if (amount == 0) revert NothingProcessed();
        address treasuryAddress = protocolConfig.treasury();
        if (treasuryAddress == address(0)) revert InvalidAddress();
        _pendingTreasuryForfeitLrep = 0;
        lrepToken.safeTransfer(treasuryAddress, amount);
        accountedLrepBalance -= amount;
        emit PendingTreasuryForfeitFlushed(treasuryAddress, amount);
    }
    // =========================================================================
    // INTERNAL HELPERS
    // =========================================================================

    function _getRoundConfig(uint256 contentId, uint256 roundId) internal view returns (RoundLib.RoundConfig memory) {
        RoundLib.RoundConfig memory cfg = roundConfigSnapshot[contentId][roundId];
        if (cfg.epochDuration == 0) return _currentConfig();
        return cfg;
    }

    function _targetRoundRevealableAt(uint256 contentId, uint256 roundId, uint64 targetRound)
        internal
        view
        returns (uint256)
    {
        return RoundCleanupLib.targetRoundRevealableAt(
            roundDrandChainHashSnapshot[contentId],
            roundDrandGenesisTimeSnapshot[contentId],
            roundDrandPeriodSnapshot[contentId],
            protocolConfig,
            roundId,
            targetRound
        );
    }

    function _getRoundDrandChainHash(uint256 contentId, uint256 roundId) internal view returns (bytes32) {
        bytes32 chainHash = roundDrandChainHashSnapshot[contentId][roundId];
        if (chainHash == bytes32(0)) {
            return protocolConfig.drandChainHash();
        }
        return chainHash;
    }

    function _currentConfig() internal view returns (RoundLib.RoundConfig memory cfg) {
        (cfg.epochDuration, cfg.maxDuration, cfg.minVoters, cfg.maxVoters) = protocolConfig.config();
    }

    function _currentRatingConfig() internal view returns (RatingLib.RatingConfig memory cfg) {
        cfg = protocolConfig.getRatingConfig();
    }

    function _getRoundRatingConfig(uint256 contentId, uint256 roundId)
        internal
        view
        returns (RatingLib.RatingConfig memory cfg)
    {
        cfg = roundRatingConfigSnapshot[contentId][roundId];
        if (cfg.confidenceMassInitial == 0) {
            return _currentRatingConfig();
        }
    }

    function _getRoundReferenceRatingBps(uint256 contentId, uint256 roundId) internal view returns (uint16) {
        // FV-1 (2026-05-20 follow-up audit): trust the per-round snapshot unconditionally. The
        // companion change in RoundCreationLib.snapshotRoundVotingConfig now refuses to open a
        // round on a zero-rating content, so the snapshot is always non-zero for any (contentId,
        // roundId) that has been used in commit / reveal. A zero return here means the round
        // never existed -- callers that bind to it (commit / reveal validators) will revert on
        // the InvalidCommitHash check, which is the desired failure mode. The previous live
        // fallback could silently switch the reference value mid-round and invalidate every
        // already-submitted commit hash if `_ratingState.ratingBps` transitioned 0 -> non-zero
        // between commit and reveal.
        return roundReferenceRatingBpsSnapshot[contentId][roundId];
    }

    function previewCommitContext(uint256 contentId)
        external
        view
        returns (uint256 openRoundId, uint16 referenceRatingBps)
    {
        return RoundVotingReadLib.previewCommitContext(
            currentRoundId,
            rounds,
            roundConfigSnapshot,
            roundReferenceRatingBpsSnapshot,
            roundRevealGracePeriodSnapshot,
            lastCommitRevealableAfter,
            roundHumanVerifiedCommitCount,
            roundContentDormantCountSnapshot,
            registry,
            protocolConfig,
            contentId,
            MIN_RBTS_PARTICIPANTS
        );
    }

    function _getRoundRaterRegistry(uint256 contentId, uint256 roundId) internal view returns (IRaterIdentityRegistry) {
        address snapshot = roundRaterRegistrySnapshot[contentId][roundId];
        if (snapshot == address(0)) {
            return IRaterIdentityRegistry(protocolConfig.raterRegistry());
        }
        return IRaterIdentityRegistry(snapshot);
    }

    function _getRoundAdvisoryVoteRecorder(uint256 contentId, uint256 roundId) internal view returns (address) {
        address snapshot = roundAdvisoryVoteRecorderSnapshot[contentId][roundId];
        if (snapshot == DISABLED_ADVISORY_VOTE_RECORDER) return address(0);
        if (snapshot == address(0)) return protocolConfig.advisoryVoteRecorder();
        return snapshot;
    }

    function _resolveClaimCommit(uint256 contentId, uint256 roundId, address account)
        internal
        view
        returns (bytes32 commitKey, address rewardRecipient)
    {
        return RoundCleanupLib.resolveClaimCommit(
            voterCommitHash[contentId][roundId],
            identityCommitKey[contentId][roundId],
            commitIdentityHolder[contentId][roundId],
            holderCommitKey[contentId][roundId],
            _getRoundRaterRegistry(contentId, roundId),
            account
        );
    }

    function resolveClaimCommit(uint256 contentId, uint256 roundId, address account)
        external
        view
        returns (bytes32 commitKey, address rewardRecipient)
    {
        return _resolveClaimCommit(contentId, roundId, account);
    }

    function _canFinalizeRevealFailedRound(uint256 contentId, uint256 roundId, RoundLib.Round storage round)
        internal
        view
        returns (bool)
    {
        RoundLib.RoundConfig memory roundCfg = _getRoundConfig(contentId, roundId);
        if (roundHumanVerifiedCommitCount[contentId][roundId] < roundCfg.minVoters) return false;
        return RoundCleanupLib.canFinalizeRevealFailedRound(
            round,
            roundConfigSnapshot[contentId],
            roundRevealGracePeriodSnapshot[contentId],
            lastCommitRevealableAfter[contentId],
            protocolConfig,
            roundId,
            MIN_RBTS_PARTICIPANTS
        );
    }

    function _canCancelExpiredRound(
        uint256 contentId,
        uint256 roundId,
        RoundLib.Round storage round,
        RoundLib.RoundConfig memory roundCfg
    ) internal view returns (bool) {
        if (!RoundLib.isExpired(round, roundCfg.maxDuration)) return false;
        // L-5: snapshot-time validation keeps minVoters >= MIN_RBTS_PARTICIPANTS.
        uint16 rbtsRevealQuorum = roundCfg.minVoters;
        if (round.revealedCount >= rbtsRevealQuorum) return false;
        return
            round.voteCount < rbtsRevealQuorum || roundHumanVerifiedCommitCount[contentId][roundId] < rbtsRevealQuorum;
    }

    function _isSettlementRevealGraceElapsed(uint256 contentId, uint256 roundId, RoundLib.Round storage round)
        internal
        view
        returns (bool)
    {
        return RoundCleanupLib.isSettlementRevealGraceElapsed(
            round,
            roundConfigSnapshot[contentId],
            roundRevealGracePeriodSnapshot[contentId],
            lastCommitRevealableAfter[contentId],
            protocolConfig,
            roundId
        );
    }

    function _pastEpochUnrevealedCount(
        uint256 contentId,
        uint256 roundId,
        RoundLib.Round storage round,
        RoundLib.RoundConfig memory roundCfg
    ) internal view returns (uint256 total) {
        return RoundCleanupLib.pastEpochUnrevealedCount(epochUnrevealedCount[contentId][roundId], round, roundCfg);
    }

    function _isEmptyRoundStaleSinceActivity(uint256 contentId, RoundLib.Round storage round)
        internal
        view
        returns (bool)
    {
        if (round.state != RoundLib.RoundState.Open || round.voteCount != 0 || round.totalStake != 0) {
            return false;
        }
        uint48 lastActivityAt = _contentLastActivityAt(contentId);
        return lastActivityAt > round.startTime && lastActivityAt <= block.timestamp;
    }

    function _snapshotRoundContentLifecycle(uint256 contentId, uint256 roundId) internal {
        (uint64 id,,,,, ContentRegistryTypes.ContentStatus status, uint8 dormantCount,,,) = registry.contents(contentId);
        if (id == 0 || status != ContentRegistryTypes.ContentStatus.Active) revert ContentNotActive();
        roundContentDormantCountSnapshot[contentId][roundId] = dormantCount;
    }

    function _isRoundContentLifecycleStale(uint256 contentId, uint256 roundId) internal view returns (bool) {
        (uint64 id,,,,, ContentRegistryTypes.ContentStatus status, uint8 dormantCount,,,) = registry.contents(contentId);
        return id == 0 || status != ContentRegistryTypes.ContentStatus.Active
            || dormantCount != roundContentDormantCountSnapshot[contentId][roundId];
    }

    function _requireRoundContentLifecycleActive(uint256 contentId, uint256 roundId) internal view {
        if (_isRoundContentLifecycleStale(contentId, roundId)) revert ContentNotActive();
    }

    function _contentLastActivityAt(uint256 contentId) internal view returns (uint48 lastActivityAt) {
        (,,,, lastActivityAt,,,,,) = registry.contents(contentId);
    }

    function _revealRbtsVoteInternal(
        uint256 contentId,
        uint256 roundId,
        bytes32 commitKey,
        bool isUp,
        uint16 predictedUpBps,
        bytes32 salt
    ) internal {
        _requireRoundContentLifecycleActive(contentId, roundId);
        RoundLib.Round storage round = rounds[contentId][roundId];
        RoundLib.Commit storage commit = commits[contentId][roundId][commitKey];
        RoundLib.RoundConfig memory roundCfg = _getRoundConfig(contentId, roundId);
        uint256 targetRoundRevealableAt = _targetRoundRevealableAt(contentId, roundId, commit.targetRound);
        VotePreflightLib.validateCommittedRaterUnbanned(
            _getRoundRaterRegistry(contentId, roundId),
            IRaterIdentityRegistry(protocolConfig.raterRegistry()),
            commitIdentityKey[contentId][roundId][commitKey],
            commit.voter,
            commitIdentityHolder[contentId][roundId][commitKey]
        );
        if (roundRbtsSeedEntropy[contentId][roundId] != bytes32(0)) revert UnrevealedPastEpochVotes();
        if (_canFinalizeRevealFailedRound(contentId, roundId, round)) revert UnrevealedPastEpochVotes();
        uint256 thresholdBlock = roundThresholdReachedBlock[contentId][roundId];
        if (thresholdBlock != 0 && _isSettlementRevealGraceElapsed(contentId, roundId, round)) {
            revert UnrevealedPastEpochVotes();
        }
        (
            uint256 eligibleFrontendStake,
            uint256 eligibleFrontendCount,
            address voter,
            uint64 effectiveStake,
            uint64 ratingEvidenceWeight
        ) = RoundRevealLib.revealRbtsVote(
            round,
            commit,
            epochUnrevealedCount[contentId][roundId],
            frontendEligibleAtCommit[contentId][roundId],
            roundPerFrontendStake[contentId][roundId],
            RoundRevealLib.RevealRbtsParams({
                currentEligibleFrontendStake: roundStakeWithEligibleFrontend[contentId][roundId],
                currentEligibleFrontendCount: roundEligibleFrontendCount[contentId][roundId],
                contentId: contentId,
                roundId: roundId,
                commitKey: commitKey,
                isUp: isUp,
                predictedUpBps: predictedUpBps,
                salt: salt,
                roundReferenceRatingBps: _getRoundReferenceRatingBps(contentId, roundId),
                minVoters: roundCfg.minVoters,
                targetRoundRevealableAt: targetRoundRevealableAt,
                drandChainHash: _getRoundDrandChainHash(contentId, roundId),
                countForSettlement: true
            })
        );
        commitRevealEntropy[contentId][roundId][commitKey] =
            keccak256(abi.encode("rateloop.rbts.reveal-entropy.v1", commitKey, salt));
        roundStakeWithEligibleFrontend[contentId][roundId] = eligibleFrontendStake;
        roundEligibleFrontendCount[contentId][roundId] = eligibleFrontendCount;
        if (thresholdBlock == 0 && round.thresholdReachedAt != 0) {
            roundThresholdReachedBlock[contentId][roundId] = block.number;
        }
        commitPredictedUpBps[contentId][roundId][commitKey] = predictedUpBps;
        commitRbtsWeight[contentId][roundId][commitKey] = effectiveStake;
        // L-Vote-A: keep evidence accumulation checked so a future governance proposal that
        // raises `maxVoters` past ~9.2e12 cannot silently truncate the uint64 counter. The
        // current bound is well below that, but the `unchecked` block was a bytecode-trim
        // micro-optimization that traded a real (if remote) safety guarantee for a few hundred
        // gas. Restore the default checked arithmetic here.
        if (isUp) {
            roundRatingUpEvidence[contentId][roundId] += ratingEvidenceWeight;
        } else {
            roundRatingDownEvidence[contentId][roundId] += ratingEvidenceWeight;
        }

        emit VoteRevealed(contentId, roundId, voter, isUp);
        emit RbtsVoteRevealed(contentId, roundId, voter, isUp, predictedUpBps, effectiveStake);
    }

    // =========================================================================
    // VIEW FUNCTIONS
    // =========================================================================

    // Note: computeCurrentEpochEnd removed to fit size limit.
    // Use config().epochDuration plus rounds(contentId, roundId).startTime to compute off-chain.
    // previewCommitContext is public above (the split preview helpers were merged
    // to fit the EIP-170 size limit).

    function getRoundCommitKey(uint256 contentId, uint256 roundId, uint256 index) external view returns (bytes32) {
        bytes32[] storage commitKeys = roundCommitHashes[contentId][roundId];
        if (index >= commitKeys.length) revert IndexOutOfBounds();
        return commitKeys[index];
    }

    function roundCore(uint256 contentId, uint256 roundId)
        external
        view
        returns (
            uint48 startTime,
            RoundLib.RoundState state,
            uint16 voteCount,
            uint16 revealedCount,
            uint64 totalStake,
            uint48 thresholdReachedAt,
            uint48 settledAt,
            uint8 upWins
        )
    {
        assembly ("memory-safe") {
            mstore(0x00, contentId)
            mstore(0x20, rounds.slot)
            mstore(0x20, keccak256(0x00, 0x40))
            mstore(0x00, roundId)
            let slot := keccak256(0x00, 0x40)
            let word0 := sload(slot)
            let word1 := sload(add(slot, 1))
            startTime := and(word0, 0xffffffffffff)
            state := and(shr(48, word0), 0xff)
            voteCount := and(shr(56, word0), 0xffff)
            revealedCount := and(shr(72, word0), 0xffff)
            totalStake := and(shr(88, word0), 0xffffffffffffffff)
            settledAt := and(shr(104, word1), 0xffffffffffff)
            thresholdReachedAt := and(shr(152, word1), 0xffffffffffff)
            upWins := and(shr(96, word1), 0xff)
        }
    }

    function advisoryRoundContext(uint256 contentId, uint256 roundId, uint64 targetRound)
        external
        view
        returns (
            uint16 referenceRatingBps,
            uint256 targetRevealableAt,
            bytes32 drandChainHash,
            uint64 drandGenesisTime,
            uint64 drandPeriod,
            bool rbtsScoringClosed,
            address advisoryVoteRecorder
        )
    {
        return (
            _getRoundReferenceRatingBps(contentId, roundId),
            targetRound == 0 ? 0 : _targetRoundRevealableAt(contentId, roundId, targetRound),
            roundDrandChainHashSnapshot[contentId][roundId],
            roundDrandGenesisTimeSnapshot[contentId][roundId],
            roundDrandPeriodSnapshot[contentId][roundId],
            roundRbtsSeedEntropy[contentId][roundId] != bytes32(0),
            _getRoundAdvisoryVoteRecorder(contentId, roundId)
        );
    }

    function roundConfidentialityEscrowSnapshotWord(uint256 contentId, uint256 roundId)
        external
        view
        returns (uint256 snapshot)
    {
        assembly ("memory-safe") {
            mstore(0x00, contentId)
            mstore(0x20, roundConfidentialityEscrowSnapshot.slot)
            mstore(0x20, keccak256(0x00, 0x40))
            mstore(0x00, roundId)
            snapshot := sload(keccak256(0x00, 0x40))
        }
    }

    function voteCooldownTimestamps(uint256 contentId, address voter, address identityHolder, bytes32 identityKey)
        external
        view
        returns (uint256 voterLastVote, uint256 identityHolderLastVote, uint256 identityLastVote)
    {
        voterLastVote = lastVoteTimestamp[contentId][voter];
        identityHolderLastVote = lastVoteTimestamp[contentId][identityHolder];
        identityLastVote = lastVoteTimestampByIdentity[contentId][identityKey];
    }

    function rbtsRoundState(uint256 contentId, uint256 roundId)
        external
        view
        returns (bool scored, bytes32 scoreSeed, uint256 rewardWeight, uint256 rewardClaimants, uint256 voterPool)
    {
        return (
            roundRbtsScored[contentId][roundId],
            roundRbtsScoreSeed[contentId][roundId],
            roundRbtsRewardWeight[contentId][roundId],
            roundRbtsRewardClaimants[contentId][roundId],
            roundVoterPool[contentId][roundId]
        );
    }

    function supportsRoundPayoutSnapshotDomain(uint8 domain) external pure returns (bool) {
        return domain == PAYOUT_DOMAIN_RBTS_SETTLEMENT;
    }

    function isRoundPayoutSnapshotConsumed(uint8 domain, uint256 rewardPoolId, uint256 contentId, uint256 roundId)
        external
        view
        returns (bool)
    {
        return domain == PAYOUT_DOMAIN_RBTS_SETTLEMENT && rewardPoolId == 0
            && roundRbtsSettlementSnapshotDigest[contentId][roundId] != bytes32(0);
    }

    function roundPayoutSnapshotSourceReadyAt(uint8 domain, uint256 rewardPoolId, uint256 contentId, uint256 roundId)
        external
        view
        returns (uint64)
    {
        if (domain != PAYOUT_DOMAIN_RBTS_SETTLEMENT || rewardPoolId != 0) return 0;
        if (rounds[contentId][roundId].state != RoundLib.RoundState.SettlementPending) return 0;
        if (msg.sender != roundRbtsSettlementOracle[contentId][roundId]) return 0;
        if (roundUnrevealedCleanupRemaining[contentId][roundId] != 0) return 0;
        return uint64(roundClusterPayoutReadyAt[contentId][roundId]);
    }

    function rbtsCommitState(uint256 contentId, uint256 roundId, bytes32 commitKey)
        external
        view
        returns (
            uint16 predictedUpBps,
            uint16 scoreBps,
            uint256 scoringWeight,
            uint256 rewardWeight,
            uint256 stakeReturned
        )
    {
        return (
            commitPredictedUpBps[contentId][roundId][commitKey],
            commitRbtsScoreBps[contentId][roundId][commitKey],
            commitRbtsWeight[contentId][roundId][commitKey],
            commitRbtsRewardWeight[contentId][roundId][commitKey],
            commitRbtsStakeReturned[contentId][roundId][commitKey]
        );
    }

    function roundRatingConfigPacked(uint256 contentId, uint256 roundId)
        external
        view
        returns (uint256 massWord, uint256 penaltyWord)
    {
        return RoundVotingReadLib.roundRatingConfigPacked(roundRatingConfigSnapshot, protocolConfig, contentId, roundId);
    }

    function ratingCommitStateCompact(uint256 contentId, uint256 roundId, bytes32 commitKey)
        external
        view
        returns (uint256 flags, bytes32 identityKey, address holder)
    {
        return RoundVotingReadLib.ratingCommitStateCompact(
            commits[contentId][roundId],
            commitIdentityKey[contentId][roundId],
            commitIdentityHolder[contentId][roundId],
            commitKey
        );
    }

    function frontendFeeState(uint256 contentId, uint256 roundId, address frontend)
        external
        view
        returns (
            uint256 totalFrontendPool,
            uint256 frontendStake,
            uint256 totalEligibleStake,
            uint256 totalFrontendClaimants
        )
    {
        return (
            roundFrontendPool[contentId][roundId],
            roundPerFrontendStake[contentId][roundId][frontend],
            roundStakeWithEligibleFrontend[contentId][roundId],
            roundEligibleFrontendCount[contentId][roundId]
        );
    }

    function roundLifecycleState(uint256 contentId, uint256 roundId)
        external
        view
        returns (
            uint256 revealGracePeriod,
            uint256 lastRevealableAfter,
            uint256 cleanupRemaining,
            uint48 clusterPayoutReadyAt
        )
    {
        return (
            roundRevealGracePeriodSnapshot[contentId][roundId],
            lastCommitRevealableAfter[contentId][roundId],
            roundUnrevealedCleanupRemaining[contentId][roundId],
            roundClusterPayoutReadyAt[contentId][roundId]
        );
    }

    function voterCommitKey(uint256 contentId, uint256 roundId, address voter)
        external
        view
        returns (bytes32 commitHash, bytes32 commitKey)
    {
        commitHash = voterCommitHash[contentId][roundId][voter];
        if (commitHash != bytes32(0)) {
            commitKey = keccak256(abi.encodePacked(voter, commitHash));
        }
    }

    function identityCommitState(uint256 contentId, uint256 roundId, bytes32 identityKey, address holder)
        external
        view
        returns (bytes32 identityKeyCommitKey, bytes32 holderKey, uint256 identityStake)
    {
        identityKeyCommitKey = identityCommitKey[contentId][roundId][identityKey];
        holderKey = holderCommitKey[contentId][roundId][holder];
        identityStake = identityRoundStake[contentId][roundId][identityKey];
    }

    function commitIdentityState(uint256 contentId, uint256 roundId, bytes32 commitKey)
        external
        view
        returns (
            bytes32 identityKey,
            address holder,
            uint48 committedAt,
            uint8 credentialMask,
            uint8 freshCredentialMask,
            bool frontendEligible
        )
    {
        return (
            commitIdentityKey[contentId][roundId][commitKey],
            commitIdentityHolder[contentId][roundId][commitKey],
            commitCommittedAt[contentId][roundId][commitKey],
            commitCredentialMask[contentId][roundId][commitKey],
            commitFreshCredentialMask[contentId][roundId][commitKey],
            frontendEligibleAtCommit[contentId][roundId][commitKey]
        );
    }

    function isDormancyBlocked(uint256 contentId) external view returns (bool) {
        return RoundVotingReadLib.isDormancyBlocked(
            currentRoundId, rounds, roundConfigSnapshot, roundHumanVerifiedCommitCount, protocolConfig, contentId
        );
    }

    // --- Admin ---

    modifier whenNotPaused() {
        assembly ("memory-safe") {
            if sload(PAUSABLE_STORAGE_LOCATION) {
                mstore(0, shl(224, 0xd93c0665))
                revert(0, 4)
            }
        }
        _;
    }

    function paused() external view returns (bool paused_) {
        assembly ("memory-safe") {
            paused_ := sload(PAUSABLE_STORAGE_LOCATION)
        }
    }

    function pause() external onlyRole(PAUSER_ROLE) {
        assembly ("memory-safe") {
            if sload(PAUSABLE_STORAGE_LOCATION) {
                mstore(0, shl(224, 0xd93c0665))
                revert(0, 4)
            }
            sstore(PAUSABLE_STORAGE_LOCATION, 1)
        }
        emit Paused(msg.sender);
    }

    function unpause() external onlyRole(PAUSER_ROLE) {
        assembly ("memory-safe") {
            if iszero(sload(PAUSABLE_STORAGE_LOCATION)) {
                mstore(0, shl(224, 0x8dfc202b))
                revert(0, 4)
            }
            sstore(PAUSABLE_STORAGE_LOCATION, 0)
        }
        emit Unpaused(msg.sender);
    }

}
