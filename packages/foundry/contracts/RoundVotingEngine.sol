// SPDX-License-Identifier: MIT
pragma solidity ^0.8.34;

import { Initializable } from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import { AccessControlUpgradeable } from "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import { PausableUpgradeable } from "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import { ReentrancyGuardTransient } from "@openzeppelin/contracts/utils/ReentrancyGuardTransient.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { SafeCast } from "@openzeppelin/contracts/utils/math/SafeCast.sol";

import { ContentRegistry } from "./ContentRegistry.sol";
import { ProtocolConfig } from "./ProtocolConfig.sol";
import { RoundLib } from "./libraries/RoundLib.sol";
import { RatingLib } from "./libraries/RatingLib.sol";
import { RoundSettlementSideEffectsLib } from "./libraries/RoundSettlementSideEffectsLib.sol";
import { RoundSettlementDistributionLib } from "./libraries/RoundSettlementDistributionLib.sol";
import { RoundCleanupLib } from "./libraries/RoundCleanupLib.sol";
import { RoundCreationLib } from "./libraries/RoundCreationLib.sol";
import { RoundRevealLib } from "./libraries/RoundRevealLib.sol";
import { VotePreflightLib } from "./libraries/VotePreflightLib.sol";
import { IFrontendRegistry } from "./interfaces/IFrontendRegistry.sol";
import { ICategoryRegistry } from "./interfaces/ICategoryRegistry.sol";
import { IRaterIdentityRegistry } from "./interfaces/IRaterIdentityRegistry.sol";
import { IRoundVotingEngine } from "./interfaces/IRoundVotingEngine.sol";

