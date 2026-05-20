// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Initializable } from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import { AccessControlUpgradeable } from "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import { ReentrancyGuardTransient } from "@openzeppelin/contracts/utils/ReentrancyGuardTransient.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import { RoundVotingEngine } from "./RoundVotingEngine.sol";
import { ContentRegistry } from "./ContentRegistry.sol";
import { ProtocolConfig } from "./ProtocolConfig.sol";
import { IFrontendRegistry } from "./interfaces/IFrontendRegistry.sol";
import { IParticipationPool } from "./interfaces/IParticipationPool.sol";
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

    // --- Custom Errors ---
    error RoundNotSettled();
    error AlreadyClaimed();
    error NoPool();
    error NoStake();
    error NoEligibleStake();
    error PoolExhausted();
    error PoolDepleted();
    error VoteNotRevealed();
    error NotWinningSide();
    error NoParticipationRate();
    error NoCommit();
    error NoStrandedLrep();
    error TreasuryNotSet();
    error InvalidParticipationSnapshot();
    error UnauthorizedCaller();
    error UnauthorizedFrontendFeeCaller();
    error FrontendFeeNotClaimable();
    error FrontendFeeNotConfiscatable();
    error ParticipationRewardsOutstanding();
    error ParticipationRewardsAlreadyFinalized();
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
    ///         {retryLaunchRaterRewardCredit}. Cleared on success.
    struct PendingLaunchCredit {
        address recipient;
        uint96 stakeAmount;
    }

    mapping(uint256 => mapping(uint256 => mapping(bytes32 => PendingLaunchCredit))) public pendingLaunchCreditRetry;

    // Track frontend fee claims: contentId => roundId => frontend => claimed
    mapping(uint256 => mapping(uint256 => mapping(address => bool))) public frontendFeeClaimed;

    // Track aggregate frontend fee claim progress so the final claimant receives the dust remainder.
    mapping(uint256 => mapping(uint256 => uint256)) public roundFrontendClaimedCount;
    mapping(uint256 => mapping(uint256 => uint256)) public roundFrontendClaimedAmount;
    mapping(uint256 => mapping(uint256 => bool)) public roundFrontendFeeDustFinalized;

    // Track participation reward claims: contentId => roundId => voter => claimed/paid
    mapping(uint256 => mapping(uint256 => mapping(address => bool))) public participationRewardClaimed;
    mapping(uint256 => mapping(uint256 => mapping(address => uint256))) public participationRewardPaid;
    mapping(uint256 => mapping(uint256 => mapping(bytes32 => bool))) public participationRewardCommitClaimed;
    mapping(uint256 => mapping(uint256 => mapping(bytes32 => uint256))) public participationRewardCommitPaid;
    mapping(uint256 => mapping(uint256 => address)) public roundParticipationRewardPool;
    mapping(uint256 => mapping(uint256 => uint256)) public roundParticipationRewardRateBps;
    mapping(uint256 => mapping(uint256 => uint256)) public roundParticipationRewardOwed;
    mapping(uint256 => mapping(uint256 => uint256)) public roundParticipationRewardReserved;
    mapping(uint256 => mapping(uint256 => uint256)) public roundParticipationRewardPaidTotal;
    mapping(uint256 => mapping(uint256 => uint256)) public roundParticipationRewardFullyClaimedCount;
    mapping(uint256 => mapping(uint256 => bool)) public roundParticipationRewardFinalized;
    mapping(uint256 => mapping(uint256 => uint48)) public roundParticipationRewardClaimableAt;

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
    event ParticipationRewardClaimed(
        uint256 indexed contentId, uint256 indexed roundId, address indexed voter, uint256 amount
    );
    event ParticipationRewardSnapshotted(
        uint256 indexed contentId,
        uint256 indexed roundId,
        address indexed rewardPool,
        uint256 rewardRateBps,
        uint256 totalReward,
        uint256 reservedReward
    );
    event ParticipationRewardBackfilled(
        uint256 indexed contentId,
        uint256 indexed roundId,
        address indexed rewardPool,
        uint256 rewardRateBps,
        uint256 totalReward,
        uint256 reservedReward
    );
    event ParticipationRewardFinalized(
        uint256 indexed contentId, uint256 indexed roundId, address indexed rewardPool, uint256 releasedDust
    );
    event VotingEngineUpdated(address votingEngine);
    event VoterRewardDustFinalized(uint256 indexed contentId, uint256 indexed roundId, uint256 amount);
    event FrontendFeeDustFinalized(uint256 indexed contentId, uint256 indexed roundId, uint256 amount);
    event FrontendFeeDustBatchProcessed(
        uint256 indexed contentId, uint256 indexed roundId, uint256 processedCount, uint256 expectedTotal
    );
    event FrontendFeeDustBatchReset(uint256 indexed contentId, uint256 indexed roundId);
    event ParticipationRewardSnapshotFailed(
        uint256 indexed contentId,
        uint256 indexed roundId,
        address indexed rewardPool,
        uint256 rewardRateBps,
        uint256 totalReward
    );
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
    /// @dev Historical cancellation fees were mistakenly routed here in some deployments. This contract does not
    ///      custody live reward inventory, so governance can safely recover the full balance to treasury.
    function sweepStrandedLrepToTreasury() external onlyRole(DEFAULT_ADMIN_ROLE) nonReentrant returns (uint256 amount) {
        address treasury = _protocolTreasury();
        if (treasury == address(0)) revert TreasuryNotSet();

        amount = lrepToken.balanceOf(address(this));
        if (amount == 0) revert NoStrandedLrep();

        lrepToken.safeTransfer(treasury, amount);
        emit StrandedLrepSwept(treasury, amount);
    }

    /// @notice The voting engine is immutable for this distributor.
    /// @dev Claim accounting is keyed by contentId/roundId, so a fresh engine with reused round IDs
    ///      must use a fresh distributor instead of reusing this stateful instance.
    function setVotingEngine(address _votingEngine) external view onlyRole(DEFAULT_ADMIN_ROLE) {
        require(_votingEngine != address(0), "Invalid voting engine");
        require(_votingEngine == address(votingEngine), "Voting engine immutable");
    }

    // --- Voter Reward Claiming ---

    /// @notice Claim reward for a settled round.
    /// @dev RBTS-scored rounds pay score-based stake return plus voter-pool rewards by score weight.
    ///      Recipient split: returned stake flows to `commit.voter` (whoever funded the stake —
    ///      typically a delegate), while voter-pool rewards flow to the current rater identity holder
    ///      (resolved via RaterRegistry). A rotated or removed delegate therefore cannot capture
    ///      historical voter-pool rewards, while still receiving any stake returned by settlement.
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

        rewardCommitClaimed[contentId][roundId][commitKey] = true;
        rewardClaimed[contentId][roundId][commit.voter] = true;

        if (!votingEngine.roundRbtsScored(contentId, roundId)) revert RoundNotSettled();
        _claimRbtsReward(contentId, roundId, commitKey, commit, rewardRecipient);
    }

    function _claimRbtsReward(
        uint256 contentId,
        uint256 roundId,
        bytes32 commitKey,
        RoundLib.Commit memory commit,
        address rewardRecipient
    ) internal {
        uint256 scoreWeight = votingEngine.commitRbtsRewardWeight(contentId, roundId, commitKey);
        uint256 stakeReturned = votingEngine.commitRbtsStakeReturned(contentId, roundId, commitKey);
        uint256 reward;
        if (scoreWeight > 0) {
            uint256 voterPool = votingEngine.roundVoterPool(contentId, roundId);
            uint256 totalScoreWeight = votingEngine.roundRbtsRewardWeight(contentId, roundId);
            uint256 totalRewardClaimants = votingEngine.roundRbtsRewardClaimants(contentId, roundId);
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
        uint16 scoreBps = votingEngine.commitRbtsScoreBps(contentId, roundId, commitKey);
        if (scoreBps == 0) return;
        bool ok = _tryRecordLaunchRaterCredit(
            config, launchPool, contentId, roundId, commitKey, rewardRecipient, scoreBps, stakeAmount
        );
        if (!ok) {
            // L-Funds-B: persist the recipient + stake so a permissionless retry can re-attempt
            // once the failure cause (oracle rotation race, transient gas spike, anchor lookup
            // glitch) has cleared. Without this the credit is permanently stranded because
            // rewardCommitClaimed flipped true in the caller.
            pendingLaunchCreditRetry[contentId][roundId][commitKey] =
                PendingLaunchCredit({ recipient: rewardRecipient, stakeAmount: uint96(stakeAmount) });
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
    ) internal returns (bool ok) {
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
            try ILaunchDistributionPool(launchPool)
                .recordEarnedRaterRewardWithSourceReady(
                    rewardRecipient,
                    contentId,
                    roundId,
                    commitKey,
                    scoreBps,
                    round.revealedCount,
                    votingEngine.roundUnrevealedCleanupRemaining(contentId, roundId) == 0,
                    stakeAmount,
                    verifiedAnchorIds,
                    votingEngine.roundClusterPayoutReadyAt(contentId, roundId)
                ) returns (
                uint256
            ) {
                return true;
            }
            catch (bytes memory reason) {
                emit LaunchRaterRewardCreditFailed(contentId, roundId, commitKey, rewardRecipient, launchPool, reason);
                return false;
            }
        } catch (bytes memory reason) {
            emit LaunchRaterRewardCreditFailed(contentId, roundId, commitKey, rewardRecipient, launchPool, reason);
            return false;
        }
    }

    /// @notice L-Funds-B: permissionless retry for a launch-credit record that failed on the
    ///         original `claimReward` call. Reads back the recipient + stake captured at first
    ///         attempt, re-invokes the launch pool's recordEarnedRaterRewardWithSourceReady, and
    ///         clears the pending entry on success. No-op (reverts) when no pending entry exists.
    function retryLaunchRaterRewardCredit(uint256 contentId, uint256 roundId, bytes32 commitKey)
        external
        nonReentrant
    {
        PendingLaunchCredit memory pending = pendingLaunchCreditRetry[contentId][roundId][commitKey];
        require(pending.recipient != address(0), "Nothing to retry");
        ProtocolConfig config = ProtocolConfig(votingEngine.protocolConfig());
        address launchPool = config.launchDistributionPool();
        require(launchPool != address(0), "Launch pool unset");
        uint16 scoreBps = votingEngine.commitRbtsScoreBps(contentId, roundId, commitKey);
        require(scoreBps != 0, "No launch score");

        bool ok = _tryRecordLaunchRaterCredit(
            config, launchPool, contentId, roundId, commitKey, pending.recipient, scoreBps, pending.stakeAmount
        );
        require(ok, "Retry failed");
        delete pendingLaunchCreditRetry[contentId][roundId][commitKey];
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
    ///      frontend's current slash/bond status. Permissionless callers can therefore finalize an
    ///      old round while a frontend is still slashed, underbonded, or deregistered.
    function claimFrontendFee(uint256 contentId, uint256 roundId, address frontend)
        external
        nonReentrant
        returns (uint256 fee)
    {
        FrontendFeeDisposition disposition;
        address operator;
        bool registryLookupFailed;
        address snapshotRegistryAddress;
        fee = _quoteFrontendFee(contentId, roundId, frontend);
        uint48 roundSettledAt = _readRound(contentId, roundId).settledAt;
        (disposition, operator, registryLookupFailed, snapshotRegistryAddress) =
            _resolveFrontendFeeDisposition(contentId, roundId, frontend, roundSettledAt);
        if (registryLookupFailed) {
            emit FrontendRegistryLookupFailed(contentId, roundId, frontend, snapshotRegistryAddress);
        }
        if (disposition == FrontendFeeDisposition.Protocol) revert FrontendFeeNotClaimable();

        address expectedCaller = operator != address(0) ? operator : frontend;
        if (msg.sender != expectedCaller) revert UnauthorizedFrontendFeeCaller();

        _consumeFrontendFeeClaim(contentId, roundId, frontend, fee);
        _payoutFrontendFee(contentId, roundId, frontend, fee, disposition);
        emit FrontendFeeClaimed(contentId, roundId, frontend, fee);
    }

    /// @notice Route a settled frontend fee to protocol once the frontend is slashed or underbonded.
    function confiscateFrontendFee(uint256 contentId, uint256 roundId, address frontend)
        external
        onlyRole(DEFAULT_ADMIN_ROLE)
        nonReentrant
        returns (uint256 fee)
    {
        fee = _quoteFrontendFee(contentId, roundId, frontend);
        uint48 roundSettledAt = _readRound(contentId, roundId).settledAt;
        (FrontendFeeDisposition disposition,,,) =
            _resolveFrontendFeeDisposition(contentId, roundId, frontend, roundSettledAt);
        if (disposition != FrontendFeeDisposition.Protocol) revert FrontendFeeNotConfiscatable();

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

        if (!votingEngine.roundRbtsScored(contentId, roundId)) revert RoundNotSettled();
        uint256 totalWinningClaimants = votingEngine.roundRbtsRewardClaimants(contentId, roundId);
        if (sortedWinningVoters.length != totalWinningClaimants) revert InvalidFinalizationInput();

        uint256 voterPool = votingEngine.roundVoterPool(contentId, roundId);
        uint256 weightedWinningStake = votingEngine.roundRbtsRewardWeight(contentId, roundId);
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

            uint256 effectiveStake = votingEngine.commitRbtsRewardWeight(contentId, roundId, commitKey);
            if (effectiveStake == 0) {
                revert InvalidFinalizationInput();
            }
            expectedTotal += RewardMath.calculateVoterReward(effectiveStake, weightedWinningStake, voterPool);
        }

        releasedDust = _finalizableDust(voterPool, expectedTotal, roundVoterRewardClaimedAmount[contentId][roundId]);
        if (releasedDust == 0) revert NoRewardDust();

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
        (processedCount, expectedTotal) = _processFrontendFeeDustBatch(contentId, roundId, sortedFrontends);
    }

    /// @notice Finalize frontend-fee dust after all eligible frontend batches have been processed.
    function finalizeProcessedFrontendFeeDust(uint256 contentId, uint256 roundId)
        external
        onlyRole(DEFAULT_ADMIN_ROLE)
        nonReentrant
        returns (uint256 releasedDust)
    {
        releasedDust = _finalizeProcessedFrontendFeeDust(contentId, roundId);
    }

    /// @notice Reset in-progress frontend-fee dust batch accounting so governance can restart a bad cursor.
    function resetFrontendFeeDustBatch(uint256 contentId, uint256 roundId) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (roundFrontendFeeDustFinalized[contentId][roundId]) revert RewardDustAlreadyFinalized();

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
        fee = _quoteFrontendFee(contentId, roundId, frontend);
        uint48 roundSettledAt = _readRound(contentId, roundId).settledAt;
        (disposition, operator,,) = _resolveFrontendFeeDisposition(contentId, roundId, frontend, roundSettledAt);
    }

    /// @notice Snapshot and reserve voter participation rewards for a settled round.
    /// @dev Called by the voting engine during settlement so claims no longer depend on the pool's
    ///      future authorization state or on unrelated rounds consuming the same balance first.
    function snapshotParticipationRewards(
        uint256 contentId,
        uint256 roundId,
        address rewardPool,
        uint256 rewardRateBps,
        uint256 weightedParticipationStake
    ) external nonReentrant {
        if (msg.sender != address(votingEngine)) revert UnauthorizedCaller();

        (uint256 totalReward, uint256 reservedReward, bool fullyReserved) = _syncParticipationRewardSnapshot(
            contentId, roundId, rewardPool, rewardRateBps, weightedParticipationStake, false
        );
        if (!fullyReserved) {
            emit ParticipationRewardSnapshotFailed(contentId, roundId, rewardPool, rewardRateBps, totalReward);
            return;
        }

        emit ParticipationRewardSnapshotted(contentId, roundId, rewardPool, rewardRateBps, totalReward, reservedReward);
    }

    /// @notice Backfill or top up participation reward reservations for a settled round.
    /// @dev Governance can repair settlements where the snapshot side effect failed or top up reservations.
    function backfillParticipationRewards(uint256 contentId, uint256 roundId, address rewardPool, uint256 rewardRateBps)
        external
        onlyRole(DEFAULT_ADMIN_ROLE)
        nonReentrant
        returns (uint256 reservedReward)
    {
        RoundLib.Round memory round = _readRound(contentId, roundId);
        if (round.state != RoundLib.RoundState.Settled) revert RoundNotSettled();
        _requireNoPendingUnrevealedCleanup(contentId, roundId);

        uint256 participationStake = votingEngine.roundRbtsScored(contentId, roundId)
            ? votingEngine.roundRbtsParticipationWeight(contentId, roundId)
            : votingEngine.roundWinningStake(contentId, roundId);
        uint256 totalReward;
        bool fullyReserved;
        (totalReward, reservedReward, fullyReserved) =
            _syncParticipationRewardSnapshot(contentId, roundId, rewardPool, rewardRateBps, participationStake, true);
        if (!fullyReserved) revert PoolDepleted();

        emit ParticipationRewardBackfilled(contentId, roundId, rewardPool, rewardRateBps, totalReward, reservedReward);
    }

    /// @notice Claim a participation reward for the caller on a settled round.
    /// @dev The participation reward is a pure bonus — there is no stake-refund component — so
    ///      the entire payout routes to the current SBT holder resolved by `_resolveClaimCommit`.
    ///      This prevents a rotated/removed delegate from capturing accumulated participation
    ///      bonuses tied to the holder's identity.
    function claimParticipationReward(uint256 contentId, uint256 roundId)
        external
        nonReentrant
        returns (uint256 paidReward)
    {
        if (roundParticipationRewardFinalized[contentId][roundId]) {
            revert ParticipationRewardsAlreadyFinalized();
        }

        RoundLib.Round memory round = _readRound(contentId, roundId);
        if (round.state != RoundLib.RoundState.Settled) revert RoundNotSettled();
        _requireNoPendingUnrevealedCleanup(contentId, roundId);

        address rewardPoolAddress = roundParticipationRewardPool[contentId][roundId];
        uint256 rateBps = roundParticipationRewardRateBps[contentId][roundId];
        uint256 totalReward = roundParticipationRewardOwed[contentId][roundId];
        uint256 reservedReward = roundParticipationRewardReserved[contentId][roundId];
        if (rewardPoolAddress == address(0)) revert NoPool();

        (bytes32 commitKey, address rewardRecipient) = _resolveClaimCommit(contentId, roundId, msg.sender);
        if (commitKey == bytes32(0)) revert NoCommit();
        RoundLib.Commit memory commit = _readCommit(contentId, roundId, commitKey);
        if (commit.voter == address(0)) revert NoCommit();
        if (
            participationRewardCommitClaimed[contentId][roundId][commitKey]
                || participationRewardClaimed[contentId][roundId][commit.voter]
        ) {
            revert AlreadyClaimed();
        }
        if (!commit.revealed) revert VoteNotRevealed();
        if (commit.stakeAmount == 0) revert NoStake();

        if (rateBps == 0) revert NoParticipationRate();

        bool rbtsRewardRound = votingEngine.roundRbtsScored(contentId, roundId);
        uint256 effectiveStake;
        if (rbtsRewardRound) {
            effectiveStake = votingEngine.commitRbtsScoringWeight(contentId, roundId, commitKey);
        } else {
            effectiveStake = (commit.stakeAmount * RoundLib.epochWeightBps(commit.epochIndex)) / 10000;
        }
        if (effectiveStake == 0 || (!rbtsRewardRound && commit.isUp != round.upWins)) revert NotWinningSide();
        uint256 reward = effectiveStake * rateBps / 10000;
        if (reward == 0) {
            participationRewardCommitClaimed[contentId][roundId][commitKey] = true;
            participationRewardClaimed[contentId][roundId][commit.voter] = true;
            roundParticipationRewardFullyClaimedCount[contentId][roundId] += 1;
            return 0;
        }

        uint256 currentlyClaimable = reward;
        if (reservedReward < totalReward) {
            currentlyClaimable = (reward * reservedReward) / totalReward;
        }
        if (currentlyClaimable == 0) revert PoolDepleted();

        uint256 alreadyPaid = participationRewardCommitPaid[contentId][roundId][commitKey];
        if (alreadyPaid >= currentlyClaimable) revert AlreadyClaimed();

        uint256 remainingReward = currentlyClaimable - alreadyPaid;
        paidReward = IParticipationPool(rewardPoolAddress).withdrawReservedReward(rewardRecipient, remainingReward);
        if (paidReward == 0) revert PoolDepleted();

        uint256 totalPaid = alreadyPaid + paidReward;
        participationRewardCommitPaid[contentId][roundId][commitKey] = totalPaid;
        participationRewardPaid[contentId][roundId][commit.voter] = totalPaid;
        roundParticipationRewardPaidTotal[contentId][roundId] += paidReward;
        if (totalPaid == reward) {
            participationRewardCommitClaimed[contentId][roundId][commitKey] = true;
            participationRewardClaimed[contentId][roundId][commit.voter] = true;
            roundParticipationRewardFullyClaimedCount[contentId][roundId] += 1;
        }

        emit ParticipationRewardClaimed(contentId, roundId, rewardRecipient, paidReward);
    }

    /// @notice Release participation-reward dust, or stale unclaimed reservations after the finalization delay.
    /// @dev Permissionless when every winner has fully claimed (only mathematical dust remains).
    ///      Admin-only when finalizing via the stale-time branch with unclaimed winners — otherwise
    ///      a griefer could trigger the cliff on every settled round to maximize forfeitures, since
    ///      claimParticipationReward reverts once `roundParticipationRewardFinalized` is set.
    function finalizeParticipationRewards(uint256 contentId, uint256 roundId)
        external
        nonReentrant
        returns (uint256 releasedDust)
    {
        if (roundParticipationRewardFinalized[contentId][roundId]) {
            revert ParticipationRewardsAlreadyFinalized();
        }

        RoundLib.Round memory round = _readRound(contentId, roundId);
        if (round.state != RoundLib.RoundState.Settled) revert RoundNotSettled();
        _requireNoPendingUnrevealedCleanup(contentId, roundId);

        uint256 winnerCount = votingEngine.roundRbtsScored(contentId, roundId)
            ? votingEngine.roundRbtsParticipationClaimants(contentId, roundId)
            : (round.upWins ? round.upCount : round.downCount);
        bool fullyClaimed = roundParticipationRewardFullyClaimedCount[contentId][roundId] == winnerCount;
        bool stale = _participationRewardsStale(contentId, roundId, round);
        if (!fullyClaimed && !stale) revert ParticipationRewardsOutstanding();
        if (!fullyClaimed && !hasRole(DEFAULT_ADMIN_ROLE, msg.sender)) revert UnauthorizedCaller();

        address rewardPoolAddress = roundParticipationRewardPool[contentId][roundId];
        if (rewardPoolAddress == address(0)) revert NoPool();

        uint256 reservedReward = roundParticipationRewardReserved[contentId][roundId];
        uint256 paidTotal = roundParticipationRewardPaidTotal[contentId][roundId];
        releasedDust = reservedReward > paidTotal ? reservedReward - paidTotal : 0;

        roundParticipationRewardFinalized[contentId][roundId] = true;
        if (releasedDust > 0) {
            releasedDust = IParticipationPool(rewardPoolAddress).releaseReservedReward(releasedDust);
            roundParticipationRewardReserved[contentId][roundId] = reservedReward - releasedDust;
        }

        emit ParticipationRewardFinalized(contentId, roundId, rewardPoolAddress, releasedDust);
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
            return RoundLib.Commit(address(0), 0, "", 0, bytes32(0), address(0), 0, false, false, 0);
        }
        return _readCommit(contentId, roundId, commitKey);
    }

    function _findVoterCommitKey(uint256 contentId, uint256 roundId, address voter) internal view returns (bytes32) {
        bytes32 commitHash = votingEngine.voterCommitHash(contentId, roundId, voter);
        if (commitHash == bytes32(0)) return bytes32(0);
        return keccak256(abi.encodePacked(voter, commitHash));
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
            round.upPool,
            round.downPool,
            round.upCount,
            round.downCount,
            round.upWins,
            round.settledAt,
            round.thresholdReachedAt,
            round.weightedUpPool,
            round.weightedDownPool
        ) = votingEngine.rounds(contentId, roundId);
    }

    function _readCommit(uint256 contentId, uint256 roundId, bytes32 commitKey)
        internal
        view
        returns (RoundLib.Commit memory commit)
    {
        // Use the narrow getter that skips `ciphertext` / `targetRound` / `drandChainHash`,
        // avoiding ~2 KB of memory expansion per commit during bounds-limit dust finalization.
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
        returns (uint256 fee)
    {
        RoundLib.Round memory round = _readRound(contentId, roundId);
        if (round.state != RoundLib.RoundState.Settled) revert RoundNotSettled();
        _requireNoPendingUnrevealedCleanup(contentId, roundId);
        if (frontendFeeClaimed[contentId][roundId][frontend]) revert AlreadyClaimed();

        uint256 totalFrontendPool = votingEngine.roundFrontendPool(contentId, roundId);
        uint256 frontendStake = votingEngine.roundPerFrontendStake(contentId, roundId, frontend);
        uint256 totalEligibleStake = votingEngine.roundStakeWithEligibleFrontend(contentId, roundId);
        uint256 totalFrontendClaimants = votingEngine.roundEligibleFrontendCount(contentId, roundId);

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
        if (votingEngine.roundUnrevealedCleanupRemaining(contentId, roundId) > 0) {
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
        FrontendFeeDisposition disposition
    ) internal {
        if (fee == 0) return;

        address snapshotRegistryAddress = votingEngine.roundFrontendRegistrySnapshot(contentId, roundId);
        if (disposition == FrontendFeeDisposition.Direct || snapshotRegistryAddress == address(0)) {
            votingEngine.transferReward(frontend, fee);
            return;
        }

        if (disposition == FrontendFeeDisposition.Protocol) {
            _routeRewardToProtocol(fee);
            return;
        }

        IFrontendRegistry snapshotRegistry = IFrontendRegistry(snapshotRegistryAddress);

        try snapshotRegistry.creditFees(frontend, fee) {
            votingEngine.transferReward(snapshotRegistryAddress, fee);
        } catch {
            emit FrontendFeeCreditFailed(contentId, roundId, frontend, snapshotRegistryAddress, fee);
            _routeRewardToProtocol(fee);
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

        uint256 totalFrontendClaimants = votingEngine.roundEligibleFrontendCount(contentId, roundId);
        if (
            totalFrontendClaimants == 0
                || roundFrontendFeeDustProcessedCount[contentId][roundId] != totalFrontendClaimants
        ) {
            revert InvalidFinalizationInput();
        }

        uint256 totalFrontendPool = votingEngine.roundFrontendPool(contentId, roundId);
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

    function _syncParticipationRewardSnapshot(
        uint256 contentId,
        uint256 roundId,
        address rewardPool,
        uint256 rewardRateBps,
        uint256 participationStake,
        bool requireFullReservation
    ) internal returns (uint256 totalReward, uint256 reservedReward, bool fullyReserved) {
        if (rewardPool == address(0)) revert NoPool();
        if (rewardRateBps == 0) revert NoParticipationRate();
        if (roundParticipationRewardFinalized[contentId][roundId]) revert InvalidParticipationSnapshot();

        address existingRewardPool = roundParticipationRewardPool[contentId][roundId];
        if (existingRewardPool != address(0) && existingRewardPool != rewardPool) {
            revert InvalidParticipationSnapshot();
        }

        uint256 existingRateBps = roundParticipationRewardRateBps[contentId][roundId];
        if (existingRateBps != 0 && existingRateBps != rewardRateBps) revert InvalidParticipationSnapshot();

        totalReward = roundParticipationRewardOwed[contentId][roundId];
        if (totalReward == 0) {
            totalReward = participationStake * rewardRateBps / 10000;
        }

        reservedReward = roundParticipationRewardReserved[contentId][roundId];
        uint256 previousReservedReward = reservedReward;
        if (reservedReward < totalReward) {
            uint256 additionalReserved =
                IParticipationPool(rewardPool).reserveReward(address(this), totalReward - reservedReward);
            if (additionalReserved > 0) {
                uint256 nextReservedReward = reservedReward + additionalReserved;
                if (nextReservedReward < totalReward) {
                    uint256 releasedReserved = IParticipationPool(rewardPool).releaseReservedReward(additionalReserved);
                    if (releasedReserved != additionalReserved) revert InvalidParticipationSnapshot();
                    if (requireFullReservation) revert PoolDepleted();
                    return (totalReward, reservedReward, false);
                }
                reservedReward = nextReservedReward;
            } else if (requireFullReservation) {
                revert PoolDepleted();
            } else if (totalReward > 0) {
                return (totalReward, reservedReward, false);
            }
        }

        roundParticipationRewardPool[contentId][roundId] = rewardPool;
        roundParticipationRewardRateBps[contentId][roundId] = rewardRateBps;
        if (roundParticipationRewardOwed[contentId][roundId] == 0) {
            roundParticipationRewardOwed[contentId][roundId] = totalReward;
        }
        roundParticipationRewardReserved[contentId][roundId] = reservedReward;
        if (roundParticipationRewardClaimableAt[contentId][roundId] == 0 || reservedReward > previousReservedReward) {
            roundParticipationRewardClaimableAt[contentId][roundId] = uint48(block.timestamp);
        }
        fullyReserved = true;
    }

    function _participationRewardsStale(uint256 contentId, uint256 roundId, RoundLib.Round memory round)
        internal
        view
        returns (bool)
    {
        uint256 claimableAt = roundParticipationRewardClaimableAt[contentId][roundId];
        if (claimableAt == 0) claimableAt = round.settledAt;
        return claimableAt != 0 && block.timestamp >= claimableAt + STALE_REWARD_FINALIZATION_DELAY;
    }

    function _protocolTreasury() internal view returns (address) {
        return ProtocolConfig(votingEngine.protocolConfig()).treasury();
    }

    // Appended state for batched frontend fee dust finalization.
    mapping(uint256 => mapping(uint256 => uint256)) public roundFrontendFeeDustProcessedCount;
    mapping(uint256 => mapping(uint256 => uint256)) public roundFrontendFeeDustExpectedTotal;
    mapping(uint256 => mapping(uint256 => address)) public roundFrontendFeeDustLastFrontend;

    // --- Storage Gap for Future Upgrades ---
    uint256[31] private __gap;
}
