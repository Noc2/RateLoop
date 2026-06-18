// SPDX-License-Identifier: MIT
pragma solidity ^0.8.34;

import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { SafeCast } from "@openzeppelin/contracts/utils/math/SafeCast.sol";
import { MerkleProof } from "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";
import { ReentrancyGuardTransient } from "@openzeppelin/contracts/utils/ReentrancyGuardTransient.sol";
import { RaterRegistry } from "./RaterRegistry.sol";
import { IClusterPayoutOracle } from "./interfaces/IClusterPayoutOracle.sol";
import {
    ILaunchDistributionPool,
    IRoundClusterReadyAtSource,
    IRevealGraceConfig
} from "./interfaces/ILaunchDistributionPool.sol";
import { IRoundPayoutSnapshotConsumer } from "./interfaces/IRoundPayoutSnapshotConsumer.sol";

interface ILaunchReadySourceProtocolConfig {
    function launchDistributionPool() external view returns (address);
    function raterRegistry() external view returns (address);
}

/// @title LaunchDistributionPool
/// @notice Holds the 75M LREP launch allocation and releases it through verified/referral, earned, and legacy paths.
contract LaunchDistributionPool is
    ILaunchDistributionPool,
    IRoundPayoutSnapshotConsumer,
    Ownable,
    ReentrancyGuardTransient
{
    using SafeERC20 for IERC20;
    using SafeCast for uint256;

    error InvalidAddress();
    error InvalidAmount();
    error InvalidProof();
    error AlreadyClaimed();
    error NotVerified();
    error PoolDepleted();
    error InvalidPolicy();
    error SnapshotNotFinalized();
    error LegacyClaimWindowClosed();
    error LegacyClaimWindowOpen();
    error PendingCreditNotStale();

    uint256 public constant VERIFIED_REFERRAL_POOL_AMOUNT = 42_000_000e6;
    uint256 public constant EARNED_RATER_POOL_AMOUNT = 24_000_000e6;
    uint256 public constant LEGACY_CONTRIBUTOR_POOL_AMOUNT = 9_000_000e6;
    uint256 public constant TOTAL_POOL_AMOUNT =
        VERIFIED_REFERRAL_POOL_AMOUNT + EARNED_RATER_POOL_AMOUNT + LEGACY_CONTRIBUTOR_POOL_AMOUNT;

    uint32 public constant ELIGIBILITY_RATING_COUNT = 5;
    uint32 public constant REWARDING_RATING_COUNT = 10;
    uint16 public constant MIN_QUALIFYING_SCORE_BPS = 7_000;
    uint16 public constant MIN_EARNED_REWARD_VOTERS = 3;
    uint16 public constant MIN_EARNED_REWARD_VERIFIED_HUMANS = 1;
    uint16 public constant MIN_EARNED_REWARD_DISTINCT_VERIFIED_ANCHORS = 2;
    uint16 public constant MIN_EARNED_REWARD_DISTINCT_ANCHOR_ROUNDS = 2;
    uint64 public constant MIN_LAUNCH_CREDIT_STAKE = 1e6;
    uint16 public constant MAX_DISTINCT_RATERS_PER_VERIFIED_ANCHOR = 25;
    uint16 public constant MAX_UNVERIFIED_LAUNCH_CREDITS_PER_ROUND = 3;
    uint16 public constant DEFAULT_UNVERIFIED_EARNED_RATER_CAP_BPS = 2_500;
    uint16 public constant BPS_DENOMINATOR = 10_000;
    uint8 public constant PAYOUT_DOMAIN_LAUNCH_CREDIT = 2;
    uint32 public constant MIN_ANCHOR_CREDENTIAL_AGE_SECONDS = 7 days;
    uint16 public constant LEGACY_IMMEDIATE_BPS = 100;
    uint64 public constant LEGACY_VESTING_DURATION = 730 days;
    uint64 public constant LEGACY_CLAIM_GRACE_PERIOD = 91 days;
    uint64 public constant LEGACY_CLAIM_DURATION = LEGACY_VESTING_DURATION + LEGACY_CLAIM_GRACE_PERIOD;
    uint64 public constant STALE_PENDING_EARNED_RATER_CREDIT_DELAY = 30 days;

    uint256 public constant REFERRAL_BONUS_BPS = 5_000;
    uint256 public constant MAX_REFERRAL_REWARD_PER_REFERRER = 10_000e6;

    struct PendingEarnedRaterCredit {
        address rater;
        address oracle;
        uint16 scoreBps;
        LaunchRewardPolicy policy;
        bool pending;
    }

    IERC20 public immutable lrepToken;
    RaterRegistry public raterRegistry;
    IClusterPayoutOracle public clusterPayoutOracle;
    /// @notice M-Oracle-1: authoritative source for round source-readiness (queried by
    ///         {roundPayoutSnapshotSourceReadyAt}). When set, takes precedence over the
    ///         per-record `launchRoundSourceReadyAt` fallback. Wired to RoundVotingEngine at
    ///         deploy time.
    IRoundClusterReadyAtSource public roundClusterReadyAtSource;
    address public governance;
    uint256 public poolBalance;
    uint256 public earnedRaterDistributed;
    uint256 public verifiedReferralDistributed;
    uint256 public legacyContributorDistributed;
    uint256 public legacyContributorTreasuryRecovered;
    uint256 public legacyContributorAllocationTotal;
    bytes32 public legacyContributorRoot;
    uint64 public legacyContributorVestingStart;

    uint256 internal eligibleRaterCount;
    uint256 internal verifiedClaimCount;

    mapping(address => bool) public authorizedCallers;
    mapping(address => uint32) public qualifyingRatingCount;
    mapping(address => uint256) public qualifyingCreditBps;
    mapping(address => uint32) public rewardedRatingCount;
    mapping(address => bool) public raterLaunchCapAssigned;
    mapping(address => uint256) public raterLaunchCap;
    mapping(address => uint256) public raterFullLaunchCap;
    mapping(address => bool) public raterFullLaunchCapUnlocked;
    mapping(address => bytes32) public raterLaunchCapNullifier;
    mapping(address => uint256) public raterLaunchPaid;
    mapping(bytes32 => bool) public verifiedCredentialClaimed;
    mapping(bytes32 => address) public launchFullCapNullifierRater;
    mapping(address => bool) internal verifiedBonusClaimedByAccount;
    mapping(address => uint256) public referralEarnings;
    mapping(address => uint256) public legacyContributorClaimed;
    mapping(uint256 => mapping(uint256 => mapping(bytes32 => bool))) public earnedRewardCreditRecorded;
    mapping(address => mapping(bytes32 => bool)) public raterVerifiedAnchorSeen;
    mapping(address => uint32) public raterDistinctVerifiedAnchorCount;
    mapping(address => mapping(bytes32 => bool)) internal raterAnchorRoundSeen;
    mapping(address => uint32) public raterDistinctAnchorRoundCount;
    mapping(bytes32 => mapping(address => bool)) public verifiedAnchorRaterSeen;
    mapping(bytes32 => uint32) public verifiedAnchorDistinctRaterCount;
    mapping(bytes32 => mapping(address => uint32)) public pendingVerifiedAnchorReservationCount;
    mapping(address => mapping(uint256 => mapping(uint256 => bool))) public raterRoundCreditRecorded;
    mapping(uint256 => mapping(uint256 => uint16)) public roundUnverifiedLaunchCreditCount;
    mapping(uint256 => mapping(uint256 => mapping(bytes32 => PendingEarnedRaterCredit))) public
        pendingEarnedRaterCredits;
    mapping(uint256 => mapping(uint256 => mapping(bytes32 => uint64))) public pendingEarnedRaterCreditReadyAt;
    mapping(uint256 => mapping(uint256 => mapping(bytes32 => bytes32[]))) internal pendingEarnedRaterCreditAnchorIds;
    /// @notice L-Launch-A: idempotency marker for {cancelStalePendingEarnedRaterCredit}. Without
    ///         it a repeat cancel re-emits the cancellation event (confusing indexers/keepers)
    ///         and, when the rater holds another pending credit sharing an anchor, decrements
    ///         that sibling credit's shared reservation count a second time. Cancellation is
    ///         terminal for the pending ticket; recorded flags remain as the one-shot audit trail.
    ///         Internal (no auto-getter) to fit the EIP-170 budget; observe cancellation via the
    ///         event or the AlreadyClaimed revert.
    mapping(uint256 => mapping(uint256 => mapping(bytes32 => bool))) internal stalePendingEarnedRaterCreditCancelled;
    mapping(uint256 => mapping(uint256 => mapping(bytes32 => bool))) public earnedRewardCreditFinalized;
    mapping(uint256 => mapping(uint256 => bool)) internal earnedRaterRoundPayoutSnapshotConsumed;
    /// @notice M-Oracle-1: Earliest sourceReadyAt observed for a given (contentId, roundId).
    ///         Set on the first pending earned-rater credit recorded for the round and surfaced via
    ///         {roundPayoutSnapshotSourceReadyAt} so the cluster oracle can reject pre-source
    ///         slot-squat proposals. Once set the value is monotonic — later credits with later
    ///         sourceReadyAt do not overwrite it.
    mapping(uint256 => mapping(uint256 => uint64)) internal launchRoundSourceReadyAt;
    LaunchRewardPolicy public launchRewardPolicy;

    event PoolDeposit(uint256 amount);
    event PoolWithdrawal(address indexed to, uint256 amount);
    event SurplusRecovered(address indexed to, uint256 amount);
    event GovernanceUpdated(address indexed governance);
    event RoundClusterReadyAtSourceUpdated(address indexed source);
    event AuthorizedCallerUpdated(address indexed caller, bool authorized);
    event LaunchRewardPolicyUpdated(LaunchRewardPolicy policy);
    event RaterLaunchCapAssigned(address indexed rater, uint256 cap, uint256 cohortIndex);
    event RaterLaunchCapStatusUpdated(
        address indexed rater, uint256 activeCap, uint256 fullCap, uint16 activeCapBps, bool fullCapUnlocked
    );
    event RaterLaunchCapUnlocked(
        address indexed rater, bytes32 indexed nullifierHash, uint256 previousCap, uint256 fullCap, uint256 catchUpPaid
    );
    event EarnedRaterRewardCreditRecorded(
        address indexed rater,
        uint256 indexed contentId,
        uint256 indexed roundId,
        bytes32 commitKey,
        uint16 scoreBps,
        uint32 qualifyingRatingCount,
        uint256 qualifyingCreditBps,
        uint32 distinctVerifiedAnchorCount,
        uint32 distinctAnchorRoundCount,
        bool payoutEligible
    );
    event EarnedRaterRewardCreditPending(
        address indexed rater, uint256 indexed contentId, uint256 indexed roundId, bytes32 commitKey, uint16 scoreBps
    );
    event StalePendingEarnedRaterCreditCancelled(
        address indexed rater, uint256 indexed contentId, uint256 indexed roundId, bytes32 commitKey
    );
    /// @notice Emitted when governance repoints a pending earned-rater credit whose oracle pin
    ///         has become stale after a cluster oracle rotation.
    event StalePendingEarnedRaterCreditRescued(
        address indexed rater,
        uint256 indexed contentId,
        uint256 indexed roundId,
        bytes32 commitKey,
        address staleOracle
    );
    event EarnedRaterRewardCreditFinalized(
        address indexed rater,
        uint256 indexed contentId,
        uint256 indexed roundId,
        bytes32 commitKey,
        uint16 independenceBps,
        uint256 effectiveCreditBps,
        uint256 qualifyingCreditBps
    );
    event EarnedRaterRewardPaid(
        address indexed rater,
        uint256 indexed contentId,
        uint256 indexed roundId,
        bytes32 commitKey,
        uint256 amount,
        uint16 scoreBps,
        uint32 qualifyingRatingCount,
        uint256 qualifyingCreditBps,
        uint32 rewardedRatingCount,
        uint32 distinctVerifiedAnchorCount,
        uint32 distinctAnchorRoundCount
    );
    event VerifiedBonusClaimed(address indexed account, uint256 amount, bytes32 indexed nullifierHash);
    event ReferralBonusPaid(address indexed referrer, address indexed referee, uint256 amount);
    event LegacyContributorRootUpdated(bytes32 indexed root, uint256 allocationTotal, uint64 vestingStart);
    event LegacyContributorClaimed(
        address indexed account, address indexed recipient, uint256 amount, uint256 allocation, uint256 totalClaimed
    );
    event LegacyContributorUnclaimedSwept(address indexed treasury, uint256 amount);

    modifier onlyAuthorized() {
        if (!authorizedCallers[msg.sender]) revert InvalidAddress();
        _;
    }

    constructor(address _lrepToken, address _raterRegistry, address _governance) Ownable(msg.sender) {
        if (_lrepToken == address(0) || _raterRegistry == address(0) || _governance == address(0)) {
            revert InvalidAddress();
        }
        _validateRaterRegistry(_raterRegistry);
        lrepToken = IERC20(_lrepToken);
        raterRegistry = RaterRegistry(_raterRegistry);
        governance = _governance;
        _setLaunchRewardPolicy(_defaultLaunchRewardPolicy());
    }

    function transferOwnership(address newOwner) public override onlyOwner {
        if (newOwner != governance) revert InvalidAddress();
        super.transferOwnership(newOwner);
    }

    function renounceOwnership() public pure override {
        revert InvalidAddress();
    }

    function setGovernance(address newGovernance) external onlyOwner {
        if (newGovernance == address(0)) revert InvalidAddress();
        if (msg.sender != governance) revert InvalidAddress();
        governance = newGovernance;
        _transferOwnership(newGovernance);
    }

    function setRaterRegistry(address newRegistry) external onlyOwner {
        _validateRaterRegistry(newRegistry);
        if (address(roundClusterReadyAtSource) != address(0)) {
            _validateRoundClusterReadyAtSource(address(roundClusterReadyAtSource), newRegistry);
        }
        raterRegistry = RaterRegistry(newRegistry);
    }

    function setClusterPayoutOracle(address newOracle) external onlyOwner {
        if (address(roundClusterReadyAtSource) == address(0)) revert InvalidAddress();
        _validateClusterPayoutOracle(newOracle);
        clusterPayoutOracle = IClusterPayoutOracle(newOracle);
    }

    /// @notice M-Oracle-1: configure the authoritative round source-readiness oracle (the
    ///         RoundVotingEngine). Must be set before the cluster oracle is enabled.
    function setRoundClusterReadyAtSource(address newSource) external onlyOwner {
        if (newSource == address(0)) revert InvalidAddress();
        _validateRoundClusterReadyAtSource(newSource, address(raterRegistry));
        roundClusterReadyAtSource = IRoundClusterReadyAtSource(newSource);
        emit RoundClusterReadyAtSourceUpdated(newSource);
    }

    /// @notice Governance rescue for pending earned-rater credits pinned to a now-stale oracle.
    /// @dev Keeps the original one-shot credit record intact and only repoints the pending
    ///      proof verifier. Advisory launch credits cannot reliably be re-recorded after their
    ///      advisory claim path is consumed, so deleting the pending ticket would strand them.
    /// @param contentId Content the pending credit belongs to.
    /// @param roundId Round the pending credit belongs to.
    /// @param commitKey Per-rater commit identifier on the pending entry.
    /// @param newReadyAt Optional override for `pendingEarnedRaterCreditReadyAt`. Pass 0 to keep
    ///        the existing value, or a non-zero value at or before the new oracle's snapshot
    ///        propose time to unblock finalize (L-Oracle-C). The legacy
    ///        `recordEarnedRaterReward` entrypoint writes `sourceReadyAt = block.timestamp`; if
    ///        that record happened AFTER the new oracle had already snapshotted the round, the
    ///        original readyAt is greater than the new oracle's proposedAt and finalize is
    ///        permanently stuck. This override lets governance reset readyAt to a value the
    ///        new oracle's snapshot post-dates.
    function rescueStalePendingEarnedRaterCredit(
        uint256 contentId,
        uint256 roundId,
        bytes32 commitKey,
        uint64 newReadyAt
    ) external onlyOwner {
        PendingEarnedRaterCredit storage pending = pendingEarnedRaterCredits[contentId][roundId][commitKey];
        if (!pending.pending) revert InvalidAmount();
        if (earnedRewardCreditFinalized[contentId][roundId][commitKey]) revert AlreadyClaimed();
        address currentOracle = address(clusterPayoutOracle);
        if (currentOracle == address(0) || pending.oracle == currentOracle) revert InvalidAddress();
        address staleOracle = pending.oracle;
        pending.oracle = currentOracle;
        if (newReadyAt != 0) {
            // L-Oracle-C: refuse to advance readyAt into the future relative to current block —
            // would silently strand the credit. Allow stepping backwards to before the new
            // oracle's snapshot proposedAt. Governance-only function; the L2 sequencer's
            // ~20s timestamp drift is well below the cluster oracle's challenge window
            // (12 h default) so timestamp dependence is intentional and safe here.
            // slither-disable-next-line timestamp
            if (uint256(newReadyAt) > block.timestamp) revert InvalidAmount();
            pendingEarnedRaterCreditReadyAt[contentId][roundId][commitKey] = newReadyAt;
        }
        emit StalePendingEarnedRaterCreditRescued(pending.rater, contentId, roundId, commitKey, staleOracle);
    }

    function cancelStalePendingEarnedRaterCredit(uint256 contentId, uint256 roundId, bytes32 commitKey)
        external
        onlyOwner
    {
        // L-Launch-A: one-shot. The reservations were already released by a prior cancel; running
        // the release again would corrupt shared per-anchor reservation counts and re-emit the event.
        // The pending credit itself remains finalizable; cancellation only frees stale reservations.
        if (stalePendingEarnedRaterCreditCancelled[contentId][roundId][commitKey]) revert AlreadyClaimed();
        PendingEarnedRaterCredit memory pending = pendingEarnedRaterCredits[contentId][roundId][commitKey];
        if (!pending.pending) revert InvalidAmount();
        if (earnedRewardCreditFinalized[contentId][roundId][commitKey]) revert AlreadyClaimed();
        uint64 readyAt = pendingEarnedRaterCreditReadyAt[contentId][roundId][commitKey];
        if (readyAt == 0 || block.timestamp < uint256(readyAt) + STALE_PENDING_EARNED_RATER_CREDIT_DELAY) {
            revert PendingCreditNotStale();
        }
        stalePendingEarnedRaterCreditCancelled[contentId][roundId][commitKey] = true;
        _releasePendingVerifiedAnchorReservations(contentId, roundId, commitKey, pending.rater);
        emit StalePendingEarnedRaterCreditCancelled(pending.rater, contentId, roundId, commitKey);
    }

    function setAuthorizedCaller(address caller, bool authorized) external onlyOwner {
        if (caller == address(0)) revert InvalidAddress();
        authorizedCallers[caller] = authorized;
        emit AuthorizedCallerUpdated(caller, authorized);
    }

    function setLaunchRewardPolicy(LaunchRewardPolicy calldata policy) external onlyOwner {
        _setLaunchRewardPolicy(policy);
    }

    function setLegacyContributorRoot(bytes32 root, uint256 allocationTotal) external onlyOwner {
        if (root == bytes32(0)) revert InvalidProof();
        if (allocationTotal != LEGACY_CONTRIBUTOR_POOL_AMOUNT) revert InvalidAmount();
        if (legacyContributorRoot != bytes32(0)) revert AlreadyClaimed();
        if (legacyContributorDistributed != 0 || legacyContributorTreasuryRecovered != 0) revert AlreadyClaimed();
        if (_legacyContributorClaimWindowClosed()) revert AlreadyClaimed();
        legacyContributorRoot = root;
        legacyContributorAllocationTotal = allocationTotal;
        legacyContributorVestingStart = uint64(block.timestamp);
        emit LegacyContributorRootUpdated(root, allocationTotal, legacyContributorVestingStart);
    }

    function depositPool(uint256 amount) external {
        if (amount == 0) revert InvalidAmount();
        lrepToken.safeTransferFrom(msg.sender, address(this), amount);
        poolBalance += amount;
        emit PoolDeposit(amount);
    }

    function accountPrefundedPoolDeposit(uint256 amount) external onlyOwner {
        if (amount == 0) revert InvalidAmount();
        uint256 actualBalance = lrepToken.balanceOf(address(this));
        uint256 untracked = actualBalance > poolBalance ? actualBalance - poolBalance : 0;
        if (amount > untracked) revert InvalidAmount();
        poolBalance += amount;
        emit PoolDeposit(amount);
    }

    /// @notice Governance recovery valve for withdrawing tracked launch balance during redeploys.
    function withdrawRemaining(address to, uint256 amount) external onlyOwner nonReentrant returns (uint256 withdrawn) {
        if (to == address(0)) revert InvalidAddress();
        if (owner() != governance) revert InvalidAddress();
        uint256 withdrawable = poolBalance;
        withdrawn = amount > withdrawable ? withdrawable : amount;
        if (withdrawn == 0) revert InvalidAmount();
        poolBalance -= withdrawn;
        lrepToken.safeTransfer(to, withdrawn);
        emit PoolWithdrawal(to, withdrawn);
    }

    function recoverSurplus(address to, uint256 amount) external onlyOwner nonReentrant returns (uint256 recovered) {
        if (to == address(0)) revert InvalidAddress();
        uint256 actualBalance = lrepToken.balanceOf(address(this));
        uint256 surplus = actualBalance > poolBalance ? actualBalance - poolBalance : 0;
        recovered = amount > surplus ? surplus : amount;
        if (recovered == 0) revert InvalidAmount();
        lrepToken.safeTransfer(to, recovered);
        emit SurplusRecovered(to, recovered);
    }

    function sweepExpiredLegacyContributorAllocationToTreasury()
        external
        onlyOwner
        nonReentrant
        returns (uint256 sweptAmount)
    {
        if (legacyContributorRoot == bytes32(0)) revert InvalidProof();
        if (!_legacyContributorClaimWindowClosed()) revert LegacyClaimWindowOpen();

        uint256 recovered = legacyContributorTreasuryRecovered;
        uint256 allocationTotal = legacyContributorAllocationTotal;
        uint256 claimedOrRecovered = legacyContributorDistributed + recovered;
        sweptAmount = allocationTotal > claimedOrRecovered ? allocationTotal - claimedOrRecovered : 0;
        if (sweptAmount == 0) revert AlreadyClaimed();

        legacyContributorTreasuryRecovered = recovered + sweptAmount;
        _pay(governance, sweptAmount);
        emit LegacyContributorUnclaimedSwept(governance, sweptAmount);
    }

    function claimVerifiedBonus(address referrer) external nonReentrant returns (uint256 paidAmount) {
        (bytes32 nullifierHash, bytes32 credentialKey) = _activeHumanCredential(msg.sender);
        if (nullifierHash == bytes32(0)) revert NotVerified();
        if (verifiedCredentialClaimed[credentialKey] || verifiedBonusClaimedByAccount[msg.sender]) {
            revert AlreadyClaimed();
        }

        uint256 baseBonus = currentVerifiedBonus();
        uint256 remaining = _remainingVerifiedReferralPool();
        if (baseBonus == 0 || remaining < baseBonus) revert PoolDepleted();

        verifiedCredentialClaimed[credentialKey] = true;
        verifiedBonusClaimedByAccount[msg.sender] = true;
        verifiedClaimCount += 1;
        verifiedReferralDistributed += baseBonus;
        paidAmount = _pay(msg.sender, baseBonus);
        emit VerifiedBonusClaimed(msg.sender, paidAmount, nullifierHash);

        uint256 referralBonus = _claimReferralBonus(referrer, msg.sender, baseBonus);
        paidAmount += referralBonus;
    }

    function claimLegacyContributorAllocation(uint256 allocation, bytes32[] calldata proof)
        external
        nonReentrant
        returns (uint256 paidAmount)
    {
        paidAmount = _claimLegacyContributorAllocation(msg.sender, msg.sender, allocation, proof);
    }

    function claimLegacyContributorAllocationTo(address recipient, uint256 allocation, bytes32[] calldata proof)
        external
        nonReentrant
        returns (uint256 paidAmount)
    {
        paidAmount = _claimLegacyContributorAllocation(msg.sender, recipient, allocation, proof);
    }

    function _claimLegacyContributorAllocation(
        address account,
        address recipient,
        uint256 allocation,
        bytes32[] calldata proof
    ) private returns (uint256 paidAmount) {
        if (recipient == address(0)) revert InvalidAddress();
        _validateLegacyContributorProof(account, allocation, proof);
        if (_legacyContributorClaimWindowClosed()) revert LegacyClaimWindowClosed();
        paidAmount = _claimableLegacyContributorAllocation(account, allocation);
        if (paidAmount == 0) revert AlreadyClaimed();
        if (legacyContributorDistributed + paidAmount > legacyContributorAllocationTotal) revert PoolDepleted();
        if (paidAmount > _remainingLegacyContributorPool()) revert PoolDepleted();

        uint256 totalClaimed = legacyContributorClaimed[account] + paidAmount;
        legacyContributorClaimed[account] = totalClaimed;
        legacyContributorDistributed += paidAmount;
        _pay(recipient, paidAmount);
        emit LegacyContributorClaimed(account, recipient, paidAmount, allocation, totalClaimed);
    }

    function unlockFullEarnedRaterCap(address rater) external nonReentrant returns (uint256 catchUpPaid) {
        if (rater == address(0)) revert InvalidAddress();
        if (!raterLaunchCapAssigned[rater]) revert InvalidAmount();
        if (raterFullLaunchCapUnlocked[rater]) return 0;

        (bytes32 nullifierHash, bytes32 credentialKey) = _activeHumanCredential(rater);
        if (nullifierHash == bytes32(0)) revert NotVerified();

        address claimedBy = launchFullCapNullifierRater[credentialKey];
        if (claimedBy != address(0) && claimedBy != rater) revert AlreadyClaimed();

        uint256 previousCap = raterLaunchCap[rater];
        uint256 fullCap = raterFullLaunchCap[rater];
        raterFullLaunchCapUnlocked[rater] = true;
        raterLaunchCapNullifier[rater] = nullifierHash;
        launchFullCapNullifierRater[credentialKey] = rater;
        raterLaunchCap[rater] = fullCap;

        catchUpPaid = _payLaunchCapCatchUp(rater, fullCap, launchRewardPolicy);
        emit RaterLaunchCapStatusUpdated(rater, fullCap, fullCap, BPS_DENOMINATOR, true);
        emit RaterLaunchCapUnlocked(rater, nullifierHash, previousCap, fullCap, catchUpPaid);
    }

    function recordEarnedRaterRewardWithSourceReady(
        address rater,
        uint256 contentId,
        uint256 roundId,
        bytes32 commitKey,
        uint16 scoreBps,
        uint16 revealedRaterCount,
        bool noPendingCleanup,
        uint256 stakeAmount,
        bytes32[] calldata verifiedAnchorIds,
        uint64 sourceReadyAt
    ) external onlyAuthorized nonReentrant returns (uint256 paidAmount) {
        return _recordEarnedRaterRewardCredit(
            rater,
            contentId,
            roundId,
            commitKey,
            scoreBps,
            revealedRaterCount,
            noPendingCleanup,
            stakeAmount,
            verifiedAnchorIds,
            sourceReadyAt
        );
    }

    function _recordEarnedRaterRewardCredit(
        address rater,
        uint256 contentId,
        uint256 roundId,
        bytes32 commitKey,
        uint16 scoreBps,
        uint16 revealedRaterCount,
        bool noPendingCleanup,
        uint256 stakeAmount,
        bytes32[] calldata verifiedAnchorIds,
        uint64 sourceReadyAt
    ) private returns (uint256 paidAmount) {
        LaunchRewardPolicy memory policy = launchRewardPolicy;
        if (_isRaterBanned(rater)) return 0;
        uint16 distinctRoundAnchors = _countDistinctAvailableAnchors(policy, rater, verifiedAnchorIds);
        if (!_passesLaunchRewardContext(
                policy,
                rater,
                commitKey,
                scoreBps,
                revealedRaterCount,
                noPendingCleanup,
                stakeAmount,
                distinctRoundAnchors
            )) {
            return 0;
        }

        if (earnedRewardCreditRecorded[contentId][roundId][commitKey]) return 0;
        if (raterRoundCreditRecorded[rater][contentId][roundId]) return 0;
        bool raterVerified = _hasActiveHumanCredential(rater);
        bool clusterProofRequired = address(clusterPayoutOracle) != address(0);
        if (
            !raterVerified
                && roundUnverifiedLaunchCreditCount[contentId][roundId] >= policy.maxUnverifiedCreditsPerRound
        ) {
            return 0;
        }

        earnedRewardCreditRecorded[contentId][roundId][commitKey] = true;
        raterRoundCreditRecorded[rater][contentId][roundId] = true;
        // M-Funds-2: increment at record time regardless of clusterProofRequired so the cap
        // gates storage growth uniformly. Previously the increment fired only when there was
        // no cluster oracle, letting unbounded pending entries accumulate when a cluster oracle
        // is configured (the mainnet shape).
        if (!raterVerified) {
            roundUnverifiedLaunchCreditCount[contentId][roundId] += 1;
        }
        if (clusterProofRequired) {
            _storePendingEarnedRaterCredit(
                rater, contentId, roundId, commitKey, scoreBps, policy, verifiedAnchorIds, sourceReadyAt
            );
            return 0;
        }

        _recordAnchorRound(rater, contentId, roundId);
        _recordVerifiedAnchors(policy, rater, verifiedAnchorIds);
        return _recordEarnedRaterReward(rater, contentId, roundId, commitKey, scoreBps, policy, BPS_DENOMINATOR);
    }

    function recordAdvisoryRaterRewardWithSourceReady(
        address rater,
        uint256 contentId,
        uint256 roundId,
        bytes32 advisoryCommitKey,
        uint16 scoreBps,
        uint16 revealedRaterCount,
        bool noPendingCleanup,
        bytes32[] calldata verifiedAnchorIds,
        uint64 sourceReadyAt
    ) external onlyAuthorized nonReentrant returns (bool recorded, uint256 paidAmount) {
        return _recordAdvisoryRaterRewardCredit(
            rater,
            contentId,
            roundId,
            advisoryCommitKey,
            scoreBps,
            revealedRaterCount,
            noPendingCleanup,
            verifiedAnchorIds,
            sourceReadyAt
        );
    }

    function _recordAdvisoryRaterRewardCredit(
        address rater,
        uint256 contentId,
        uint256 roundId,
        bytes32 advisoryCommitKey,
        uint16 scoreBps,
        uint16 revealedRaterCount,
        bool noPendingCleanup,
        bytes32[] calldata verifiedAnchorIds,
        uint64 sourceReadyAt
    ) private returns (bool recorded, uint256 paidAmount) {
        LaunchRewardPolicy memory policy = launchRewardPolicy;
        if (_isRaterBanned(rater)) return (false, 0);
        uint16 distinctRoundAnchors = _countDistinctAvailableAnchors(policy, rater, verifiedAnchorIds);
        if (!_passesAdvisoryLaunchRewardContext(
                policy, rater, advisoryCommitKey, scoreBps, revealedRaterCount, noPendingCleanup, distinctRoundAnchors
            )) {
            return (false, 0);
        }

        if (earnedRewardCreditRecorded[contentId][roundId][advisoryCommitKey]) return (false, 0);
        if (raterRoundCreditRecorded[rater][contentId][roundId]) return (false, 0);
        bool raterVerified = _hasActiveHumanCredential(rater);
        bool clusterProofRequired = address(clusterPayoutOracle) != address(0);
        if (
            !raterVerified
                && roundUnverifiedLaunchCreditCount[contentId][roundId] >= policy.maxUnverifiedCreditsPerRound
        ) {
            return (false, 0);
        }

        earnedRewardCreditRecorded[contentId][roundId][advisoryCommitKey] = true;
        raterRoundCreditRecorded[rater][contentId][roundId] = true;
        // M-Funds-2: see recordEarnedRaterReward — increment unconditionally on !raterVerified.
        if (!raterVerified) {
            roundUnverifiedLaunchCreditCount[contentId][roundId] += 1;
        }
        if (clusterProofRequired) {
            _storePendingEarnedRaterCredit(
                rater, contentId, roundId, advisoryCommitKey, scoreBps, policy, verifiedAnchorIds, sourceReadyAt
            );
            return (true, 0);
        }

        _recordAnchorRound(rater, contentId, roundId);
        _recordVerifiedAnchors(policy, rater, verifiedAnchorIds);
        paidAmount =
            _recordEarnedRaterReward(rater, contentId, roundId, advisoryCommitKey, scoreBps, policy, BPS_DENOMINATOR);
        return (true, paidAmount);
    }

    function finalizeEarnedRaterRewardCredit(
        uint256 contentId,
        uint256 roundId,
        bytes32 commitKey,
        IClusterPayoutOracle.PayoutWeight calldata payoutWeight,
        bytes32[] calldata proof
    ) external nonReentrant returns (uint256 paidAmount) {
        PendingEarnedRaterCredit memory pending = pendingEarnedRaterCredits[contentId][roundId][commitKey];
        if (!pending.pending) revert InvalidAmount();
        IClusterPayoutOracle oracle = IClusterPayoutOracle(pending.oracle);
        if (address(oracle) == address(0)) revert SnapshotNotFinalized();
        if (earnedRewardCreditFinalized[contentId][roundId][commitKey]) revert AlreadyClaimed();
        if (
            payoutWeight.domain != PAYOUT_DOMAIN_LAUNCH_CREDIT || payoutWeight.rewardPoolId != 0
                || payoutWeight.contentId != contentId || payoutWeight.roundId != roundId
                || payoutWeight.commitKey != commitKey || payoutWeight.account != pending.rater
                || payoutWeight.identityKey != bytes32(0) || payoutWeight.baseWeight != BPS_DENOMINATOR
                || payoutWeight.effectiveWeight == 0 || payoutWeight.effectiveWeight > BPS_DENOMINATOR
        ) {
            revert InvalidProof();
        }
        if (!oracle.verifyPayoutWeight(payoutWeight, proof)) revert InvalidProof();
        if (!_roundPayoutSnapshotProposedAfter(
                oracle, contentId, roundId, pendingEarnedRaterCreditReadyAt[contentId][roundId][commitKey]
            )) {
            revert InvalidProof();
        }
        if (_isRaterBanned(pending.rater)) {
            earnedRewardCreditFinalized[contentId][roundId][commitKey] = true;
            _clearPendingVerifiedAnchorReservations(contentId, roundId, commitKey, pending.rater);
            delete pendingEarnedRaterCredits[contentId][roundId][commitKey];
            delete pendingEarnedRaterCreditReadyAt[contentId][roundId][commitKey];
            earnedRaterRoundPayoutSnapshotConsumed[contentId][roundId] = true;
            emit EarnedRaterRewardCreditFinalized(
                pending.rater,
                contentId,
                roundId,
                commitKey,
                payoutWeight.independenceBps,
                0,
                qualifyingCreditBps[pending.rater]
            );
            return 0;
        }

        // M-Funds-2: the cap is enforced at record time now, so no re-check or increment here.
        // A rater who was unverified at record (and thus consumed a cap slot) keeps that slot
        // regardless of verification flips between record and finalize.
        earnedRewardCreditFinalized[contentId][roundId][commitKey] = true;
        _recordAnchorRound(pending.rater, contentId, roundId);
        _recordPendingVerifiedAnchors(
            pending.policy, pending.rater, pendingEarnedRaterCreditAnchorIds[contentId][roundId][commitKey]
        );
        _clearPendingVerifiedAnchorReservations(contentId, roundId, commitKey, pending.rater);
        // M-Funds-3: reclaim the pending entry now that it has been finalized. The slot
        // (oracle, rater, scoreBps, policy) was a one-shot ticket; leaving it in storage
        // strands gas and makes governance rotation of `clusterPayoutOracle` ambiguous about
        // whether the entry should re-verify against the new oracle.
        delete pendingEarnedRaterCredits[contentId][roundId][commitKey];
        delete pendingEarnedRaterCreditReadyAt[contentId][roundId][commitKey];
        uint256 effectiveCreditBps = payoutWeight.effectiveWeight;
        paidAmount = _recordEarnedRaterReward(
            pending.rater, contentId, roundId, commitKey, pending.scoreBps, pending.policy, effectiveCreditBps
        );
        earnedRaterRoundPayoutSnapshotConsumed[contentId][roundId] = true;
        emit EarnedRaterRewardCreditFinalized(
            pending.rater,
            contentId,
            roundId,
            commitKey,
            payoutWeight.independenceBps,
            effectiveCreditBps,
            qualifyingCreditBps[pending.rater]
        );
    }

    function _recordEarnedRaterReward(
        address rater,
        uint256 contentId,
        uint256 roundId,
        bytes32 commitKey,
        uint16 scoreBps,
        LaunchRewardPolicy memory policy,
        uint256 effectiveCreditBps
    ) private returns (uint256 paidAmount) {
        uint32 previousQualifyingCount = _fullQualifyingCreditCount(qualifyingCreditBps[rater]);
        uint256 updatedCreditBps = qualifyingCreditBps[rater] + effectiveCreditBps;
        qualifyingCreditBps[rater] = updatedCreditBps;
        uint32 qualifyingCount = _fullQualifyingCreditCount(updatedCreditBps);
        qualifyingRatingCount[rater] = qualifyingCount;
        uint32 newlyCompletedCredits =
            qualifyingCount > previousQualifyingCount ? qualifyingCount - previousQualifyingCount : 0;
        bool payoutEligible = qualifyingCount >= policy.eligibilityRatingCount
            && raterDistinctVerifiedAnchorCount[rater] >= policy.minDistinctVerifiedAnchors
            && raterDistinctAnchorRoundCount[rater] >= policy.minDistinctAnchorRounds;

        emit EarnedRaterRewardCreditRecorded(
            rater,
            contentId,
            roundId,
            commitKey,
            scoreBps,
            qualifyingCount,
            updatedCreditBps,
            raterDistinctVerifiedAnchorCount[rater],
            raterDistinctAnchorRoundCount[rater],
            payoutEligible
        );

        if (!payoutEligible || newlyCompletedCredits == 0) return 0;

        uint256 cap = raterLaunchCap[rater];
        if (!raterLaunchCapAssigned[rater]) {
            uint256 fullCap = currentRaterLaunchCap();
            (cap,) = _assignLaunchCap(rater, fullCap, policy);
            if (cap > 0) {
                eligibleRaterCount += 1;
                emit RaterLaunchCapAssigned(rater, cap, eligibleRaterCount);
            }
        }
        if (!raterFullLaunchCapUnlocked[rater] && _activeLaunchCredentialClaimedByOther(rater)) {
            return 0;
        }

        uint32 rewardedCount = rewardedRatingCount[rater];
        uint32 targetRewardedCount = rewardedCount + newlyCompletedCredits;
        if (targetRewardedCount > policy.rewardingRatingCount) targetRewardedCount = policy.rewardingRatingCount;
        if (targetRewardedCount <= rewardedCount || raterLaunchPaid[rater] >= cap) return 0;

        uint256 targetPaid = targetRewardedCount == policy.rewardingRatingCount
            ? cap
            : (cap * uint256(targetRewardedCount)) / policy.rewardingRatingCount;
        if (targetPaid <= raterLaunchPaid[rater]) {
            rewardedRatingCount[rater] = targetRewardedCount;
            return 0;
        }
        paidAmount = targetPaid - raterLaunchPaid[rater];
        uint256 remaining = _remainingEarnedRaterPool();
        bool poolDepleted = paidAmount > remaining;
        if (poolDepleted) paidAmount = remaining;
        if (paidAmount == 0) return 0;

        // L-Funds-5: when the pool is depleted mid-slot, advance rewardedRatingCount only to
        // the proportional position represented by the actually-paid amount.
        _setRewardedCountAfterPaidAmount(
            rater, cap, rewardedCount, targetRewardedCount, paidAmount, poolDepleted, policy
        );
        raterLaunchPaid[rater] += paidAmount;
        earnedRaterDistributed += paidAmount;
        _pay(rater, paidAmount);
        emit EarnedRaterRewardPaid(
            rater,
            contentId,
            roundId,
            commitKey,
            paidAmount,
            scoreBps,
            qualifyingCount,
            updatedCreditBps,
            rewardedRatingCount[rater],
            raterDistinctVerifiedAnchorCount[rater],
            raterDistinctAnchorRoundCount[rater]
        );
    }

    function _storePendingEarnedRaterCredit(
        address rater,
        uint256 contentId,
        uint256 roundId,
        bytes32 commitKey,
        uint16 scoreBps,
        LaunchRewardPolicy memory policy,
        bytes32[] calldata verifiedAnchorIds,
        uint64 sourceReadyAt
    ) private {
        address oracle = address(clusterPayoutOracle);
        if (oracle == address(0) || sourceReadyAt == 0) revert SnapshotNotFinalized();
        IRoundClusterReadyAtSource source = roundClusterReadyAtSource;
        uint64 creditReadyAt;
        if (address(source) != address(0)) {
            creditReadyAt = _roundClusterSourceReadyAt(source, contentId, roundId);
            if (creditReadyAt == 0) revert SnapshotNotFinalized();
        } else {
            creditReadyAt = uint64(block.timestamp);
            if (sourceReadyAt > creditReadyAt) {
                creditReadyAt = sourceReadyAt;
            }
        }
        pendingEarnedRaterCredits[contentId][roundId][commitKey] = PendingEarnedRaterCredit({
            rater: rater, oracle: oracle, scoreBps: scoreBps, policy: policy, pending: true
        });
        pendingEarnedRaterCreditReadyAt[contentId][roundId][commitKey] = creditReadyAt;
        // M-Oracle-1: record the earliest sourceReadyAt for this round so the cluster oracle can
        // reject snapshot proposals submitted before any credit has been recorded.
        uint64 existing = launchRoundSourceReadyAt[contentId][roundId];
        if (existing == 0 || creditReadyAt < existing) {
            launchRoundSourceReadyAt[contentId][roundId] = creditReadyAt;
        }

        delete pendingEarnedRaterCreditAnchorIds[contentId][roundId][commitKey];
        bytes32[] storage pendingAnchors = pendingEarnedRaterCreditAnchorIds[contentId][roundId][commitKey];
        uint256 anchorCount = verifiedAnchorIds.length;
        for (uint256 i = 0; i < anchorCount; i++) {
            bytes32 anchorId = verifiedAnchorIds[i];
            if (anchorId == bytes32(0) || _isDuplicateAnchor(verifiedAnchorIds, i)) continue;
            if (!_reservePendingVerifiedAnchor(policy, rater, anchorId)) continue;
            pendingAnchors.push(anchorId);
        }
        emit EarnedRaterRewardCreditPending(rater, contentId, roundId, commitKey, scoreBps);
    }

    function _fullQualifyingCreditCount(uint256 creditBps) private pure returns (uint32) {
        uint256 count = creditBps / BPS_DENOMINATOR;
        return count > type(uint32).max ? type(uint32).max : uint32(count);
    }

    function currentRaterLaunchCap() public view returns (uint256) {
        uint256 count = eligibleRaterCount;
        if (count < 100) return 500e6;
        if (count < 1_000) return 250e6;
        if (count < 10_000) return 100e6;
        if (count < 100_000) return 10e6;
        if (count < 1_000_000) return 5e6;
        if (count < 5_000_000) return 2_500_000;
        if (count < 15_000_000) return 1_250_000;
        return 500_000;
    }

    function currentVerifiedBonus() public view returns (uint256) {
        uint256 count = verifiedClaimCount;
        if (count < 100) return 250e6;
        if (count < 1_000) return 100e6;
        if (count < 10_000) return 40e6;
        if (count < 50_000) return 10e6;
        if (count < 200_000) return 5e6;
        if (count < 1_000_000) return 2_500_000;
        return 1e6;
    }

    function launchAnchorCredentialAgeSeconds() external view returns (uint32) {
        return launchRewardPolicy.minAnchorCredentialAgeSeconds;
    }

    function remainingEarnedRaterPool() external view returns (uint256) {
        return _remainingEarnedRaterPool();
    }

    function remainingVerifiedReferralPool() external view returns (uint256) {
        return _remainingVerifiedReferralPool();
    }

    function vestedLegacyContributorAllocation(address account, uint256 allocation, bytes32[] calldata proof)
        external
        view
        returns (uint256)
    {
        _validateLegacyContributorProof(account, allocation, proof);
        return _vestedLegacyContributorAllocation(allocation);
    }

    function claimableLegacyContributorAllocation(address account, uint256 allocation, bytes32[] calldata proof)
        external
        view
        returns (uint256)
    {
        _validateLegacyContributorProof(account, allocation, proof);
        return _claimableLegacyContributorAllocation(account, allocation);
    }

    function supportsRoundPayoutSnapshotDomain(uint8 domain) external pure returns (bool) {
        return domain == PAYOUT_DOMAIN_LAUNCH_CREDIT;
    }

    function isRoundPayoutSnapshotConsumed(uint8 domain, uint256 rewardPoolId, uint256 contentId, uint256 roundId)
        external
        view
        returns (bool)
    {
        if (domain != PAYOUT_DOMAIN_LAUNCH_CREDIT || rewardPoolId != 0) return false;
        // Finalizing any launch credit consumes the root because even zero-pay finalizations
        // mutate the rater's future unlock state.
        return earnedRaterRoundPayoutSnapshotConsumed[contentId][roundId];
    }

    /// @notice M-Oracle-1: source-readiness timestamp for the launch-credit domain. Prefers the
    ///         configured RoundVotingEngine view (set via {setRoundClusterReadyAtSource}) so a
    ///         proposer can front-run a snapshot as soon as the advisory reveal grace has
    ///         elapsed. Falls back to the per-record `launchRoundSourceReadyAt` so existing
    ///         deployments without the source wired up still get the gate once at least one
    ///         credit lands.
    function roundPayoutSnapshotSourceReadyAt(uint8 domain, uint256 rewardPoolId, uint256 contentId, uint256 roundId)
        external
        view
        returns (uint64)
    {
        if (domain != PAYOUT_DOMAIN_LAUNCH_CREDIT || rewardPoolId != 0) return 0;
        IRoundClusterReadyAtSource source = roundClusterReadyAtSource;
        if (address(source) != address(0)) return _roundClusterSourceReadyAt(source, contentId, roundId);
        return launchRoundSourceReadyAt[contentId][roundId];
    }

    function _roundClusterSourceReadyAt(IRoundClusterReadyAtSource source, uint256 contentId, uint256 roundId)
        private
        view
        returns (uint64)
    {
        (bool readyAtOk, uint48 readyAt) = _roundReadyAtView(address(source), contentId, roundId);
        if (readyAtOk && readyAt != 0) {
            return _launchSnapshotReadyAtAfterAdvisoryGrace(address(source), contentId, roundId, readyAt);
        }
        return 0;
    }

    function _launchSnapshotReadyAtAfterAdvisoryGrace(
        address source,
        uint256 contentId,
        uint256 roundId,
        uint48 readyAt
    ) private view returns (uint64) {
        uint64 sourceReadyAt = uint64(readyAt);
        (bool roundCoreOk, uint48 settledAt) = _roundCoreSettledAtView(source, contentId, roundId);
        if (!roundCoreOk || settledAt == 0) return 0;
        address protocolConfig = _roundSourceProtocolConfig(source);
        (bool revealGraceOk, uint256 revealGracePeriod) = _revealGracePeriodView(protocolConfig);
        if (!revealGraceOk) return 0;
        uint256 settledAtUint = uint256(settledAt);
        if (revealGracePeriod > type(uint256).max - settledAtUint) return type(uint64).max;
        uint256 graceReadyAt = settledAtUint + revealGracePeriod;
        if (graceReadyAt > type(uint64).max) return type(uint64).max;
        if (graceReadyAt > sourceReadyAt) return graceReadyAt.toUint64();
        return sourceReadyAt;
    }

    function _validateRoundClusterReadyAtSource(address source, address expectedRaterRegistry) private view {
        (bool readyAtOk,) = _roundReadyAtView(source, 0, 0);
        (bool roundCoreOk,) = _roundCoreSettledAtView(source, 0, 0);
        address protocolConfig = _roundSourceProtocolConfig(source);
        (bool revealGraceOk,) = _revealGracePeriodView(protocolConfig);
        if (!readyAtOk || !roundCoreOk || !revealGraceOk) revert InvalidAddress();
        try ILaunchReadySourceProtocolConfig(protocolConfig).launchDistributionPool() returns (address configuredPool) {
            if (configuredPool != address(0) && configuredPool != address(this)) revert InvalidAddress();
        } catch {
            revert InvalidAddress();
        }
        try ILaunchReadySourceProtocolConfig(protocolConfig).raterRegistry() returns (address configuredRegistry) {
            if (configuredRegistry != expectedRaterRegistry && configuredRegistry != address(raterRegistry)) {
                revert InvalidAddress();
            }
        } catch {
            revert InvalidAddress();
        }
    }

    function _roundReadyAtView(address source, uint256 contentId, uint256 roundId)
        private
        view
        returns (bool ok, uint48 readyAt)
    {
        bytes memory data;
        (ok, data) =
            source.staticcall(abi.encodeCall(IRoundClusterReadyAtSource.roundLifecycleState, (contentId, roundId)));
        if (!ok || data.length < 128) return (false, 0);
        uint256 rawReadyAt;
        assembly ("memory-safe") {
            rawReadyAt := mload(add(data, 128))
        }
        if (rawReadyAt > type(uint48).max) return (false, 0);
        return (true, uint48(rawReadyAt));
    }

    function _roundCoreSettledAtView(address source, uint256 contentId, uint256 roundId)
        private
        view
        returns (bool ok, uint48 settledAt)
    {
        bytes memory data;
        (ok, data) = source.staticcall(abi.encodeCall(IRoundClusterReadyAtSource.roundCore, (contentId, roundId)));
        if (!ok || data.length < 224) return (false, 0);
        uint256 rawSettledAt;
        assembly ("memory-safe") {
            rawSettledAt := mload(add(data, 224))
        }
        if (rawSettledAt > type(uint48).max) return (false, 0);
        return (true, uint48(rawSettledAt));
    }

    function _roundSourceProtocolConfig(address source) private view returns (address protocolConfig) {
        (bool ok, bytes memory data) = source.staticcall(abi.encodeCall(IRoundClusterReadyAtSource.protocolConfig, ()));
        if (!ok || data.length < 32) return address(0);
        uint256 rawAddress;
        assembly ("memory-safe") {
            rawAddress := mload(add(data, 32))
        }
        if (rawAddress > type(uint160).max) return address(0);
        return address(uint160(rawAddress));
    }

    function _revealGracePeriodView(address protocolConfig) private view returns (bool ok, uint256 revealGracePeriod) {
        bytes memory data;
        (ok, data) = protocolConfig.staticcall(abi.encodeCall(IRevealGraceConfig.revealGracePeriod, ()));
        if (!ok || data.length < 32) return (false, 0);
        assembly ("memory-safe") {
            revealGracePeriod := mload(add(data, 32))
        }
        return (true, revealGracePeriod);
    }

    function _assignLaunchCap(address rater, uint256 fullCap, LaunchRewardPolicy memory policy)
        private
        returns (uint256 activeCap, bool fullCapUnlocked)
    {
        (bytes32 nullifierHash, bytes32 credentialKey) = _activeHumanCredential(rater);
        bool credentialClaimedByOther;
        if (nullifierHash != bytes32(0)) {
            address claimedBy = launchFullCapNullifierRater[credentialKey];
            if (claimedBy == address(0) || claimedBy == rater) {
                fullCapUnlocked = true;
                raterFullLaunchCapUnlocked[rater] = true;
                raterLaunchCapNullifier[rater] = nullifierHash;
                launchFullCapNullifierRater[credentialKey] = rater;
            } else {
                credentialClaimedByOther = true;
            }
        }

        activeCap = credentialClaimedByOther
            ? 0
            : fullCapUnlocked ? fullCap : (fullCap * uint256(policy.unverifiedEarnedRaterCapBps)) / BPS_DENOMINATOR;
        raterLaunchCapAssigned[rater] = true;
        raterFullLaunchCap[rater] = fullCap;
        raterLaunchCap[rater] = activeCap;
        emit RaterLaunchCapStatusUpdated(rater, activeCap, fullCap, _launchCapBps(activeCap, fullCap), fullCapUnlocked);
    }

    function _payLaunchCapCatchUp(address rater, uint256 fullCap, LaunchRewardPolicy memory policy)
        private
        returns (uint256 catchUpPaid)
    {
        uint32 targetRewardedCount = _earnedRewardSlotCount(qualifyingRatingCount[rater], policy);
        uint32 currentRewardedCount = rewardedRatingCount[rater];
        if (targetRewardedCount < currentRewardedCount) {
            targetRewardedCount = currentRewardedCount;
        }
        if (targetRewardedCount == 0) return 0;

        uint256 targetPaid = targetRewardedCount == policy.rewardingRatingCount
            ? fullCap
            : (fullCap * uint256(targetRewardedCount)) / policy.rewardingRatingCount;
        if (targetPaid <= raterLaunchPaid[rater]) {
            rewardedRatingCount[rater] = targetRewardedCount;
            return 0;
        }

        catchUpPaid = targetPaid - raterLaunchPaid[rater];
        uint256 remaining = _remainingEarnedRaterPool();
        bool poolDepleted = catchUpPaid > remaining;
        if (poolDepleted) catchUpPaid = remaining;
        if (catchUpPaid == 0) return 0;

        _setRewardedCountAfterPaidAmount(
            rater, fullCap, currentRewardedCount, targetRewardedCount, catchUpPaid, poolDepleted, policy
        );
        raterLaunchPaid[rater] += catchUpPaid;
        earnedRaterDistributed += catchUpPaid;
        _pay(rater, catchUpPaid);
    }

    function _activeLaunchCredentialClaimedByOther(address rater) private view returns (bool) {
        (bytes32 nullifierHash, bytes32 credentialKey) = _activeHumanCredential(rater);
        if (nullifierHash == bytes32(0)) return false;
        address claimedBy = launchFullCapNullifierRater[credentialKey];
        return claimedBy != address(0) && claimedBy != rater;
    }

    function _setRewardedCountAfterPaidAmount(
        address rater,
        uint256 cap,
        uint32 currentRewardedCount,
        uint32 targetRewardedCount,
        uint256 paidAmount,
        bool poolDepleted,
        LaunchRewardPolicy memory policy
    ) private {
        if (!poolDepleted) {
            rewardedRatingCount[rater] = targetRewardedCount;
            return;
        }
        uint256 newTotalPaid = raterLaunchPaid[rater] + paidAmount;
        uint32 proportionalCount;
        if (newTotalPaid >= cap) {
            proportionalCount = policy.rewardingRatingCount;
        } else if (cap > 0) {
            proportionalCount = uint32((newTotalPaid * uint256(policy.rewardingRatingCount)) / cap);
        } else {
            proportionalCount = currentRewardedCount;
        }
        if (proportionalCount < currentRewardedCount) proportionalCount = currentRewardedCount;
        if (proportionalCount > targetRewardedCount) proportionalCount = targetRewardedCount;
        rewardedRatingCount[rater] = proportionalCount;
    }

    function _earnedRewardSlotCount(uint32 qualifyingCount, LaunchRewardPolicy memory policy)
        private
        pure
        returns (uint32)
    {
        if (qualifyingCount < policy.eligibilityRatingCount) return 0;
        uint32 slots = qualifyingCount - policy.eligibilityRatingCount + 1;
        return slots > policy.rewardingRatingCount ? policy.rewardingRatingCount : slots;
    }

    function _launchCapBps(uint256 activeCap, uint256 fullCap) private pure returns (uint16) {
        if (fullCap == 0) return 0;
        uint256 capBps = (activeCap * BPS_DENOMINATOR) / fullCap;
        return capBps > BPS_DENOMINATOR ? BPS_DENOMINATOR : uint16(capBps);
    }

    function _claimReferralBonus(address referrer, address referee, uint256 baseBonus)
        internal
        returns (uint256 referralBonus)
    {
        if (referrer == address(0) || referrer == referee) return 0;
        if (!_hasActiveHumanCredential(referrer)) return 0;

        uint256 remainingCap = MAX_REFERRAL_REWARD_PER_REFERRER > referralEarnings[referrer]
            ? MAX_REFERRAL_REWARD_PER_REFERRER - referralEarnings[referrer]
            : 0;
        if (remainingCap == 0) return 0;

        referralBonus = (baseBonus * REFERRAL_BONUS_BPS) / 10_000;
        if (referralBonus > remainingCap) referralBonus = remainingCap;
        uint256 remainingPool = _remainingVerifiedReferralPool();
        if (referralBonus > remainingPool) referralBonus = remainingPool;
        if (referralBonus == 0) return 0;

        referralEarnings[referrer] += referralBonus;
        verifiedReferralDistributed += referralBonus;
        _pay(referrer, referralBonus);
        emit ReferralBonusPaid(referrer, referee, referralBonus);
    }

    function _validateLegacyContributorProof(address account, uint256 allocation, bytes32[] calldata proof)
        internal
        view
    {
        if (account == address(0) || allocation == 0) revert InvalidAmount();
        if (allocation > legacyContributorAllocationTotal) revert InvalidAmount();
        bytes32 root = legacyContributorRoot;
        if (root == bytes32(0)) revert InvalidProof();
        bytes32 leaf = _legacyContributorLeaf(account, allocation);
        if (!MerkleProof.verifyCalldata(proof, root, leaf)) revert InvalidProof();
    }

    function _claimableLegacyContributorAllocation(address account, uint256 allocation)
        internal
        view
        returns (uint256)
    {
        if (_legacyContributorClaimWindowClosed()) return 0;
        uint256 vestedAmount = _vestedLegacyContributorAllocation(allocation);
        uint256 claimed = legacyContributorClaimed[account];
        return vestedAmount > claimed ? vestedAmount - claimed : 0;
    }

    function _legacyContributorClaimWindowClosed() internal view returns (bool) {
        uint64 start = legacyContributorVestingStart;
        if (start == 0) return false;
        return block.timestamp >= uint256(start) + LEGACY_CLAIM_DURATION;
    }

    function _vestedLegacyContributorAllocation(uint256 allocation) internal view returns (uint256) {
        uint64 start = legacyContributorVestingStart;
        if (block.timestamp < start) return 0;
        uint256 immediateAmount = (allocation * LEGACY_IMMEDIATE_BPS) / BPS_DENOMINATOR;
        uint256 deferredAmount = allocation - immediateAmount;
        uint256 elapsed = block.timestamp - uint256(start);
        if (elapsed >= LEGACY_VESTING_DURATION) return allocation;
        return immediateAmount + ((deferredAmount * elapsed) / LEGACY_VESTING_DURATION);
    }

    function _legacyContributorLeaf(address account, uint256 allocation) internal pure returns (bytes32) {
        return keccak256(bytes.concat(keccak256(abi.encode(account, allocation))));
    }

    function _passesLaunchRewardContext(
        LaunchRewardPolicy memory policy,
        address rater,
        bytes32 commitKey,
        uint16 scoreBps,
        uint16 revealedRaterCount,
        bool noPendingCleanup,
        uint256 stakeAmount,
        uint16 distinctRoundAnchors
    ) internal pure returns (bool) {
        return rater != address(0) && commitKey != bytes32(0) && scoreBps >= policy.minQualifyingScoreBps
            && revealedRaterCount >= policy.minVoters && (!policy.requireNoPendingCleanup || noPendingCleanup)
            && stakeAmount >= policy.minLaunchCreditStake && distinctRoundAnchors >= policy.minVerifiedHumans;
    }

    function _passesAdvisoryLaunchRewardContext(
        LaunchRewardPolicy memory policy,
        address rater,
        bytes32 advisoryCommitKey,
        uint16 scoreBps,
        uint16 revealedRaterCount,
        bool noPendingCleanup,
        uint16 distinctRoundAnchors
    ) internal pure returns (bool) {
        return rater != address(0) && advisoryCommitKey != bytes32(0) && scoreBps >= policy.minQualifyingScoreBps
            && revealedRaterCount >= policy.minVoters && (!policy.requireNoPendingCleanup || noPendingCleanup)
            && distinctRoundAnchors >= policy.minVerifiedHumans;
    }

    function _recordAnchorRound(address rater, uint256 contentId, uint256 roundId) internal {
        bytes32 roundKey = keccak256(abi.encode(contentId, roundId));
        if (raterAnchorRoundSeen[rater][roundKey]) return;
        raterAnchorRoundSeen[rater][roundKey] = true;
        raterDistinctAnchorRoundCount[rater] += 1;
    }

    function _recordVerifiedAnchors(
        LaunchRewardPolicy memory policy,
        address rater,
        bytes32[] calldata verifiedAnchorIds
    ) internal {
        uint256 anchorCount = verifiedAnchorIds.length;
        for (uint256 i = 0; i < anchorCount; i++) {
            bytes32 anchorId = verifiedAnchorIds[i];
            if (anchorId == bytes32(0) || _isDuplicateAnchor(verifiedAnchorIds, i)) continue;
            _recordVerifiedAnchor(policy, rater, anchorId);
        }
    }

    function _recordPendingVerifiedAnchors(
        LaunchRewardPolicy memory policy,
        address rater,
        bytes32[] storage verifiedAnchorIds
    ) internal {
        uint256 anchorCount = verifiedAnchorIds.length;
        for (uint256 i = 0; i < anchorCount; i++) {
            bytes32 anchorId = verifiedAnchorIds[i];
            if (anchorId == bytes32(0) || _isDuplicatePendingAnchor(verifiedAnchorIds, i)) continue;
            _recordVerifiedAnchor(policy, rater, anchorId);
        }
    }

    function _recordVerifiedAnchor(LaunchRewardPolicy memory policy, address rater, bytes32 anchorId)
        private
        returns (bool recorded)
    {
        if (raterVerifiedAnchorSeen[rater][anchorId]) return true;
        if (_isVerifiedAnchorBanned(anchorId)) return false;
        bool reservedOrSeen = verifiedAnchorRaterSeen[anchorId][rater];
        if (!reservedOrSeen && verifiedAnchorDistinctRaterCount[anchorId] >= policy.maxDistinctRatersPerVerifiedAnchor)
        {
            return false;
        }

        raterVerifiedAnchorSeen[rater][anchorId] = true;
        if (!reservedOrSeen) {
            verifiedAnchorRaterSeen[anchorId][rater] = true;
            verifiedAnchorDistinctRaterCount[anchorId] += 1;
        }
        raterDistinctVerifiedAnchorCount[rater] += 1;
        return true;
    }

    function _reservePendingVerifiedAnchor(LaunchRewardPolicy memory policy, address rater, bytes32 anchorId)
        private
        returns (bool reserved)
    {
        if (raterVerifiedAnchorSeen[rater][anchorId]) return false;
        uint32 pendingCount = pendingVerifiedAnchorReservationCount[anchorId][rater];
        if (!verifiedAnchorRaterSeen[anchorId][rater]) {
            if (verifiedAnchorDistinctRaterCount[anchorId] >= policy.maxDistinctRatersPerVerifiedAnchor) return false;
            verifiedAnchorRaterSeen[anchorId][rater] = true;
            verifiedAnchorDistinctRaterCount[anchorId] += 1;
        }

        pendingVerifiedAnchorReservationCount[anchorId][rater] = pendingCount + 1;
        return true;
    }

    function _clearPendingVerifiedAnchorReservations(
        uint256 contentId,
        uint256 roundId,
        bytes32 commitKey,
        address rater
    ) internal {
        if (!stalePendingEarnedRaterCreditCancelled[contentId][roundId][commitKey]) {
            _releasePendingVerifiedAnchorReservations(contentId, roundId, commitKey, rater);
        }
        delete pendingEarnedRaterCreditAnchorIds[contentId][roundId][commitKey];
    }

    function _releasePendingVerifiedAnchorReservations(
        uint256 contentId,
        uint256 roundId,
        bytes32 commitKey,
        address rater
    ) internal {
        bytes32[] storage pendingAnchors = pendingEarnedRaterCreditAnchorIds[contentId][roundId][commitKey];
        uint256 anchorCount = pendingAnchors.length;
        for (uint256 i = 0; i < anchorCount; i++) {
            bytes32 anchorId = pendingAnchors[i];
            uint32 pendingCount = pendingVerifiedAnchorReservationCount[anchorId][rater];
            if (pendingCount == 0) continue;
            unchecked {
                pendingCount -= 1;
            }
            if (pendingCount == 0) {
                delete pendingVerifiedAnchorReservationCount[anchorId][rater];
                if (!raterVerifiedAnchorSeen[rater][anchorId] && verifiedAnchorRaterSeen[anchorId][rater]) {
                    verifiedAnchorRaterSeen[anchorId][rater] = false;
                    uint32 distinctCount = verifiedAnchorDistinctRaterCount[anchorId];
                    if (distinctCount > 0) {
                        verifiedAnchorDistinctRaterCount[anchorId] = distinctCount - 1;
                    }
                }
            } else {
                pendingVerifiedAnchorReservationCount[anchorId][rater] = pendingCount;
            }
        }
    }

    function _countDistinctAvailableAnchors(
        LaunchRewardPolicy memory policy,
        address rater,
        bytes32[] calldata verifiedAnchorIds
    ) internal view returns (uint16 distinctCount) {
        uint256 anchorCount = verifiedAnchorIds.length;
        for (uint256 i = 0; i < anchorCount; i++) {
            bytes32 anchorId = verifiedAnchorIds[i];
            if (anchorId == 0 || _isVerifiedAnchorBanned(anchorId) || _isDuplicateAnchor(verifiedAnchorIds, i)) {
                continue;
            }
            if (
                !raterVerifiedAnchorSeen[rater][anchorId] && !verifiedAnchorRaterSeen[anchorId][rater]
                    && verifiedAnchorDistinctRaterCount[anchorId] >= policy.maxDistinctRatersPerVerifiedAnchor
            ) {
                continue;
            }
            unchecked {
                ++distinctCount;
            }
        }
    }

    function _isVerifiedAnchorBanned(bytes32 anchorId) private view returns (bool banned) {
        assembly ("memory-safe") {
            mstore(0x00, shl(224, 0xf8e0a2d6))
            mstore(0x04, anchorId)
            if staticcall(gas(), sload(raterRegistry.slot), 0x00, 0x24, 0x00, 0x20) {
                banned := iszero(iszero(mload(0x00)))
            }
        }
    }

    function _hasActiveHumanCredential(address rater) internal view returns (bool) {
        (bytes32 nullifierHash,) = _activeHumanCredential(rater);
        return nullifierHash != bytes32(0);
    }

    function _activeHumanCredential(address rater)
        internal
        view
        returns (bytes32 nullifierHash, bytes32 credentialKey)
    {
        if (_isRaterBanned(rater)) {
            return (bytes32(0), bytes32(0));
        }
        RaterRegistry.HumanCredential memory credential = raterRegistry.getHumanCredential(rater);
        if (
            credential.verified && !credential.revoked && credential.expiresAt > block.timestamp
                && credential.nullifierHash != bytes32(0)
        ) {
            nullifierHash = credential.nullifierHash;
            credentialKey = _credentialClaimKey(credential.provider, credential.nullifierHash);
            if (raterRegistry.isIdentityKeyBanned(credentialKey)) {
                return (bytes32(0), bytes32(0));
            }
        }
    }

    function _isRaterBanned(address rater) internal view returns (bool) {
        _requireConfiguredRaterRegistry();
        return raterRegistry.isIdentityKeyBanned(raterRegistry.addressIdentityKey(rater));
    }

    function _requireConfiguredRaterRegistry() private view {
        address source = address(roundClusterReadyAtSource);
        if (source == address(0)) return;
        address protocolConfig = _roundSourceProtocolConfig(source);
        if (protocolConfig == address(0)) revert InvalidAddress();

        address configuredPool;
        address configuredRegistry;
        assembly ("memory-safe") {
            let ptr := mload(0x40)
            mstore(ptr, shl(224, 0xced2665e))
            pop(staticcall(gas(), protocolConfig, ptr, 4, ptr, 0x20))
            configuredPool := and(mload(ptr), 0xffffffffffffffffffffffffffffffffffffffff)
            mstore(ptr, shl(224, 0x53b86ffb))
            pop(staticcall(gas(), protocolConfig, ptr, 4, ptr, 0x20))
            configuredRegistry := and(mload(ptr), 0xffffffffffffffffffffffffffffffffffffffff)
        }
        if (configuredPool != address(this)) revert InvalidAddress();
        if (configuredRegistry != address(raterRegistry)) revert InvalidAddress();
    }

    function _credentialClaimKey(RaterRegistry.HumanCredentialProvider provider, bytes32 nullifierHash)
        internal
        view
        returns (bytes32)
    {
        return raterRegistry.launchHumanIdentityKey(provider, nullifierHash);
    }

    function _roundPayoutSnapshotProposedAfter(
        IClusterPayoutOracle oracle,
        uint256 contentId,
        uint256 roundId,
        uint64 readyAt
    ) private view returns (bool) {
        if (readyAt == 0) return false;
        try oracle.roundPayoutSnapshotProposedAt(PAYOUT_DOMAIN_LAUNCH_CREDIT, 0, contentId, roundId) returns (
            uint64 proposedAt
        ) {
            return proposedAt >= readyAt;
        } catch {
            return false;
        }
    }

    function _validateRaterRegistry(address newRegistry) private view {
        if (newRegistry == address(0) || newRegistry.code.length == 0) revert InvalidAddress();
        RaterRegistry registry = RaterRegistry(newRegistry);
        address sample = address(uint160(uint256(keccak256("rateloop.rater-registry.validation"))));
        bytes32 expectedSampleKey = keccak256(abi.encodePacked("rateloop.address-identity-v1", sample));
        try registry.getHumanCredential(address(0)) returns (RaterRegistry.HumanCredential memory) { }
        catch {
            revert InvalidAddress();
        }
        try registry.addressIdentityKey(address(0)) returns (bytes32 zeroKey) {
            if (zeroKey != bytes32(0)) revert InvalidAddress();
        } catch {
            revert InvalidAddress();
        }
        try registry.addressIdentityKey(sample) returns (bytes32 sampleKey) {
            if (sampleKey != expectedSampleKey) revert InvalidAddress();
        } catch {
            revert InvalidAddress();
        }
        try registry.isIdentityKeyBanned(bytes32(0)) returns (bool banned) {
            if (banned) revert InvalidAddress();
        } catch {
            revert InvalidAddress();
        }
    }

    function _validateClusterPayoutOracle(address newOracle) private view {
        if (newOracle == address(0) || newOracle.code.length == 0) revert InvalidAddress();
        try IClusterPayoutOracle(newOracle).roundPayoutSnapshotKey(PAYOUT_DOMAIN_LAUNCH_CREDIT, 0, 0, 0) returns (
            bytes32
        ) { }
        catch {
            revert InvalidAddress();
        }
        try IClusterPayoutOracle(newOracle)
            .roundPayoutSnapshotProposedAt(PAYOUT_DOMAIN_LAUNCH_CREDIT, 0, 0, 0) returns (
            uint64
        ) { }
        catch {
            revert InvalidAddress();
        }
        // M-Oracle-1: confirm the new oracle routes the launch-credit domain back to this
        // pool before pointing the pool at it. Sibling check to L-Oracle-B on the question
        // reward escrow. Without this, a governance fat-finger (new oracle deployed but its
        // `setRoundPayoutSnapshotConsumer` never called) strands every in-flight launch
        // credit: `verifyPayoutWeight` rejects `msg.sender != proposal.consumer`, and fresh
        // proposes revert because `roundPayoutSnapshotConsumer[domain] == address(0)`.
        try IClusterPayoutOracle(newOracle).roundPayoutSnapshotConsumer(PAYOUT_DOMAIN_LAUNCH_CREDIT) returns (
            address consumer
        ) {
            if (consumer != address(this)) revert InvalidAddress();
        } catch {
            revert InvalidAddress();
        }
    }

    function _isDuplicateAnchor(bytes32[] calldata verifiedAnchorIds, uint256 index) internal pure returns (bool) {
        bytes32 anchorId = verifiedAnchorIds[index];
        for (uint256 i = 0; i < index; i++) {
            if (verifiedAnchorIds[i] == anchorId) return true;
        }
        return false;
    }

    function _isDuplicatePendingAnchor(bytes32[] storage verifiedAnchorIds, uint256 index)
        internal
        view
        returns (bool)
    {
        bytes32 anchorId = verifiedAnchorIds[index];
        for (uint256 i = 0; i < index; i++) {
            if (verifiedAnchorIds[i] == anchorId) return true;
        }
        return false;
    }

    function _defaultLaunchRewardPolicy() internal pure returns (LaunchRewardPolicy memory policy) {
        policy = LaunchRewardPolicy({
            minQualifyingScoreBps: MIN_QUALIFYING_SCORE_BPS,
            minVoters: MIN_EARNED_REWARD_VOTERS,
            minVerifiedHumans: MIN_EARNED_REWARD_VERIFIED_HUMANS,
            minDistinctVerifiedAnchors: MIN_EARNED_REWARD_DISTINCT_VERIFIED_ANCHORS,
            minDistinctAnchorRounds: MIN_EARNED_REWARD_DISTINCT_ANCHOR_ROUNDS,
            minLaunchCreditStake: MIN_LAUNCH_CREDIT_STAKE,
            maxDistinctRatersPerVerifiedAnchor: MAX_DISTINCT_RATERS_PER_VERIFIED_ANCHOR,
            maxUnverifiedCreditsPerRound: MAX_UNVERIFIED_LAUNCH_CREDITS_PER_ROUND,
            unverifiedEarnedRaterCapBps: DEFAULT_UNVERIFIED_EARNED_RATER_CAP_BPS,
            minAnchorCredentialAgeSeconds: MIN_ANCHOR_CREDENTIAL_AGE_SECONDS,
            eligibilityRatingCount: ELIGIBILITY_RATING_COUNT,
            rewardingRatingCount: REWARDING_RATING_COUNT,
            requireNoPendingCleanup: true
        });
    }

    function _setLaunchRewardPolicy(LaunchRewardPolicy memory policy) internal {
        _validateLaunchRewardPolicy(policy);
        launchRewardPolicy = policy;
        emit LaunchRewardPolicyUpdated(policy);
    }

    function _validateLaunchRewardPolicy(LaunchRewardPolicy memory policy) internal pure {
        if (
            policy.minQualifyingScoreBps > 10_000 || policy.minVoters == 0
                || policy.minVoters < MIN_EARNED_REWARD_VOTERS
                || policy.minVerifiedHumans < MIN_EARNED_REWARD_VERIFIED_HUMANS
                || policy.minVerifiedHumans > policy.minVoters
                || policy.minDistinctVerifiedAnchors < MIN_EARNED_REWARD_DISTINCT_VERIFIED_ANCHORS
                || policy.minDistinctAnchorRounds < MIN_EARNED_REWARD_DISTINCT_ANCHOR_ROUNDS
                || policy.minLaunchCreditStake < MIN_LAUNCH_CREDIT_STAKE
                || policy.maxDistinctRatersPerVerifiedAnchor == 0
                || policy.maxDistinctRatersPerVerifiedAnchor > MAX_DISTINCT_RATERS_PER_VERIFIED_ANCHOR
                || policy.maxUnverifiedCreditsPerRound > MAX_UNVERIFIED_LAUNCH_CREDITS_PER_ROUND
                || policy.unverifiedEarnedRaterCapBps > BPS_DENOMINATOR
                || policy.minAnchorCredentialAgeSeconds < MIN_ANCHOR_CREDENTIAL_AGE_SECONDS
                || policy.eligibilityRatingCount < ELIGIBILITY_RATING_COUNT
                || policy.rewardingRatingCount < REWARDING_RATING_COUNT
                || policy.minDistinctVerifiedAnchors > policy.eligibilityRatingCount
                || policy.minDistinctAnchorRounds > policy.eligibilityRatingCount
                || (policy.minVerifiedHumans == 0 && policy.minDistinctVerifiedAnchors > 0)
        ) {
            revert InvalidPolicy();
        }
    }

    function _remainingEarnedRaterPool() internal view returns (uint256) {
        return EARNED_RATER_POOL_AMOUNT - earnedRaterDistributed;
    }

    function _remainingVerifiedReferralPool() internal view returns (uint256) {
        return VERIFIED_REFERRAL_POOL_AMOUNT - verifiedReferralDistributed;
    }

    function _remainingLegacyContributorPool() internal view returns (uint256) {
        return LEGACY_CONTRIBUTOR_POOL_AMOUNT - legacyContributorDistributed - legacyContributorTreasuryRecovered;
    }

    function _pay(address to, uint256 amount) internal returns (uint256 paidAmount) {
        if (amount > poolBalance) revert PoolDepleted();
        poolBalance -= amount;
        lrepToken.safeTransfer(to, amount);
        return amount;
    }
}
