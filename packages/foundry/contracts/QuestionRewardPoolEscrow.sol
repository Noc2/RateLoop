// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import {AccessControlUpgradeable} from "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import {PausableUpgradeable} from "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import {ReentrancyGuardTransient} from "@openzeppelin/contracts/utils/ReentrancyGuardTransient.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeCast} from "@openzeppelin/contracts/utils/math/SafeCast.sol";

import {ContentRegistry} from "./ContentRegistry.sol";
import {RoundVotingEngine} from "./RoundVotingEngine.sol";
import {ProtocolConfig} from "./ProtocolConfig.sol";
import {IClusterPayoutOracle} from "./interfaces/IClusterPayoutOracle.sol";
import {IRaterIdentityRegistry} from "./interfaces/IRaterIdentityRegistry.sol";
import {RoundLib} from "./libraries/RoundLib.sol";
import {QuestionRewardPoolEscrowBundleActionsLib} from "./libraries/QuestionRewardPoolEscrowBundleActionsLib.sol";
import {QuestionRewardPoolEscrowClaimLib} from "./libraries/QuestionRewardPoolEscrowClaimLib.sol";
import {QuestionRewardPoolEscrowEligibilityLib} from "./libraries/QuestionRewardPoolEscrowEligibilityLib.sol";
import {QuestionRewardPoolEscrowQualificationLib} from "./libraries/QuestionRewardPoolEscrowQualificationLib.sol";
import {QuestionRewardPoolEscrowPoolActionsLib} from "./libraries/QuestionRewardPoolEscrowPoolActionsLib.sol";
import {QuestionRewardPoolEscrowTransferLib} from "./libraries/QuestionRewardPoolEscrowTransferLib.sol";
import {
    RewardPool,
    RoundSnapshot,
    BundleReward,
    BundleQuestion,
    BundleRoundSetSnapshot,
    BOUNTY_ELIGIBILITY_OPEN
} from "./libraries/QuestionRewardPoolEscrowTypes.sol";
import {QuestionRewardPoolEscrowVoterLib} from "./libraries/QuestionRewardPoolEscrowVoterLib.sol";

