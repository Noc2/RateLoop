// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { MerkleProof } from "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";
import { ReentrancyGuardTransient } from "@openzeppelin/contracts/utils/ReentrancyGuardTransient.sol";
import { RaterRegistry } from "./RaterRegistry.sol";
import { IClusterPayoutOracle } from "./interfaces/IClusterPayoutOracle.sol";
import { ILaunchDistributionPool } from "./interfaces/ILaunchDistributionPool.sol";
import { IRoundPayoutSnapshotConsumer } from "./interfaces/IRoundPayoutSnapshotConsumer.sol";

/// @title LaunchDistributionPool
/// @notice Holds the 64M LREP launch allocation and releases it through earned, verified, and legacy paths.
contract LaunchDistributionPool is
    ILaunchDistributionPool,
    IRoundPayoutSnapshotConsumer,
    Ownable,
    ReentrancyGuardTransient
{
    using SafeERC20 for IERC20;

    error InvalidAddress();
    error InvalidAmount();
    error InvalidProof();
    error AlreadyClaimed();
    error NotVerified();
    error PoolDepleted();
    error InvalidPolicy();
    error SnapshotNotFinalized();

    uint256 public constant LEGACY_POOL_AMOUNT = 4_000_000e6;
    uint256 public constant EARNED_RATER_POOL_AMOUNT = 25_000_000e6;
    uint256 public constant VERIFIED_REFERRAL_POOL_AMOUNT = 35_000_000e6;
    uint256 public constant TOTAL_POOL_AMOUNT =
        LEGACY_POOL_AMOUNT + EARNED_RATER_POOL_AMOUNT + VERIFIED_REFERRAL_POOL_AMOUNT;

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
    address public governance;
    uint256 public poolBalance;
    uint256 public legacyDistributed;
    uint256 public earnedRaterDistributed;
    uint256 public verifiedReferralDistributed;
    bytes32 public legacyRoot;

    uint256 public eligibleRaterCount;
    uint256 public verifiedClaimCount;

    mapping(address => bool) public authorizedCallers;
    mapping(address => bool) public legacyClaimed;
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
    mapping(address => bool) public verifiedBonusClaimedByAccount;
    mapping(address => uint256) public referralEarnings;
    mapping(uint256 => mapping(uint256 => mapping(bytes32 => bool))) public earnedRewardCreditRecorded;
    mapping(address => mapping(bytes32 => bool)) public raterVerifiedAnchorSeen;
    mapping(address => uint32) public raterDistinctVerifiedAnchorCount;
    mapping(address => mapping(bytes32 => bool)) public raterAnchorRoundSeen;
    mapping(address => uint32) public raterDistinctAnchorRoundCount;
    mapping(bytes32 => mapping(address => bool)) public verifiedAnchorRaterSeen;
    mapping(bytes32 => uint32) public verifiedAnchorDistinctRaterCount;
    mapping(address => mapping(uint256 => mapping(uint256 => bool))) public raterRoundCreditRecorded;
    mapping(uint256 => mapping(uint256 => uint16)) public roundUnverifiedLaunchCreditCount;
    mapping(uint256 => mapping(uint256 => mapping(bytes32 => PendingEarnedRaterCredit))) public
        pendingEarnedRaterCredits;
    mapping(uint256 => mapping(uint256 => mapping(bytes32 => bool))) public earnedRewardCreditFinalized;
    mapping(uint256 => mapping(uint256 => bool)) public earnedRaterRoundPayoutSnapshotConsumed;
    LaunchRewardPolicy public launchRewardPolicy;

    event PoolDeposit(uint256 amount);
    event PoolWithdrawal(address indexed to, uint256 amount);
    event SurplusRecovered(address indexed to, uint256 amount);
    event LegacyRootUpdated(bytes32 legacyRoot);
    event GovernanceUpdated(address indexed governance);
    event RaterRegistryUpdated(address indexed raterRegistry);
    event ClusterPayoutOracleUpdated(address indexed clusterPayoutOracle);
    event AuthorizedCallerUpdated(address indexed caller, bool authorized);
    event LaunchRewardPolicyUpdated(LaunchRewardPolicy policy);
    event LegacyClaimed(address indexed account, uint256 amount);
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
        uint32 distinctVerifiedAnchorCount,
        uint32 distinctAnchorRoundCount,
        bool payoutEligible
    );
    event EarnedRaterRewardCreditPending(
        address indexed rater, uint256 indexed contentId, uint256 indexed roundId, bytes32 commitKey, uint16 scoreBps
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
        uint32 rewardedRatingCount,
        uint32 distinctVerifiedAnchorCount,
        uint32 distinctAnchorRoundCount
    );
    event VerifiedBonusClaimed(address indexed account, uint256 amount, bytes32 indexed nullifierHash);
    event ReferralBonusPaid(address indexed referrer, address indexed referee, uint256 amount);

    modifier onlyAuthorized() {
        if (!authorizedCallers[msg.sender]) revert InvalidAddress();
        _;
    }

    constructor(address _lrepToken, address _raterRegistry, address _governance) Ownable(msg.sender) {
        if (_lrepToken == address(0) || _raterRegistry == address(0) || _governance == address(0)) {
            revert InvalidAddress();
        }
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
        governance = newGovernance;
        emit GovernanceUpdated(newGovernance);
    }

    function setRaterRegistry(address newRegistry) external onlyOwner {
        if (newRegistry == address(0)) revert InvalidAddress();
        raterRegistry = RaterRegistry(newRegistry);
        emit RaterRegistryUpdated(newRegistry);
    }

    function setClusterPayoutOracle(address newOracle) external onlyOwner {
        if (newOracle == address(0)) revert InvalidAddress();
        clusterPayoutOracle = IClusterPayoutOracle(newOracle);
        emit ClusterPayoutOracleUpdated(newOracle);
    }

    function setAuthorizedCaller(address caller, bool authorized) external onlyOwner {
        if (caller == address(0)) revert InvalidAddress();
        authorizedCallers[caller] = authorized;
        emit AuthorizedCallerUpdated(caller, authorized);
    }

    function setLegacyRoot(bytes32 newRoot) external onlyOwner {
        legacyRoot = newRoot;
        emit LegacyRootUpdated(newRoot);
    }

    function setLaunchRewardPolicy(LaunchRewardPolicy calldata policy) external onlyOwner {
        _setLaunchRewardPolicy(policy);
    }

    function depositPool(uint256 amount) external {
        if (amount == 0) revert InvalidAmount();
        lrepToken.safeTransferFrom(msg.sender, address(this), amount);
        poolBalance += amount;
        emit PoolDeposit(amount);
    }

    function withdrawRemaining(address to, uint256 amount) external onlyOwner nonReentrant returns (uint256 withdrawn) {
        if (to == address(0)) revert InvalidAddress();
        if (owner() != governance) revert InvalidAddress();
        withdrawn = amount > poolBalance ? poolBalance : amount;
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

    function claimLegacy(uint256 amount, bytes32[] calldata proof) external nonReentrant returns (uint256 paidAmount) {
        if (amount == 0) revert InvalidAmount();
        if (legacyClaimed[msg.sender]) revert AlreadyClaimed();
        bytes32 root = legacyRoot;
        if (root == bytes32(0)) revert InvalidProof();
        bytes32 leaf = keccak256(abi.encode(msg.sender, amount));
        if (!MerkleProof.verifyCalldata(proof, root, leaf)) revert InvalidProof();

        uint256 remaining = _remainingLegacyPool();
        if (amount > remaining) revert PoolDepleted();
        legacyClaimed[msg.sender] = true;
        legacyDistributed += amount;
        paidAmount = _pay(msg.sender, amount);
        emit LegacyClaimed(msg.sender, paidAmount);
    }

    function claimVerifiedBonus(address referrer) external nonReentrant returns (uint256 paidAmount) {
        RaterRegistry.HumanCredential memory credential = raterRegistry.getHumanCredential(msg.sender);
        if (!credential.verified || credential.revoked || credential.expiresAt <= block.timestamp) {
            revert NotVerified();
        }
        if (credential.nullifierHash == bytes32(0)) revert NotVerified();
        if (verifiedCredentialClaimed[credential.nullifierHash] || verifiedBonusClaimedByAccount[msg.sender]) {
            revert AlreadyClaimed();
        }

        uint256 baseBonus = currentVerifiedBonus();
        uint256 remaining = _remainingVerifiedReferralPool();
        if (baseBonus == 0 || remaining < baseBonus) revert PoolDepleted();

        verifiedCredentialClaimed[credential.nullifierHash] = true;
        verifiedBonusClaimedByAccount[msg.sender] = true;
        verifiedClaimCount += 1;
        verifiedReferralDistributed += baseBonus;
        paidAmount = _pay(msg.sender, baseBonus);
        emit VerifiedBonusClaimed(msg.sender, paidAmount, credential.nullifierHash);

        uint256 referralBonus = _claimReferralBonus(referrer, msg.sender, baseBonus);
        paidAmount += referralBonus;
    }

    function unlockFullEarnedRaterCap(address rater) external nonReentrant returns (uint256 catchUpPaid) {
        if (rater == address(0)) revert InvalidAddress();
        if (!raterLaunchCapAssigned[rater]) revert InvalidAmount();
        if (raterFullLaunchCapUnlocked[rater]) return 0;

        bytes32 nullifierHash = _activeHumanNullifier(rater);
        if (nullifierHash == bytes32(0)) revert NotVerified();

        address claimedBy = launchFullCapNullifierRater[nullifierHash];
        if (claimedBy != address(0) && claimedBy != rater) revert AlreadyClaimed();

        uint256 previousCap = raterLaunchCap[rater];
        uint256 fullCap = raterFullLaunchCap[rater];
        raterFullLaunchCapUnlocked[rater] = true;
        raterLaunchCapNullifier[rater] = nullifierHash;
        launchFullCapNullifierRater[nullifierHash] = rater;
        raterLaunchCap[rater] = fullCap;

        catchUpPaid = _payLaunchCapCatchUp(rater, fullCap, launchRewardPolicy);
        emit RaterLaunchCapStatusUpdated(rater, fullCap, fullCap, BPS_DENOMINATOR, true);
        emit RaterLaunchCapUnlocked(rater, nullifierHash, previousCap, fullCap, catchUpPaid);
    }

    function recordEarnedRaterReward(
        address rater,
        uint256 contentId,
        uint256 roundId,
        bytes32 commitKey,
        uint16 scoreBps,
        uint16 revealedRaterCount,
        bool noPendingCleanup,
        uint256 stakeAmount,
        bytes32[] calldata verifiedAnchorIds
    ) external onlyAuthorized nonReentrant returns (uint256 paidAmount) {
        LaunchRewardPolicy memory policy = launchRewardPolicy;
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
        if (
            !raterVerified
                && roundUnverifiedLaunchCreditCount[contentId][roundId] >= policy.maxUnverifiedCreditsPerRound
        ) {
            return 0;
        }

        earnedRewardCreditRecorded[contentId][roundId][commitKey] = true;
        raterRoundCreditRecorded[rater][contentId][roundId] = true;
        if (!raterVerified) {
            roundUnverifiedLaunchCreditCount[contentId][roundId] += 1;
        }
        _recordAnchorRound(rater, contentId, roundId);
        _recordVerifiedAnchors(policy, rater, verifiedAnchorIds);

        if (address(clusterPayoutOracle) != address(0)) {
            _storePendingEarnedRaterCredit(rater, contentId, roundId, commitKey, scoreBps, policy);
            return 0;
        }

        return _recordEarnedRaterReward(rater, contentId, roundId, commitKey, scoreBps, policy, BPS_DENOMINATOR);
    }

    function recordAdvisoryRaterReward(
        address rater,
        uint256 contentId,
        uint256 roundId,
        bytes32 advisoryCommitKey,
        uint16 scoreBps,
        uint16 revealedRaterCount,
        bool noPendingCleanup,
        bytes32[] calldata verifiedAnchorIds
    ) external onlyAuthorized nonReentrant returns (bool recorded, uint256 paidAmount) {
        LaunchRewardPolicy memory policy = launchRewardPolicy;
        uint16 distinctRoundAnchors = _countDistinctAvailableAnchors(policy, rater, verifiedAnchorIds);
        if (!_passesAdvisoryLaunchRewardContext(
                policy, rater, advisoryCommitKey, scoreBps, revealedRaterCount, noPendingCleanup, distinctRoundAnchors
            )) {
            return (false, 0);
        }

        if (earnedRewardCreditRecorded[contentId][roundId][advisoryCommitKey]) return (false, 0);
        if (raterRoundCreditRecorded[rater][contentId][roundId]) return (false, 0);
        bool raterVerified = _hasActiveHumanCredential(rater);
        if (
            !raterVerified
                && roundUnverifiedLaunchCreditCount[contentId][roundId] >= policy.maxUnverifiedCreditsPerRound
        ) {
            return (false, 0);
        }

        earnedRewardCreditRecorded[contentId][roundId][advisoryCommitKey] = true;
        raterRoundCreditRecorded[rater][contentId][roundId] = true;
        if (!raterVerified) {
            roundUnverifiedLaunchCreditCount[contentId][roundId] += 1;
        }
        _recordAnchorRound(rater, contentId, roundId);
        _recordVerifiedAnchors(policy, rater, verifiedAnchorIds);

        if (address(clusterPayoutOracle) != address(0)) {
            _storePendingEarnedRaterCredit(rater, contentId, roundId, advisoryCommitKey, scoreBps, policy);
            return (true, 0);
        }

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
                || payoutWeight.baseWeight != BPS_DENOMINATOR || payoutWeight.effectiveWeight == 0
                || payoutWeight.effectiveWeight > BPS_DENOMINATOR
        ) {
            revert InvalidProof();
        }
        if (!oracle.verifyPayoutWeight(payoutWeight, proof)) revert InvalidProof();

        earnedRewardCreditFinalized[contentId][roundId][commitKey] = true;
        uint256 effectiveCreditBps = payoutWeight.effectiveWeight;
        paidAmount = _recordEarnedRaterReward(
            pending.rater, contentId, roundId, commitKey, pending.scoreBps, pending.policy, effectiveCreditBps
        );
        if (paidAmount > 0) {
            earnedRaterRoundPayoutSnapshotConsumed[contentId][roundId] = true;
        }
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
    ) internal returns (uint256 paidAmount) {
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
            raterDistinctVerifiedAnchorCount[rater],
            raterDistinctAnchorRoundCount[rater],
            payoutEligible
        );

        if (!payoutEligible || newlyCompletedCredits == 0) return 0;

        uint256 cap = raterLaunchCap[rater];
        if (!raterLaunchCapAssigned[rater]) {
            uint256 fullCap = currentRaterLaunchCap();
            (cap,) = _assignLaunchCap(rater, fullCap, policy);
            eligibleRaterCount += 1;
            emit RaterLaunchCapAssigned(rater, cap, eligibleRaterCount);
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
        if (paidAmount > remaining) paidAmount = remaining;
        if (paidAmount == 0) return 0;

        rewardedRatingCount[rater] = targetRewardedCount;
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
        LaunchRewardPolicy memory policy
    ) internal {
        address oracle = address(clusterPayoutOracle);
        if (oracle == address(0)) revert SnapshotNotFinalized();
        pendingEarnedRaterCredits[contentId][roundId][commitKey] = PendingEarnedRaterCredit({
            rater: rater, oracle: oracle, scoreBps: scoreBps, policy: policy, pending: true
        });
        emit EarnedRaterRewardCreditPending(rater, contentId, roundId, commitKey, scoreBps);
    }

    function _fullQualifyingCreditCount(uint256 creditBps) internal pure returns (uint32) {
        uint256 count = creditBps / BPS_DENOMINATOR;
        return count > type(uint32).max ? type(uint32).max : uint32(count);
    }

    function currentRaterLaunchCap() public view returns (uint256) {
        uint256 count = eligibleRaterCount;
        if (count < 100_000) return 10e6;
        if (count < 1_000_000) return 5e6;
        if (count < 5_000_000) return 2_500_000;
        if (count < 15_000_000) return 1_250_000;
        return 500_000;
    }

    function currentVerifiedBonus() public view returns (uint256) {
        uint256 count = verifiedClaimCount;
        if (count < 50_000) return 10e6;
        if (count < 200_000) return 5e6;
        if (count < 1_000_000) return 2_500_000;
        return 1e6;
    }

    function launchAnchorCredentialAgeSeconds() external view returns (uint32) {
        return launchRewardPolicy.minAnchorCredentialAgeSeconds;
    }

    function remainingLegacyPool() external view returns (uint256) {
        return _remainingLegacyPool();
    }

    function remainingEarnedRaterPool() external view returns (uint256) {
        return _remainingEarnedRaterPool();
    }

    function remainingVerifiedReferralPool() external view returns (uint256) {
        return _remainingVerifiedReferralPool();
    }

    function isRoundPayoutSnapshotConsumed(uint8 domain, uint256 rewardPoolId, uint256 contentId, uint256 roundId)
        external
        view
        returns (bool)
    {
        if (domain != PAYOUT_DOMAIN_LAUNCH_CREDIT || rewardPoolId != 0) return false;
        // Launch credits are finalized per commit key, so a partially used root can still
        // be rejected and replaced until a finalized credit has paid non-revertible funds.
        return earnedRaterRoundPayoutSnapshotConsumed[contentId][roundId];
    }

    function _assignLaunchCap(address rater, uint256 fullCap, LaunchRewardPolicy memory policy)
        internal
        returns (uint256 activeCap, bool fullCapUnlocked)
    {
        bytes32 nullifierHash = _activeHumanNullifier(rater);
        if (nullifierHash != bytes32(0)) {
            address claimedBy = launchFullCapNullifierRater[nullifierHash];
            if (claimedBy == address(0) || claimedBy == rater) {
                fullCapUnlocked = true;
                raterFullLaunchCapUnlocked[rater] = true;
                raterLaunchCapNullifier[rater] = nullifierHash;
                launchFullCapNullifierRater[nullifierHash] = rater;
            }
        }

        activeCap =
            fullCapUnlocked ? fullCap : (fullCap * uint256(policy.unverifiedEarnedRaterCapBps)) / BPS_DENOMINATOR;
        raterLaunchCapAssigned[rater] = true;
        raterFullLaunchCap[rater] = fullCap;
        raterLaunchCap[rater] = activeCap;
        emit RaterLaunchCapStatusUpdated(rater, activeCap, fullCap, _launchCapBps(activeCap, fullCap), fullCapUnlocked);
    }

    function _payLaunchCapCatchUp(address rater, uint256 fullCap, LaunchRewardPolicy memory policy)
        internal
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
        if (catchUpPaid > remaining) catchUpPaid = remaining;
        if (catchUpPaid == 0) return 0;

        rewardedRatingCount[rater] = targetRewardedCount;
        raterLaunchPaid[rater] += catchUpPaid;
        earnedRaterDistributed += catchUpPaid;
        _pay(rater, catchUpPaid);
    }

    function _earnedRewardSlotCount(uint32 qualifyingCount, LaunchRewardPolicy memory policy)
        internal
        pure
        returns (uint32)
    {
        if (qualifyingCount < policy.eligibilityRatingCount) return 0;
        uint32 slots = qualifyingCount - policy.eligibilityRatingCount + 1;
        return slots > policy.rewardingRatingCount ? policy.rewardingRatingCount : slots;
    }

    function _launchCapBps(uint256 activeCap, uint256 fullCap) internal pure returns (uint16) {
        if (fullCap == 0) return 0;
        uint256 capBps = (activeCap * BPS_DENOMINATOR) / fullCap;
        return capBps > BPS_DENOMINATOR ? BPS_DENOMINATOR : uint16(capBps);
    }

    function _claimReferralBonus(address referrer, address referee, uint256 baseBonus)
        internal
        returns (uint256 referralBonus)
    {
        if (referrer == address(0) || referrer == referee) return 0;
        RaterRegistry.HumanCredential memory credential = raterRegistry.getHumanCredential(referrer);
        if (!credential.verified || credential.revoked || credential.expiresAt <= block.timestamp) {
            return 0;
        }

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
        if (rater == address(0) || commitKey == bytes32(0)) return false;
        if (scoreBps < policy.minQualifyingScoreBps) return false;
        if (revealedRaterCount < policy.minVoters) return false;
        if (policy.requireNoPendingCleanup && !noPendingCleanup) return false;
        if (stakeAmount < policy.minLaunchCreditStake) return false;
        if (distinctRoundAnchors < policy.minVerifiedHumans) return false;
        return true;
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
        if (rater == address(0) || advisoryCommitKey == bytes32(0)) return false;
        if (scoreBps < policy.minQualifyingScoreBps) return false;
        if (revealedRaterCount < policy.minVoters) return false;
        if (policy.requireNoPendingCleanup && !noPendingCleanup) return false;
        if (distinctRoundAnchors < policy.minVerifiedHumans) return false;
        return true;
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
            if (raterVerifiedAnchorSeen[rater][anchorId]) continue;
            if (verifiedAnchorDistinctRaterCount[anchorId] >= policy.maxDistinctRatersPerVerifiedAnchor) continue;

            raterVerifiedAnchorSeen[rater][anchorId] = true;
            if (!verifiedAnchorRaterSeen[anchorId][rater]) {
                verifiedAnchorRaterSeen[anchorId][rater] = true;
                verifiedAnchorDistinctRaterCount[anchorId] += 1;
            }
            raterDistinctVerifiedAnchorCount[rater] += 1;
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
            if (anchorId == bytes32(0) || _isDuplicateAnchor(verifiedAnchorIds, i)) continue;
            if (
                !raterVerifiedAnchorSeen[rater][anchorId]
                    && verifiedAnchorDistinctRaterCount[anchorId] >= policy.maxDistinctRatersPerVerifiedAnchor
            ) {
                continue;
            }
            distinctCount += 1;
        }
    }

    function _hasActiveHumanCredential(address rater) internal view returns (bool) {
        return _activeHumanNullifier(rater) != bytes32(0);
    }

    function _activeHumanNullifier(address rater) internal view returns (bytes32) {
        RaterRegistry.HumanCredential memory credential = raterRegistry.getHumanCredential(rater);
        if (
            credential.verified && !credential.revoked && credential.expiresAt > block.timestamp
                && credential.nullifierHash != bytes32(0)
        ) {
            return credential.nullifierHash;
        }
        return bytes32(0);
    }

    function _isDuplicateAnchor(bytes32[] calldata verifiedAnchorIds, uint256 index) internal pure returns (bool) {
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

    function _remainingLegacyPool() internal view returns (uint256) {
        return LEGACY_POOL_AMOUNT - legacyDistributed;
    }

    function _remainingEarnedRaterPool() internal view returns (uint256) {
        return EARNED_RATER_POOL_AMOUNT - earnedRaterDistributed;
    }

    function _remainingVerifiedReferralPool() internal view returns (uint256) {
        return VERIFIED_REFERRAL_POOL_AMOUNT - verifiedReferralDistributed;
    }

    function _pay(address to, uint256 amount) internal returns (uint256 paidAmount) {
        if (amount > poolBalance) revert PoolDepleted();
        poolBalance -= amount;
        lrepToken.safeTransfer(to, amount);
        return amount;
    }
}
