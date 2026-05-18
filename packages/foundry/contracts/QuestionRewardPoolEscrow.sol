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
import { RoundVotingEngine } from "./RoundVotingEngine.sol";
import { ProtocolConfig } from "./ProtocolConfig.sol";
import { IClusterPayoutOracle } from "./interfaces/IClusterPayoutOracle.sol";
import { IRaterIdentityRegistry } from "./interfaces/IRaterIdentityRegistry.sol";
import { IRoundPayoutSnapshotConsumer } from "./interfaces/IRoundPayoutSnapshotConsumer.sol";
import { RoundLib } from "./libraries/RoundLib.sol";
import { QuestionRewardPoolEscrowBundleActionsLib } from "./libraries/QuestionRewardPoolEscrowBundleActionsLib.sol";
import {
    QuestionRewardPoolEscrowClaimLib,
    EqualShareInputs,
    WeightedShareInputs,
    ClaimableQuestionRewardParams
} from "./libraries/QuestionRewardPoolEscrowClaimLib.sol";
import { QuestionRewardPoolEscrowEligibilityLib } from "./libraries/QuestionRewardPoolEscrowEligibilityLib.sol";
import { QuestionRewardPoolEscrowQualificationLib } from "./libraries/QuestionRewardPoolEscrowQualificationLib.sol";
import { QuestionRewardPoolEscrowPoolActionsLib } from "./libraries/QuestionRewardPoolEscrowPoolActionsLib.sol";
import { QuestionRewardPoolEscrowTransferLib } from "./libraries/QuestionRewardPoolEscrowTransferLib.sol";
import {
    RewardPool,
    RoundSnapshot,
    BundleReward,
    BundleQuestion,
    BundleRoundSetSnapshot,
    CreateRewardPoolParams,
    CreateSubmissionBundleParams,
    BOUNTY_ELIGIBILITY_OPEN
} from "./libraries/QuestionRewardPoolEscrowTypes.sol";
import { QuestionRewardPoolEscrowVoterLib } from "./libraries/QuestionRewardPoolEscrowVoterLib.sol";