/// @title QuestionRewardPoolEscrow
/// @notice Holds per-question USDC bounties and pays equal per-round rewards to revealed voters.
/// @dev Curyo 2 keeps HREP coherence penalties in the voting engine. Stablecoin payouts are participation rewards.
contract QuestionRewardPoolEscrow is
    Initializable,
    AccessControlUpgradeable,
    PausableUpgradeable,
    ReentrancyGuardTransient
{
    using SafeCast for uint256;

    bytes32 internal constant CONFIG_ROLE = keccak256("CONFIG_ROLE");
    bytes32 internal constant PAUSER_ROLE = keccak256("PAUSER_ROLE");

    uint256 internal constant MIN_REQUIRED_SETTLED_ROUNDS = 1;
    uint256 internal constant MIN_EFFECTIVE_PARTICIPANT_UNITS = 3;
    uint256 internal constant BPS_SCALE = 10_000;
    uint256 internal constant DEFAULT_FRONTEND_FEE_BPS = 300;
    /// @notice Grace period voters have after bountyClosesAt to claim on a still-claimable bundle
    ///         before a third party can sweep the remainder back to the funder.
    uint256 internal constant BUNDLE_CLAIM_GRACE = 7 days;
    uint8 internal constant REWARD_ASSET_HREP = 0;
    uint8 internal constant REWARD_ASSET_USDC = 1;
    uint8 internal constant PAYOUT_DOMAIN_QUESTION_REWARD = 1;

    error RewardPoolCursorNeedsAdvance();

    IERC20 internal hrepToken;
    IERC20 internal usdcToken;
    ContentRegistry internal registry;
    RoundVotingEngine internal votingEngine;
    IRaterIdentityRegistry internal raterRegistry;
    uint256 internal nextRewardPoolId;

    mapping(uint256 => RewardPool) private rewardPools;
    mapping(uint256 => mapping(uint256 => RoundSnapshot)) private roundSnapshots;
    mapping(uint256 => mapping(uint256 => mapping(bytes32 => bool))) private rewardClaimed;
    mapping(uint256 => BundleReward) private bundleRewards;
    mapping(uint256 => BundleQuestion[]) private bundleQuestions;
    mapping(uint256 => mapping(uint256 => uint32)) private bundleQuestionRecordedRounds;
    mapping(uint256 => mapping(uint256 => mapping(uint256 => uint64))) private bundleRoundIds;
    mapping(uint256 => mapping(uint256 => BundleRoundSetSnapshot)) private bundleRoundSetSnapshots;
    mapping(uint256 => mapping(uint256 => mapping(bytes32 => bool))) private bundleRoundSetRewardClaimed;
    /// @dev Storage placeholder reserving the slot once occupied by the removed
    ///      `rewardPoolFunderNullifier` mapping (slim 2820d934). DO NOT remove or repurpose:
    ///      preserves storage layout for any in-place proxy upgrade from a deployment that
    ///      still has data in this slot. The funder's nullifier was write-only after the M2-1
    ///      payer-identity refactor; refunds use `RewardPool.funder` directly and exclusion
    ///      uses `rewardPoolPayerNullifier` for gateway-mediated payments.
    mapping(uint256 => uint256) private __deprecated_rewardPoolFunderNullifier;
    mapping(uint256 => address) private rewardPoolPayerIdentity;
    mapping(uint256 => bytes32) private rewardPoolPayerIdentityKey;
    mapping(uint256 => uint256) private contentBundleId;
    mapping(uint256 => uint256) private contentBundleIndex;
    uint16 public defaultFrontendFeeBps;

    event RewardPoolCreated(
        uint256 indexed rewardPoolId,
        uint256 indexed contentId,
        address indexed funder,
        bytes32 funderIdentityKey,
        uint256 amount,
        uint256 requiredVoters,
        uint256 requiredSettledRounds,
        uint256 startRoundId,
        uint256 bountyOpensAt,
        uint256 bountyClosesAt,
        uint256 feedbackClosesAt,
        uint256 frontendFeeBps,
        uint8 asset,
        uint8 bountyEligibility,
        bytes32 bountyEligibilityDataHash,
        bool nonRefundable
    );
    event RewardPoolRoundQualified(
        uint256 indexed rewardPoolId,
        uint256 indexed contentId,
        uint256 indexed roundId,
        uint256 allocation,
        uint256 eligibleVoters,
        uint256 frontendFeeAllocation
    );
    event RewardPoolRoundEffectiveUnits(
        uint256 indexed rewardPoolId,
        uint256 indexed contentId,
        uint256 indexed roundId,
        uint256 rawEligibleVoters,
        uint256 effectiveParticipantUnits,
        uint256 totalClaimWeight
    );
    event RewardPoolRoundCorrelationSnapshotApplied(
        uint256 indexed rewardPoolId,
        uint256 indexed contentId,
        uint256 indexed roundId,
        uint64 correlationEpochId,
        bytes32 weightRoot
    );
    event RewardPoolCursorAdvanced(
        uint256 indexed rewardPoolId, uint256 indexed contentId, uint256 fromRoundId, uint256 toRoundId, uint256 skipped
    );
    event QuestionRewardClaimed(
        uint256 indexed rewardPoolId,
        uint256 indexed contentId,
        uint256 indexed roundId,
        address claimant,
        bytes32 identityKey,
        uint256 amount,
        address frontend,
        address frontendRecipient,
        uint256 frontendFee,
        uint256 grossAmount
    );
    event RewardPoolRefunded(uint256 indexed rewardPoolId, address indexed funder, uint256 amount);
    event RewardPoolForfeited(uint256 indexed rewardPoolId, address indexed treasury, uint256 amount);
    event DefaultFrontendFeeBpsUpdated(uint256 previousFrontendFeeBps, uint256 newFrontendFeeBps);
    event RewardPoolPurposeSet(
        uint256 indexed rewardPoolId, uint8 indexed bountyKind, uint256 indexed challengedRoundId, bytes32 reasonHash
    );
    event RewardPoolEligibilitySet(uint256 indexed rewardPoolId, uint8 indexed bountyEligibility);
    event QuestionBundleRewardCreated(
        uint256 indexed bundleId,
        address indexed funder,
        bytes32 funderIdentityKey,
        uint256 amount,
        uint256 requiredCompleters,
        uint256 questionCount,
        uint256 requiredSettledRounds,
        uint256 bountyOpensAt,
        uint256 bountyClosesAt,
        uint256 feedbackClosesAt,
        uint256 frontendFeeBps,
        uint8 asset,
        uint8 bountyEligibility,
        bytes32 bountyEligibilityDataHash
    );
    event QuestionBundleEligibilitySet(uint256 indexed bundleId, uint8 indexed bountyEligibility);
    event QuestionBundleRoundRecorded(
        uint256 indexed bundleId,
        uint256 indexed contentId,
        uint256 indexed roundId,
        uint256 bundleIndex,
        uint256 roundSetIndex
    );
    event QuestionBundleRoundSetQualified(
        uint256 indexed bundleId, uint256 indexed roundSetIndex, uint256 allocation, uint256 frontendFeeAllocation
    );
    /// @dev Removed: QuestionBundleFailed is no longer emitted after the retry-after-
    ///      failed-round refactor, so subscribing to that event is a no-op on current deployments.
    event QuestionBundleRewardClaimed(
        uint256 indexed bundleId,
        uint256 indexed roundSetIndex,
        address indexed claimant,
        bytes32 identityKey,
        uint256 amount,
        address frontend,
        address frontendRecipient,
        uint256 frontendFee,
        uint256 grossAmount
    );
    event QuestionBundleRewardRefunded(uint256 indexed bundleId, address indexed funder, uint256 amount);
    event QuestionBundleRewardForfeited(uint256 indexed bundleId, address indexed treasury, uint256 amount);

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(
        address admin,
        address hrepToken_,
        address usdcToken_,
        address registry_,
        address votingEngine_,
        address raterRegistry_
    ) external initializer {
        require(admin != address(0), "Invalid admin");
        require(hrepToken_ != address(0), "Invalid HREP token");
        require(usdcToken_ != address(0), "Invalid token");
        require(registry_ != address(0), "Invalid registry");
        require(votingEngine_ != address(0), "Invalid engine");

        __AccessControl_init();
        __Pausable_init();

        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(CONFIG_ROLE, admin);
        _grantRole(PAUSER_ROLE, admin);

        hrepToken = IERC20(hrepToken_);
        usdcToken = IERC20(usdcToken_);
        registry = ContentRegistry(registry_);
        votingEngine = RoundVotingEngine(votingEngine_);
        raterRegistry = IRaterIdentityRegistry(raterRegistry_);
        nextRewardPoolId = 1;
        defaultFrontendFeeBps = uint16(DEFAULT_FRONTEND_FEE_BPS);
    }

    function createRewardPool(
        uint256 contentId,
        uint256 amount,
        uint256 requiredVoters,
        uint256 requiredSettledRounds,
        uint256 bountyClosesAt,
        uint256 feedbackClosesAt
    ) external nonReentrant whenNotPaused returns (uint256 rewardPoolId) {
        _requireCurrentRegistryEscrow();
        rewardPoolId = _createRewardPool(
            contentId,
            msg.sender,
            address(0),
            REWARD_ASSET_USDC,
            amount,
            requiredVoters,
            requiredSettledRounds,
            bountyClosesAt,
            feedbackClosesAt,
            BOUNTY_ELIGIBILITY_OPEN,
            false
        );
    }

    function createRewardPoolWithEligibility(
        uint256 contentId,
        uint256 amount,
        uint256 requiredVoters,
        uint256 requiredSettledRounds,
        uint256 bountyClosesAt,
        uint256 feedbackClosesAt,
        uint8 bountyEligibility
    ) external nonReentrant whenNotPaused returns (uint256 rewardPoolId) {
        _requireCurrentRegistryEscrow();
        rewardPoolId = _createRewardPool(
            contentId,
            msg.sender,
            address(0),
            REWARD_ASSET_USDC,
            amount,
            requiredVoters,
            requiredSettledRounds,
            bountyClosesAt,
            feedbackClosesAt,
            bountyEligibility,
            false
        );
    }

    function createChallengeRewardPool(
        uint256 contentId,
        uint256 amount,
        uint256 requiredVoters,
        uint256 challengedRoundId,
        bytes32 reasonHash,
        uint256 bountyClosesAt,
        uint256 feedbackClosesAt
    ) external nonReentrant whenNotPaused returns (uint256 rewardPoolId) {
        rewardPoolId = _createPurposeRewardPool(
            contentId,
            amount,
            requiredVoters,
            challengedRoundId,
            reasonHash,
            bountyClosesAt,
            feedbackClosesAt,
            1,
            BOUNTY_ELIGIBILITY_OPEN
        );
    }

    function createChallengeRewardPoolWithEligibility(
        uint256 contentId,
        uint256 amount,
        uint256 requiredVoters,
        uint256 challengedRoundId,
        bytes32 reasonHash,
        uint256 bountyClosesAt,
        uint256 feedbackClosesAt,
        uint8 bountyEligibility
    ) external nonReentrant whenNotPaused returns (uint256 rewardPoolId) {
        rewardPoolId = _createPurposeRewardPool(
            contentId,
            amount,
            requiredVoters,
            challengedRoundId,
            reasonHash,
            bountyClosesAt,
            feedbackClosesAt,
            1,
            bountyEligibility
        );
    }

    function createRerateRewardPool(
        uint256 contentId,
        uint256 amount,
        uint256 requiredVoters,
        uint256 previousRoundId,
        bytes32 reasonHash,
        uint256 bountyClosesAt,
        uint256 feedbackClosesAt
    ) external nonReentrant whenNotPaused returns (uint256 rewardPoolId) {
        rewardPoolId = _createPurposeRewardPool(
            contentId,
            amount,
            requiredVoters,
            previousRoundId,
            reasonHash,
            bountyClosesAt,
            feedbackClosesAt,
            2,
            BOUNTY_ELIGIBILITY_OPEN
        );
    }

    function createRerateRewardPoolWithEligibility(
        uint256 contentId,
        uint256 amount,
        uint256 requiredVoters,
        uint256 previousRoundId,
        bytes32 reasonHash,
        uint256 bountyClosesAt,
        uint256 feedbackClosesAt,
        uint8 bountyEligibility
    ) external nonReentrant whenNotPaused returns (uint256 rewardPoolId) {
        rewardPoolId = _createPurposeRewardPool(
            contentId,
            amount,
            requiredVoters,
            previousRoundId,
            reasonHash,
            bountyClosesAt,
            feedbackClosesAt,
            2,
            bountyEligibility
        );
    }

    function _createPurposeRewardPool(
        uint256 contentId,
        uint256 amount,
        uint256 requiredVoters,
        uint256 relatedRoundId,
        bytes32 reasonHash,
        uint256 bountyClosesAt,
        uint256 feedbackClosesAt,
        uint8 bountyKind,
        uint8 bountyEligibility
    ) private returns (uint256 rewardPoolId) {
        _requireCurrentRegistryEscrow();
        (rewardPoolId, nextRewardPoolId) = QuestionRewardPoolEscrowPoolActionsLib.createRewardPool(
            rewardPools,
            rewardPoolPayerIdentity,
            rewardPoolPayerIdentityKey,
            registry,
            votingEngine,
            hrepToken,
            usdcToken,
            defaultFrontendFeeBps,
            nextRewardPoolId,
            contentId,
            msg.sender,
            address(0),
            REWARD_ASSET_USDC,
            amount,
            requiredVoters,
            MIN_REQUIRED_SETTLED_ROUNDS,
            bountyClosesAt,
            feedbackClosesAt,
            bountyEligibility,
            false,
            bountyKind,
            relatedRoundId,
            reasonHash
        );
    }

    function createSubmissionRewardPoolFromRegistry(
        uint256 contentId,
        address funder,
        address payer,
        uint8 asset,
        uint256 amount,
        uint256 requiredVoters,
        uint256 requiredSettledRounds,
        uint256 bountyClosesAt,
        uint256 feedbackClosesAt
    ) external nonReentrant whenNotPaused returns (uint256 rewardPoolId) {
        require(msg.sender == address(registry), "Only registry");
        _requireRegistryVotingEngine();
        require(funder != address(0), "Invalid funder");
        rewardPoolId = _createRewardPool(
            contentId,
            funder,
            payer,
            asset,
            amount,
            requiredVoters,
            requiredSettledRounds,
            bountyClosesAt,
            feedbackClosesAt,
            BOUNTY_ELIGIBILITY_OPEN,
            true
        );
    }

    function createSubmissionRewardPoolFromRegistry(
        uint256 contentId,
        address funder,
        address payer,
        uint8 asset,
        uint256 amount,
        uint256 requiredVoters,
        uint256 requiredSettledRounds,
        uint256 bountyClosesAt,
        uint256 feedbackClosesAt,
        uint8 bountyEligibility
    ) external nonReentrant whenNotPaused returns (uint256 rewardPoolId) {
        require(msg.sender == address(registry), "Only registry");
        _requireRegistryVotingEngine();
        require(funder != address(0), "Invalid funder");
        rewardPoolId = _createRewardPool(
            contentId,
            funder,
            payer,
            asset,
            amount,
            requiredVoters,
            requiredSettledRounds,
            bountyClosesAt,
            feedbackClosesAt,
            bountyEligibility,
            true
        );
    }

    function createSubmissionBundleFromRegistry(
        uint256 bundleId,
        uint256[] calldata contentIds,
        address funder,
        uint8 asset,
        uint256 amount,
        uint256 requiredCompleters,
        uint256 requiredSettledRounds,
        uint256 bountyClosesAt,
        uint256 feedbackClosesAt
    ) external nonReentrant whenNotPaused returns (uint256 rewardPoolId) {
        return _createSubmissionBundleFromRegistry(
            bundleId,
            contentIds,
            funder,
            asset,
            amount,
            requiredCompleters,
            requiredSettledRounds,
            bountyClosesAt,
            feedbackClosesAt,
            BOUNTY_ELIGIBILITY_OPEN
        );
    }

    function createSubmissionBundleFromRegistry(
        uint256 bundleId,
        uint256[] calldata contentIds,
        address funder,
        uint8 asset,
        uint256 amount,
        uint256 requiredCompleters,
        uint256 requiredSettledRounds,
        uint256 bountyClosesAt,
        uint256 feedbackClosesAt,
        uint8 bountyEligibility
    ) external nonReentrant whenNotPaused returns (uint256 rewardPoolId) {
        return _createSubmissionBundleFromRegistry(
            bundleId,
            contentIds,
            funder,
            asset,
            amount,
            requiredCompleters,
            requiredSettledRounds,
            bountyClosesAt,
            feedbackClosesAt,
            bountyEligibility
        );
    }

    function _createSubmissionBundleFromRegistry(
        uint256 bundleId,
        uint256[] calldata contentIds,
        address funder,
        uint8 asset,
        uint256 amount,
        uint256 requiredCompleters,
        uint256 requiredSettledRounds,
        uint256 bountyClosesAt,
        uint256 feedbackClosesAt,
        uint8 bountyEligibility
    ) internal returns (uint256 rewardPoolId) {
        require(msg.sender == address(registry), "Only registry");
        _requireRegistryVotingEngine();
        require(funder != address(0), "Invalid funder");

        rewardPoolId = QuestionRewardPoolEscrowBundleActionsLib.createSubmissionBundleFromRegistry(
            bundleRewards,
            bundleQuestions,
            contentBundleId,
            contentBundleIndex,
            registry,
            votingEngine.protocolConfig(),
            hrepToken,
            usdcToken,
            defaultFrontendFeeBps,
            bundleId,
            contentIds,
            funder,
            asset,
            amount,
            requiredCompleters,
            requiredSettledRounds,
            bountyClosesAt,
            feedbackClosesAt,
            bountyEligibility
        );
    }

    function _createRewardPool(
        uint256 contentId,
        address funder,
        address payer,
        uint8 asset,
        uint256 amount,
        uint256 requiredVoters,
        uint256 requiredSettledRounds,
        uint256 bountyClosesAt,
        uint256 feedbackClosesAt,
        uint8 bountyEligibility,
        bool nonRefundable
    ) internal returns (uint256 rewardPoolId) {
        (rewardPoolId, nextRewardPoolId) = QuestionRewardPoolEscrowPoolActionsLib.createRewardPool(
            rewardPools,
            rewardPoolPayerIdentity,
            rewardPoolPayerIdentityKey,
            registry,
            votingEngine,
            hrepToken,
            usdcToken,
            defaultFrontendFeeBps,
            nextRewardPoolId,
            contentId,
            funder,
            payer,
            asset,
            amount,
            requiredVoters,
            requiredSettledRounds,
            bountyClosesAt,
            feedbackClosesAt,
            bountyEligibility,
            nonRefundable,
            0,
            0,
            bytes32(0)
        );
    }

    function qualifyRound(uint256 rewardPoolId, uint256 roundId) external {
        RewardPool storage rewardPool = _getIncompleteRewardPoolForQualification(rewardPoolId);
        _qualifyRound(rewardPoolId, rewardPool, roundId);
    }

    function advanceQualificationCursor(uint256 rewardPoolId, uint256 maxRounds)
        external
        returns (uint256 skipped, uint256 nextRoundToEvaluate)
    {
        require(maxRounds > 0, "No rounds");
        RewardPool storage rewardPool = _getIncompleteRewardPoolForQualification(rewardPoolId);

        nextRoundToEvaluate = rewardPool.nextRoundToEvaluate;
        while (skipped < maxRounds) {
            (bool roundFinished, bool canQualify,) = _roundQualificationStatus(rewardPool, nextRoundToEvaluate);
            if (!roundFinished || canQualify) break;
            nextRoundToEvaluate++;
            skipped++;
        }

        if (skipped > 0) {
            rewardPool.nextRoundToEvaluate = nextRoundToEvaluate.toUint64();
        }
    }

    function claimQuestionReward(uint256 rewardPoolId, uint256 roundId)
        external
        nonReentrant
        returns (uint256 rewardAmount)
    {
        bytes32[] memory proof;
        IClusterPayoutOracle.PayoutWeight memory payoutWeight;
        return _claimQuestionReward(rewardPoolId, roundId, payoutWeight, proof, false);
    }

    function claimQuestionReward(
        uint256 rewardPoolId,
        uint256 roundId,
        IClusterPayoutOracle.PayoutWeight calldata payoutWeight,
        bytes32[] calldata proof
    ) external nonReentrant returns (uint256 rewardAmount) {
        return _claimQuestionReward(rewardPoolId, roundId, payoutWeight, proof, true);
    }

    function _claimQuestionReward(
        uint256 rewardPoolId,
        uint256 roundId,
        IClusterPayoutOracle.PayoutWeight memory payoutWeight,
        bytes32[] memory proof,
        bool hasCorrelationProof
    ) internal returns (uint256 rewardAmount) {
        RewardPool storage rewardPool = _getExistingRewardPool(rewardPoolId);
        require(!rewardPool.refunded, "Bounty refunded");
        require(votingEngine.roundUnrevealedCleanupRemaining(rewardPool.contentId, roundId) == 0, "Cleanup pending");
        _qualifyRoundIfNeeded(rewardPoolId, rewardPool, roundId);

        (bytes32 identityKey, bytes32 commitKey, address rewardRecipient) =
            _resolveQuestionRewardClaim(rewardPool, roundId, msg.sender);
        require(!_isExcludedClaimant(rewardPool, identityKey, msg.sender), "Excluded voter");
        require(_isQuestionBountyEligible(rewardPool, rewardRecipient), "Not bounty eligible");
        require(commitKey != bytes32(0), "No commit");
        require(!rewardClaimed[rewardPoolId][roundId][commitKey], "Already claimed");

        (bool revealed, address frontend) =
            _timelyRevealedCommitFrontend(rewardPool.contentId, roundId, commitKey, rewardPool.bountyClosesAt);
        require(revealed, "Vote not revealed");

        RoundSnapshot storage snapshot = roundSnapshots[rewardPoolId][roundId];
        uint256 baseClaimWeight = _roundClaimWeight(rewardPool.contentId, roundId, commitKey);
        uint256 claimWeight = _effectiveQuestionClaimWeight(
            rewardPool,
            rewardPoolId,
            roundId,
            identityKey,
            commitKey,
            rewardRecipient,
            baseClaimWeight,
            payoutWeight,
            proof,
            hasCorrelationProof
        );
        require(claimWeight > 0, "No reward weight");
        uint256 reservedFrontendFee;
        uint256 grossAmount;
        uint256 frontendFee;
        address frontendRecipient;
        if (snapshot.totalClaimWeight == 0) {
            reservedFrontendFee = QuestionRewardPoolEscrowClaimLib.nextEqualShare(
                snapshot.frontendFeeAllocation, snapshot.eligibleVoters, snapshot.claimedCount
            );
            (grossAmount, rewardAmount, frontendFee, frontendRecipient) =
                QuestionRewardPoolEscrowClaimLib.computeEqualShareClaimSplit(
                    votingEngine,
                    rewardPool.contentId,
                    roundId,
                    commitKey,
                    frontend,
                    snapshot.allocation,
                    snapshot.frontendFeeAllocation,
                    snapshot.eligibleVoters,
                    snapshot.claimedCount
                );
        } else {
            (grossAmount, rewardAmount, frontendFee, frontendRecipient, reservedFrontendFee) =
                QuestionRewardPoolEscrowClaimLib.computeWeightedClaimSplit(
                    votingEngine,
                    rewardPool.contentId,
                    roundId,
                    commitKey,
                    frontend,
                    snapshot.allocation,
                    snapshot.frontendFeeAllocation,
                    snapshot.totalClaimWeight,
                    claimWeight,
                    snapshot.claimedWeight,
                    snapshot.claimedAmount,
                    snapshot.frontendFeeClaimedAmount
                );
        }
        require(grossAmount > 0, "No reward");

        rewardClaimed[rewardPoolId][roundId][commitKey] = true;
        unchecked {
            snapshot.claimedCount++;
        }
        snapshot.claimedWeight += claimWeight;
        snapshot.claimedAmount += grossAmount;
        snapshot.frontendFeeClaimedAmount += reservedFrontendFee;
        rewardPool.claimedAmount += grossAmount;

        (rewardAmount, frontendFee, frontendRecipient) = _settleClaimPayout(
            _rewardToken(rewardPool.asset), rewardRecipient, rewardAmount, frontendRecipient, frontendFee
        );
        emit QuestionRewardClaimed(
            rewardPoolId,
            rewardPool.contentId,
            roundId,
            rewardRecipient,
            identityKey,
            rewardAmount,
            frontend,
            frontendRecipient,
            frontendFee,
            grossAmount
        );
    }

    function _settleClaimPayout(
        IERC20 rewardToken,
        address rewardRecipient,
        uint256 rewardAmount,
        address frontendRecipient,
        uint256 frontendFee
    ) internal returns (uint256, uint256, address) {
        return QuestionRewardPoolEscrowTransferLib.settleClaimPayout(
            rewardToken, rewardRecipient, rewardAmount, frontendRecipient, frontendFee
        );
    }

    function recordBundleQuestionTerminal(uint256 contentId, uint256 roundId, bool settled) external {
        // Intentionally NOT gated by whenNotPaused: the voting engine invokes this inside a
        // try/catch during settlement, so a paused escrow would silently swallow the terminal
        // signal with no retry path, permanently locking bundle claims. Caller is restricted
        // to the voting engine, which is already a trusted state machine.
        require(msg.sender == address(votingEngine), "Only engine");
        QuestionRewardPoolEscrowBundleActionsLib.recordBundleQuestionTerminal(
            bundleRewards,
            bundleQuestionRecordedRounds,
            bundleRoundIds,
            contentBundleId,
            contentBundleIndex,
            contentId,
            roundId,
            settled
        );
    }

    /// @notice Mirror a settled or terminal round into its bundle accounting and qualify any
    ///         complete-but-pending round set. Permissionless and idempotent.
    /// @dev Settlement only does the O(1) record into the bundle slot; the heavy qualification
    ///      iteration (voters × bundle questions) is intentionally deferred here so it cannot
    ///      OOG the settlement transaction at high `maxVoters` × bundle-size. Anyone can call
    ///      this after settlement to drive the bundle forward.
    /// @dev OPERATIONS REQUIREMENT: deployments SHOULD run a keeper that calls this function
    ///      after each bundle question's round settles. Voters can also self-trigger this
    ///      call before claiming, and the refund path rechecks complete recorded sets before
    ///      sweeping funds.
    function syncBundleQuestionTerminal(uint256 contentId, uint256 roundId) external {
        QuestionRewardPoolEscrowBundleActionsLib.syncBundleQuestionTerminal(
            bundleRewards,
            bundleQuestions,
            bundleQuestionRecordedRounds,
            bundleRoundIds,
            bundleRoundSetSnapshots,
            contentBundleId,
            contentBundleIndex,
            registry,
            votingEngine,
            votingEngine.protocolConfig(),
            contentId,
            roundId
        );
    }

    function claimQuestionBundleReward(uint256 bundleId, uint256 roundSetIndex)
        external
        nonReentrant
        returns (uint256 rewardAmount)
    {
        return QuestionRewardPoolEscrowBundleActionsLib.claimQuestionBundleReward(
            bundleRewards,
            bundleQuestions,
            bundleQuestionRecordedRounds,
            bundleRoundIds,
            bundleRoundSetSnapshots,
            bundleRoundSetRewardClaimed,
            registry,
            votingEngine,
            votingEngine.protocolConfig(),
            hrepToken,
            usdcToken,
            bundleId,
            roundSetIndex
        );
    }

    function claimableQuestionBundleReward(uint256 bundleId, uint256 roundSetIndex, address account)
        external
        view
        returns (uint256 claimableAmount)
    {
        return QuestionRewardPoolEscrowBundleActionsLib.claimableQuestionBundleReward(
            bundleRewards,
            bundleQuestions,
            bundleRoundIds,
            bundleRoundSetSnapshots,
            bundleRoundSetRewardClaimed,
            registry,
            votingEngine,
            votingEngine.protocolConfig(),
            bundleId,
            roundSetIndex,
            account
        );
    }

    function refundQuestionBundleReward(uint256 bundleId) external nonReentrant returns (uint256 refundAmount) {
        return QuestionRewardPoolEscrowBundleActionsLib.refundQuestionBundleReward(
            bundleRewards,
            bundleQuestions,
            bundleQuestionRecordedRounds,
            bundleRoundIds,
            bundleRoundSetSnapshots,
            registry,
            votingEngine,
            votingEngine.protocolConfig(),
            hrepToken,
            usdcToken,
            bundleId
        );
    }

    function refundExpiredRewardPool(uint256 rewardPoolId) external nonReentrant returns (uint256 refundAmount) {
        RewardPool storage rewardPool = _getExistingRewardPool(rewardPoolId);
        if (rewardPool.qualifiedRounds >= rewardPool.requiredSettledRounds || rewardPool.unallocatedRefunded) {
            refundAmount = _refundCompleteRewardPool(rewardPoolId, rewardPool);
        } else {
            require(rewardPool.bountyClosesAt != 0 && block.timestamp > rewardPool.bountyClosesAt, "Not expired");
            refundAmount = _refundUnallocatedRewardPool(rewardPoolId, rewardPool);
        }
    }

    function refundInactiveRewardPool(uint256 rewardPoolId) external nonReentrant returns (uint256 refundAmount) {
        RewardPool storage rewardPool = _getExistingRewardPool(rewardPoolId);
        require(!registry.isContentActive(rewardPool.contentId), "Content active");
        // If the content is Dormant, the original submitter still has an exclusive 24-hour
        // revival window. Forfeiting during that window would let anyone atomically combine
        // markDormant + refundInactiveRewardPool to strip the bounty before the submitter
        // can recover it. Wait until the revival window closes. Cancelled / non-dormant
        // content has dormantKeyReleasableAt == 0 so this check is a no-op there.
        require(block.timestamp > registry.dormantKeyReleasableAt(rewardPool.contentId), "Revival active");
        refundAmount = _refundUnallocatedRewardPool(rewardPoolId, rewardPool);
    }

    function _refundUnallocatedRewardPool(uint256 rewardPoolId, RewardPool storage rewardPool)
        internal
        returns (uint256 refundAmount)
    {
        require(!rewardPool.refunded, "Already refunded");
        require(!rewardPool.unallocatedRefunded, "Already refunded");
        require(rewardPool.qualifiedRounds < rewardPool.requiredSettledRounds, "Bounty complete");
        _requireNoPendingFinishedRound(rewardPool);
        refundAmount = rewardPool.unallocatedAmount;
        require(refundAmount > 0, "No refund");
        rewardPool.unallocatedRefunded = true;
        rewardPool.unallocatedAmount = 0;
        rewardPool.fundedAmount -= refundAmount;
        _transferRewardPoolResidue(rewardPoolId, rewardPool, refundAmount);
    }

    function _refundCompleteRewardPool(uint256 rewardPoolId, RewardPool storage rewardPool)
        internal
        returns (uint256 refundAmount)
    {
        uint256 claimDeadline = rewardPool.claimDeadline;
        require(claimDeadline != 0, "Grace");
        require(block.timestamp > claimDeadline + BUNDLE_CLAIM_GRACE, "Grace");

        refundAmount = rewardPool.fundedAmount - rewardPool.claimedAmount;
        require(refundAmount > 0, "No refund");
        rewardPool.refunded = true;
        rewardPool.claimDeadline = 0;
        _transferRewardPoolResidue(rewardPoolId, rewardPool, refundAmount);
    }

    function _transferRewardPoolResidue(uint256 rewardPoolId, RewardPool storage rewardPool, uint256 amount) internal {
        if (rewardPool.nonRefundable) {
            address treasury = _protocolTreasury();
            QuestionRewardPoolEscrowTransferLib.transferResidue(
                _rewardToken(rewardPool.asset), true, rewardPool.funder, treasury, amount
            );
            emit RewardPoolForfeited(rewardPoolId, treasury, amount);
        } else {
            QuestionRewardPoolEscrowTransferLib.transferResidue(
                _rewardToken(rewardPool.asset), false, rewardPool.funder, address(0), amount
            );
            emit RewardPoolRefunded(rewardPoolId, rewardPool.funder, amount);
        }
    }

    function claimableQuestionReward(uint256 rewardPoolId, uint256 roundId, address account)
        external
        view
        returns (uint256 claimableAmount)
    {
        RewardPool storage rewardPool = rewardPools[rewardPoolId];
        if (rewardPool.id != 0 && _usesClusterPayoutSnapshot(rewardPool)) return 0;

        return QuestionRewardPoolEscrowClaimLib.claimableQuestionReward(
            rewardPools,
            roundSnapshots,
            rewardClaimed,
            rewardPoolPayerIdentity,
            rewardPoolPayerIdentityKey,
            votingEngine,
            votingEngine.protocolConfig(),
            rewardPoolId,
            roundId,
            account,
            BPS_SCALE
        );
    }

    function claimableQuestionRewardWithPayoutWeight(
        uint256 rewardPoolId,
        uint256 roundId,
        address account,
        IClusterPayoutOracle.PayoutWeight calldata payoutWeight,
        bytes32[] calldata proof
    ) external view returns (uint256 claimableAmount) {
        RewardPool storage rewardPool = rewardPools[rewardPoolId];
        if (rewardPool.id == 0 || rewardPool.refunded) return 0;
        if (!_usesClusterPayoutSnapshot(rewardPool)) {
            return QuestionRewardPoolEscrowClaimLib.claimableQuestionReward(
                rewardPools,
                roundSnapshots,
                rewardClaimed,
                rewardPoolPayerIdentity,
                rewardPoolPayerIdentityKey,
                votingEngine,
                votingEngine.protocolConfig(),
                rewardPoolId,
                roundId,
                account,
                BPS_SCALE
            );
        }

        (bytes32 identityKey, bytes32 commitKey, address rewardRecipient) =
            _resolveQuestionRewardClaim(rewardPool, roundId, account);
        if (
            commitKey == bytes32(0) || rewardClaimed[rewardPoolId][roundId][commitKey]
                || _isExcludedClaimant(rewardPool, identityKey, account)
                || !_isQuestionBountyEligible(rewardPool, rewardRecipient)
        ) return 0;
        (bool revealed, address frontend) =
            _timelyRevealedCommitFrontend(rewardPool.contentId, roundId, commitKey, rewardPool.bountyClosesAt);
        if (!revealed || votingEngine.roundUnrevealedCleanupRemaining(rewardPool.contentId, roundId) > 0) return 0;

        RoundSnapshot storage snapshot = roundSnapshots[rewardPoolId][roundId];
        if (!snapshot.qualified || snapshot.claimedWeight >= snapshot.totalClaimWeight) return 0;
        uint256 baseClaimWeight = _roundClaimWeight(rewardPool.contentId, roundId, commitKey);
        uint256 claimWeight = _effectiveQuestionClaimWeight(
            rewardPool,
            rewardPoolId,
            roundId,
            identityKey,
            commitKey,
            rewardRecipient,
            baseClaimWeight,
            payoutWeight,
            proof,
            true
        );
        if (claimWeight == 0) return 0;

        (, claimableAmount,,,) = QuestionRewardPoolEscrowClaimLib.computeWeightedClaimSplit(
            votingEngine,
            rewardPool.contentId,
            roundId,
            commitKey,
            frontend,
            snapshot.allocation,
            snapshot.frontendFeeAllocation,
            snapshot.totalClaimWeight,
            claimWeight,
            snapshot.claimedWeight,
            snapshot.claimedAmount,
            snapshot.frontendFeeClaimedAmount
        );
    }

    function getRoundSnapshot(uint256 rewardPoolId, uint256 roundId) external view returns (RoundSnapshot memory) {
        return roundSnapshots[rewardPoolId][roundId];
    }

    function getRewardPoolEligibility(uint256 rewardPoolId)
        external
        view
        returns (uint8 bountyEligibility, bytes32 bountyEligibilityDataHash)
    {
        RewardPool storage rewardPool = _getExistingRewardPool(rewardPoolId);
        return (rewardPool.bountyEligibility, rewardPool.bountyEligibilityDataHash);
    }

    function getQuestionBundleEligibility(uint256 bundleId)
        external
        view
        returns (uint8 bountyEligibility, bytes32 bountyEligibilityDataHash)
    {
        BundleReward storage bundle = _getExistingBundleReward(bundleId);
        return (bundle.bountyEligibility, bundle.bountyEligibilityDataHash);
    }

    function pause() external onlyRole(PAUSER_ROLE) {
        _pause();
    }

    function unpause() external onlyRole(PAUSER_ROLE) {
        _unpause();
    }

    function _rewardToken(uint8 asset) internal view returns (IERC20 token) {
        return asset == REWARD_ASSET_HREP ? hrepToken : usdcToken;
    }

    function _protocolTreasury() internal view returns (address treasury) {
        return votingEngine.protocolConfig().treasury();
    }

    function _requireRegistryVotingEngine() internal view {
        require(registry.votingEngine() == address(votingEngine), "Stale engine");
    }

    function _requireCurrentRegistryEscrow() internal view {
        _requireRegistryVotingEngine();
        require(registry.questionRewardPoolEscrow() == address(this), "Stale escrow");
    }

    function _getExistingRewardPool(uint256 rewardPoolId) internal view returns (RewardPool storage rewardPool) {
        rewardPool = rewardPools[rewardPoolId];
        require(rewardPool.id != 0, "Bounty not found");
    }

    function _getExistingBundleReward(uint256 bundleId) internal view returns (BundleReward storage bundle) {
        bundle = bundleRewards[bundleId];
        require(bundle.id != 0, "Bundle not found");
    }

    function _getIncompleteRewardPoolForQualification(uint256 rewardPoolId)
        internal
        view
        returns (RewardPool storage rewardPool)
    {
        rewardPool = _getExistingRewardPool(rewardPoolId);
        _requireIncompleteRewardPool(rewardPool);
    }

    function _qualifyRoundIfNeeded(uint256 rewardPoolId, RewardPool storage rewardPool, uint256 roundId) internal {
        if (!roundSnapshots[rewardPoolId][roundId].qualified) {
            _requireIncompleteRewardPool(rewardPool);
            _qualifyRound(rewardPoolId, rewardPool, roundId);
        }
    }

    function _requireIncompleteRewardPool(RewardPool storage rewardPool) internal view {
        require(!rewardPool.refunded, "Bounty refunded");
        require(!rewardPool.unallocatedRefunded, "Bounty refunded");
        require(rewardPool.qualifiedRounds < rewardPool.requiredSettledRounds, "Bounty complete");
    }

    function _qualifyRound(uint256 rewardPoolId, RewardPool storage rewardPool, uint256 roundId) internal {
        if (_usesClusterPayoutSnapshot(rewardPool)) {
            _qualifyRoundWithClusterSnapshot(rewardPoolId, rewardPool, roundId);
            return;
        }

        (
            uint256 allocation,
            uint256 effectiveParticipantUnits,
            uint256 frontendFeeAllocation,
            uint256 rawEligibleVoters,
            uint256 totalClaimWeight
        ) = QuestionRewardPoolEscrowQualificationLib.qualifyRound(
            roundSnapshots,
            rewardPoolPayerIdentity,
            rewardPoolPayerIdentityKey,
            votingEngine,
            rewardPool,
            rewardPoolId,
            roundId,
            BPS_SCALE
        );

        emit RewardPoolRoundQualified(
            rewardPoolId, rewardPool.contentId, roundId, allocation, effectiveParticipantUnits, frontendFeeAllocation
        );
        emit RewardPoolRoundEffectiveUnits(
            rewardPoolId, rewardPool.contentId, roundId, rawEligibleVoters, effectiveParticipantUnits, totalClaimWeight
        );
    }

    function _qualifyRoundWithClusterSnapshot(uint256 rewardPoolId, RewardPool storage rewardPool, uint256 roundId)
        internal
    {
        require(roundId >= rewardPool.startRoundId, "Round too early");
        require(!roundSnapshots[rewardPoolId][roundId].qualified, "Round qualified");
        require(roundId == rewardPool.nextRoundToEvaluate, "Round out of order");

        (bool roundSettled,, uint256 baseRawEligibleVoters,,, uint48 settledAt) = QuestionRewardPoolEscrowQualificationLib.previewRoundQualification(
            QuestionRewardPoolEscrowQualificationLib.QualificationContext({
                votingEngine: votingEngine,
                protocolConfig: votingEngine.protocolConfig(),
                rewardId: rewardPool.id,
                contentId: rewardPool.contentId,
                roundId: roundId,
                bountyClosesAt: rewardPool.bountyClosesAt,
                requiredVoters: rewardPool.requiredVoters,
                bountyEligibility: rewardPool.bountyEligibility,
                funder: rewardPool.funder,
                funderIdentity: rewardPoolPayerIdentity[rewardPool.id],
                funderIdentityKey: rewardPoolPayerIdentityKey[rewardPool.id],
                submitterIdentity: rewardPool.submitterIdentity,
                submitterIdentityKey: rewardPool.submitterIdentityKey
            })
        );
        require(roundSettled, "Round not settled");
        require(votingEngine.roundUnrevealedCleanupRemaining(rewardPool.contentId, roundId) == 0, "Cleanup pending");

        IClusterPayoutOracle.RoundPayoutSnapshot memory payoutSnapshot =
            _finalizedQuestionPayoutSnapshot(rewardPoolId, rewardPool.contentId, roundId);
        require(payoutSnapshot.rawEligibleVoters == baseRawEligibleVoters, "Cluster snapshot mismatch");

        uint256 effectiveParticipantUnits = payoutSnapshot.effectiveParticipantUnits;
        uint256 totalClaimWeight = payoutSnapshot.totalClaimWeight;
        uint256 minEffectiveUnits = rewardPool.requiredVoters > MIN_EFFECTIVE_PARTICIPANT_UNITS
            ? rewardPool.requiredVoters
            : MIN_EFFECTIVE_PARTICIPANT_UNITS;
        uint256 effectiveFloor = minEffectiveUnits * BPS_SCALE;
        require(
            baseRawEligibleVoters >= rewardPool.requiredVoters && effectiveParticipantUnits >= effectiveFloor
                && totalClaimWeight > 0,
            "Too few eligible voters"
        );

        uint256 allocation = _previewRoundAllocation(rewardPool);
        require(allocation > 0 && allocation <= rewardPool.unallocatedAmount, "No allocation");
        require(allocation >= effectiveParticipantUnits, "Small allocation");
        uint256 frontendFeeAllocation = (allocation * rewardPool.frontendFeeBps) / BPS_SCALE;

        unchecked {
            rewardPool.qualifiedRounds++;
        }
        uint256 claimDeadline = block.timestamp > settledAt ? block.timestamp : settledAt;
        if (claimDeadline > rewardPool.claimDeadline) {
            rewardPool.claimDeadline = claimDeadline.toUint64();
        }
        rewardPool.nextRoundToEvaluate = (roundId + 1).toUint64();
        rewardPool.unallocatedAmount -= allocation;

        roundSnapshots[rewardPoolId][roundId] = RoundSnapshot({
            qualified: true,
            eligibleVoters: effectiveParticipantUnits.toUint32(),
            rawEligibleVoters: baseRawEligibleVoters.toUint32(),
            allocation: allocation,
            claimedCount: 0,
            frontendFeeAllocation: frontendFeeAllocation,
            totalClaimWeight: totalClaimWeight,
            claimedWeight: 0,
            claimedAmount: 0,
            frontendFeeClaimedAmount: 0
        });

        emit RewardPoolRoundQualified(
            rewardPoolId, rewardPool.contentId, roundId, allocation, effectiveParticipantUnits, frontendFeeAllocation
        );
        emit RewardPoolRoundEffectiveUnits(
            rewardPoolId,
            rewardPool.contentId,
            roundId,
            baseRawEligibleVoters,
            effectiveParticipantUnits,
            totalClaimWeight
        );
        emit RewardPoolRoundCorrelationSnapshotApplied(
            rewardPoolId, rewardPool.contentId, roundId, payoutSnapshot.correlationEpochId, payoutSnapshot.weightRoot
        );
    }

    function _canPreviewNewQualification(RewardPool storage rewardPool, uint256 roundId) internal view returns (bool) {
        if (
            rewardPool.refunded || rewardPool.unallocatedRefunded
                || rewardPool.qualifiedRounds >= rewardPool.requiredSettledRounds
        ) return false;
        return roundId >= rewardPool.startRoundId && roundId == rewardPool.nextRoundToEvaluate;
    }

    function _previewRoundQualification(RewardPool storage rewardPool, uint256 roundId)
        internal
        view
        returns (
            bool roundSettled,
            bool canQualify,
            uint256 rawEligibleVoters,
            uint256 effectiveParticipantUnits,
            uint256 totalClaimWeight,
            uint48 settledAt
        )
    {
        if (_usesClusterPayoutSnapshot(rewardPool)) {
            return _previewRoundQualificationWithClusterSnapshot(rewardPool, roundId);
        }

        (roundSettled, canQualify, rawEligibleVoters, effectiveParticipantUnits, totalClaimWeight, settledAt) =
            QuestionRewardPoolEscrowQualificationLib.previewRoundQualification(
                QuestionRewardPoolEscrowQualificationLib.QualificationContext({
                    votingEngine: votingEngine,
                    protocolConfig: votingEngine.protocolConfig(),
                    rewardId: rewardPool.id,
                    contentId: rewardPool.contentId,
                    roundId: roundId,
                    bountyClosesAt: rewardPool.bountyClosesAt,
                    requiredVoters: rewardPool.requiredVoters,
                    bountyEligibility: rewardPool.bountyEligibility,
                    funder: rewardPool.funder,
                    // Use payer identity for exclusion checks so gateway-mediated payments
                    // (e.g. X402) correctly exclude the actual human payer, not the gateway contract.
                    funderIdentity: rewardPoolPayerIdentity[rewardPool.id],
                    funderIdentityKey: rewardPoolPayerIdentityKey[rewardPool.id],
                    submitterIdentity: rewardPool.submitterIdentity,
                    submitterIdentityKey: rewardPool.submitterIdentityKey
                })
            );
    }

    function _previewRoundQualificationWithClusterSnapshot(RewardPool storage rewardPool, uint256 roundId)
        internal
        view
        returns (
            bool roundSettled,
            bool canQualify,
            uint256 rawEligibleVoters,
            uint256 effectiveParticipantUnits,
            uint256 totalClaimWeight,
            uint48 settledAt
        )
    {
        (roundSettled,, rawEligibleVoters,,, settledAt) =
            QuestionRewardPoolEscrowQualificationLib.previewRoundQualification(
                QuestionRewardPoolEscrowQualificationLib.QualificationContext({
                    votingEngine: votingEngine,
                    protocolConfig: votingEngine.protocolConfig(),
                    rewardId: rewardPool.id,
                    contentId: rewardPool.contentId,
                    roundId: roundId,
                    bountyClosesAt: rewardPool.bountyClosesAt,
                    requiredVoters: rewardPool.requiredVoters,
                    bountyEligibility: rewardPool.bountyEligibility,
                    funder: rewardPool.funder,
                    funderIdentity: rewardPoolPayerIdentity[rewardPool.id],
                    funderIdentityKey: rewardPoolPayerIdentityKey[rewardPool.id],
                    submitterIdentity: rewardPool.submitterIdentity,
                    submitterIdentityKey: rewardPool.submitterIdentityKey
                })
            );
        if (!roundSettled) return (false, false, 0, 0, 0, 0);

        try IClusterPayoutOracle(_clusterPayoutOracleAddress())
            .getRoundPayoutSnapshot(
                PAYOUT_DOMAIN_QUESTION_REWARD, rewardPool.id, rewardPool.contentId, roundId
            ) returns (
            IClusterPayoutOracle.RoundPayoutSnapshot memory payoutSnapshot
        ) {
            if (payoutSnapshot.status != IClusterPayoutOracle.SnapshotStatus.Finalized) {
                return (roundSettled, false, rawEligibleVoters, 0, 0, settledAt);
            }
            if (payoutSnapshot.rawEligibleVoters != rawEligibleVoters) {
                return (roundSettled, false, rawEligibleVoters, 0, 0, settledAt);
            }
            effectiveParticipantUnits = payoutSnapshot.effectiveParticipantUnits;
            totalClaimWeight = payoutSnapshot.totalClaimWeight;
            uint256 minEffectiveUnits = rewardPool.requiredVoters > MIN_EFFECTIVE_PARTICIPANT_UNITS
                ? rewardPool.requiredVoters
                : MIN_EFFECTIVE_PARTICIPANT_UNITS;
            uint256 effectiveFloor = minEffectiveUnits * BPS_SCALE;
            canQualify = rawEligibleVoters >= rewardPool.requiredVoters && effectiveParticipantUnits >= effectiveFloor
                && totalClaimWeight > 0;
        } catch {
            return (roundSettled, false, rawEligibleVoters, 0, 0, settledAt);
        }
    }

    function _roundQualificationStatus(RewardPool storage rewardPool, uint256 roundId)
        internal
        view
        returns (bool roundFinished, bool canQualify, uint256 eligibleVoters)
    {
        (, RoundLib.RoundState state,,,,,,,,,,,,) = votingEngine.rounds(rewardPool.contentId, roundId);
        if (state == RoundLib.RoundState.Open) return (false, false, 0);
        if (state != RoundLib.RoundState.Settled) return (true, false, 0);

        if (_usesClusterPayoutSnapshot(rewardPool)) {
            return _clusterRoundQualificationStatus(rewardPool, roundId);
        }

        uint256 effectiveParticipantUnits;
        (, canQualify,, effectiveParticipantUnits,,) = _previewRoundQualification(rewardPool, roundId);
        if (canQualify) canQualify = _previewRoundAllocation(rewardPool) >= effectiveParticipantUnits;
        return (true, canQualify, effectiveParticipantUnits);
    }

    function _clusterRoundQualificationStatus(RewardPool storage rewardPool, uint256 roundId)
        internal
        view
        returns (bool roundFinished, bool canQualify, uint256 eligibleVoters)
    {
        (bool roundSettled,, uint256 rawEligibleVoters,,,) =
            _previewRoundQualificationWithClusterSnapshot(rewardPool, roundId);
        if (!roundSettled) return (false, false, 0);

        try IClusterPayoutOracle(_clusterPayoutOracleAddress())
            .getRoundPayoutSnapshot(
                PAYOUT_DOMAIN_QUESTION_REWARD, rewardPool.id, rewardPool.contentId, roundId
            ) returns (
            IClusterPayoutOracle.RoundPayoutSnapshot memory payoutSnapshot
        ) {
            if (
                payoutSnapshot.status != IClusterPayoutOracle.SnapshotStatus.Finalized
                    || payoutSnapshot.rawEligibleVoters != rawEligibleVoters
            ) {
                return (false, false, 0);
            }

            uint256 effectiveParticipantUnits = payoutSnapshot.effectiveParticipantUnits;
            uint256 minEffectiveUnits = rewardPool.requiredVoters > MIN_EFFECTIVE_PARTICIPANT_UNITS
                ? rewardPool.requiredVoters
                : MIN_EFFECTIVE_PARTICIPANT_UNITS;
            uint256 effectiveFloor = minEffectiveUnits * BPS_SCALE;
            canQualify = rawEligibleVoters >= rewardPool.requiredVoters
                && effectiveParticipantUnits >= effectiveFloor && payoutSnapshot.totalClaimWeight > 0;
            if (canQualify) canQualify = _previewRoundAllocation(rewardPool) >= effectiveParticipantUnits;
            return (true, canQualify, effectiveParticipantUnits);
        } catch {
            return (false, false, 0);
        }
    }

    function _requireNoPendingFinishedRound(RewardPool storage rewardPool) internal view {
        uint256 nextRoundToEvaluate = rewardPool.nextRoundToEvaluate;
        QuestionRewardPoolEscrowQualificationLib.requireNoPendingFinishedRound(
            votingEngine, rewardPool.contentId, nextRoundToEvaluate, rewardPool.bountyClosesAt
        );
    }

    function _previewRoundAllocation(RewardPool storage rewardPool) internal view returns (uint256 allocation) {
        if (rewardPool.qualifiedRounds >= rewardPool.requiredSettledRounds) return 0;
        uint256 remainingRounds = uint256(rewardPool.requiredSettledRounds) - rewardPool.qualifiedRounds;
        allocation = remainingRounds == 1
            ? rewardPool.unallocatedAmount
            : rewardPool.fundedAmount / rewardPool.requiredSettledRounds;
        if (allocation > rewardPool.unallocatedAmount) return 0;
    }

    function _timelyRevealedCommitFrontend(uint256 contentId, uint256 roundId, bytes32 commitKey, uint64 closesAt)
        internal
        view
        returns (bool revealed, address frontend)
    {
        return QuestionRewardPoolEscrowVoterLib.timelyRevealedCommitFrontend(
            votingEngine, contentId, roundId, commitKey, closesAt
        );
    }

    function _effectiveQuestionClaimWeight(
        RewardPool storage rewardPool,
        uint256 rewardPoolId,
        uint256 roundId,
        bytes32 identityKey,
        bytes32 commitKey,
        address rewardRecipient,
        uint256 baseClaimWeight,
        IClusterPayoutOracle.PayoutWeight memory payoutWeight,
        bytes32[] memory proof,
        bool hasCorrelationProof
    ) internal view returns (uint256) {
        if (!_usesClusterPayoutSnapshot(rewardPool)) return baseClaimWeight;

        require(hasCorrelationProof, "Cluster proof required");
        require(
            payoutWeight.domain == PAYOUT_DOMAIN_QUESTION_REWARD && payoutWeight.rewardPoolId == rewardPoolId
                && payoutWeight.contentId == rewardPool.contentId && payoutWeight.roundId == roundId
                && payoutWeight.commitKey == commitKey && payoutWeight.identityKey == identityKey
                && payoutWeight.account == rewardRecipient && payoutWeight.baseWeight == baseClaimWeight
                && payoutWeight.effectiveWeight > 0,
            "Invalid cluster proof"
        );
        require(
            IClusterPayoutOracle(_clusterPayoutOracleAddress()).verifyPayoutWeight(payoutWeight, proof),
            "Invalid cluster proof"
        );
        return payoutWeight.effectiveWeight;
    }

    function _finalizedQuestionPayoutSnapshot(uint256 rewardPoolId, uint256 contentId, uint256 roundId)
        internal
        view
        returns (IClusterPayoutOracle.RoundPayoutSnapshot memory payoutSnapshot)
    {
        payoutSnapshot = IClusterPayoutOracle(_clusterPayoutOracleAddress())
            .getRoundPayoutSnapshot(PAYOUT_DOMAIN_QUESTION_REWARD, rewardPoolId, contentId, roundId);
        require(payoutSnapshot.status == IClusterPayoutOracle.SnapshotStatus.Finalized, "Cluster snapshot pending");
    }

    function _usesClusterPayoutSnapshot(RewardPool storage rewardPool) internal view returns (bool) {
        return rewardPool.asset == REWARD_ASSET_USDC && _clusterPayoutOracleAddress() != address(0);
    }

    function _clusterPayoutOracleAddress() internal view returns (address) {
        return votingEngine.protocolConfig().clusterPayoutOracle();
    }

    function _roundClaimWeight(uint256 contentId, uint256 roundId, bytes32 commitKey) internal view returns (uint256) {
        if (!votingEngine.roundRbtsScored(contentId, roundId)) {
            return BPS_SCALE;
        }
        return votingEngine.commitRbtsRewardWeight(contentId, roundId, commitKey);
    }

    function _isExcludedClaimant(RewardPool storage rewardPool, bytes32 identityKey, address account)
        internal
        view
        returns (bool)
    {
        return QuestionRewardPoolEscrowQualificationLib.isExcludedRater(
            identityKey,
            account,
            rewardPool.funder,
            rewardPoolPayerIdentity[rewardPool.id],
            rewardPoolPayerIdentityKey[rewardPool.id],
            rewardPool.submitterIdentity,
            rewardPool.submitterIdentityKey
        );
    }

    function _isQuestionBountyEligible(RewardPool storage rewardPool, address account) internal view returns (bool) {
        return QuestionRewardPoolEscrowEligibilityLib.isAccountEligibleForBounty(
            votingEngine.protocolConfig(), rewardPool.bountyEligibility, account
        );
    }

    function _resolveQuestionRewardClaim(RewardPool storage rewardPool, uint256 roundId, address account)
        internal
        view
        returns (bytes32 identityKey, bytes32 commitKey, address rewardRecipient)
    {
        return _resolveRoundRewardClaim(rewardPool.contentId, roundId, account);
    }

    function _resolveRoundRewardClaim(uint256 contentId, uint256 roundId, address account)
        internal
        view
        returns (bytes32 identityKey, bytes32 commitKey, address rewardRecipient)
    {
        return QuestionRewardPoolEscrowVoterLib.resolveRoundRewardClaim(
            votingEngine, votingEngine.protocolConfig(), contentId, roundId, account
        );
    }

    uint256[50] private __gap;
}
