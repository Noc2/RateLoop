// SPDX-License-Identifier: MIT
pragma solidity ^0.8.34;

import { Initializable } from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import { AccessControlUpgradeable } from "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import { ReentrancyGuardTransient } from "@openzeppelin/contracts/utils/ReentrancyGuardTransient.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { SafeCast } from "@openzeppelin/contracts/utils/math/SafeCast.sol";

import { RoundVotingEngine } from "./RoundVotingEngine.sol";
import { ContentRegistry } from "./ContentRegistry.sol";
import { ProtocolConfig } from "./ProtocolConfig.sol";
import { IFrontendRegistry } from "./interfaces/IFrontendRegistry.sol";
import { ILaunchDistributionPool } from "./interfaces/ILaunchDistributionPool.sol";
import { FrontendFeeDustLib } from "./libraries/FrontendFeeDustLib.sol";
import { LaunchRaterRewardLib } from "./libraries/LaunchRaterRewardLib.sol";
import { RoundLib } from "./libraries/RoundLib.sol";
import { RewardMath } from "./libraries/RewardMath.sol";

/// @title RoundRewardDistributor
/// @notice Pull-based reward claiming for settled rounds.
/// @dev NOT pausable — users must always be able to withdraw their funds.
///      When RBTS scoring is active, revealed voters receive score-based stake return and rewards.
contract RoundRewardDistributor is Initializable, AccessControlUpgradeable, ReentrancyGuardTransient {
    using SafeERC20 for IERC20;
    using SafeCast for uint256;

    bytes32 public constant RATELOOP_REWARD_DISTRIBUTOR_MARKER = keccak256("rateloop.round-reward-distributor.v1");

    // --- Custom Errors ---
    error RoundNotSettled();
    error AlreadyClaimed();
    error NoPool();
    error NoStake();
    error NoEligibleStake();
    error PoolExhausted();
    error PoolDepleted();
    error NoStrandedLrep();
    error TreasuryNotSet();
    error UnauthorizedCaller();
    error UnauthorizedFrontendFeeCaller();
    error FrontendFeeCreditorNotConfigured();
    error FrontendFeeNotClaimable();
    error FrontendFeeNotConfiscatable();
    error UnrevealedCleanupPending();
    error RewardFinalizationTooEarly();
    error InvalidFinalizationInput();
    error RewardDustAlreadyFinalized();
    error NoRewardDust();
    error VotingEngineNotDrained();

    enum FrontendFeeDisposition {
        Direct,
        CreditRegistry,
        Protocol
    }

    enum LaunchCreditAttempt {
        Recorded,
        RetryableFailure,
        DeterministicNoop
    }

    uint256 public constant STALE_REWARD_FINALIZATION_DELAY = 30 days;

    // --- State ---
    IERC20 public lrepToken;
    RoundVotingEngine public votingEngine;
    ContentRegistry public registry;

    // Track claimed rewards: contentId => roundId => voter => claimed
    mapping(uint256 => mapping(uint256 => mapping(address => bool))) public rewardClaimed;
    mapping(uint256 => mapping(uint256 => mapping(bytes32 => bool))) public rewardCommitClaimed;

    // Track aggregate voter reward claim progress so the final winner receives the dust remainder.
    mapping(uint256 => mapping(uint256 => uint256)) public roundVoterRewardClaimedCount;
    mapping(uint256 => mapping(uint256 => uint256)) public roundVoterRewardClaimedAmount;
    mapping(uint256 => mapping(uint256 => bool)) public roundVoterRewardDustFinalized;

    /// @notice L-Funds-B: per-commit recipient + stake captured on the first failed
    ///         launch-credit record attempt. Non-zero recipient ⇒ retry is permitted via
    ///         {retryLaunchRaterRewardCredit}. Cleared on success. Defined here so the
    ///         struct is in scope for the storage mapping below; the mapping itself is
    ///         appended to the end of storage (see `pendingLaunchCreditRetry` near `__gap`)
    ///         to keep upgrade-compatibility with existing TransparentUpgradeableProxy
    ///         deployments that already populated `frontendFeeClaimed`.
    struct PendingLaunchCredit {
        address recipient;
        uint96 stakeAmount;
    }

    // Track frontend fee claims: contentId => roundId => frontend => claimed
    mapping(uint256 => mapping(uint256 => mapping(address => bool))) public frontendFeeClaimed;

    // Track aggregate frontend fee claim progress so the final claimant receives the dust remainder.
    mapping(uint256 => mapping(uint256 => uint256)) public roundFrontendClaimedCount;
    mapping(uint256 => mapping(uint256 => uint256)) public roundFrontendClaimedAmount;
    mapping(uint256 => mapping(uint256 => bool)) public roundFrontendFeeDustFinalized;

    // --- Events ---
    /// @notice Emitted when a settled-round claim pays out.
    /// @param voter Current SBT holder (or fallback EOA for non-SBT direct path) — receives `reward`.
    /// @param stakePayer Original `commit.voter` (typically a delegate) — receives `stakeReturned`.
    /// @param stakeReturned LREP sent to `stakePayer` as returned stake.
    /// @param reward LREP sent to `voter` (voter-pool reward; 0 for losers).
    event RewardClaimed(
        uint256 indexed contentId,
        uint256 indexed roundId,
        address indexed voter,
        address stakePayer,
        uint256 stakeReturned,
        uint256 reward
    );
    event LaunchRaterRewardCreditFailed(
        uint256 indexed contentId,
        uint256 indexed roundId,
        bytes32 indexed commitKey,
        address rater,
        address launchPool,
        bytes reason
    );
    /// @notice L-Funds-B: emitted when a previously-failed launch credit is successfully
    ///         recorded via `retryLaunchRaterRewardCredit`. `recipient` mirrors the original
    ///         `LaunchRaterRewardCreditFailed.rater`.
    event LaunchRaterRewardCreditRetried(
        uint256 indexed contentId,
        uint256 indexed roundId,
        bytes32 indexed commitKey,
        address recipient,
        address launchPool
    );
    event FrontendFeeClaimed(
        uint256 indexed contentId, uint256 indexed roundId, address indexed frontend, uint256 amount
    );
    event FrontendFeeConfiscated(
        uint256 indexed contentId, uint256 indexed roundId, address indexed frontend, uint256 amount
    );
    event FrontendRegistryLookupFailed(
        uint256 indexed contentId, uint256 indexed roundId, address indexed frontend, address frontendRegistry
    );
    event FrontendFeeCreditFailed(
        uint256 indexed contentId,
        uint256 indexed roundId,
        address indexed frontend,
        address frontendRegistry,
        uint256 amount
    );
    event VoterRewardDustFinalized(uint256 indexed contentId, uint256 indexed roundId, uint256 amount);
    event FrontendFeeDustFinalized(uint256 indexed contentId, uint256 indexed roundId, uint256 amount);
    event FrontendFeeDustBatchProcessed(
        uint256 indexed contentId, uint256 indexed roundId, uint256 processedCount, uint256 expectedTotal
    );
    event FrontendFeeDustBatchReset(uint256 indexed contentId, uint256 indexed roundId);
    event StrandedLrepSwept(address indexed treasury, uint256 amount);

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(address _governance, address _lrepToken, address _votingEngine, address _registry)
        public
        initializer
    {
        __AccessControl_init();

        require(_governance != address(0), "Invalid governance");
        require(_lrepToken != address(0), "Invalid LREP token");
        require(_votingEngine != address(0), "Invalid voting engine");
        require(_registry != address(0), "Invalid registry");

        _grantRole(DEFAULT_ADMIN_ROLE, _governance);

        lrepToken = IERC20(_lrepToken);
        votingEngine = RoundVotingEngine(_votingEngine);
        registry = ContentRegistry(_registry);
    }

    /// @notice Sweep any LREP accidentally held by the distributor to the protocol treasury.
    /// @dev Historical LREP balances were mistakenly routed here in some deployments. This contract does not custody
    ///      live reward inventory, so governance can safely recover the full balance to treasury.
    function sweepStrandedLrepToTreasury() external onlyRole(DEFAULT_ADMIN_ROLE) nonReentrant returns (uint256 amount) {
        address treasury = _protocolTreasury();
        if (treasury == address(0)) revert TreasuryNotSet();

        amount = lrepToken.balanceOf(address(this));
        if (amount == 0) revert NoStrandedLrep();

        lrepToken.safeTransfer(treasury, amount);
        emit StrandedLrepSwept(treasury, amount);
    }

    /// @notice The voting engine is immutable for this distributor; this setter is a
    ///         compatibility no-op kept for tooling that probes the shared setter surface.
    /// @dev It never updates state and emits no event: it succeeds only when passed the
    ///      current engine and reverts for any other address. Claim accounting is keyed by
    ///      contentId/roundId, so a fresh engine with reused round IDs must use a fresh
    ///      distributor instead of reusing this stateful instance.
    function setVotingEngine(address _votingEngine) external view onlyRole(DEFAULT_ADMIN_ROLE) {
        require(_votingEngine != address(0), "Invalid voting engine");
        require(_votingEngine == address(votingEngine), "Voting engine immutable");
    }

    // --- Voter Reward Claiming ---

    /// @notice Claim reward for a settled round.
    /// @dev RBTS-scored rounds pay score-based stake return plus voter-pool rewards by score weight.
    ///      Recipient split: returned stake flows to `commit.voter` (whoever funded the stake —
    ///      typically a delegate), while voter-pool rewards flow to the round-snapshotted rater
    ///      identity holder. A rotated or removed delegate therefore cannot capture historical
    ///      voter-pool rewards, while still receiving any stake returned by settlement.
    ///      This mirrors `claimCancelledRoundRefund`, which routes stake refunds to the original payer.
    /// @param contentId The content ID.
    /// @param roundId The round ID.
    function claimReward(uint256 contentId, uint256 roundId) external nonReentrant {
        RoundLib.Round memory round = _readRound(contentId, roundId);
        require(round.state == RoundLib.RoundState.Settled, "Round not settled");
        _requireNoPendingUnrevealedCleanup(contentId, roundId);

        (bytes32 commitKey, address rewardRecipient) = _resolveClaimCommit(contentId, roundId, msg.sender);
        require(commitKey != bytes32(0), "No vote found");

        RoundLib.Commit memory commit = _readCommit(contentId, roundId, commitKey);
        require(commit.voter != address(0), "No vote found");
        if (rewardCommitClaimed[contentId][roundId][commitKey] || rewardClaimed[contentId][roundId][commit.voter]) {
            revert("Already claimed");
        }
        require(commit.revealed, "Vote not revealed");

        claimAccountingStarted = true;
        rewardCommitClaimed[contentId][roundId][commitKey] = true;
        rewardClaimed[contentId][roundId][commit.voter] = true;

        (bool scored,,,,) = votingEngine.rbtsRoundState(contentId, roundId);
        if (!scored) revert RoundNotSettled();
        _claimRbtsReward(contentId, roundId, commitKey, commit, rewardRecipient);
    }

    function _claimRbtsReward(
        uint256 contentId,
        uint256 roundId,
        bytes32 commitKey,
        RoundLib.Commit memory commit,
        address rewardRecipient
    ) internal {
        (,,, uint256 scoreWeight, uint256 stakeReturned) = votingEngine.rbtsCommitState(contentId, roundId, commitKey);
        uint256 reward;
        if (scoreWeight > 0) {
            (,, uint256 totalScoreWeight, uint256 totalRewardClaimants, uint256 voterPool) =
                votingEngine.rbtsRoundState(contentId, roundId);
            uint256 claimedCount = roundVoterRewardClaimedCount[contentId][roundId];
            uint256 claimedAmount = roundVoterRewardClaimedAmount[contentId][roundId];
            if (voterPool == 0) {
                totalRewardClaimants = 0;
            }
            if (
                totalRewardClaimants == 0 || claimedCount >= totalRewardClaimants || claimedAmount > voterPool
                    || totalScoreWeight == 0
            ) {
                if (voterPool > 0) revert PoolExhausted();
            } else {
                reward = claimedCount + 1 == totalRewardClaimants
                    ? voterPool - claimedAmount
                    : RewardMath.calculateVoterReward(scoreWeight, totalScoreWeight, voterPool);
                roundVoterRewardClaimedCount[contentId][roundId] = claimedCount + 1;
                roundVoterRewardClaimedAmount[contentId][roundId] = claimedAmount + reward;
            }
        }

        if (stakeReturned > 0) {
            votingEngine.transferReward(commit.voter, stakeReturned);
        }
        if (reward > 0) {
            votingEngine.transferReward(rewardRecipient, reward);
        }

        _claimLaunchRaterReward(contentId, roundId, commitKey, rewardRecipient, commit.stakeAmount);
        emit RewardClaimed(contentId, roundId, rewardRecipient, commit.voter, stakeReturned, reward);
    }

    function _claimLaunchRaterReward(
        uint256 contentId,
        uint256 roundId,
        bytes32 commitKey,
        address rewardRecipient,
        uint256 stakeAmount
    ) internal {
        ProtocolConfig config = ProtocolConfig(votingEngine.protocolConfig());
        address launchPool = config.launchDistributionPool();
        if (launchPool == address(0)) return;
        (, uint16 scoreBps,,,) = votingEngine.rbtsCommitState(contentId, roundId, commitKey);
        if (scoreBps == 0) return;
        LaunchCreditAttempt attempt = _tryRecordLaunchRaterCredit(
            config, launchPool, contentId, roundId, commitKey, rewardRecipient, scoreBps, stakeAmount
        );
        if (attempt == LaunchCreditAttempt.RetryableFailure) {
            // L-Funds-B: persist the recipient + stake so a permissionless retry can re-attempt
            // once the failure cause (oracle rotation race, transient gas spike, anchor lookup
            // glitch) has cleared. Without this the credit is permanently stranded because
            // rewardCommitClaimed flipped true in the caller.
            pendingLaunchCreditRetry[contentId][roundId][commitKey] =
                PendingLaunchCredit({ recipient: rewardRecipient, stakeAmount: stakeAmount.toUint96() });
        }
    }

    function _tryRecordLaunchRaterCredit(
        ProtocolConfig config,
        address launchPool,
        uint256 contentId,
        uint256 roundId,
        bytes32 commitKey,
        address rewardRecipient,
        uint16 scoreBps,
        uint256 stakeAmount
    ) internal returns (LaunchCreditAttempt attempt) {
        RoundLib.Round memory round = _readRound(contentId, roundId);
        uint32 minAnchorCredentialAgeSeconds = _launchAnchorCredentialAgeSeconds(launchPool);

        try LaunchRaterRewardLib.collectAnchorIds(
            config,
            votingEngine,
            registry,
            contentId,
            roundId,
            rewardRecipient,
            round.voteCount,
            round.startTime,
            minAnchorCredentialAgeSeconds
        ) returns (
            bytes32[] memory verifiedAnchorIds
        ) {
            (,, uint256 cleanupRemaining, uint48 readyAt) = votingEngine.roundLifecycleState(contentId, roundId);
            bool cleanupComplete = cleanupRemaining == 0;
            try ILaunchDistributionPool(launchPool)
                .recordEarnedRaterRewardWithSourceReady(
                    rewardRecipient,
                    contentId,
                    roundId,
                    commitKey,
                    scoreBps,
                    round.revealedCount,
                    cleanupComplete,
                    stakeAmount,
                    verifiedAnchorIds,
                    readyAt
                ) returns (
                uint256
            ) {
                if (!ILaunchDistributionPool(launchPool).earnedRewardCreditRecorded(contentId, roundId, commitKey)) {
                    emit LaunchRaterRewardCreditFailed(
                        contentId, roundId, commitKey, rewardRecipient, launchPool, bytes("policy-gate")
                    );
                    // Unverified-cap no-ops can become recordable after the rater verifies.
                    if (_retryableLaunchCreditPolicyNoop(
                            launchPool,
                            rewardRecipient,
                            contentId,
                            roundId,
                            commitKey,
                            scoreBps,
                            round.revealedCount,
                            cleanupComplete,
                            stakeAmount,
                            verifiedAnchorIds.length
                        )) {
                        return LaunchCreditAttempt.RetryableFailure;
                    }
                    return LaunchCreditAttempt.DeterministicNoop;
                }
                return LaunchCreditAttempt.Recorded;
            } catch (bytes memory reason) {
                emit LaunchRaterRewardCreditFailed(contentId, roundId, commitKey, rewardRecipient, launchPool, reason);
                return LaunchCreditAttempt.RetryableFailure;
            }
        } catch (bytes memory reason) {
            emit LaunchRaterRewardCreditFailed(contentId, roundId, commitKey, rewardRecipient, launchPool, reason);
            return LaunchCreditAttempt.RetryableFailure;
        }
    }

    function _retryableLaunchCreditPolicyNoop(
        address launchPool,
        address rewardRecipient,
        uint256 contentId,
        uint256 roundId,
        bytes32 commitKey,
        uint16 scoreBps,
        uint16 revealedRaterCount,
        bool noPendingCleanup,
        uint256 stakeAmount,
        uint256 distinctRoundAnchors
    ) internal view returns (bool) {
        (bool policyRead, ILaunchDistributionPool.LaunchRewardPolicy memory policy) =
            _readLaunchRewardPolicy(launchPool);
        if (!policyRead) {
            return false;
        }

        if (rewardRecipient == address(0) || commitKey == bytes32(0)) return false;
        if (scoreBps < policy.minQualifyingScoreBps) return false;
        if (revealedRaterCount < policy.minVoters) return false;
        if (policy.requireNoPendingCleanup && !noPendingCleanup) return false;
        if (stakeAmount < policy.minLaunchCreditStake) return false;
        if (distinctRoundAnchors < policy.minVerifiedHumans) return false;

        try ILaunchDistributionPool(launchPool).raterRoundCreditRecorded(rewardRecipient, contentId, roundId) returns (
            bool alreadyRecorded
        ) {
            if (alreadyRecorded) return false;
        } catch {
            return false;
        }

        // At this point immutable score/voter/stake gates pass and neither the commit nor
        // rater-round slot is recorded. Remaining pool no-ops are dynamic launch accounting
        // state, such as anchor fanout reservations or unverified-credit caps.
        return true;
    }

    function _readLaunchRewardPolicy(address launchPool)
        internal
        view
        returns (bool success, ILaunchDistributionPool.LaunchRewardPolicy memory policy)
    {
        try ILaunchDistributionPool(launchPool).launchRewardPolicy() returns (
            uint16 minQualifyingScoreBps,
            uint16 minVoters,
            uint16 minVerifiedHumans,
            uint16 minDistinctVerifiedAnchors,
            uint16 minDistinctAnchorRounds,
            uint64 minLaunchCreditStake,
            uint16 maxDistinctRatersPerVerifiedAnchor,
            uint16 maxUnverifiedCreditsPerRound,
            uint16 unverifiedEarnedRaterCapBps,
            uint32 minAnchorCredentialAgeSeconds,
            uint32 eligibilityRatingCount,
            uint32 rewardingRatingCount,
            bool requireNoPendingCleanup
        ) {
            policy = ILaunchDistributionPool.LaunchRewardPolicy({
                minQualifyingScoreBps: minQualifyingScoreBps,
                minVoters: minVoters,
                minVerifiedHumans: minVerifiedHumans,
                minDistinctVerifiedAnchors: minDistinctVerifiedAnchors,
                minDistinctAnchorRounds: minDistinctAnchorRounds,
                minLaunchCreditStake: minLaunchCreditStake,
                maxDistinctRatersPerVerifiedAnchor: maxDistinctRatersPerVerifiedAnchor,
                maxUnverifiedCreditsPerRound: maxUnverifiedCreditsPerRound,
                unverifiedEarnedRaterCapBps: unverifiedEarnedRaterCapBps,
                minAnchorCredentialAgeSeconds: minAnchorCredentialAgeSeconds,
                eligibilityRatingCount: eligibilityRatingCount,
                rewardingRatingCount: rewardingRatingCount,
                requireNoPendingCleanup: requireNoPendingCleanup
            });
            success = true;
        } catch { }
    }

    /// @notice L-Funds-B: permissionless retry for a launch-credit record that failed on the
    ///         original `claimReward` call. Reads back the recipient + stake captured at first
    ///         attempt, re-invokes the launch pool's recordEarnedRaterRewardWithSourceReady, and
    ///         clears the pending entry on success. No-op (reverts) when no pending entry exists.
    /// @dev    CEI ordering: clear the pending mapping entry BEFORE the external call so a
    ///         reentrant caller (e.g. via a malicious launch pool reach-back) cannot replay the
    ///         retry against the same slot. The outer `nonReentrant` already blocks reentry
    ///         into this exact function, but ordering the delete first is the defense-in-depth
    ///         pattern flagged by Slither. If `_tryRecordLaunchRaterCredit` returns false the
    ///         whole tx reverts and the delete is rolled back atomically.
    function retryLaunchRaterRewardCredit(uint256 contentId, uint256 roundId, bytes32 commitKey) external nonReentrant {
        PendingLaunchCredit memory pending = pendingLaunchCreditRetry[contentId][roundId][commitKey];
        require(pending.recipient != address(0), "Nothing to retry");
        ProtocolConfig config = ProtocolConfig(votingEngine.protocolConfig());
        address launchPool = config.launchDistributionPool();
        require(launchPool != address(0), "Launch pool unset");
        (, uint16 scoreBps,,,) = votingEngine.rbtsCommitState(contentId, roundId, commitKey);
        require(scoreBps != 0, "No launch score");

        claimAccountingStarted = true;
        delete pendingLaunchCreditRetry[contentId][roundId][commitKey];

        LaunchCreditAttempt attempt = _tryRecordLaunchRaterCredit(
            config, launchPool, contentId, roundId, commitKey, pending.recipient, scoreBps, pending.stakeAmount
        );
        require(attempt == LaunchCreditAttempt.Recorded, "Retry failed");
        emit LaunchRaterRewardCreditRetried(contentId, roundId, commitKey, pending.recipient, launchPool);
    }

    function _launchAnchorCredentialAgeSeconds(address launchPool) internal view returns (uint32) {
        try ILaunchDistributionPool(launchPool).launchAnchorCredentialAgeSeconds() returns (uint32 minAgeSeconds) {
            return minAgeSeconds;
        } catch {
            return 0;
        }
    }

    // --- Frontend Fee Claims ---

    /// @notice Claim frontend fees for a settled round.
    /// @dev AUDIT NOTE: This path intentionally crystallizes historical frontend fees against the
    ///      frontend's current slash/bond status. The current operator (or the frontend address
    ///      itself when no distinct operator is registered) must call it, so finalized fees cannot
    ///      be pulled forward by unrelated accounts.
    function claimFrontendFee(uint256 contentId, uint256 roundId, address frontend)
        external
        nonReentrant
        returns (uint256 fee)
    {
        FrontendFeeDisposition disposition;
        address operator;
        bool registryLookupFailed;
        address snapshotRegistryAddress;
        uint48 roundSettledAt;
        (fee, roundSettledAt) = _quoteFrontendFee(contentId, roundId, frontend);
        (disposition, operator, registryLookupFailed, snapshotRegistryAddress) =
            _resolveFrontendFeeDisposition(contentId, roundId, frontend, roundSettledAt);
        if (registryLookupFailed) {
            emit FrontendRegistryLookupFailed(contentId, roundId, frontend, snapshotRegistryAddress);
        }
        if (disposition == FrontendFeeDisposition.Protocol) revert FrontendFeeNotClaimable();

        address expectedCaller = operator != address(0) ? operator : frontend;
        if (msg.sender != expectedCaller) revert UnauthorizedFrontendFeeCaller();

        claimAccountingStarted = true;
        _consumeFrontendFeeClaim(contentId, roundId, frontend, fee);
        _payoutFrontendFee(contentId, roundId, frontend, fee, disposition, snapshotRegistryAddress);
        emit FrontendFeeClaimed(contentId, roundId, frontend, fee);
    }

    /// @notice Route a settled frontend fee to protocol once the frontend is slashed or underbonded.
    function confiscateFrontendFee(uint256 contentId, uint256 roundId, address frontend)
        external
        onlyRole(DEFAULT_ADMIN_ROLE)
        nonReentrant
        returns (uint256 fee)
    {
        uint48 roundSettledAt;
        (fee, roundSettledAt) = _quoteFrontendFee(contentId, roundId, frontend);
        (FrontendFeeDisposition disposition,,,) =
            _resolveFrontendFeeDisposition(contentId, roundId, frontend, roundSettledAt);
        if (disposition != FrontendFeeDisposition.Protocol) revert FrontendFeeNotConfiscatable();

        claimAccountingStarted = true;
        _consumeFrontendFeeClaim(contentId, roundId, frontend, fee);
        _routeRewardToProtocol(fee);
        emit FrontendFeeConfiscated(contentId, roundId, frontend, fee);
    }

    /// @notice Finalize only mathematical voter-reward dust after stale RBTS reward claimants had time to claim.
    /// @dev `sortedWinningVoters` must contain every positive-score reward claimant exactly once, sorted by
    ///      address ascending. NOTE: each entry is the **`commit.voter`** address — the EOA
    ///      that originally committed the vote — not the SBT holder. For delegated commits
    ///      these differ; off-chain dust finalizers must enumerate `commit.voter` from the
    ///      `voterCommitHash` mapping (or the `VoteCommitted` events), NOT call
    ///      `RaterRegistry.resolveRater(account).holder`. Passing the holder address for a delegated
    ///      commit fails the lookup and reverts the entire batch with `InvalidFinalizationInput`.
    function finalizeVoterRewardDust(uint256 contentId, uint256 roundId, address[] calldata sortedWinningVoters)
        external
        nonReentrant
        returns (uint256 releasedDust)
    {
        if (roundVoterRewardDustFinalized[contentId][roundId]) revert RewardDustAlreadyFinalized();

        _readSettledStaleRound(contentId, roundId);
        _requireNoPendingUnrevealedCleanup(contentId, roundId);

        (bool scored,, uint256 weightedWinningStake, uint256 totalWinningClaimants, uint256 voterPool) =
            votingEngine.rbtsRoundState(contentId, roundId);
        if (!scored) revert RoundNotSettled();
        if (sortedWinningVoters.length != totalWinningClaimants) revert InvalidFinalizationInput();

        if (totalWinningClaimants == 0 || voterPool == 0 || weightedWinningStake == 0) revert NoRewardDust();

        uint256 expectedTotal;
        address previous;
        for (uint256 i = 0; i < sortedWinningVoters.length; i++) {
            address voter = sortedWinningVoters[i];
            if (voter == address(0) || (i != 0 && voter <= previous)) revert InvalidFinalizationInput();
            previous = voter;

            bytes32 commitKey = _findVoterCommitKey(contentId, roundId, voter);
            RoundLib.Commit memory commit = _readCommit(contentId, roundId, commitKey);
            if (commit.voter != voter || !commit.revealed) {
                revert InvalidFinalizationInput();
            }

            (,,, uint256 effectiveStake,) = votingEngine.rbtsCommitState(contentId, roundId, commitKey);
            if (effectiveStake == 0) {
                revert InvalidFinalizationInput();
            }
            expectedTotal += RewardMath.calculateVoterReward(effectiveStake, weightedWinningStake, voterPool);
        }

        releasedDust = _finalizableDust(voterPool, expectedTotal, roundVoterRewardClaimedAmount[contentId][roundId]);
        if (releasedDust == 0) revert NoRewardDust();

        claimAccountingStarted = true;
        roundVoterRewardDustFinalized[contentId][roundId] = true;
        roundVoterRewardClaimedAmount[contentId][roundId] += releasedDust;
        _routeRewardToProtocol(releasedDust);

        emit VoterRewardDustFinalized(contentId, roundId, releasedDust);
    }

    /// @notice Finalize only mathematical frontend-fee dust after stale frontend operators have had time to claim.
    /// @dev `sortedFrontends` must contain every eligible frontend exactly once, sorted by address ascending.
    function finalizeFrontendFeeDust(uint256 contentId, uint256 roundId, address[] calldata sortedFrontends)
        external
        nonReentrant
        returns (uint256 releasedDust)
    {
        claimAccountingStarted = true;
        _processFrontendFeeDustBatch(contentId, roundId, sortedFrontends);
        releasedDust = _finalizeProcessedFrontendFeeDust(contentId, roundId);
    }

    /// @notice Process a globally sorted slice of eligible frontends for later dust finalization.
    function processFrontendFeeDustBatch(uint256 contentId, uint256 roundId, address[] calldata sortedFrontends)
        external
        onlyRole(DEFAULT_ADMIN_ROLE)
        nonReentrant
        returns (uint256 processedCount, uint256 expectedTotal)
    {
        claimAccountingStarted = true;
        (processedCount, expectedTotal) = _processFrontendFeeDustBatch(contentId, roundId, sortedFrontends);
    }

    /// @notice Finalize frontend-fee dust after all eligible frontend batches have been processed.
    function finalizeProcessedFrontendFeeDust(uint256 contentId, uint256 roundId)
        external
        onlyRole(DEFAULT_ADMIN_ROLE)
        nonReentrant
        returns (uint256 releasedDust)
    {
        claimAccountingStarted = true;
        releasedDust = _finalizeProcessedFrontendFeeDust(contentId, roundId);
    }

    /// @notice Reset in-progress frontend-fee dust batch accounting so governance can restart a bad cursor.
    function resetFrontendFeeDustBatch(uint256 contentId, uint256 roundId) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (roundFrontendFeeDustFinalized[contentId][roundId]) revert RewardDustAlreadyFinalized();

        claimAccountingStarted = true;
        delete roundFrontendFeeDustProcessedCount[contentId][roundId];
        delete roundFrontendFeeDustExpectedTotal[contentId][roundId];
        delete roundFrontendFeeDustLastFrontend[contentId][roundId];

        emit FrontendFeeDustBatchReset(contentId, roundId);
    }

    function previewFrontendFee(uint256 contentId, uint256 roundId, address frontend)
        external
        view
        returns (uint256 fee, FrontendFeeDisposition disposition, address operator, bool alreadyClaimed)
    {
        alreadyClaimed = frontendFeeClaimed[contentId][roundId][frontend];
        uint48 roundSettledAt;
        (fee, roundSettledAt) = _quoteFrontendFee(contentId, roundId, frontend);
        (disposition, operator,,) = _resolveFrontendFeeDisposition(contentId, roundId, frontend, roundSettledAt);
    }

    // --- Internal ---

    /// @dev Find a voter's commit using the O(1) voter-to-commitHash mapping.
    function _findVoterCommit(uint256 contentId, uint256 roundId, address voter)
        internal
        view
        returns (RoundLib.Commit memory)
    {
        bytes32 commitKey = _findVoterCommitKey(contentId, roundId, voter);
        if (commitKey == bytes32(0)) {
            return RoundLib.Commit(address(0), 0, bytes32(0), 0, address(0), 0, false, false, 0);
        }
        return _readCommit(contentId, roundId, commitKey);
    }

    function _findVoterCommitKey(uint256 contentId, uint256 roundId, address voter) internal view returns (bytes32) {
        (, bytes32 commitKey) = votingEngine.voterCommitKey(contentId, roundId, voter);
        return commitKey;
    }

    function _resolveClaimCommit(uint256 contentId, uint256 roundId, address account)
        internal
        view
        returns (bytes32 commitKey, address rewardRecipient)
    {
        return votingEngine.resolveClaimCommit(contentId, roundId, account);
    }

    function _readRound(uint256 contentId, uint256 roundId) internal view returns (RoundLib.Round memory round) {
        (
            round.startTime,
            round.state,
            round.voteCount,
            round.revealedCount,
            round.totalStake,
            round.thresholdReachedAt,
            round.settledAt
        ) = votingEngine.roundCore(contentId, roundId);
    }

    function _readCommit(uint256 contentId, uint256 roundId, bytes32 commitKey)
        internal
        view
        returns (RoundLib.Commit memory commit)
    {
        // Use the narrow getter that skips hash/target metadata during bounds-limit dust finalization.
        (
            commit.voter,
            commit.stakeAmount,
            commit.frontend,
            commit.revealableAfter,
            commit.revealed,
            commit.isUp,
            commit.epochIndex
        ) = votingEngine.commitCore(contentId, roundId, commitKey);
    }

    function _quoteFrontendFee(uint256 contentId, uint256 roundId, address frontend)
        internal
        view
        returns (uint256 fee, uint48 roundSettledAt)
    {
        RoundLib.Round memory round = _readRound(contentId, roundId);
        if (round.state != RoundLib.RoundState.Settled) revert RoundNotSettled();
        roundSettledAt = round.settledAt;
        _requireNoPendingUnrevealedCleanup(contentId, roundId);
        if (frontendFeeClaimed[contentId][roundId][frontend]) revert AlreadyClaimed();

        (uint256 totalFrontendPool, uint256 frontendStake, uint256 totalEligibleStake, uint256 totalFrontendClaimants) =
            votingEngine.frontendFeeState(contentId, roundId, frontend);

        if (totalFrontendPool == 0) revert NoPool();
        if (frontendStake == 0) revert NoStake();
        if (totalEligibleStake == 0) revert NoEligibleStake();
        if (totalFrontendClaimants == 0) revert NoPool();

        uint256 claimedCount = roundFrontendClaimedCount[contentId][roundId];
        uint256 claimedAmount = roundFrontendClaimedAmount[contentId][roundId];
        if (claimedAmount > totalFrontendPool) revert PoolExhausted();

        if (claimedCount + 1 == totalFrontendClaimants) {
            fee = totalFrontendPool - claimedAmount;
        } else {
            fee = (totalFrontendPool * frontendStake) / totalEligibleStake;
        }
    }

    function _consumeFrontendFeeClaim(uint256 contentId, uint256 roundId, address frontend, uint256 fee) internal {
        frontendFeeClaimed[contentId][roundId][frontend] = true;
        roundFrontendClaimedCount[contentId][roundId] += 1;
        roundFrontendClaimedAmount[contentId][roundId] += fee;
    }

    function _requireNoPendingUnrevealedCleanup(uint256 contentId, uint256 roundId) internal view {
        (,, uint256 cleanupRemaining,) = votingEngine.roundLifecycleState(contentId, roundId);
        if (cleanupRemaining > 0) {
            revert UnrevealedCleanupPending();
        }
    }

    function _resolveFrontendFeeDisposition(uint256 contentId, uint256 roundId, address frontend, uint48 roundSettledAt)
        internal
        view
        returns (
            FrontendFeeDisposition disposition,
            address operator,
            bool registryLookupFailed,
            address snapshotRegistryAddress
        )
    {
        snapshotRegistryAddress = votingEngine.roundFrontendRegistrySnapshot(contentId, roundId);
        if (snapshotRegistryAddress == address(0)) {
            return (FrontendFeeDisposition.Direct, frontend, false, snapshotRegistryAddress);
        }

        IFrontendRegistry snapshotRegistry = IFrontendRegistry(snapshotRegistryAddress);
        try snapshotRegistry.getFrontendInfo(frontend) returns (address frontendOperator, uint256, bool, bool) {
            if (frontendOperator == address(0)) {
                return (FrontendFeeDisposition.Protocol, frontend, false, snapshotRegistryAddress);
            }
            // canClaimFeesForRound subsumes the eligible / slashed / stakedAmount /
            // exit-pending / credential status / registered-before-round checks. A frontend that
            // re-registered after this round settled fails the registeredAt gate and routes
            // the fee to Protocol (admin confiscation) instead of reviving a claim.
            if (_canClaimFeesForRound(snapshotRegistry, frontend, roundSettledAt)) {
                return (FrontendFeeDisposition.CreditRegistry, frontendOperator, false, snapshotRegistryAddress);
            }
            return (FrontendFeeDisposition.Protocol, frontendOperator, false, snapshotRegistryAddress);
        } catch {
            return (FrontendFeeDisposition.Protocol, frontend, true, snapshotRegistryAddress);
        }
    }

    function _canClaimFeesForRound(IFrontendRegistry snapshotRegistry, address frontend, uint48 roundSettledAt)
        internal
        view
        returns (bool)
    {
        try snapshotRegistry.canClaimFeesForRound(frontend, roundSettledAt) returns (bool canClaim) {
            return canClaim;
        } catch {
            return false;
        }
    }

    function _payoutFrontendFee(
        uint256 contentId,
        uint256 roundId,
        address frontend,
        uint256 fee,
        FrontendFeeDisposition disposition,
        address snapshotRegistryAddress
    ) internal {
        if (fee == 0) return;

        if (disposition == FrontendFeeDisposition.Direct || snapshotRegistryAddress == address(0)) {
            votingEngine.transferReward(frontend, fee);
            return;
        }

        if (disposition == FrontendFeeDisposition.Protocol) {
            _routeRewardToProtocol(fee);
            return;
        }

        IFrontendRegistry snapshotRegistry = IFrontendRegistry(snapshotRegistryAddress);
        _requireFrontendFeeCreditorConfigured(snapshotRegistry);

        try snapshotRegistry.creditFees(frontend, fee) {
            votingEngine.transferReward(snapshotRegistryAddress, fee);
        } catch {
            emit FrontendFeeCreditFailed(contentId, roundId, frontend, snapshotRegistryAddress, fee);
            _routeRewardToProtocol(fee);
        }
    }

    function _requireFrontendFeeCreditorConfigured(IFrontendRegistry snapshotRegistry) internal view {
        try snapshotRegistry.feeCreditorForEngine(address(votingEngine)) returns (address creditor) {
            if (creditor != address(this)) revert FrontendFeeCreditorNotConfigured();
        } catch {
            revert FrontendFeeCreditorNotConfigured();
        }
    }

    function _routeRewardToProtocol(uint256 fee) internal {
        address treasury = _protocolTreasury();
        if (treasury != address(0)) {
            votingEngine.transferReward(treasury, fee);
            return;
        }

        // Treasury is initialized in ProtocolConfig, but if governance has temporarily
        // unset or broken it, keep protocol-routed rewards recoverable here instead of
        // reviving a subsidy reserve.
        votingEngine.transferReward(address(this), fee);
    }

    function _readSettledStaleRound(uint256 contentId, uint256 roundId)
        internal
        view
        returns (RoundLib.Round memory round)
    {
        round = _readRound(contentId, roundId);
        if (round.state != RoundLib.RoundState.Settled) revert RoundNotSettled();
        if (!_isStaleRound(round)) revert RewardFinalizationTooEarly();
    }

    function _isStaleRound(RoundLib.Round memory round) internal view returns (bool) {
        return round.settledAt != 0 && block.timestamp >= uint256(round.settledAt) + STALE_REWARD_FINALIZATION_DELAY;
    }

    function _processFrontendFeeDustBatch(uint256 contentId, uint256 roundId, address[] calldata sortedFrontends)
        internal
        returns (uint256 processedCount, uint256 expectedTotal)
    {
        (processedCount, expectedTotal) = FrontendFeeDustLib.processBatch(
            votingEngine,
            roundFrontendFeeDustFinalized,
            roundFrontendFeeDustProcessedCount,
            roundFrontendFeeDustExpectedTotal,
            roundFrontendFeeDustLastFrontend,
            contentId,
            roundId,
            sortedFrontends,
            STALE_REWARD_FINALIZATION_DELAY
        );

        emit FrontendFeeDustBatchProcessed(contentId, roundId, processedCount, expectedTotal);
    }

    function _finalizeProcessedFrontendFeeDust(uint256 contentId, uint256 roundId)
        internal
        returns (uint256 releasedDust)
    {
        if (roundFrontendFeeDustFinalized[contentId][roundId]) revert RewardDustAlreadyFinalized();

        _readSettledStaleRound(contentId, roundId);
        _requireNoPendingUnrevealedCleanup(contentId, roundId);

        (uint256 totalFrontendPool,,, uint256 totalFrontendClaimants) =
            votingEngine.frontendFeeState(contentId, roundId, address(0));
        if (
            totalFrontendClaimants == 0
                || roundFrontendFeeDustProcessedCount[contentId][roundId] != totalFrontendClaimants
        ) {
            revert InvalidFinalizationInput();
        }

        uint256 expectedTotal = roundFrontendFeeDustExpectedTotal[contentId][roundId];
        releasedDust =
            _finalizableDust(totalFrontendPool, expectedTotal, roundFrontendClaimedAmount[contentId][roundId]);
        if (releasedDust == 0) revert NoRewardDust();

        roundFrontendFeeDustFinalized[contentId][roundId] = true;
        roundFrontendClaimedAmount[contentId][roundId] += releasedDust;
        _routeRewardToProtocol(releasedDust);

        emit FrontendFeeDustFinalized(contentId, roundId, releasedDust);
    }

    function _finalizableDust(uint256 totalPool, uint256 expectedTotal, uint256 claimedAmount)
        internal
        pure
        returns (uint256)
    {
        if (expectedTotal >= totalPool) return 0;
        uint256 totalDust = totalPool - expectedTotal;
        uint256 alreadyClaimedDust = claimedAmount > expectedTotal ? claimedAmount - expectedTotal : 0;
        if (alreadyClaimedDust >= totalDust) return 0;
        return totalDust - alreadyClaimedDust;
    }

    function _protocolTreasury() internal view returns (address) {
        return ProtocolConfig(votingEngine.protocolConfig()).treasury();
    }

    // Appended state for batched frontend fee dust finalization.
    mapping(uint256 => mapping(uint256 => uint256)) public roundFrontendFeeDustProcessedCount;
    mapping(uint256 => mapping(uint256 => uint256)) public roundFrontendFeeDustExpectedTotal;
    mapping(uint256 => mapping(uint256 => address)) public roundFrontendFeeDustLastFrontend;

    /// @notice L-Funds-B retry slot, appended at end of storage so an upgrade from any
    ///         layout that already populated `frontendFeeClaimed` etc. does not shift
    ///         existing slots. Reads at the new slot before the upgrade are zero, which
    ///         is the correct "no pending retry" semantic.
    mapping(uint256 => mapping(uint256 => mapping(bytes32 => PendingLaunchCredit))) public pendingLaunchCreditRetry;

    /// @notice True once this distributor has mutated reward, frontend-fee, or dust claim accounting.
    bool public claimAccountingStarted;

    // --- Storage Gap for Future Upgrades ---
    uint256[29] private __gap;
}