/// @title QuestionRewardPoolEscrow
/// @notice Holds per-question USDC bounties and pays equal per-round rewards to revealed voters.
/// @dev Curyo 2 keeps LREP coherence penalties in the voting engine. Stablecoin payouts are participation rewards.
contract QuestionRewardPoolEscrow is
    Initializable,
    AccessControlUpgradeable,
    PausableUpgradeable,
    ReentrancyGuardTransient,
    IRoundPayoutSnapshotConsumer
{
    using SafeCast for uint256;
    using SafeERC20 for IERC20;

    bytes32 internal constant CONFIG_ROLE = keccak256("CONFIG_ROLE");
    bytes32 internal constant PAUSER_ROLE = keccak256("PAUSER_ROLE");

    uint256 internal constant MIN_REQUIRED_SETTLED_ROUNDS = 1;
    uint256 internal constant MIN_EFFECTIVE_PARTICIPANT_UNITS = 3;
    uint256 internal constant BPS_SCALE = 10_000;
    uint256 internal constant DEFAULT_FRONTEND_FEE_BPS = 300;
    /// @notice Grace period voters have after bountyClosesAt to claim on a still-claimable bundle
    ///         before a third party can sweep the remainder back to the funder.
    uint256 internal constant BUNDLE_CLAIM_GRACE = 7 days;
    uint8 internal constant REWARD_ASSET_LREP = 0;
    uint8 internal constant REWARD_ASSET_USDC = 1;
    uint8 internal constant PAYOUT_DOMAIN_QUESTION_REWARD = 1;

    error RewardPoolCursorNeedsAdvance();

    IERC20 internal lrepToken;
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
    mapping(uint256 => address) private rewardPoolPayerIdentity;
    mapping(uint256 => bytes32) private rewardPoolPayerIdentityKey;
    mapping(uint256 => uint256) private contentBundleId;
    mapping(uint256 => uint256) private contentBundleIndex;
    uint16 public defaultFrontendFeeBps;
    mapping(uint256 => address) private rewardPoolClusterPayoutOracle;

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
    event RewardPoolClusterPayoutOracleSnapshotted(uint256 indexed rewardPoolId, address indexed clusterPayoutOracle);
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
    event NonAssetTokenRecovered(address indexed token, address indexed to, uint256 amount);
    event RejectedSnapshotRoundRecovered(
        uint256 indexed rewardPoolId, uint256 indexed contentId, uint256 indexed roundId, uint256 allocationReturned
    );
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
        address lrepToken_,
        address usdcToken_,
        address registry_,
        address votingEngine_,
        address raterRegistry_
    ) external initializer {
        require(admin != address(0), "Invalid admin");
        require(lrepToken_ != address(0), "Invalid LREP token");
        require(usdcToken_ != address(0), "Invalid token");
        require(registry_ != address(0), "Invalid registry");
        require(votingEngine_ != address(0), "Invalid engine");

        __AccessControl_init();
        __Pausable_init();

        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(CONFIG_ROLE, admin);
        _grantRole(PAUSER_ROLE, admin);

        lrepToken = IERC20(lrepToken_);
        usdcToken = IERC20(usdcToken_);
        registry = ContentRegistry(registry_);
        votingEngine = RoundVotingEngine(votingEngine_);
        raterRegistry = IRaterIdentityRegistry(raterRegistry_);
        nextRewardPoolId = 1;
        defaultFrontendFeeBps = DEFAULT_FRONTEND_FEE_BPS.toUint16();
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
        CreateRewardPoolParams memory params = CreateRewardPoolParams({
            contentId: contentId,
            funder: msg.sender,
            payer: address(0),
            asset: REWARD_ASSET_USDC,
            amount: amount,
            requiredVoters: requiredVoters,
            requiredSettledRounds: MIN_REQUIRED_SETTLED_ROUNDS,
            bountyClosesAt: bountyClosesAt,
            feedbackClosesAt: feedbackClosesAt,
            bountyEligibility: bountyEligibility,
            nonRefundable: false,
            bountyKind: bountyKind,
            relatedRoundId: relatedRoundId,
            reasonHash: reasonHash
        });
        (rewardPoolId, nextRewardPoolId) = QuestionRewardPoolEscrowPoolActionsLib.createRewardPool(
            rewardPools,
            rewardPoolPayerIdentity,
            rewardPoolPayerIdentityKey,
            registry,
            votingEngine,
            lrepToken,
            usdcToken,
            defaultFrontendFeeBps,
            nextRewardPoolId,
            params
        );
        _snapshotRewardPoolClusterPayoutOracle(rewardPoolId, REWARD_ASSET_USDC);
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

        CreateSubmissionBundleParams memory params = CreateSubmissionBundleParams({
            bundleId: bundleId,
            contentIds: contentIds,
            funder: funder,
            asset: asset,
            amount: amount,
            requiredCompleters: requiredCompleters,
            requiredSettledRounds: requiredSettledRounds,
            bountyClosesAt: bountyClosesAt,
            feedbackClosesAt: feedbackClosesAt,
            bountyEligibility: bountyEligibility
        });

        rewardPoolId = QuestionRewardPoolEscrowBundleActionsLib.createSubmissionBundleFromRegistry(
            bundleRewards,
            bundleQuestions,
            contentBundleId,
            contentBundleIndex,
            registry,
            votingEngine.protocolConfig(),
            lrepToken,
            usdcToken,
            defaultFrontendFeeBps,
            params
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
        CreateRewardPoolParams memory params = CreateRewardPoolParams({
            contentId: contentId,
            funder: funder,
            payer: payer,
            asset: asset,
            amount: amount,
            requiredVoters: requiredVoters,
            requiredSettledRounds: requiredSettledRounds,
            bountyClosesAt: bountyClosesAt,
            feedbackClosesAt: feedbackClosesAt,
            bountyEligibility: bountyEligibility,
            nonRefundable: nonRefundable,
            bountyKind: 0,
            relatedRoundId: 0,
            reasonHash: bytes32(0)
        });
        (rewardPoolId, nextRewardPoolId) = QuestionRewardPoolEscrowPoolActionsLib.createRewardPool(
            rewardPools,
            rewardPoolPayerIdentity,
            rewardPoolPayerIdentityKey,
            registry,
            votingEngine,
            lrepToken,
            usdcToken,
            defaultFrontendFeeBps,
            nextRewardPoolId,
            params
        );
        _snapshotRewardPoolClusterPayoutOracle(rewardPoolId, asset);
    }

    function _snapshotRewardPoolClusterPayoutOracle(uint256 rewardPoolId, uint8 asset) private {
        QuestionRewardPoolEscrowPoolActionsLib.snapshotRewardPoolClusterPayoutOracle(
            rewardPoolClusterPayoutOracle, votingEngine, rewardPoolId, asset
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
        require(!_isExcludedClaimant(rewardPool, identityKey, rewardRecipient), "Excluded voter");
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
        uint256 grossAmount;
        uint256 frontendFee;
        address frontendRecipient;
        uint256 reservedFrontendFee;
        (grossAmount, rewardAmount, frontendFee, frontendRecipient, reservedFrontendFee) =
            _resolveClaimSplit(rewardPool, snapshot, roundId, commitKey, frontend, claimWeight);
        require(grossAmount > 0, "No reward");

        rewardClaimed[rewardPoolId][roundId][commitKey] = true;
        unchecked {
            snapshot.claimedCount++;
        }
        snapshot.claimedWeight += claimWeight;
        snapshot.claimedAmount += grossAmount;
        snapshot.frontendFeeClaimedAmount += reservedFrontendFee;
        rewardPool.claimedAmount += grossAmount;
        // M-Oracle-2-Followup: mark the snapshot as having moved funds. Matches the launch
        // consumer's "first paid wei" semantics so the arbiter veto window outside the 7-day
        // rejection bound stays open until an actual claim has paid.
        if (!snapshot.firstClaimPaid) {
            snapshot.firstClaimPaid = true;
        }

        uint256 redirectedFrontendFee;
        (rewardAmount, frontendFee, frontendRecipient, redirectedFrontendFee) = _settleClaimPayout(
            _rewardToken(rewardPool.asset), rewardRecipient, rewardAmount, frontendRecipient, frontendFee
        );
        if (redirectedFrontendFee > 0) {
            // M-Funds-1: the bucket was credited reservedFrontendFee at line above, but the
            // frontend transfer failed and the amount was redirected to the voter. Decrement
            // the bucket so later claimants' weighted share is computed against the actual
            // remaining frontend balance, not the over-stated reservation.
            snapshot.frontendFeeClaimedAmount -= redirectedFrontendFee;
            // L-Funds-3: also shrink the frontend-fee total so the residue stays with future
            // voters rather than being captured by the last claimant's frontend operator.
            // `frontendFeeAllocation` and `frontendFeeClaimedAmount` decrement in lockstep, so
            // the running "remaining for frontend" is unchanged while the residue carried by
            // the weighted-share formula reduces. Pool solvency is preserved because the
            // redirected amount is already part of the voter payout for this claim.
            snapshot.frontendFeeAllocation -= redirectedFrontendFee;
        }
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
    ) internal returns (uint256, uint256, address, uint256) {
        return QuestionRewardPoolEscrowTransferLib.settleClaimPayout(
            rewardToken, rewardRecipient, rewardAmount, frontendRecipient, frontendFee
        );
    }

    /// @dev Extracted out of `_claimQuestionReward` so the 9/12-arg library calls do not coexist
    ///      with the rest of `_claimQuestionReward`'s ~14 locals on the same stack frame.
    ///      Without this split, `forge coverage --ir-minimum` fails Yul ABI encoding.
    function _resolveClaimSplit(
        RewardPool storage rewardPool,
        RoundSnapshot storage snapshot,
        uint256 roundId,
        bytes32 commitKey,
        address frontend,
        uint256 claimWeight
    )
        private
        view
        returns (
            uint256 grossAmount,
            uint256 rewardAmount,
            uint256 frontendFee,
            address frontendRecipient,
            uint256 reservedFrontendFee
        )
    {
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
                    EqualShareInputs({
                        allocation: snapshot.allocation,
                        frontendFeeAllocation: snapshot.frontendFeeAllocation,
                        eligibleParticipants: snapshot.eligibleVoters,
                        claimedCount: snapshot.claimedCount
                    })
                );
        } else {
            (grossAmount, rewardAmount, frontendFee, frontendRecipient, reservedFrontendFee) =
                QuestionRewardPoolEscrowClaimLib.computeWeightedClaimSplit(
                    votingEngine,
                    rewardPool.contentId,
                    roundId,
                    commitKey,
                    frontend,
                    claimWeight,
                    WeightedShareInputs({
                        allocation: snapshot.allocation,
                        frontendFeeAllocation: snapshot.frontendFeeAllocation,
                        totalClaimWeight: snapshot.totalClaimWeight,
                        claimedWeight: snapshot.claimedWeight,
                        claimedAmount: snapshot.claimedAmount,
                        frontendFeeClaimedAmount: snapshot.frontendFeeClaimedAmount
                    })
                );
        }
    }

    /// @notice Recover an ERC-20 that is NOT one of the protocol's reward assets (LREP/USDC).
    /// @dev Donations of non-asset tokens to the escrow are otherwise permanently stuck. This
    ///      function deliberately refuses to touch the protocol's own reward tokens: their
    ///      balances reflect accumulated per-pool / per-bundle funded/claimed accounting that
    ///      is not summarisable cheaply on-chain, so any "surplus" sweep would risk underfunding
    ///      legitimate pending claims. L-Funds-1.
    function recoverNonAssetToken(IERC20 token, address to, uint256 amount)
        external
        onlyRole(DEFAULT_ADMIN_ROLE)
        nonReentrant
    {
        require(address(token) != address(lrepToken), "Cannot recover protocol asset");
        require(address(token) != address(usdcToken), "Cannot recover protocol asset");
        require(to != address(0), "Invalid recipient");
        token.safeTransfer(to, amount);
        emit NonAssetTokenRecovered(address(token), to, amount);
    }

    /// @notice Recover a round's allocation after the arbiter rejected its cluster snapshot
    ///         post-qualification but before any claim has paid out.
    /// @dev If the arbiter calls `ClusterPayoutOracle.rejectFinalizedRoundPayoutSnapshot` after
    ///      `qualifyRound` has run but before any voter has claimed (the case M-Oracle-2-Followup
    ///      keeps reachable via the `firstClaimPaid` flag), the round's `allocation` is parked in
    ///      `roundSnapshots[...]` while every subsequent claim reverts at the oracle's
    ///      `verifyPayoutWeight` check. This function rolls back the qualification: returns
    ///      `allocation` to `unallocatedAmount`, decrements `qualifiedRounds`, and resets the
    ///      snapshot slot. `nextRoundToEvaluate` intentionally stays advanced so the same
    ///      rejected snapshot cannot be re-qualified. (L-Oracle-1, audit 2026-05-17.)
    function recoverRejectedSnapshotRound(uint256 rewardPoolId, uint256 roundId)
        external
        onlyRole(DEFAULT_ADMIN_ROLE)
        nonReentrant
    {
        RewardPool storage rewardPool = _getExistingRewardPool(rewardPoolId);
        require(_usesClusterPayoutSnapshot(rewardPool), "Not cluster-snapshot pool");

        RoundSnapshot storage snapshot = roundSnapshots[rewardPoolId][roundId];
        require(snapshot.qualified, "Round not qualified");
        require(!_snapshotHasPaidClaim(snapshot), "Claims already paid");

        address oracleAddr = rewardPoolClusterPayoutOracle[rewardPoolId];
        require(oracleAddr != address(0), "Oracle not pinned");
        IClusterPayoutOracle oracle = IClusterPayoutOracle(oracleAddr);
        IClusterPayoutOracle.RoundPayoutSnapshot memory oracleSnapshot =
            oracle.getRoundPayoutSnapshot(PAYOUT_DOMAIN_QUESTION_REWARD, rewardPoolId, rewardPool.contentId, roundId);
        bytes32 snapshotKey =
            oracle.roundPayoutSnapshotKey(PAYOUT_DOMAIN_QUESTION_REWARD, rewardPoolId, rewardPool.contentId, roundId);
        bool cachedRootRejected = oracleSnapshot.status == IClusterPayoutOracle.SnapshotStatus.Rejected
            && oracleSnapshot.weightRoot == snapshot.clusterWeightRoot;
        if (!cachedRootRejected) {
            cachedRootRejected = oracle.rejectedRoundPayoutSnapshotRoots(snapshotKey, snapshot.clusterWeightRoot);
        }
        require(cachedRootRejected, "Snapshot not rejected");

        uint256 allocationToReturn = snapshot.allocation;
        rewardPool.unallocatedAmount += allocationToReturn;
        require(rewardPool.qualifiedRounds > 0, "No qualified rounds");
        unchecked {
            rewardPool.qualifiedRounds -= 1;
        }
        delete roundSnapshots[rewardPoolId][roundId];

        emit RejectedSnapshotRoundRecovered(rewardPoolId, rewardPool.contentId, roundId, allocationToReturn);
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
            lrepToken,
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
            lrepToken,
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
        QuestionRewardPoolEscrowTransferLib.transferRewardPoolResidue(
            _rewardToken(rewardPool.asset),
            votingEngine,
            rewardPoolId,
            rewardPool.funder,
            rewardPool.nonRefundable,
            amount
        );
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
        return QuestionRewardPoolEscrowClaimLib.claimableQuestionRewardWithPayoutWeight(
            rewardPools,
            roundSnapshots,
            rewardClaimed,
            rewardPoolPayerIdentity,
            rewardPoolPayerIdentityKey,
            rewardPoolClusterPayoutOracle,
            votingEngine,
            votingEngine.protocolConfig(),
            payoutWeight,
            proof,
            ClaimableQuestionRewardParams({
                rewardPoolId: rewardPoolId,
                roundId: roundId,
                account: account,
                bpsScale: BPS_SCALE,
                rewardAssetUsdc: REWARD_ASSET_USDC,
                payoutDomain: PAYOUT_DOMAIN_QUESTION_REWARD
            })
        );
    }

    function getRoundSnapshot(uint256 rewardPoolId, uint256 roundId) external view returns (RoundSnapshot memory) {
        return roundSnapshots[rewardPoolId][roundId];
    }

    function isRoundPayoutSnapshotConsumed(uint8 domain, uint256 rewardPoolId, uint256 contentId, uint256 roundId)
        external
        view
        returns (bool)
    {
        if (domain != PAYOUT_DOMAIN_QUESTION_REWARD) return false;
        RewardPool storage rewardPool = rewardPools[rewardPoolId];
        if (rewardPool.id == 0 || rewardPool.contentId != contentId || !_usesClusterPayoutSnapshot(rewardPool)) {
            return false;
        }
        // M-Oracle-2-Followup (audit 2026-05-17): tracks whether any claim against this
        // snapshot has actually moved funds, matching the launch consumer's "first paid wei"
        // semantics. Legacy pre-upgrade snapshots have no appended flag, so existing claim
        // accounting also counts as paid.
        return _snapshotHasPaidClaim(roundSnapshots[rewardPoolId][roundId]);
    }

    function _snapshotHasPaidClaim(RoundSnapshot storage snapshot) private view returns (bool) {
        return snapshot.firstClaimPaid || snapshot.claimedCount != 0 || snapshot.claimedAmount != 0;
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
        return asset == REWARD_ASSET_LREP ? lrepToken : usdcToken;
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
            QuestionRewardPoolEscrowQualificationLib.qualifyRoundWithClusterSnapshot(
                roundSnapshots,
                rewardPoolPayerIdentity,
                rewardPoolPayerIdentityKey,
                rewardPoolClusterPayoutOracle,
                votingEngine,
                rewardPool,
                rewardPoolId,
                roundId,
                PAYOUT_DOMAIN_QUESTION_REWARD
            );
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
            return QuestionRewardPoolEscrowQualificationLib.previewRoundQualificationWithClusterSnapshot(
                rewardPoolPayerIdentity,
                rewardPoolPayerIdentityKey,
                rewardPoolClusterPayoutOracle,
                votingEngine,
                rewardPool,
                roundId,
                PAYOUT_DOMAIN_QUESTION_REWARD
            );
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

    function _roundQualificationStatus(RewardPool storage rewardPool, uint256 roundId)
        internal
        view
        returns (bool roundFinished, bool canQualify, uint256 eligibleVoters)
    {
        (, RoundLib.RoundState state,,,,,,,,,,,,) = votingEngine.rounds(rewardPool.contentId, roundId);
        if (state == RoundLib.RoundState.Open) return (false, false, 0);
        if (state != RoundLib.RoundState.Settled) return (true, false, 0);

        if (_usesClusterPayoutSnapshot(rewardPool)) {
            return QuestionRewardPoolEscrowQualificationLib.clusterRoundQualificationStatus(
                rewardPoolPayerIdentity,
                rewardPoolPayerIdentityKey,
                rewardPoolClusterPayoutOracle,
                votingEngine,
                rewardPool,
                roundId,
                PAYOUT_DOMAIN_QUESTION_REWARD
            );
        }

        uint256 effectiveParticipantUnits;
        (, canQualify,, effectiveParticipantUnits,,) = _previewRoundQualification(rewardPool, roundId);
        if (canQualify) canQualify = _previewRoundAllocation(rewardPool) >= effectiveParticipantUnits;
        return (true, canQualify, effectiveParticipantUnits);
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

    function _roundClaimWeight(uint256 contentId, uint256 roundId, bytes32 commitKey) internal view returns (uint256) {
        if (!votingEngine.roundRbtsScored(contentId, roundId)) {
            return BPS_SCALE;
        }
        return votingEngine.commitRbtsRewardWeight(contentId, roundId, commitKey);
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
        return QuestionRewardPoolEscrowClaimLib.effectiveClusterQuestionClaimWeight(
            rewardPoolClusterPayoutOracle,
            rewardPool,
            rewardPoolId,
            roundId,
            identityKey,
            commitKey,
            rewardRecipient,
            baseClaimWeight,
            payoutWeight,
            proof,
            PAYOUT_DOMAIN_QUESTION_REWARD,
            roundSnapshots[rewardPoolId][roundId].clusterWeightRoot,
            roundSnapshots[rewardPoolId][roundId].totalClaimWeight
        );
    }

    function _usesClusterPayoutSnapshot(RewardPool storage rewardPool) internal view returns (bool) {
        return rewardPool.asset == REWARD_ASSET_USDC && rewardPoolClusterPayoutOracle[rewardPool.id] != address(0);
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

    uint256[51] private __gap;
}
