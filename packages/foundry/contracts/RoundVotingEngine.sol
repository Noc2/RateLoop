// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

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
import { RoundRevealLib } from "./libraries/RoundRevealLib.sol";
import { VotePreflightLib } from "./libraries/VotePreflightLib.sol";
import { IFrontendRegistry } from "./interfaces/IFrontendRegistry.sol";
import { ICategoryRegistry } from "./interfaces/ICategoryRegistry.sol";
import { IRaterIdentityRegistry } from "./interfaces/IRaterIdentityRegistry.sol";
import { IRoundVotingEngine } from "./interfaces/IRoundVotingEngine.sol";
import { IParticipationPool } from "./interfaces/IParticipationPool.sol";
import { IAdvisoryVoteRecorder } from "./interfaces/IAdvisoryVoteRecorder.sol";

interface IQuestionBundleRoundObserver {
    function recordBundleQuestionTerminal(uint256 contentId, uint256 roundId, bool settled) external;
}

/// @title RoundVotingEngine
/// @notice Per-content round-based parimutuel voting with keeper-assisted/self-reveal and epoch-weighted rewards.
/// @dev Flow: commitVote (stores ciphertext bytes, drand metadata, and commit hash) → epoch ends → revealVote
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
    error DormancyWindowElapsed();
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
    error NothingToClaim();
    error ReserveEmpty();

    // --- Access Control Roles ---
    bytes32 internal constant PAUSER_ROLE = keccak256("PAUSER_ROLE");

    // --- Constants ---
    uint256 internal constant MIN_STAKE = 1e6; // 1 LREP; zero-LREP ratings use AdvisoryVoteRecorder
    uint256 internal constant MAX_STAKE = 10e6; // 10 LREP (6 decimals)
    uint256 internal constant VOTE_COOLDOWN = 24 hours; // Time-based cooldown per content per voter
    uint256 internal constant MAX_CIPHERTEXT_SIZE = 2_048; // 2 KB max ciphertext to prevent storage bloat
    uint16 internal constant MIN_RBTS_PARTICIPANTS = 3;
    uint16 internal constant RBTS_SCORE_SCALE_BPS = 10_000;

    // --- State ---
    IERC20 internal lrepToken;
    ContentRegistry internal registry;
    ProtocolConfig public protocolConfig;

    // Round data: contentId => roundId => Round
    mapping(uint256 => mapping(uint256 => RoundLib.Round)) public rounds;

    // Per-content round tracking
    mapping(uint256 => uint256) public currentRoundId; // contentId => active round ID (0 = none)
    mapping(uint256 => uint256) internal nextRoundId; // contentId => next round ID to create

    // Commits: contentId => roundId => commitKey => Commit
    mapping(uint256 => mapping(uint256 => mapping(bytes32 => RoundLib.Commit))) internal commits;

    // Track commit keys per round for iteration (reveal/settlement)
    mapping(uint256 => mapping(uint256 => bytes32[])) internal roundCommitHashes;

    // Time-based cooldown: contentId => voter => timestamp of last vote
    mapping(uint256 => mapping(address => uint256)) internal lastVoteTimestamp;

    // Reward accounting per round
    mapping(uint256 => mapping(uint256 => uint256)) public roundVoterPool; // contentId => roundId => voter pool
    mapping(uint256 => mapping(uint256 => uint256)) public roundWinningStake; // contentId => roundId => epoch-weighted winning stake

    // Robust BTS reward accounting per round.
    mapping(uint256 => mapping(uint256 => bool)) public roundRbtsScored;
    mapping(uint256 => mapping(uint256 => uint256)) public roundRbtsRewardWeight;
    mapping(uint256 => mapping(uint256 => uint256)) public roundRbtsRewardClaimants;
    mapping(uint256 => mapping(uint256 => uint256)) public roundRbtsParticipationWeight;
    mapping(uint256 => mapping(uint256 => uint256)) public roundRbtsParticipationClaimants;
    mapping(uint256 => mapping(uint256 => uint256)) public roundRbtsForfeitedPool;
    mapping(uint256 => mapping(uint256 => uint256)) public roundRbtsForfeitClaimants;
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

    // Sybil resistance
    // Consensus subsidy reserve: pre-funded + replenished by 5% of each losing pool.
    // Pays out on unanimous rounds (losingPool == 0) to incentivize voting on obvious content.
    uint256 public consensusReserve;
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
    mapping(uint256 => mapping(uint256 => mapping(bytes32 => uint256))) public identityRoundStake;

    // Frontend fee aggregation (computed incrementally during revealVote for O(1) settlement)
    mapping(uint256 => mapping(uint256 => uint256)) public roundStakeWithEligibleFrontend;
    mapping(uint256 => mapping(uint256 => mapping(address => uint256))) public roundPerFrontendStake;
    mapping(uint256 => mapping(uint256 => uint256)) public roundFrontendPool;
    mapping(uint256 => mapping(uint256 => uint256)) public roundEligibleFrontendCount;
    mapping(uint256 => mapping(uint256 => address)) public roundRaterRegistrySnapshot;

    // --- Events ---
    event VoteCommitted(
        uint256 indexed contentId,
        uint256 indexed roundId,
        address indexed voter,
        bytes32 commitHash,
        uint16 roundReferenceRatingBps,
        uint64 targetRound,
        bytes32 drandChainHash,
        uint256 stake
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
        uint256 forfeitClaimants
    );
    event RbtsSeedCaptured(uint256 indexed contentId, uint256 indexed roundId, bytes32 entropy);
    event RoundSettled(uint256 indexed contentId, uint256 indexed roundId, bool upWins, uint256 losingPool);
    event RoundCancelled(uint256 indexed contentId, uint256 indexed roundId);
    event RoundTied(uint256 indexed contentId, uint256 indexed roundId);
    event RoundRevealFailed(uint256 indexed contentId, uint256 indexed roundId);
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
    event UnrevealedStakeAddedToConsensusReserve(uint256 indexed contentId, uint256 indexed roundId, uint256 amount);
    /// @notice Emitted when the treasury transfer branch of `processUnrevealedVotes` falls
    ///         back to the consensus reserve -- either because the treasury address is
    ///         unset or because the transfer reverted. Gives indexers a distinct signal
    ///         from the settled-round replenishment path (`UnrevealedStakeAddedToConsensusReserve`).
    event ForfeitedFundsFallbackToConsensusReserve(uint256 indexed contentId, uint256 indexed roundId, uint256 amount);
    event DeferredCleanupBountyAccrued(
        uint256 indexed contentId, uint256 indexed roundId, address indexed recipient, uint256 amount
    );
    event DeferredCleanupBountyClaimed(
        uint256 indexed contentId,
        uint256 indexed roundId,
        address indexed recipient,
        uint256 paidAmount,
        uint256 remaining
    );
    event CurrentEpochRefunded(uint256 indexed contentId, uint256 indexed roundId, uint256 amount);
    event TreasuryFeeDistributed(uint256 indexed contentId, uint256 indexed roundId, uint256 amount);
    event ConsensusReserveFunded(uint256 indexed contentId, uint256 indexed roundId, uint256 amount);
    event ConsensusReserveToppedUp(address indexed funder, uint256 amount);
    event ConsensusSubsidyDistributed(uint256 indexed contentId, uint256 indexed roundId, uint256 amount);

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

    /// @notice Add LREP to the consensus reserve.
    /// @dev Permissionless by design — treasury top-ups and slashed-stake routing both use this same path.
    function addToConsensusReserve(uint256 amount) external {
        if (amount == 0) revert InvalidStake();
        lrepToken.safeTransferFrom(msg.sender, address(this), amount);
        accountedLrepBalance += amount;
        consensusReserve += amount;
        emit ConsensusReserveToppedUp(msg.sender, amount);
    }

    /// @notice Drain a previously-deferred refund-only cleanup bounty owed to `msg.sender`.
    /// @dev When `processUnrevealedVotes` runs against a refund-eligible batch with the
    ///      consensus reserve below the keeper bounty, the unpaid sliver is deferred per
    ///      (round, keeper) instead of being silently discarded -- the processed commits have
    ///      already had their stake zeroed, so a later `processUnrevealedVotes` over the same
    ///      range cannot recompute the incentive. This function lets the original keeper
    ///      collect the IOU once `addToConsensusReserve` has topped the reserve up. Pays the
    ///      lesser of the pending IOU and the current reserve; the remainder stays claimable.
    function claimDeferredCleanupBounty(uint256 contentId, uint256 roundId)
        external
        nonReentrant
        returns (uint256 paidAmount)
    {
        uint256 pending = roundDeferredCleanupBounty[contentId][roundId][msg.sender];
        if (pending == 0) revert NothingToClaim();
        uint256 reserve = consensusReserve;
        if (reserve == 0) revert ReserveEmpty();

        paidAmount = pending > reserve ? reserve : pending;
        uint256 remaining = pending - paidAmount;
        roundDeferredCleanupBounty[contentId][roundId][msg.sender] = remaining;
        consensusReserve = reserve - paidAmount;
        accountedLrepBalance -= paidAmount;
        lrepToken.safeTransfer(msg.sender, paidAmount);

        emit DeferredCleanupBountyClaimed(contentId, roundId, msg.sender, paidAmount, remaining);
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
        if (lrepAmount > 0) {
            accountedLrepBalance -= lrepAmount;
            lrepToken.safeTransfer(recipient, lrepAmount);
        }
    }

    // =========================================================================
    // COMMIT PHASE
    // =========================================================================

    /// @notice Narrow view of a commit that omits `ciphertext`, `targetRound`, and
    ///         `drandChainHash`. Used by off-chain iterators and by the reward distributor's
    ///         dust-finalization paths, which read many commits in a single call and would
    ///         otherwise pay ~2 KB of memory expansion per commit for the full public getter.
    /// @dev Returned fields mirror RoundLib.Commit but skip the blob data.
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
        RoundLib.Commit storage c = commits[contentId][roundId][commitKey];
        return (c.voter, c.stakeAmount, c.frontend, c.revealableAfter, c.revealed, c.isUp, c.epochIndex);
    }

    /// @notice Reveal/decryption data for keeper and manual reveal flows.
    /// @dev Keeps the full `commits` storage mapping internal so deployed bytecode does not
    ///      include Solidity's large auto-getter for the full struct.
    function commitRevealData(uint256 contentId, uint256 roundId, bytes32 commitKey)
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
        RoundLib.Commit storage c = commits[contentId][roundId][commitKey];
        return (c.ciphertext, c.targetRound, c.drandChainHash, c.revealableAfter, c.revealed, c.stakeAmount);
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

    /// @notice Commit a blind vote using an ERC-2612 permit for the stake allowance.
    /// @dev This gives wallets without atomic batching a one-transaction counted-vote path.
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
        VotePreflightLib.permitStake(
            address(lrepToken), msg.sender, address(this), stakeAmount, permitDeadline, v, r, s
        );
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
        bytes memory ciphertext,
        uint256 stakeAmount,
        address frontend
    ) internal {
        if (stakeAmount < MIN_STAKE || stakeAmount > MAX_STAKE) revert InvalidStake();
        if (commitHash == bytes32(0)) revert InvalidCommitHash();

        uint64 stakeAmount64 = stakeAmount.toUint64();

        // Get or create active round
        uint256 currentOpenRoundId = currentRoundId[contentId];
        if (currentOpenRoundId == 0 || RoundLib.isTerminal(rounds[contentId][currentOpenRoundId])) {
            if (registry.isDormancyEligible(contentId)) revert DormancyWindowElapsed();
        } else {
            RoundLib.Round storage currentRound = rounds[contentId][currentOpenRoundId];
            // If this commit would auto-finalize the stale open round and roll into a fresh round,
            // finalize it first so the registry can observe that no open round remains.
            RoundLib.RoundConfig memory currentRoundCfg = _getRoundConfig(contentId, currentOpenRoundId);
            if (_canCancelExpiredRound(contentId, currentOpenRoundId, currentRound, currentRoundCfg)) {
                _markRoundCancelled(contentId, currentOpenRoundId, currentRound);
                if (registry.isDormancyEligible(contentId)) revert DormancyWindowElapsed();
            } else if (_canFinalizeRevealFailedRound(contentId, currentOpenRoundId, currentRound)) {
                _markRoundRevealFailed(contentId, currentOpenRoundId, currentRound);
                if (registry.isDormancyEligible(contentId)) revert DormancyWindowElapsed();
            }
        }

        uint256 roundId = _getOrCreateRound(contentId);
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
        _validateNoAdvisoryConflict(contentId, roundId, voter, resolved.identityKey);

        bytes32 commitKey = VotePreflightLib.prepareCommit(
            voterCommitHash,
            identityCommitKey,
            lastVoteTimestamp,
            lastVoteTimestampByIdentity,
            identityRoundStake,
            VotePreflightLib.CommitPreflightParams({
                voter: voter,
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
        // Transfer LREP stake after all lightweight validation passes.
        lrepToken.safeTransferFrom(voter, address(this), stakeAmount);
        accountedLrepBalance += stakeAmount;

        _storeCommittedVote(
            contentId,
            roundId,
            commitKey,
            voter,
            stakeAmount64,
            ciphertext,
            frontend,
            epochEnd,
            targetRound,
            drandChainHash,
            epochIdx,
            commitHash,
            resolved.identityKey,
            resolved.holder
        );
        _recordCommitAccounting(round, contentId, roundId, voter, resolved.identityKey, stakeAmount64, stakeAmount);
        // Flag whether at least one commit in this round originated from an HRC-verified identity.
        // `cancelExpiredRound` consults this flag to keep all-sybil rounds refund-cancellable.
        if (resolved.hasActiveHumanCredential && !roundHasHumanVerifiedCommit[contentId][roundId]) {
            roundHasHumanVerifiedCommit[contentId][roundId] = true;
        }

        emit VoteCommitted(
            contentId, roundId, voter, commitHash, expectedReferenceRatingBps, targetRound, drandChainHash, stakeAmount
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
        bytes memory ciphertext,
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
        bytes memory ciphertext,
        address frontend,
        uint256 epochEnd,
        uint64 targetRound,
        bytes32 drandChainHash,
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
            ciphertext,
            frontend,
            epochEnd,
            targetRound,
            drandChainHash,
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
        bytes memory ciphertext,
        address frontend,
        uint256 epochEnd,
        uint64 targetRound,
        bytes32 drandChainHash,
        uint8 epochIdx
    ) internal {
        commits[contentId][roundId][commitKey] = RoundLib.Commit({
            voter: voter,
            stakeAmount: stakeAmount64,
            ciphertext: ciphertext,
            frontend: frontend,
            revealableAfter: epochEnd.toUint48(),
            targetRound: targetRound,
            drandChainHash: drandChainHash,
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
            commitKey,
            identityKey,
            identityHolder
        );
    }

    function _recordCommitAccounting(
        RoundLib.Round storage round,
        uint256 contentId,
        uint256 roundId,
        address voter,
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
            identityKey,
            stakeAmount64,
            stakeAmount
        );
    }

    /// @dev Get or create the active round for a content item.
    function _getOrCreateRound(uint256 contentId) internal returns (uint256) {
        uint256 roundId = currentRoundId[contentId];

        // If there's an active round, use it
        if (roundId > 0) {
            RoundLib.Round storage existingRound = rounds[contentId][roundId];
            if (existingRound.state == RoundLib.RoundState.Open) {
                RoundLib.RoundConfig memory activeRoundCfg = _getRoundConfig(contentId, roundId);
                if (_canCancelExpiredRound(contentId, roundId, existingRound, activeRoundCfg)) {
                    _markRoundCancelled(contentId, roundId, existingRound);
                } else if (_canFinalizeRevealFailedRound(contentId, roundId, existingRound)) {
                    _markRoundRevealFailed(contentId, roundId, existingRound);
                }
            }
            if (!RoundLib.isTerminal(existingRound)) {
                return roundId;
            }
        }

        // Create a new round
        nextRoundId[contentId]++;
        roundId = nextRoundId[contentId];
        currentRoundId[contentId] = roundId;

        rounds[contentId][roundId].startTime = block.timestamp.toUint48();
        rounds[contentId][roundId].state = RoundLib.RoundState.Open;

        // Snapshot config at round creation to prevent mid-round governance or question edits from changing semantics.
        RoundLib.RoundConfig memory roundCfg = registry.getContentRoundConfig(contentId);
        roundConfigSnapshot[contentId][roundId] = roundCfg;
        roundRatingConfigSnapshot[contentId][roundId] = _currentRatingConfig();
        roundReferenceRatingBpsSnapshot[contentId][roundId] = registry.getRating(contentId);
        roundRevealGracePeriodSnapshot[contentId][roundId] = protocolConfig.revealGracePeriod();
        roundDrandChainHashSnapshot[contentId][roundId] = protocolConfig.drandChainHash();
        roundDrandGenesisTimeSnapshot[contentId][roundId] = protocolConfig.drandGenesisTime();
        roundDrandPeriodSnapshot[contentId][roundId] = protocolConfig.drandPeriod();
        roundRaterRegistrySnapshot[contentId][roundId] = protocolConfig.raterRegistry();
        roundFrontendRegistrySnapshot[contentId][roundId] = protocolConfig.frontendRegistry();
        emit RoundConfigSnapshotted(
            contentId, roundId, roundCfg.epochDuration, roundCfg.maxDuration, roundCfg.minVoters, roundCfg.maxVoters
        );
        emit RoundReferenceSnapshotted(contentId, roundId, roundReferenceRatingBpsSnapshot[contentId][roundId]);

        return roundId;
    }

    function _markRoundRevealFailed(uint256 contentId, uint256 roundId, RoundLib.Round storage round) internal {
        round.state = RoundLib.RoundState.RevealFailed;
        round.settledAt = block.timestamp.toUint48();
        roundUnrevealedCleanupRemaining[contentId][roundId] = round.voteCount - round.revealedCount;
        _notifyBundleRoundTerminal(contentId, roundId, false);
        emit RoundRevealFailed(contentId, roundId);
    }

    function _markRoundCancelled(uint256 contentId, uint256 roundId, RoundLib.Round storage round) internal {
        round.state = RoundLib.RoundState.Cancelled;
        _notifyBundleRoundTerminal(contentId, roundId, false);
        emit RoundCancelled(contentId, roundId);
    }

    function _notifyBundleRoundTerminal(uint256 contentId, uint256 roundId, bool settled) internal {
        address bundleEscrow = registry.questionRewardPoolEscrow();
        if (bundleEscrow == address(0)) return;

        try IQuestionBundleRoundObserver(bundleEscrow).recordBundleQuestionTerminal(contentId, roundId, settled) {
            // Idempotent: clearing here keeps the replay flag honest in the (currently
            // unreachable) case where a prior failure flagged the round before this call
            // succeeded via a later code path.
            if (pendingBundleObserverReplay[contentId][roundId]) {
                delete pendingBundleObserverReplay[contentId][roundId];
            }
        } catch (bytes memory lowLevelError) {
            // Capture the failure so off-chain observers and on-chain replay can detect and
            // recover. The terminal-state transition on the engine has already happened, so
            // reverting here would brick settlement; recording is the only sound option.
            pendingBundleObserverReplay[contentId][roundId] = true;
            emit BundleObserverNotifyFailed(contentId, roundId, settled, lowLevelError);
        }
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
        require(pendingBundleObserverReplay[contentId][roundId], "no pending replay");
        address bundleEscrow = registry.questionRewardPoolEscrow();
        if (bundleEscrow == address(0)) return false;
        // Derive `settled` from the engine's authoritative round state rather than accepting
        // it from the admin caller, so a replay can never desync the escrow's bundle
        // accounting from the engine's view of the round (I-Vote-3, audit 2026-05-17).
        settled = rounds[contentId][roundId].state == RoundLib.RoundState.Settled;
        IQuestionBundleRoundObserver(bundleEscrow).recordBundleQuestionTerminal(contentId, roundId, settled);
        delete pendingBundleObserverReplay[contentId][roundId];
        emit BundleObserverNotifyReplayed(contentId, roundId, settled);
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

        uint256 weightedWinningStake;
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

        (weightedWinningStake, rbtsForfeitedPool, scoreSeed) =
            _scoreRbtsRewards(contentId, roundId, round.revealedCount, upWins);
        roundRbtsScored[contentId][roundId] = true;

        round.upWins = upWins;
        round.state = RoundLib.RoundState.Settled;
        round.settledAt = block.timestamp.toUint48();
        _notifyBundleRoundTerminal(contentId, roundId, true);

        (uint256 updatedConsensusReserve, uint256 treasuryPaid) = RoundSettlementDistributionLib.distribute(
            lrepToken,
            protocolConfig,
            round,
            roundVoterPool,
            roundWinningStake,
            roundStakeWithEligibleFrontend,
            roundFrontendPool,
            roundFrontendRegistrySnapshot,
            consensusReserve,
            contentId,
            roundId,
            weightedWinningStake,
            rbtsForfeitedPool,
            binaryLosingPool == 0 && round.revealedCount == round.voteCount
        );
        consensusReserve = updatedConsensusReserve;
        if (treasuryPaid > 0) {
            accountedLrepBalance -= treasuryPaid;
        }

        IParticipationPool currentParticipationPool = _getParticipationPool();
        address currentRewardDistributor = protocolConfig.rewardDistributorForVotingEngine(address(this));
        RoundSettlementSideEffectsLib.recordSettlement(
            registry,
            _getRoundRatingConfig(contentId, roundId),
            currentParticipationPool,
            currentRewardDistributor,
            contentId,
            roundId,
            _getRoundReferenceRatingBps(contentId, roundId),
            roundRbtsParticipationWeight[contentId][roundId],
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
            roundRbtsForfeitClaimants[contentId][roundId]
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
    /// @dev For settled rounds: unrevealed votes from past epochs are credited to the consensus reserve.
    ///      For tied rounds: unrevealed votes from past epochs are forfeited to treasury.
    ///      Current/future-epoch votes at settlement/tie time are refunded because they had no chance.
    ///      For reveal-failed rounds: all unrevealed votes are forfeited because the final reveal grace has passed.
    function processUnrevealedVotes(uint256 contentId, uint256 roundId, uint256 startIndex, uint256 count)
        external
        nonReentrant
    {
        RoundLib.Round storage round = rounds[contentId][roundId];

        if (
            round.state != RoundLib.RoundState.Settled && round.state != RoundLib.RoundState.Tied
                && round.state != RoundLib.RoundState.RevealFailed
        ) {
            revert RoundNotSettledOrTied();
        }

        bytes32[] storage commitKeys = roundCommitHashes[contentId][roundId];
        uint256 len = commitKeys.length;
        if (startIndex >= len) revert IndexOutOfBounds();

        (
            uint256 forfeitedToTreasury,
            uint256 addedToConsensusReserve,
            uint256 refundedLrep,
            uint256 processedPastEpochCount,
            uint256 cleanupIncentive,
            uint256 updatedConsensusReserve,
            uint256 deferredCleanupBounty
        ) = RoundCleanupLib.processUnrevealedVotes(
            round,
            commitKeys,
            commits[contentId][roundId],
            roundCleanupIncentivePaid,
            contentId,
            roundId,
            lrepToken,
            protocolConfig,
            consensusReserve,
            msg.sender,
            startIndex,
            count
        );

        uint256 previousConsensusReserve = consensusReserve;
        if (updatedConsensusReserve != previousConsensusReserve) {
            consensusReserve = updatedConsensusReserve;
        }
        uint256 paidOut = refundedLrep + cleanupIncentive;
        if (forfeitedToTreasury > 0 && updatedConsensusReserve == previousConsensusReserve + addedToConsensusReserve) {
            paidOut += forfeitedToTreasury;
        }
        if (paidOut > 0) {
            accountedLrepBalance -= paidOut;
        }

        if (forfeitedToTreasury > 0) {
            if (updatedConsensusReserve == previousConsensusReserve + addedToConsensusReserve) {
                emit ForfeitedFundsAddedToTreasury(contentId, roundId, forfeitedToTreasury);
            } else {
                // Treasury transfer failed or treasury was unset; the cleanup lib added
                // `forfeitedToTreasury` to the consensus reserve instead. Emit a dedicated
                // event so indexers can distinguish this fallback from the regular
                // UnrevealedStakeAddedToConsensusReserve path.
                emit ForfeitedFundsFallbackToConsensusReserve(contentId, roundId, forfeitedToTreasury);
            }
        }

        if (addedToConsensusReserve > 0) {
            emit UnrevealedStakeAddedToConsensusReserve(contentId, roundId, addedToConsensusReserve);
        }

        if (deferredCleanupBounty > 0) {
            // Refund-only batch where the consensus reserve could not cover the keeper bounty
            // in full. Record the IOU; keeper drains via `claimDeferredCleanupBounty` once the
            // reserve has been topped up. No accountedLrepBalance change here -- the LREP has
            // not left the contract yet.
            roundDeferredCleanupBounty[contentId][roundId][msg.sender] += deferredCleanupBounty;
            emit DeferredCleanupBountyAccrued(contentId, roundId, msg.sender, deferredCleanupBounty);
        }

        if (processedPastEpochCount > 0) {
            uint256 remaining = roundUnrevealedCleanupRemaining[contentId][roundId];
            if (remaining > 0) {
                roundUnrevealedCleanupRemaining[contentId][roundId] =
                    processedPastEpochCount >= remaining ? 0 : remaining - processedPastEpochCount;
            }
        }

        if (refundedLrep > 0) {
            emit CurrentEpochRefunded(contentId, roundId, refundedLrep);
        }
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
        uint16 referenceRatingBps = roundReferenceRatingBpsSnapshot[contentId][roundId];
        if (referenceRatingBps == 0) {
            return registry.getRating(contentId);
        }
        return referenceRatingBps;
    }

    function previewCommitReferenceRatingBps(uint256 contentId) public view returns (uint16) {
        uint256 openRoundId = previewCommitRoundId(contentId);
        if (openRoundId == nextRoundId[contentId] + 1) {
            return registry.getRating(contentId);
        }

        return _getRoundReferenceRatingBps(contentId, openRoundId);
    }

    function previewCommitRoundId(uint256 contentId) public view returns (uint256) {
        uint256 openRoundId = currentRoundId[contentId];
        if (openRoundId != 0) {
            RoundLib.Round storage round = rounds[contentId][openRoundId];
            RoundLib.RoundConfig memory roundCfg = _getRoundConfig(contentId, openRoundId);
            if (
                !RoundLib.isTerminal(round) && !_canCancelExpiredRound(contentId, openRoundId, round, roundCfg)
                    && !_canFinalizeRevealFailedRound(contentId, openRoundId, round)
            ) {
                return openRoundId;
            }
        }

        return nextRoundId[contentId] + 1;
    }

    function _getCategoryRegistry() internal view returns (ICategoryRegistry) {
        return ICategoryRegistry(protocolConfig.categoryRegistry());
    }

    function _getRoundRaterRegistry(uint256 contentId, uint256 roundId) internal view returns (IRaterIdentityRegistry) {
        address snapshot = roundRaterRegistrySnapshot[contentId][roundId];
        if (snapshot == address(0)) {
            snapshot = protocolConfig.raterRegistry();
        }
        return IRaterIdentityRegistry(snapshot);
    }

    function _getParticipationPool() internal view returns (IParticipationPool) {
        return IParticipationPool(protocolConfig.participationPool());
    }

    function _validateNoAdvisoryConflict(uint256 contentId, uint256 roundId, address voter, bytes32 identityKey)
        internal
        view
    {
        address advisoryRecorder = protocolConfig.advisoryVoteRecorder();
        if (advisoryRecorder == address(0)) return;

        IAdvisoryVoteRecorder recorder = IAdvisoryVoteRecorder(advisoryRecorder);
        if (recorder.advisoryCommitKeyByRater(contentId, roundId, voter) != bytes32(0)) {
            revert AlreadyCommitted();
        }

        uint256 lastAdvisoryVote = recorder.lastAdvisoryVoteTimestamp(contentId, voter);
        if (identityKey != bytes32(0)) {
            if (recorder.advisoryCommitKeyByIdentity(contentId, roundId, identityKey) != bytes32(0)) {
                revert AlreadyCommitted();
            }

            uint256 lastIdentityAdvisoryVote = recorder.lastAdvisoryVoteTimestampByIdentity(contentId, identityKey);
            if (lastIdentityAdvisoryVote > lastAdvisoryVote) {
                lastAdvisoryVote = lastIdentityAdvisoryVote;
            }
        }

        if (lastAdvisoryVote > 0 && block.timestamp < lastAdvisoryVote + VOTE_COOLDOWN) {
            revert CooldownActive();
        }
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
            _getRoundRaterRegistry(contentId, roundId),
            account
        );
    }

    function _canFinalizeRevealFailedRound(uint256 contentId, uint256 roundId, RoundLib.Round storage round)
        internal
        view
        returns (bool)
    {
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
        return
            round.voteCount < _rbtsRevealQuorum(roundCfg.minVoters) || !roundHasHumanVerifiedCommit[contentId][roundId];
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

    function _scoreRbtsRewards(uint256 contentId, uint256 roundId, uint256 revealedCount, bool upWins)
        internal
        returns (uint256 rewardWeight, uint256 forfeitedPool, bytes32 scoreSeed)
    {
        bytes32 settlementEntropy = roundRbtsSeedEntropy[contentId][roundId];
        if (settlementEntropy == bytes32(0)) {
            RoundLib.Round storage round = rounds[contentId][roundId];
            settlementEntropy = keccak256(
                abi.encode(
                    "rateloop.rbts.legacy-seed.v1",
                    block.chainid,
                    address(this),
                    contentId,
                    roundId,
                    round.thresholdReachedAt,
                    round.voteCount
                )
            );
        }
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
                upWins: upWins,
                minParticipants: MIN_RBTS_PARTICIPANTS,
                scoreScaleBps: RBTS_SCORE_SCALE_BPS,
                settlementEntropy: settlementEntropy
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
    }

    function _captureRbtsSeed(uint256 contentId, uint256 roundId, uint48 thresholdReachedAt, bytes32 thresholdCommitKey)
        internal
    {
        bytes32 previousBlockhash = block.number > 0 ? blockhash(block.number - 1) : bytes32(0);
        bytes32 entropy = keccak256(
            abi.encode(
                "rateloop.rbts.threshold-seed.v1",
                block.chainid,
                address(this),
                contentId,
                roundId,
                thresholdReachedAt,
                block.number,
                thresholdCommitKey,
                previousBlockhash,
                bytes32(block.prevrandao)
            )
        );
        roundRbtsSeedEntropy[contentId][roundId] = entropy;
        emit RbtsSeedCaptured(contentId, roundId, entropy);
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
        bool thresholdAlreadyReached = round.thresholdReachedAt != 0;
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
                targetRoundRevealableAt: targetRoundRevealableAt
            })
        );
        roundStakeWithEligibleFrontend[contentId][roundId] = eligibleFrontendStake;
        roundEligibleFrontendCount[contentId][roundId] = eligibleFrontendCount;
        if (!thresholdAlreadyReached && round.thresholdReachedAt != 0) {
            _captureRbtsSeed(contentId, roundId, round.thresholdReachedAt, commitKey);
        }
        commitPredictedUpBps[contentId][roundId][commitKey] = predictedUpBps;
        commitRbtsWeight[contentId][roundId][commitKey] = effectiveStake;
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

    function roundRbtsStats(uint256 contentId, uint256 roundId)
        external
        view
        returns (bool scored, uint256 rewardWeight, uint256 forfeitedPool)
    {
        scored = roundRbtsScored[contentId][roundId];
        rewardWeight = roundRbtsRewardWeight[contentId][roundId];
        forfeitedPool = roundRbtsForfeitedPool[contentId][roundId];
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

    // Deprecated compatibility slot. RBTS scoring now mixes threshold-captured entropy instead
    // of a value overwritten by the final committer.
    mapping(uint256 => mapping(uint256 => bytes32)) public roundLastCommitPrevrandao;

    // True if at least one commit in this round originated from an address with an active human
    // credential. `cancelExpiredRound` requires this flag before the min-RBTS-quorum cancel-lockout
    // engages -- attacker-only rounds (all non-HRC sybils) remain refund-cancellable so they
    // cannot grief honest content into a RevealFailed cycle.
    mapping(uint256 => mapping(uint256 => bool)) public roundHasHumanVerifiedCommit;

    // Per-round, per-keeper IOU for the refund-only cleanup bounty when the consensus reserve was
    // too low to pay it in full. Drained by `claimDeferredCleanupBounty`. Already counted toward
    // the per-round 5 LREP cap so a deferred sliver cannot be used to bypass the envelope.
    mapping(uint256 contentId => mapping(uint256 roundId => mapping(address recipient => uint256 amount))) public
        roundDeferredCleanupBounty;

    // Entropy captured when reveal quorum first closes the commit set; RBTS settlement uses this
    // stored value so the settlement caller cannot grind the sampler by reverting unfavorable runs.
    mapping(uint256 => mapping(uint256 => bytes32)) public roundRbtsSeedEntropy;

    // --- Storage gap reserved for future upgrades ---
    uint256[23] private __gap;
}