/// @title RoundVotingEngine
/// @notice Per-content round-based parimutuel voting with keeper-assisted/self-reveal and epoch-weighted rewards.
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
///      Epoch-weighting: epoch-1 (blind) = 100% reward weight; epoch-2+ (informed) = 25%.
///      Win condition uses weighted pools, not raw stake, preventing late-voter herding.
contract RoundVotingEngine is
    IRoundVotingEngine,
    Initializable,
    AccessControlUpgradeable,
    PausableUpgradeable,
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
    error ActiveRoundStillOpen();
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
    uint256 internal constant MAX_CIPHERTEXT_SIZE = 2_048; // 2 KB max ciphertext to prevent storage bloat
    uint16 internal constant MIN_RBTS_PARTICIPANTS = 3;
    address internal constant DISABLED_ADVISORY_VOTE_RECORDER = address(1);

    // --- State ---
    // M-Crosscutting-1 (audit 2026-05-20): Storage layout history. This contract is
    // `TransparentUpgradeableProxy`-backed (see `script/Deploy.s.sol`). Slot positions matter
    // for any future hot-upgrade. The current layout has the following SHIFTS from prior
    // releases — fresh deployments are unaffected, but any hot-upgrade from a baseline that
    // populated the old surface MUST run `forge-upgrade` / OZ Upgrades `validateUpgrade` first:
    //
    //   * Pre-2026-05-19: `roundDeferredCleanupBounty` (triple mapping → uint256) at the slot
    //     now occupied by `roundClusterPayoutReadyAt` (triple mapping → uint48). Annotated
    //     with `@custom:oz-renamed-from roundDeferredCleanupBounty` (I-Crosscutting-A).
    //   * Pre-2026-05-19: `consensusReserve` (uint256) sat at the end of the layout. Removed
    //     when the consensus-reserve mechanism was deleted (`bc96d7e5`); all later slots
    //     shifted up by 1.
    //   * Post-2026-05-19: `roundRbtsMeanScoreBps` (uint256→uint16) inserted mid-layout at
    //     line 139; all later slots shifted down by 1.
    //   * Post-2026-05-28: `roundRbtsScoreSeed` inserted after `roundRbtsMeanScoreBps` so
    //     advisory sampling can bind to the finalized engine seed. Fresh deployments only.
    //   * Post-2026-05-29: `roundAdvisoryVoteRecorderSnapshot` inserted after
    //     `roundRaterRegistrySnapshot` so recorder rotation does not affect open rounds.
    //
    // CI runbook: any future change to the order or type of state variables in this contract
    // must run OZ `validateUpgrade` against the previous implementation before any non-31337
    // deploy. If the deploy is `--upgrade`, the validator catches incompatible shifts and
    // aborts. If the deploy is fresh (TransparentUpgradeableProxy with a brand-new admin),
    // the layout is permitted to shift freely.
    IERC20 internal lrepToken;
    ContentRegistry internal registry;
    ProtocolConfig public protocolConfig;

    // Round data: contentId => roundId => Round
    mapping(uint256 => mapping(uint256 => RoundLib.Round)) public rounds;

    // Per-content round tracking
    mapping(uint256 => uint256) public currentRoundId; // contentId => latest current-round slot (0 = none)
    mapping(uint256 => uint256) internal nextRoundId; // contentId => next round ID to create

    // Commits: contentId => roundId => commitKey => Commit
    mapping(uint256 => mapping(uint256 => mapping(bytes32 => RoundLib.Commit))) internal commits;

    // Track commit keys per round for iteration (reveal/settlement)
    mapping(uint256 => mapping(uint256 => bytes32[])) internal roundCommitHashes;

    // Time-based cooldown: contentId => voter => timestamp of last vote
    mapping(uint256 => mapping(address => uint256)) internal lastVoteTimestamp;

    // Reward accounting per round
    mapping(uint256 => mapping(uint256 => uint256)) public roundVoterPool; // contentId => roundId => voter pool
    mapping(uint256 => mapping(uint256 => uint256)) public roundWinningStake; // contentId => roundId => reward-distribution weight

    // Robust BTS reward accounting per round.
    mapping(uint256 => mapping(uint256 => bool)) public roundRbtsScored;
    mapping(uint256 => mapping(uint256 => uint256)) public roundRbtsRewardWeight;
    mapping(uint256 => mapping(uint256 => uint256)) public roundRbtsRewardClaimants;
    mapping(uint256 => mapping(uint256 => uint256)) public roundRbtsParticipationWeight;
    mapping(uint256 => mapping(uint256 => uint256)) public roundRbtsParticipationClaimants;
    mapping(uint256 => mapping(uint256 => uint256)) public roundRbtsForfeitedPool;
    mapping(uint256 => mapping(uint256 => uint256)) public roundRbtsForfeitClaimants;
    mapping(uint256 => mapping(uint256 => uint16)) public roundRbtsMeanScoreBps;
    mapping(uint256 => mapping(uint256 => bytes32)) public roundRbtsScoreSeed;
    mapping(uint256 => mapping(uint256 => uint256)) public roundThresholdReachedBlock;
    mapping(uint256 => mapping(uint256 => mapping(bytes32 => uint16))) public commitPredictedUpBps;
    mapping(uint256 => mapping(uint256 => mapping(bytes32 => uint256))) internal commitRbtsWeight;
    mapping(uint256 => mapping(uint256 => mapping(bytes32 => uint16))) public commitRbtsScoreBps;
    mapping(uint256 => mapping(uint256 => mapping(bytes32 => uint256))) public commitRbtsRewardWeight;
    mapping(uint256 => mapping(uint256 => mapping(bytes32 => uint256))) public commitRbtsStakeReturned;
    mapping(uint256 => mapping(uint256 => mapping(bytes32 => uint256))) public commitRbtsForfeitedStake;

    // Cancelled/tied round refund claims: contentId => roundId => voter => claimed
    mapping(uint256 => mapping(uint256 => mapping(address => bool))) public cancelledRoundRefundClaimed;
    mapping(uint256 => mapping(uint256 => mapping(bytes32 => bool))) internal cancelledRoundRefundCommitClaimed;

    // Fast zero/non-zero indicator for content vote history. Public so the IRoundVotingEngine
    // `hasCommits` view is fulfilled by the auto-getter without an explicit function definition.
    mapping(uint256 => bool) public hasCommits;

    uint256 internal accountedLrepBalance;

    // Config snapshot per round: prevents governance config changes from affecting in-progress rounds
    mapping(uint256 => mapping(uint256 => RoundLib.RoundConfig)) public roundConfigSnapshot;
    mapping(uint256 => mapping(uint256 => RatingLib.RatingConfig)) internal roundRatingConfigSnapshot;
    mapping(uint256 => mapping(uint256 => uint16)) internal roundReferenceRatingBpsSnapshot;

    // Voter to commit hash lookup: contentId => roundId => voter => commitHash (O(1) claim lookups)
    mapping(uint256 => mapping(uint256 => mapping(address => bytes32))) public voterCommitHash;

    // Stable rater-identity keyed commit lookups for duplicate prevention and delegated wallets.
    mapping(uint256 => mapping(uint256 => mapping(bytes32 => bytes32))) public identityCommitKey;
    mapping(uint256 => mapping(uint256 => mapping(bytes32 => bytes32))) public commitIdentityKey;
    mapping(uint256 => mapping(uint256 => mapping(bytes32 => address))) public commitIdentityHolder;
    mapping(uint256 => mapping(uint256 => mapping(address => bytes32))) public holderCommitKey;
    mapping(uint256 => mapping(uint256 => mapping(bytes32 => uint256))) public identityRoundStake;

    // Frontend fee aggregation (computed incrementally during revealVote for O(1) settlement)
    mapping(uint256 => mapping(uint256 => uint256)) public roundStakeWithEligibleFrontend;
    mapping(uint256 => mapping(uint256 => mapping(address => uint256))) public roundPerFrontendStake;
    mapping(uint256 => mapping(uint256 => uint256)) public roundFrontendPool;
    mapping(uint256 => mapping(uint256 => uint256)) public roundEligibleFrontendCount;
    mapping(uint256 => mapping(uint256 => address)) public roundRaterRegistrySnapshot;
    mapping(uint256 => mapping(uint256 => address)) public roundAdvisoryVoteRecorderSnapshot;

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
    event RbtsSeedCaptured(uint256 indexed contentId, uint256 indexed roundId, bytes32 entropy);
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

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(address _governance, address _lrepToken, address _registry, address _protocolConfig)
        public
        initializer
    {
        __AccessControl_init();
        __Pausable_init();

        if (_governance == address(0)) revert InvalidAddress();
        if (_lrepToken == address(0)) revert InvalidAddress();
        if (_registry == address(0)) revert InvalidAddress();
        if (_protocolConfig == address(0)) revert InvalidAddress();

        _grantRole(DEFAULT_ADMIN_ROLE, _governance);
        _grantRole(PAUSER_ROLE, _governance);

        lrepToken = IERC20(_lrepToken);
        registry = ContentRegistry(_registry);
        protocolConfig = ProtocolConfig(_protocolConfig);
    }

    /// @notice Recover LREP sent directly to this contract outside accounted protocol flows.
    /// @dev Admin-only and naturally reentrancy-safe: a re-entrant call would compute
    ///      `balanceOf - accountedLrepBalance == 0` after the first transfer, draining nothing.
    function recoverSurplusLrep() external {
        if (!hasRole(bytes32(0), msg.sender)) revert Unauthorized();
        lrepToken.safeTransfer(msg.sender, lrepToken.balanceOf(address(this)) - accountedLrepBalance);
    }

    /// @notice Transfer LREP reward tokens to a recipient. Only callable by RewardDistributor.
    function transferReward(address recipient, uint256 lrepAmount) external {
        if (!protocolConfig.isRewardDistributorForEngine(msg.sender, address(this))) revert Unauthorized();
        if (recipient == address(0)) revert InvalidAddress();
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
        VotePreflightLib.validateRoundOpener(
            IRaterIdentityRegistry(protocolConfig.raterRegistry()), registry, msg.sender, contentId
        );
        uint256 roundId = _getOrCreateRound(contentId);
        RoundLib.Round storage round = rounds[contentId][roundId];
        RoundLib.RoundConfig memory roundCfg = _getRoundConfig(contentId, roundId);
        if (!RoundLib.acceptsVotes(round, roundCfg.maxDuration)) revert RoundNotOpen();
        if (round.thresholdReachedAt != 0) revert ThresholdReached();
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
        _applyAppendedPermit(ciphertext, stakeAmount);
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

    /// @notice Bind an advisory commit to the current staked open round.
    /// @dev Records no vote/stake accounting; zero-stake advisory commits cannot open or roll rounds.
    function prepareAdvisoryRound(uint256 contentId, uint256 roundContext) external view {
        uint256 roundId = currentRoundId[contentId];
        if (roundId == 0) revert RoundNotOpen();
        if (roundId != roundContext >> 16) revert InvalidCommitHash();
        if (msg.sender != _getRoundAdvisoryVoteRecorder(contentId, roundId)) revert Unauthorized();

        RoundLib.Round storage round = rounds[contentId][roundId];
        RoundLib.RoundConfig memory roundCfg = _getRoundConfig(contentId, roundId);
        uint16 roundReferenceRatingBps = uint16(roundContext);
        if (roundReferenceRatingBps != _getRoundReferenceRatingBps(contentId, roundId)) {
            revert InvalidCommitHash();
        }

        if (!RoundLib.acceptsVotes(round, roundCfg.maxDuration)) revert RoundNotOpen();
        unchecked {
            if (block.timestamp >= uint256(round.startTime) + uint256(roundCfg.epochDuration)) revert RoundNotOpen();
        }
        if (round.voteCount == 0 || round.totalStake == 0) revert RoundNotOpen();
        if (round.thresholdReachedAt != 0) revert ThresholdReached();
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
        RoundLib.RoundConfig memory roundCfg = _getRoundConfig(contentId, roundId);
        uint16 roundReferenceRatingBps = uint16(roundContext);
        uint16 expectedReferenceRatingBps = _getRoundReferenceRatingBps(contentId, roundId);
        if (roundReferenceRatingBps != expectedReferenceRatingBps) revert InvalidCommitHash();

        // Round must be Open and not expired
        if (!RoundLib.acceptsVotes(round, roundCfg.maxDuration)) revert RoundNotOpen();
        if (round.thresholdReachedAt != 0) revert ThresholdReached();

        IRaterIdentityRegistry roundRaterRegistry = _getRoundRaterRegistry(contentId, roundId);
        IRaterIdentityRegistry.ResolvedRater memory resolved =
            VotePreflightLib.validateVoterAndContent(roundRaterRegistry, registry, voter, contentId);
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

        _storeCommittedVote(
            contentId,
            roundId,
            commitKey,
            voter,
            stakeAmount64,
            ciphertextHash,
            frontend,
            epochEnd,
            targetRound,
            epochIdx,
            commitHash,
            resolved.identityKey,
            resolved.holder
        );
        _recordCommitAccounting(
            round, contentId, roundId, voter, resolved.holder, resolved.identityKey, stakeAmount64, stakeAmount
        );
        // Flag whether at least one commit in this round originated from an HRC-verified identity.
        // `cancelExpiredRound` consults this flag to keep all-sybil rounds refund-cancellable.
        if (resolved.hasActiveHumanCredential && !roundHasHumanVerifiedCommit[contentId][roundId]) {
            roundHasHumanVerifiedCommit[contentId][roundId] = true;
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

    function _applyAppendedPermit(bytes calldata ciphertext, uint256 stakeAmount) private {
        bool hasPermit;
        uint256 permitDeadline;
        uint8 v;
        bytes32 r;
        bytes32 s;
        assembly ("memory-safe") {
            let permitOffset := add(ciphertext.offset, and(add(ciphertext.length, 31), not(31)))
            hasPermit := gt(calldatasize(), permitOffset)
            permitDeadline := calldataload(permitOffset)
            v := calldataload(add(permitOffset, 32))
            r := calldataload(add(permitOffset, 64))
            s := calldataload(add(permitOffset, 96))
        }
        if (!hasPermit) return;

        // Front-run-tolerant permit: a mempool observer can replay this permit
        // to consume the nonce and revert a bare permit() call, which would
        // brick the single-transaction permit-backed commit. permitStake
        // swallows that revert when the allowance is already sufficient.
        VotePreflightLib.permitStake(
            address(lrepToken), msg.sender, address(this), stakeAmount, permitDeadline, v, r, s
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

    function _storeCommittedVote(
        uint256 contentId,
        uint256 roundId,
        bytes32 commitKey,
        address voter,
        uint64 stakeAmount64,
        bytes32 ciphertextHash,
        address frontend,
        uint256 epochEnd,
        uint64 targetRound,
        uint8 epochIdx,
        bytes32 commitHash,
        bytes32 identityKey,
        address identityHolder
    ) internal {
        _writeCommitStruct(
            contentId,
            roundId,
            commitKey,
            voter,
            stakeAmount64,
            ciphertextHash,
            frontend,
            epochEnd,
            targetRound,
            epochIdx
        );
        _markFrontendEligibility(contentId, roundId, commitKey, frontend);
        _recordCommitIndexes(
            contentId, roundId, commitKey, epochEnd, voter, commitHash, identityKey, identityHolder, targetRound
        );
    }

    function _writeCommitStruct(
        uint256 contentId,
        uint256 roundId,
        bytes32 commitKey,
        address voter,
        uint64 stakeAmount64,
        bytes32 ciphertextHash,
        address frontend,
        uint256 epochEnd,
        uint64 targetRound,
        uint8 epochIdx
    ) internal {
        commits[contentId][roundId][commitKey] = RoundLib.Commit({
            voter: voter,
            stakeAmount: stakeAmount64,
            ciphertextHash: ciphertextHash,
            frontend: frontend,
            revealableAfter: epochEnd.toUint48(),
            targetRound: targetRound,
            revealed: false,
            isUp: false,
            epochIndex: epochIdx
        });
        commitCommittedAt[contentId][roundId][commitKey] = block.timestamp.toUint48();
    }

    function _markFrontendEligibility(uint256 contentId, uint256 roundId, bytes32 commitKey, address frontend)
        internal
    {
        if (frontend == address(0)) {
            return;
        }
        address snapshotRegistry = roundFrontendRegistrySnapshot[contentId][roundId];
        IFrontendRegistry frontendRegistry = IFrontendRegistry(snapshotRegistry);
        if (VotePreflightLib.isFrontendEligible(frontendRegistry, frontend)) {
            frontendEligibleAtCommit[contentId][roundId][commitKey] = true;
        }
    }

    function _recordCommitIndexes(
        uint256 contentId,
        uint256 roundId,
        bytes32 commitKey,
        uint256 epochEnd,
        address voter,
        bytes32 commitHash,
        bytes32 identityKey,
        address identityHolder,
        uint64 targetRound
    ) internal {
        uint256 effectiveRevealableAfter = _targetRoundRevealableAt(contentId, roundId, targetRound);
        if (effectiveRevealableAfter < epochEnd) effectiveRevealableAfter = epochEnd;
        hasCommits[contentId] = true;
        RoundCleanupLib.recordCommitIndexes(
            roundCommitHashes[contentId][roundId],
            epochUnrevealedCount[contentId][roundId],
            lastCommitRevealableAfter[contentId],
            voterCommitHash[contentId][roundId],
            roundId,
            commitKey,
            epochEnd,
            effectiveRevealableAfter,
            voter,
            commitHash
        );
        RoundCleanupLib.recordIdentityCommitIndex(
            identityCommitKey[contentId][roundId],
            commitIdentityKey[contentId][roundId],
            commitIdentityHolder[contentId][roundId],
            holderCommitKey[contentId][roundId],
            commitKey,
            identityKey,
            identityHolder,
            voter
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

    /// @dev Get or create the active round for a content item.
    function _getOrCreateRound(uint256 contentId) internal returns (uint256) {
        uint256 roundId = currentRoundId[contentId];
        if (roundId > 0 && !RoundLib.isTerminal(rounds[contentId][roundId])) {
            RoundLib.Round storage round = rounds[contentId][roundId];
            RoundLib.RoundConfig memory roundCfg = _getRoundConfig(contentId, roundId);
            if (_isEmptyRoundStaleSinceActivity(contentId, round)) {
                _markRoundCancelled(contentId, roundId, round);
            } else if (_canCancelExpiredRound(contentId, roundId, round, roundCfg)) {
                _markRoundCancelled(contentId, roundId, round);
            } else if (_canFinalizeRevealFailedRound(contentId, roundId, round)) {
                _markRoundRevealFailed(contentId, roundId, round);
            } else {
                return roundId;
            }
        }

        roundId = RoundCreationLib.activateNewRound(currentRoundId, nextRoundId, rounds, contentId);
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
            protocolConfig,
            contentId,
            roundId
        );
        return roundId;
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
        onlyRole(DEFAULT_ADMIN_ROLE)
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

    // =========================================================================
    // ROUND EXPIRY
    // =========================================================================

    /// @notice Cancel an expired round that didn't reach the minimum voter threshold. Permissionless.
    /// @dev The min-RBTS-quorum lockout only engages once at least one commit in the round has
    ///      originated from a human-credential-verified identity. A pure-sybil attacker (no HRC)
    ///      reaching N >= 3 commits at min stake can no longer grief honest content into a
    ///      `RevealFailed` cycle (~80 min @ ~3 LREP/cycle) -- the round remains
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
        uint16 rbtsRevealQuorum = _rbtsRevealQuorum(roundCfg.minVoters);
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
    /// @dev Win condition uses epoch-weighted stake pools to prevent late-voter herding.
    ///      Rating update uses bounded binary signal evidence so public rating movement is
    ///      compatible with absolute Robust BTS reports without making it a raw stake vote.
    function settleRound(uint256 contentId, uint256 roundId) external nonReentrant {
        RoundLib.Round storage round = rounds[contentId][roundId];

        if (round.state != RoundLib.RoundState.Open) revert RoundNotOpen();

        RoundLib.RoundConfig memory roundCfg = _getRoundConfig(contentId, roundId);

        // Must have enough revealed votes for both the round config and Robust BTS.
        if (round.revealedCount < _rbtsRevealQuorum(roundCfg.minVoters)) revert NotEnoughVotes();

        // Prevent selective revelation: all past-epoch commits must be revealed before settlement is allowed.
        // Once the final reveal grace window has elapsed, revealed quorum is enough to settle and unrevealed
        // past-epoch stakes stay locked until they are cleaned up.
        // Loop is bounded: votes can only be committed during maxDuration, so no
        // epochUnrevealedCount entries exist beyond startTime + maxDuration + epochDuration.
        uint256 unrevealedPastEpochCount = _pastEpochUnrevealedCount(contentId, roundId, round, roundCfg);
        if (unrevealedPastEpochCount > 0) {
            if (!_isSettlementRevealGraceElapsed(contentId, roundId, round)) revert UnrevealedPastEpochVotes();
            roundUnrevealedCleanupRemaining[contentId][roundId] = unrevealedPastEpochCount;
        }

        uint256 weightedRewardStake;
        uint256 rbtsForfeitedPool;
        uint256 binaryLosingPool;
        bool upWins;
        bytes32 scoreSeed;

        // Determine winner: weighted majority wins (anti-herding). Robust BTS scores only
        // calibrate rewards; they do not override the binary signal used for rating movement.
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
            // fewer tokens → more concentration in early epochs → "more informed" voters.
            // This inverts the conventional raw-majority-breaks-tie convention intentionally.
            upWins = round.upPool < round.downPool;
        }
        binaryLosingPool = upWins ? round.downPool : round.upPool;

        (weightedRewardStake, rbtsForfeitedPool, scoreSeed) =
            _scoreRbtsRewards(contentId, roundId, round.revealedCount, round.thresholdReachedAt);
        roundRbtsScored[contentId][roundId] = true;

        round.upWins = upWins;
        round.state = RoundLib.RoundState.Settled;
        round.settledAt = block.timestamp.toUint48();
        if (unrevealedPastEpochCount == 0) {
            roundClusterPayoutReadyAt[contentId][roundId] = round.settledAt;
        }
        _notifyBundleRoundTerminal(contentId, roundId, true);

        uint256 treasuryPaid = RoundSettlementDistributionLib.distribute(
            lrepToken,
            protocolConfig,
            roundVoterPool,
            roundWinningStake,
            roundStakeWithEligibleFrontend,
            roundFrontendPool,
            roundFrontendRegistrySnapshot,
            contentId,
            roundId,
            weightedRewardStake,
            rbtsForfeitedPool
        );
        if (treasuryPaid > 0) {
            accountedLrepBalance -= treasuryPaid;
        }

        RoundSettlementSideEffectsLib.recordSettlement(
            registry,
            _getRoundRatingConfig(contentId, roundId),
            contentId,
            roundId,
            _getRoundReferenceRatingBps(contentId, roundId),
            roundRatingUpEvidence[contentId][roundId],
            roundRatingDownEvidence[contentId][roundId]
        );
        emit RbtsRewardsScored(
            contentId,
            roundId,
            scoreSeed,
            roundRbtsRewardWeight[contentId][roundId],
            roundRbtsRewardClaimants[contentId][roundId],
            roundRbtsForfeitedPool[contentId][roundId],
            roundRbtsForfeitClaimants[contentId][roundId],
            roundRbtsMeanScoreBps[contentId][roundId]
        );
        emit RoundSettled(contentId, roundId, upWins, binaryLosingPool);
    }

    // =========================================================================
    // REFUNDS (cancelled/tied/reveal-failed rounds)
    // =========================================================================

    /// @notice Claim refund for a cancelled, tied, or reveal-failed round. Pull-based.
    /// @dev AUDIT NOTE (I-7): No forfeiture deadline is intentional — refundable terminal-round stakes
    ///      belong to voters indefinitely. Adding a deadline would create a governance extraction vector.
    function claimCancelledRoundRefund(uint256 contentId, uint256 roundId) external nonReentrant {
        RoundLib.Round storage round = rounds[contentId][roundId];
        if (
            round.state != RoundLib.RoundState.Cancelled && round.state != RoundLib.RoundState.Tied
                && round.state != RoundLib.RoundState.RevealFailed
        ) {
            revert RoundCleanupLib.RoundNotCancelledOrTied();
        }

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
    /// @dev For settled/tied rounds: unrevealed votes from past epochs are forfeited to treasury.
    ///      Current/future-epoch votes at settlement/tie time are refunded because they had no chance.
    ///      For reveal-failed rounds: all unrevealed votes are forfeited because the final reveal grace has passed.
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
            round.state == RoundLib.RoundState.Settled && roundUnrevealedCleanupRemaining[contentId][roundId] == 0
                && roundClusterPayoutReadyAt[contentId][roundId] == 0
        ) {
            roundClusterPayoutReadyAt[contentId][roundId] = block.timestamp.toUint48();
        }
    }

    /// @notice L-Cleanup-1: permissionless retry of pending treasury forfeits accumulated by
    ///         `processUnrevealedVotes` when treasury was unset or the transfer reverted.
    ///         Decrements `accountedLrepBalance` only on successful transfer; the bucket
    ///         survives failed flushes so callers can retry once treasury is healthy.
    function flushPendingTreasuryForfeit() external nonReentrant returns (uint256 paid) {
        uint256 amount = _pendingTreasuryForfeitLrep;
        if (amount == 0) revert NothingProcessed();
        address treasuryAddress = protocolConfig.treasury();
        if (treasuryAddress == address(0)) revert InvalidAddress();
        _pendingTreasuryForfeitLrep = 0;
        lrepToken.safeTransfer(treasuryAddress, amount);
        accountedLrepBalance -= amount;
        emit PendingTreasuryForfeitFlushed(treasuryAddress, amount);
        return amount;
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

    function previewCommitReferenceRatingBps(uint256 contentId) public view returns (uint16) {
        uint256 openRoundId = previewCommitRoundId(contentId);
        unchecked {
            if (openRoundId == nextRoundId[contentId] + 1) {
                return registry.getRating(contentId);
            }
        }

        return _getRoundReferenceRatingBps(contentId, openRoundId);
    }

    function previewCommitRoundId(uint256 contentId) public view returns (uint256) {
        uint256 openRoundId = currentRoundId[contentId];
        if (openRoundId != 0) {
            RoundLib.Round storage round = rounds[contentId][openRoundId];
            RoundLib.RoundConfig memory roundCfg = _getRoundConfig(contentId, openRoundId);
            if (
                !RoundLib.isTerminal(round) && !_isEmptyRoundStaleSinceActivity(contentId, round)
                    && !_canCancelExpiredRound(contentId, openRoundId, round, roundCfg)
                    && !_canFinalizeRevealFailedRound(contentId, openRoundId, round)
            ) {
                return openRoundId;
            }
        }

        unchecked {
            return nextRoundId[contentId] + 1;
        }
    }

    function _getCategoryRegistry() internal view returns (ICategoryRegistry) {
        return ICategoryRegistry(protocolConfig.categoryRegistry());
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
        if (!roundHasHumanVerifiedCommit[contentId][roundId]) return false;
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
        uint16 rbtsRevealQuorum = _rbtsRevealQuorum(roundCfg.minVoters);
        if (round.revealedCount >= rbtsRevealQuorum) return false;
        return round.voteCount < rbtsRevealQuorum || !roundHasHumanVerifiedCommit[contentId][roundId];
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

    function _contentLastActivityAt(uint256 contentId) internal view returns (uint48 lastActivityAt) {
        (,,,, lastActivityAt,,,,,) = registry.contents(contentId);
    }

    function _scoreRbtsRewards(uint256 contentId, uint256 roundId, uint256 revealedCount, uint48 thresholdReachedAt)
        internal
        returns (uint256 rewardWeight, uint256 forfeitedPool, bytes32 scoreSeed)
    {
        (bytes32 settlementEntropy, bool disableRbtsRewards) =
            RoundRevealLib.finalizeRbtsSeed(roundRbtsSeedEntropy, contentId, roundId);
        RoundRevealLib.ScoreRbtsResult memory result = RoundRevealLib.scoreRbtsRewards(
            roundCommitHashes[contentId][roundId],
            commits[contentId][roundId],
            commitPredictedUpBps[contentId][roundId],
            commitRbtsWeight[contentId][roundId],
            commitRbtsScoreBps[contentId][roundId],
            commitRbtsRewardWeight[contentId][roundId],
            commitRbtsStakeReturned[contentId][roundId],
            commitRbtsForfeitedStake[contentId][roundId],
            commitIdentityKey[contentId][roundId],
            RoundRevealLib.ScoreRbtsParams({
                contentId: contentId,
                roundId: roundId,
                revealedCount: revealedCount,
                minParticipants: MIN_RBTS_PARTICIPANTS,
                settlementEntropy: settlementEntropy,
                thresholdReachedAt: thresholdReachedAt,
                disableRewards: disableRbtsRewards
            })
        );

        rewardWeight = result.rewardWeight;
        forfeitedPool = result.forfeitedPool;
        scoreSeed = result.scoreSeed;
        roundRbtsRewardWeight[contentId][roundId] = result.rewardWeight;
        roundRbtsRewardClaimants[contentId][roundId] = result.rewardClaimants;
        roundRbtsParticipationWeight[contentId][roundId] = result.participationWeight;
        roundRbtsParticipationClaimants[contentId][roundId] = result.participationClaimants;
        roundRbtsForfeitedPool[contentId][roundId] = result.forfeitedPool;
        roundRbtsForfeitClaimants[contentId][roundId] = result.forfeitClaimants;
        roundRbtsMeanScoreBps[contentId][roundId] = result.meanScoreBps;
        roundRbtsScoreSeed[contentId][roundId] = result.scoreSeed;
    }

    function _revealRbtsVoteInternal(
        uint256 contentId,
        uint256 roundId,
        bytes32 commitKey,
        bool isUp,
        uint16 predictedUpBps,
        bytes32 salt
    ) internal {
        RoundLib.Round storage round = rounds[contentId][roundId];
        RoundLib.Commit storage commit = commits[contentId][roundId][commitKey];
        RoundLib.RoundConfig memory roundCfg = _getRoundConfig(contentId, roundId);
        uint256 targetRoundRevealableAt = _targetRoundRevealableAt(contentId, roundId, commit.targetRound);
        uint256 thresholdBlock = roundThresholdReachedBlock[contentId][roundId];
        bool countForSettlement = thresholdBlock == 0;
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
                minVoters: _rbtsRevealQuorum(roundCfg.minVoters),
                targetRoundRevealableAt: targetRoundRevealableAt,
                drandChainHash: _getRoundDrandChainHash(contentId, roundId),
                countForSettlement: countForSettlement
            })
        );
        roundStakeWithEligibleFrontend[contentId][roundId] = eligibleFrontendStake;
        roundEligibleFrontendCount[contentId][roundId] = eligibleFrontendCount;
        if (thresholdBlock == 0 && round.thresholdReachedAt != 0) {
            roundThresholdReachedBlock[contentId][roundId] = block.number;
            RoundRevealLib.captureRbtsSeed(roundRbtsSeedEntropy, contentId, roundId);
        }
        commitPredictedUpBps[contentId][roundId][commitKey] = predictedUpBps;
        // L-Vote-B / H-Vote-1: settlement pools and RBTS scoring use the same cutoff for all
        // post-quorum reveals. The delayed RBTS seed makes settlement impossible in the
        // quorum-closing block, so later-block reveals must be stake-return-only as well.
        if (countForSettlement) {
            commitRbtsWeight[contentId][roundId][commitKey] = effectiveStake;
        }
        // L-Vote-A: keep evidence accumulation checked so a future governance proposal that
        // raises `maxVoters` past ~9.2e12 cannot silently truncate the uint64 counter. The
        // current bound is well below that, but the `unchecked` block was a bytecode-trim
        // micro-optimization that traded a real (if remote) safety guarantee for a few hundred
        // gas. Restore the default checked arithmetic here.
        if (countForSettlement) {
            if (isUp) {
                roundRatingUpEvidence[contentId][roundId] += ratingEvidenceWeight;
            } else {
                roundRatingDownEvidence[contentId][roundId] += ratingEvidenceWeight;
            }
        }

        emit VoteRevealed(contentId, roundId, voter, isUp);
        emit RbtsVoteRevealed(contentId, roundId, voter, isUp, predictedUpBps, effectiveStake);
    }

    // =========================================================================
    // VIEW FUNCTIONS
    // =========================================================================

    function _rbtsRevealQuorum(uint16 minVoters) internal pure returns (uint16) {
        return minVoters < MIN_RBTS_PARTICIPANTS ? MIN_RBTS_PARTICIPANTS : minVoters;
    }

    // Note: computeCurrentEpochEnd removed to fit size limit.
    // Use config().epochDuration plus rounds(contentId, roundId).startTime to compute off-chain.
    // previewCommitRoundId / previewCommitReferenceRatingBps are public above (their internal
    // wrappers were merged into the externals to fit the EIP-170 size limit).

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
            uint48 settledAt
        )
    {
        RoundLib.Round storage round = rounds[contentId][roundId];
        return (
            round.startTime,
            round.state,
            round.voteCount,
            round.revealedCount,
            round.totalStake,
            round.thresholdReachedAt,
            round.settledAt
        );
    }

    function roundDrandConfig(uint256 contentId, uint256 roundId)
        external
        view
        returns (bytes32 chainHash, uint64 genesisTime, uint64 period)
    {
        return (
            roundDrandChainHashSnapshot[contentId][roundId],
            roundDrandGenesisTimeSnapshot[contentId][roundId],
            roundDrandPeriodSnapshot[contentId][roundId]
        );
    }

    function targetRoundRevealableTimestamp(uint256 contentId, uint256 roundId, uint64 targetRound)
        external
        view
        returns (uint256)
    {
        return _targetRoundRevealableAt(contentId, roundId, targetRound);
    }

    function roundReferenceRatingBpsForRound(uint256 contentId, uint256 roundId) external view returns (uint16) {
        return _getRoundReferenceRatingBps(contentId, roundId);
    }

    function voterLastVoteTimestamp(uint256 contentId, address voter) external view returns (uint256) {
        return lastVoteTimestamp[contentId][voter];
    }

    function identityLastVoteTimestamp(uint256 contentId, bytes32 identityKey) external view returns (uint256) {
        return lastVoteTimestampByIdentity[contentId][identityKey];
    }

    function commitRbtsScoringWeight(uint256 contentId, uint256 roundId, bytes32 commitKey)
        external
        view
        returns (uint256)
    {
        return commitRbtsWeight[contentId][roundId][commitKey];
    }

    function activeRoundId(uint256 contentId) external view returns (uint256) {
        uint256 roundId = currentRoundId[contentId];
        if (roundId == 0) return 0;
        RoundLib.Round storage round = rounds[contentId][roundId];
        if (round.state != RoundLib.RoundState.Open || _isEmptyRoundStaleSinceActivity(contentId, round)) return 0;
        return roundId;
    }

    function isDormancyBlocked(uint256 contentId) external view returns (bool) {
        uint256 roundId = currentRoundId[contentId];
        if (roundId == 0) return false;

        RoundLib.Round storage round = rounds[contentId][roundId];
        if (round.state != RoundLib.RoundState.Open || round.voteCount == 0 || round.totalStake == 0) return false;
        if (_isEmptyRoundStaleSinceActivity(contentId, round)) return false;

        RoundLib.RoundConfig memory roundCfg = _getRoundConfig(contentId, roundId);
        uint16 rbtsRevealQuorum = _rbtsRevealQuorum(roundCfg.minVoters);
        if (round.revealedCount >= rbtsRevealQuorum) return true;
        if (round.voteCount < rbtsRevealQuorum) return false;
        if (!roundHasHumanVerifiedCommit[contentId][roundId]) return false;
        if (_canCancelExpiredRound(contentId, roundId, round, roundCfg)) return false;
        return true;
    }

    // --- Admin ---

    function pause() external onlyRole(PAUSER_ROLE) {
        _pause();
    }

    function unpause() external onlyRole(PAUSER_ROLE) {
        _unpause();
    }

    // =========================================================================
    // STORAGE
    // =========================================================================

    // Per-identity cooldown: contentId => identity key => timestamp (survives delegation)
    mapping(uint256 => mapping(bytes32 => uint256)) internal lastVoteTimestampByIdentity;

    // Per-epoch unrevealed commit counter: prevents selective vote revelation (front-running keeper).
    // contentId => roundId => epochEnd => number of unrevealed commits for that epoch.
    mapping(uint256 => mapping(uint256 => mapping(uint256 => uint256))) internal epochUnrevealedCount;

    // Per-round reveal grace period snapshot for governance consistency across open rounds.
    mapping(uint256 => mapping(uint256 => uint256)) public roundRevealGracePeriodSnapshot;

    // Per-round drand config snapshot so reveal timing stays stable across governance updates.
    mapping(uint256 => mapping(uint256 => bytes32)) internal roundDrandChainHashSnapshot;
    mapping(uint256 => mapping(uint256 => uint64)) internal roundDrandGenesisTimeSnapshot;
    mapping(uint256 => mapping(uint256 => uint64)) internal roundDrandPeriodSnapshot;

    // Latest effective revealable timestamp among all commits in a round, including drand target delay.
    mapping(uint256 => mapping(uint256 => uint256)) public lastCommitRevealableAfter;

    // Commit-time frontend eligibility snapshot to prevent retroactive fee eligibility changes.
    mapping(uint256 => mapping(uint256 => mapping(bytes32 => bool))) public frontendEligibleAtCommit;

    // Frontend registry snapshot per round so historical fee claims do not depend on live registry replacement.
    mapping(uint256 => mapping(uint256 => address)) public roundFrontendRegistrySnapshot;

    // Settled rounds with expired unrevealed votes must be cleaned before reward claims.
    mapping(uint256 => mapping(uint256 => uint256)) public roundUnrevealedCleanupRemaining;

    // Cumulative cleanup incentive paid per round.
    mapping(uint256 => mapping(uint256 => uint256)) internal roundCleanupIncentivePaid;

    // Bounded binary signal evidence used for public rating movement. Reward and payout
    // accounting continue to use stake-weighted RBTS weights.
    mapping(uint256 => mapping(uint256 => uint64)) public roundRatingUpEvidence;
    mapping(uint256 => mapping(uint256 => uint64)) public roundRatingDownEvidence;

    // Commit timestamp used for bounty eligibility.
    mapping(uint256 => mapping(uint256 => mapping(bytes32 => uint48))) public commitCommittedAt;

    /// @notice Tracks bundle-observer terminal notifications that reverted on the escrow side.
    /// @dev Set true by `_notifyBundleRoundTerminal` on revert; cleared by
    ///      `replayBundleObserverNotify` (or by a subsequent successful notification).
    ///      Indexed by (contentId, roundId).
    mapping(uint256 contentId => mapping(uint256 roundId => bool)) public pendingBundleObserverReplay;

    // True if at least one commit in this round originated from an address with an active human
    // credential. `cancelExpiredRound` requires this flag before the min-RBTS-quorum cancel-lockout
    // engages -- attacker-only rounds (all non-HRC sybils) remain refund-cancellable so they
    // cannot grief honest content into a RevealFailed cycle.
    mapping(uint256 => mapping(uint256 => bool)) public roundHasHumanVerifiedCommit;

    // Entropy captured when reveal quorum first closes the commit set; RBTS settlement uses this
    // stored value so the settlement caller cannot grind the sampler by reverting unfavorable runs.
    mapping(uint256 => mapping(uint256 => bytes32)) public roundRbtsSeedEntropy;

    /// @notice Timestamp when a settled round's payout source became fully auditable.
    /// @dev For rounds without stale unrevealed votes this equals `settledAt`; otherwise it is
    ///      set when the cleanup queue reaches zero. Oracle consumers reject roots proposed
    ///      before this timestamp so the optimistic challenge window only runs on complete data.
    ///      I-Crosscutting-A: this slot was swapped in-place from `roundDeferredCleanupBounty`
    ///      (triple mapping → uint48) when the deferred-cleanup bounty was removed in commit
    ///      `38dae9e6`. Fresh deployments are unaffected; any future upgrade from a baseline
    ///      that populated the old surface must run `validateUpgrade` first and treat this slot
    ///      as freshly initialized. The annotation marks the in-place swap so OZ Upgrades tools
    ///      do not flag the storage layout change.
    /// @custom:oz-renamed-from roundDeferredCleanupBounty
    mapping(uint256 contentId => mapping(uint256 roundId => uint48)) public roundClusterPayoutReadyAt;

    /// @dev Deprecated pre-deploy seed-refresh counter slot. Kept reserved so storage-layout
    ///      snapshots do not shift if this code is compared to earlier local builds.
    mapping(uint256 contentId => mapping(uint256 roundId => uint8)) internal _roundRbtsSeedRefreshCount;

    /// @notice L-Cleanup-1: accumulated LREP that `processUnrevealedVotes` tried to send to
    ///         treasury but couldn't (treasury unset or transfer reverted). Permissionless
    ///         `flushPendingTreasuryForfeit` retries the transfer; until then the amount stays
    ///         in `accountedLrepBalance` so it isn't classified as recoverable surplus.
    uint256 internal _pendingTreasuryForfeitLrep;

    // --- Storage gap reserved for future upgrades ---
    uint256[20] private __gap;
}
