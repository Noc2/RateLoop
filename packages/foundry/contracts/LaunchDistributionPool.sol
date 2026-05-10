// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {MerkleProof} from "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";
import {ReentrancyGuardTransient} from "@openzeppelin/contracts/utils/ReentrancyGuardTransient.sol";
import {RaterRegistry} from "./RaterRegistry.sol";
import {ILaunchDistributionPool} from "./interfaces/ILaunchDistributionPool.sol";

/// @title LaunchDistributionPool
/// @notice Holds the 52M LREP launch allocation and releases it through earned, verified, and legacy paths.
contract LaunchDistributionPool is ILaunchDistributionPool, Ownable, ReentrancyGuardTransient {
    using SafeERC20 for IERC20;

    error InvalidAddress();
    error InvalidAmount();
    error InvalidProof();
    error AlreadyClaimed();
    error NotVerified();
    error PoolDepleted();

    uint256 public constant LEGACY_POOL_AMOUNT = 2_000_000e6;
    uint256 public constant EARNED_RATER_POOL_AMOUNT = 25_000_000e6;
    uint256 public constant VERIFIED_REFERRAL_POOL_AMOUNT = 25_000_000e6;
    uint256 public constant TOTAL_POOL_AMOUNT =
        LEGACY_POOL_AMOUNT + EARNED_RATER_POOL_AMOUNT + VERIFIED_REFERRAL_POOL_AMOUNT;

    uint32 public constant ELIGIBILITY_RATING_COUNT = 5;
    uint32 public constant REWARDING_RATING_COUNT = 10;
    uint16 public constant MIN_QUALIFYING_SCORE_BPS = 7_000;

    uint256 public constant REFERRAL_BONUS_BPS = 5_000;
    uint256 public constant MAX_REFERRAL_REWARD_PER_REFERRER = 10_000e6;

    IERC20 public immutable lrepToken;
    RaterRegistry public raterRegistry;
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
    mapping(address => uint32) public rewardedRatingCount;
    mapping(address => uint256) public raterLaunchCap;
    mapping(address => uint256) public raterLaunchPaid;
    mapping(bytes32 => bool) public verifiedCredentialClaimed;
    mapping(address => bool) public verifiedBonusClaimedByAccount;
    mapping(address => uint256) public referralEarnings;

    event PoolDeposit(uint256 amount);
    event PoolWithdrawal(address indexed to, uint256 amount);
    event LegacyRootUpdated(bytes32 legacyRoot);
    event GovernanceUpdated(address indexed governance);
    event RaterRegistryUpdated(address indexed raterRegistry);
    event AuthorizedCallerUpdated(address indexed caller, bool authorized);
    event LegacyClaimed(address indexed account, uint256 amount);
    event RaterLaunchCapAssigned(address indexed rater, uint256 cap, uint256 cohortIndex);
    event EarnedRaterRewardPaid(address indexed rater, uint256 amount, uint16 scoreBps, uint32 rewardedRatingCount);
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

    function setAuthorizedCaller(address caller, bool authorized) external onlyOwner {
        if (caller == address(0)) revert InvalidAddress();
        authorizedCallers[caller] = authorized;
        emit AuthorizedCallerUpdated(caller, authorized);
    }

    function setLegacyRoot(bytes32 newRoot) external onlyOwner {
        legacyRoot = newRoot;
        emit LegacyRootUpdated(newRoot);
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
        RaterRegistry.SelfCredential memory credential = raterRegistry.getSelfCredential(msg.sender);
        if (!credential.verified || credential.revoked || credential.legacy || credential.expiresAt <= block.timestamp) {
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

    function recordEarnedRaterReward(address rater, uint16 scoreBps)
        external
        onlyAuthorized
        nonReentrant
        returns (uint256 paidAmount)
    {
        if (rater == address(0) || scoreBps < MIN_QUALIFYING_SCORE_BPS) return 0;

        uint32 qualifyingCount = qualifyingRatingCount[rater] + 1;
        qualifyingRatingCount[rater] = qualifyingCount;
        if (qualifyingCount < ELIGIBILITY_RATING_COUNT) return 0;

        uint256 cap = raterLaunchCap[rater];
        if (cap == 0) {
            cap = currentRaterLaunchCap();
            raterLaunchCap[rater] = cap;
            eligibleRaterCount += 1;
            emit RaterLaunchCapAssigned(rater, cap, eligibleRaterCount);
        }

        uint32 rewardedCount = rewardedRatingCount[rater];
        if (rewardedCount >= REWARDING_RATING_COUNT || raterLaunchPaid[rater] >= cap) return 0;

        uint256 targetPaid = rewardedCount + 1 == REWARDING_RATING_COUNT
            ? cap
            : (cap * uint256(rewardedCount + 1)) / REWARDING_RATING_COUNT;
        paidAmount = targetPaid - raterLaunchPaid[rater];
        uint256 remaining = _remainingEarnedRaterPool();
        if (paidAmount > remaining) paidAmount = remaining;
        if (paidAmount == 0) return 0;

        rewardedRatingCount[rater] = rewardedCount + 1;
        raterLaunchPaid[rater] += paidAmount;
        earnedRaterDistributed += paidAmount;
        _pay(rater, paidAmount);
        emit EarnedRaterRewardPaid(rater, paidAmount, scoreBps, rewardedRatingCount[rater]);
    }

    function currentRaterLaunchCap() public view returns (uint256) {
        uint256 count = eligibleRaterCount;
        if (count < 100_000) return 12e6;
        if (count < 1_000_000) return 6e6;
        if (count < 5_000_000) return 3e6;
        if (count < 15_000_000) return 1_500_000;
        return 500_000;
    }

    function currentVerifiedBonus() public view returns (uint256) {
        uint256 count = verifiedClaimCount;
        if (count < 50_000) return 10e6;
        if (count < 200_000) return 5e6;
        if (count < 1_000_000) return 2_500_000;
        return 1e6;
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

    function _claimReferralBonus(address referrer, address referee, uint256 baseBonus)
        internal
        returns (uint256 referralBonus)
    {
        if (referrer == address(0) || referrer == referee) return 0;
        RaterRegistry.SelfCredential memory credential = raterRegistry.getSelfCredential(referrer);
        if (!credential.verified || credential.revoked || credential.legacy || credential.expiresAt <= block.timestamp) {
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
