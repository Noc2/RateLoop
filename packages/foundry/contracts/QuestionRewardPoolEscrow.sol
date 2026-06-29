// SPDX-License-Identifier: MIT
pragma solidity ^0.8.34;

import { Initializable } from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import { AccessControlUpgradeable } from "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import { PausableUpgradeable } from "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import { ReentrancyGuardTransient } from "@openzeppelin/contracts/utils/ReentrancyGuardTransient.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import { ContentRegistry } from "./ContentRegistry.sol";
import { RoundVotingEngine } from "./RoundVotingEngine.sol";
import { ProtocolConfig } from "./ProtocolConfig.sol";
import { IClusterPayoutOracle } from "./interfaces/IClusterPayoutOracle.sol";
import { IRaterIdentityRegistry } from "./interfaces/IRaterIdentityRegistry.sol";
import { IRaterRegistryStatus } from "./interfaces/IRaterRegistryStatus.sol";
import { IRoundPayoutSnapshotConsumer } from "./interfaces/IRoundPayoutSnapshotConsumer.sol";
import { RoundLib } from "./libraries/RoundLib.sol";
import { QuestionRewardPoolEscrowBundleActionsLib } from "./libraries/QuestionRewardPoolEscrowBundleActionsLib.sol";
import { QuestionRewardPoolEscrowBundlePreviewLib } from "./libraries/QuestionRewardPoolEscrowBundlePreviewLib.sol";
import {
    QuestionRewardPoolEscrowClaimLib,
    EqualShareInputs,
    WeightedShareInputs,
    ClaimableQuestionRewardParams
} from "./libraries/QuestionRewardPoolEscrowClaimLib.sol";
import { QuestionRewardPoolEscrowQualificationLib } from "./libraries/QuestionRewardPoolEscrowQualificationLib.sol";
import { QuestionRewardPoolEscrowRecoveryLib } from "./libraries/QuestionRewardPoolEscrowRecoveryLib.sol";
import { QuestionRewardPoolEscrowBundleRecoveryLib } from "./libraries/QuestionRewardPoolEscrowBundleRecoveryLib.sol";
import { QuestionRewardPoolEscrowPoolActionsLib } from "./libraries/QuestionRewardPoolEscrowPoolActionsLib.sol";
import {
    QuestionRewardPoolEscrowSnapshotConsumerLib
} from "./libraries/QuestionRewardPoolEscrowSnapshotConsumerLib.sol";
import { QuestionRewardPoolEscrowTransferLib } from "./libraries/QuestionRewardPoolEscrowTransferLib.sol";
import { QuestionRewardPoolEscrowWindowLib } from "./libraries/QuestionRewardPoolEscrowWindowLib.sol";
import { TokenTransferLib } from "./libraries/TokenTransferLib.sol";
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
/// @dev RateLoop 2 keeps LREP coherence penalties in the voting engine. Stablecoin payouts are USDC bonuses.
contract QuestionRewardPoolEscrow is
    Initializable,
    AccessControlUpgradeable,
    PausableUpgradeable,
    ReentrancyGuardTransient,
    IRoundPayoutSnapshotConsumer
{
    bytes32 internal constant CONFIG_ROLE = keccak256("CONFIG_ROLE");
    bytes32 internal constant PAUSER_ROLE = keccak256("PAUSER_ROLE");

    uint256 internal constant MIN_REQUIRED_SETTLED_ROUNDS = 1;
    uint256 internal constant BPS_SCALE = 10_000;
    uint16 internal constant DEFAULT_FRONTEND_FEE_BPS = 300;
    /// @notice Grace period voters have after bountyClosesAt to claim on a still-claimable bundle
    ///         before a third party can sweep the remainder back to the funder.
    uint256 internal constant BUNDLE_CLAIM_GRACE = 7 days;
    uint8 internal constant REWARD_ASSET_LREP = 0;
    uint8 internal constant REWARD_ASSET_USDC = 1;
    uint8 internal constant PAYOUT_DOMAIN_QUESTION_REWARD = 1;
    uint8 internal constant PAYOUT_DOMAIN_QUESTION_BUNDLE_REWARD = 4;

    error RewardPoolCursorNeedsAdvance();
    error StaleEngine();
    error StaleEscrow();

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
    mapping(uint256 => address) private bundleRewardClusterPayoutOracle;
    mapping(uint256 => uint64) private rewardPoolClusterPayoutOraclePinnedAt;
    mapping(uint256 => uint64) private bundleRewardClusterPayoutOraclePinnedAt;
    mapping(uint256 => mapping(uint256 => uint256)) private bundleQuestionTerminalSyncCursor;
    // FE-1 (audit 2026-05-20-followup): track rounds whose finalized snapshot was rejected and
    // whose allocation was returned via `recoverRejectedSnapshotRound`. Required so any caller
    // can later reopen the round for requalification once the oracle finalizes a NEW snapshot
    // with a different `weightRoot`. Without this, honest voters of the rejected round are
    // permanently locked out because `nextRoundToEvaluate` is advanced past `roundId`.
    mapping(uint256 => mapping(uint256 => bool)) public rejectedRecoveredRound;
    /// @notice Tracks recovered rounds reopened for requalification. The
    ///         qualification path honours this flag to admit `roundId != nextRoundToEvaluate`.
    mapping(uint256 => mapping(uint256 => bool)) public reopenedRecoveredRound;
    /// @notice Tracks current-cursor rounds skipped after their pre-qualification cluster
    ///         snapshot was rejected. These rounds did not move allocation into a snapshot, so
    ///         replacement qualification uses normal allocation math instead of recovery debt.
    mapping(uint256 => mapping(uint256 => bool)) private preQualificationRejectedRound;
    mapping(uint256 => mapping(uint256 => mapping(bytes32 => mapping(bytes32 => bool)))) private
        qualifiedQuestionRewardClaimants;
    mapping(uint256 => mapping(uint256 => mapping(bytes32 => bool))) private qualifiedBundleRoundSetClaimants;
    mapping(uint256 => mapping(uint256 => bool)) private rejectedRecoveredBundleRoundSet;
    mapping(uint256 => mapping(uint256 => bool)) private reopenedRecoveredBundleRoundSet;

    event RewardPoolCreated(
        uint256 indexed rewardPoolId,
        uint256 indexed contentId,
        address indexed funder,
        bytes32 funderIdentityKey,
        address payerIdentity,
        bytes32 payerIdentityKey,
        address submitterIdentity,
        bytes32 submitterIdentityKey,
        uint256 amount,
        uint256 requiredVoters,
        uint256 requiredSettledRounds,
        uint256 startRoundId,
        uint256 bountyStartBy,
        uint256 bountyWindowSeconds,
        uint256 feedbackWindowSeconds,
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
    event RewardPoolWindowActivated(
        uint256 indexed rewardPoolId,
        uint256 indexed contentId,
        uint256 indexed roundId,
        uint256 bountyOpensAt,
        uint256 bountyClosesAt,
        uint256 feedbackClosesAt
    );
    event RewardPoolClusterPayoutOracleRepointed(
        uint256 indexed rewardPoolId, address indexed oldClusterPayoutOracle, address indexed newClusterPayoutOracle
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
    event NonAssetTokenRecovered(address indexed token, address indexed to, uint256 amount);
    event RejectedSnapshotRoundRecovered(
        uint256 indexed rewardPoolId, uint256 indexed contentId, uint256 indexed roundId, uint256 allocationReturned
    );
    event PreQualificationRejectedSnapshotRoundSkipped(
        uint256 indexed rewardPoolId,
        uint256 indexed contentId,
        uint256 indexed roundId,
        bytes32 snapshotDigest,
        bytes32 weightRoot
    );
    /// @notice Emitted by `reopenRecoveredSnapshotRound` when a recovered round can be
    ///         requalified against a NEW finalized oracle snapshot. (FE-1.)
    event RecoveredSnapshotRoundReopened(
        uint256 indexed rewardPoolId, uint256 indexed contentId, uint256 indexed roundId, bytes32 newWeightRoot
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
        uint256 bountyStartBy,
        uint256 bountyWindowSeconds,
        uint256 feedbackWindowSeconds,
        uint256 frontendFeeBps,
        uint8 asset,
        uint8 bountyEligibility,
        bytes32 bountyEligibilityDataHash
    );
    event QuestionBundleEligibilitySet(uint256 indexed bundleId, uint8 indexed bountyEligibility);
    event QuestionBundleWindowActivated(
        uint256 indexed bundleId, uint256 bountyOpensAt, uint256 bountyClosesAt, uint256 feedbackClosesAt
    );
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
    event RejectedSnapshotBundleRoundSetRecovered(
        uint256 indexed bundleId, uint256 indexed roundSetIndex, uint256 allocationReturned
    );
    event RecoveredSnapshotBundleRoundSetReopened(
        uint256 indexed bundleId, uint256 indexed roundSetIndex, bytes32 newWeightRoot
    );
    event QuestionBundleTerminalSkipped(
        uint256 indexed bundleId, uint256 indexed contentId, uint256 indexed roundId, uint8 reasonCode
    );
    event QuestionBundleRoundSetCorrelationSnapshotApplied(
        uint256 indexed bundleId,
        uint256 indexed roundSetIndex,
        uint64 correlationEpochId,
        uint256 rawEligibleCompleters,
        uint256 effectiveParticipantUnits,
        uint256 totalClaimWeight,
        bytes32 weightRoot
    );
    event PreQualificationRejectedSnapshotBundleRoundSetSkipped(
        uint256 indexed bundleId, uint256 indexed roundSetIndex, bytes32 snapshotDigest, bytes32 weightRoot
    );
    event QuestionBundleClusterPayoutOracleSnapshotted(uint256 indexed bundleId, address indexed clusterPayoutOracle);
    event QuestionBundleClusterPayoutOracleRepointed(
        uint256 indexed bundleId, address indexed oldClusterPayoutOracle, address indexed newClusterPayoutOracle
    );
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
        defaultFrontendFeeBps = DEFAULT_FRONTEND_FEE_BPS;
    }

    function questionRewardPoolEscrowConfigShape() external view returns (address, address) {
        assembly ("memory-safe") {
            mstore(0, sload(registry.slot))
            mstore(0x20, sload(votingEngine.slot))
            // aderyn-fp-next-line(yul-return)
            return(0, 0x40)
        }
    }

    /// @dev FE-2 (2026-05-20 follow-up audit): the funder's effective refund-eligibility time is
    ///      `max(bountyClosesAt, lastQualifyingRound.settledAt) + 7 days`, NOT
    ///      `bountyClosesAt + 7 days`. Each round qualification advances the per-pool
    ///      `claimDeadline` forward (never backward) so claimants always get a full 7-day grace
    ///      after the qualifying round settles. Fresh deployments only accept one required
    ///      settled round for new funding, so this claim-grace behavior now applies to that
    ///      single creation-time rewardable round.
    function createSubmissionRewardPoolFromRegistry(
        uint256 contentId,
        address funder,
        address payer,
        uint8 asset,
        uint256 amount,
        uint256 requiredVoters,
        uint256 rewardClosesAt,
        uint256 questionDurationSeconds,
        uint8 bountyEligibility
    ) external nonReentrant whenNotPaused returns (uint256 rewardPoolId) {
        require(msg.sender == address(registry), "Only registry");
        _requireCurrentRegistryEscrow();
        require(funder != address(0), "Invalid funder");
        rewardPoolId = _createRewardPool(
            contentId,
            funder,
            payer,
            asset,
            amount,
            requiredVoters,
            MIN_REQUIRED_SETTLED_ROUNDS,
            rewardClosesAt,
            questionDurationSeconds,
            questionDurationSeconds,
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
        uint256 rewardClosesAt,
        uint256 questionDurationSeconds,
        uint8 bountyEligibility
    ) external nonReentrant whenNotPaused returns (uint256 rewardPoolId) {
        require(msg.sender == address(registry), "Only registry");
        _requireCurrentRegistryEscrow();
        require(funder != address(0), "Invalid funder");

        CreateSubmissionBundleParams memory params = CreateSubmissionBundleParams({
            bundleId: bundleId,
            contentIds: contentIds,
            funder: funder,
            asset: asset,
            amount: amount,
            requiredCompleters: requiredCompleters,
            requiredSettledRounds: MIN_REQUIRED_SETTLED_ROUNDS,
            bountyStartBy: rewardClosesAt,
            bountyWindowSeconds: questionDurationSeconds,
            feedbackWindowSeconds: questionDurationSeconds,
            bountyEligibility: bountyEligibility
        });

        rewardPoolId = QuestionRewardPoolEscrowBundleActionsLib.createSubmissionBundleFromRegistry(
            bundleRewards,
            bundleQuestions,
            contentBundleId,
            contentBundleIndex,
            bundleQuestionTerminalSyncCursor,
            registry,
            votingEngine,
            votingEngine.protocolConfig(),
            lrepToken,
            usdcToken,
            defaultFrontendFeeBps,
            params
        );
        QuestionRewardPoolEscrowBundleActionsLib.snapshotBundleClusterPayoutOracle(
            bundleRewardClusterPayoutOracle,
            bundleRewardClusterPayoutOraclePinnedAt,
            votingEngine,
            rewardPoolId,
            PAYOUT_DOMAIN_QUESTION_BUNDLE_REWARD,
            address(this)
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
        uint256 bountyStartBy,
        uint256 bountyWindowSeconds,
        uint256 feedbackWindowSeconds,
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
            bountyStartBy: bountyStartBy,
            bountyWindowSeconds: bountyWindowSeconds,
            feedbackWindowSeconds: feedbackWindowSeconds,
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
            rewardPoolClusterPayoutOracle,
            rewardPoolClusterPayoutOraclePinnedAt,
            votingEngine,
            rewardPoolId,
            asset,
            address(this)
        );
    }

    function repointRewardPoolClusterPayoutOracle(uint256 rewardPoolId, address newOracle)
        external
        onlyRole(DEFAULT_ADMIN_ROLE)
    {
        QuestionRewardPoolEscrowSnapshotConsumerLib.repoint(
            rewardPools,
            rewardPoolClusterPayoutOracle,
            rewardPoolClusterPayoutOraclePinnedAt,
            PAYOUT_DOMAIN_QUESTION_REWARD,
            address(this),
            rewardPoolId,
            newOracle
        );
    }

    function repointQuestionBundleClusterPayoutOracle(uint256 bundleId, address newOracle)
        external
        onlyRole(DEFAULT_ADMIN_ROLE)
    {
        QuestionRewardPoolEscrowSnapshotConsumerLib.repointBundle(
            bundleRewards,
            bundleRewardClusterPayoutOracle,
            bundleRewardClusterPayoutOraclePinnedAt,
            PAYOUT_DOMAIN_QUESTION_BUNDLE_REWARD,
            address(this),
            bundleId,
            newOracle
        );
    }

    function qualifyRound(uint256 rewardPoolId, uint256 roundId) external nonReentrant {
        RewardPool storage rewardPool = _getExistingRewardPool(rewardPoolId);
        bool reopened = reopenedRecoveredRound[rewardPoolId][roundId];
        _requireQualifiableRewardPool(rewardPool, reopened);
        _qualifyRound(rewardPoolId, rewardPool, roundId);
    }

    function advanceQualificationCursor(uint256 rewardPoolId, uint256 maxRounds)
        external
        nonReentrant
        returns (uint256 skipped, uint256 nextRoundToEvaluate)
    {
        RewardPool storage rewardPool = _getIncompleteRewardPoolForQualification(rewardPoolId);
        return QuestionRewardPoolEscrowQualificationLib.advanceQualificationCursor(
            rewardPoolPayerIdentity,
            rewardPoolPayerIdentityKey,
            rewardPoolClusterPayoutOracle,
            rewardPoolClusterPayoutOraclePinnedAt,
            votingEngine,
            rewardPool,
            QuestionRewardPoolEscrowQualificationLib.AdvanceCursorParams({
                maxRounds: maxRounds, payoutDomain: PAYOUT_DOMAIN_QUESTION_REWARD
            })
        );
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
        (,, uint256 cleanupRemaining,) = votingEngine.roundLifecycleState(rewardPool.contentId, roundId);
        require(cleanupRemaining == 0, "Cleanup pending");
        _qualifyRoundIfNeeded(rewardPoolId, rewardPool, roundId);

        (bytes32 identityKey, bytes32 commitKey, address rewardRecipient) =
            _resolveQuestionRewardClaim(rewardPool, roundId, msg.sender);
        require(commitKey != bytes32(0), "No commit");
        require(!_isIdentityBannedForRound(rewardPool.contentId, roundId, identityKey), "Identity banned");
        require(!_isCommitVoterBannedForRound(rewardPool.contentId, roundId, commitKey), "Identity banned");
        require(!_isExcludedClaimant(rewardPool, identityKey, rewardRecipient), "Excluded voter");
        require(_wasQuestionBountyEligibleAtQualification(rewardPoolId, roundId, commitKey), "Not bounty eligible");
        require(!rewardClaimed[rewardPoolId][roundId][commitKey], "Already claimed");

        (bool revealed, address frontend) = _timelyRevealedCommitFrontend(
            rewardPool.contentId, roundId, commitKey, rewardPool.bountyOpensAt, rewardPool.bountyClosesAt
        );
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
            rewardPool.asset == REWARD_ASSET_LREP ? lrepToken : usdcToken,
            rewardRecipient,
            rewardAmount,
            frontendRecipient,
            frontendFee
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

    function _isIdentityBannedForRound(uint256 contentId, uint256 roundId, bytes32 identityKey)
        internal
        view
        returns (bool)
    {
        if (identityKey == bytes32(0)) return false;
        address snapshot = votingEngine.roundRaterRegistrySnapshot(contentId, roundId);
        if (_isIdentityBannedAt(snapshot, identityKey)) return true;
        address current = ProtocolConfig(votingEngine.protocolConfig()).raterRegistry();
        if (current == snapshot) return false;
        return _isIdentityBannedAt(current, identityKey);
    }

    function _isCommitVoterBannedForRound(uint256 contentId, uint256 roundId, bytes32 commitKey)
        internal
        view
        returns (bool)
    {
        (address voter,,,,,,) = votingEngine.commitCore(contentId, roundId, commitKey);
        (, address holder,,,,) = votingEngine.commitIdentityState(contentId, roundId, commitKey);
        return _isIdentityBannedForRound(contentId, roundId, _addressIdentityKey(voter))
            || _isIdentityBannedForRound(contentId, roundId, _addressIdentityKey(holder));
    }

    function _isIdentityBannedAt(address registryAddress, bytes32 identityKey) private view returns (bool) {
        if (registryAddress == address(0)) return false;
        try IRaterRegistryStatus(registryAddress).isIdentityKeyBanned(identityKey) returns (bool banned) {
            return banned;
        } catch {
            return false;
        }
    }

    function _addressIdentityKey(address account) private pure returns (bytes32) {
        if (account == address(0)) return bytes32(0);
        return keccak256(abi.encodePacked("rateloop.address-identity-v1", account));
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
        QuestionRewardPoolEscrowTransferLib.recoverNonAssetToken(token, lrepToken, usdcToken, to, amount);
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
    function recoverRejectedSnapshotRound(uint256 rewardPoolId, uint256 roundId) external nonReentrant {
        QuestionRewardPoolEscrowRecoveryLib.recoverRejectedSnapshotRound(
            rewardPools,
            roundSnapshots,
            rewardPoolClusterPayoutOracle,
            rejectedRecoveredRound,
            rewardPoolId,
            roundId,
            PAYOUT_DOMAIN_QUESTION_REWARD
        );
    }

    /// @notice Advance past a current cursor round whose cluster payout snapshot was rejected
    ///         before qualification, without mutating allocation or recovered-round accounting.
    /// @dev A corrected snapshot can still qualify this exact round before unallocated funds are
    ///      refunded; the qualification path treats this flag as a cursor bypass only.
    function skipPreQualificationRejectedSnapshotRound(uint256 rewardPoolId, uint256 roundId) external nonReentrant {
        QuestionRewardPoolEscrowRecoveryLib.skipPreQualificationRejectedSnapshotRound(
            rewardPools,
            roundSnapshots,
            rewardPoolPayerIdentity,
            rewardPoolPayerIdentityKey,
            rewardPoolClusterPayoutOracle,
            rewardPoolClusterPayoutOraclePinnedAt,
            preQualificationRejectedRound,
            votingEngine,
            rewardPoolId,
            roundId,
            PAYOUT_DOMAIN_QUESTION_REWARD
        );
    }

    /// @notice Reopen a previously recovered round for requalification once the oracle has a
    ///         NEW finalized snapshot whose `weightRoot` is not on the rejected set.
    /// @dev FE-1 (audit 2026-05-20-followup). Without this entrypoint, honest voters of a
    ///      round whose initial snapshot was rejected by the arbiter are permanently locked
    ///      out of this pool's payout because `recoverRejectedSnapshotRound` advances
    ///      `nextRoundToEvaluate` past the recovered round to block replay of the same
    ///      rejected snapshot.
    ///
    ///      Gating:
    ///        * Permissionless; all safety gates are on-chain oracle/pool state checks.
    ///        * The pool MUST be cluster-snapshot-backed (USDC + pinned oracle).
    ///        * The round MUST have been previously recovered (`rejectedRecoveredRound` flag).
    ///        * The oracle MUST hold a finalized snapshot whose `weightRoot` is NOT on the
    ///          per-key rejected set; the oracle's propose path already blocks re-proposing
    ///          a rejected root, so this is defence-in-depth.
    ///        * The pool must still be incomplete (not refunded, not fully qualified).
    function reopenRecoveredSnapshotRound(uint256 rewardPoolId, uint256 roundId) external nonReentrant {
        QuestionRewardPoolEscrowRecoveryLib.reopenRecoveredSnapshotRound(
            rewardPools,
            roundSnapshots,
            rewardPoolClusterPayoutOracle,
            rewardPoolClusterPayoutOraclePinnedAt,
            rejectedRecoveredRound,
            reopenedRecoveredRound,
            rewardPoolId,
            roundId,
            PAYOUT_DOMAIN_QUESTION_REWARD
        );
    }

    function recoverOrReopenSnapshotBundleRoundSet(uint256 bundleId, uint256 roundSetIndex) external nonReentrant {
        QuestionRewardPoolEscrowBundleRecoveryLib.recoverOrReopenSnapshotRoundSet(
            bundleRewards,
            bundleQuestions,
            bundleRoundIds,
            bundleRoundSetSnapshots,
            bundleRewardClusterPayoutOracle,
            bundleRewardClusterPayoutOraclePinnedAt,
            rejectedRecoveredBundleRoundSet,
            reopenedRecoveredBundleRoundSet,
            qualifiedBundleRoundSetClaimants,
            votingEngine,
            bundleId,
            roundSetIndex,
            PAYOUT_DOMAIN_QUESTION_BUNDLE_REWARD
        );
        _qualifyRecoveredSnapshotBundleRoundSetIfNeeded(bundleId, roundSetIndex);
    }

    function skipPreQualificationRejectedSnapshotBundleRoundSet(uint256 bundleId, uint256 roundSetIndex)
        external
        nonReentrant
    {
        QuestionRewardPoolEscrowBundleRecoveryLib.skipPreQualificationRejectedSnapshotRoundSet(
            bundleRewards,
            bundleQuestions,
            bundleQuestionRecordedRounds,
            bundleRoundIds,
            bundleRoundSetSnapshots,
            bundleRewardClusterPayoutOracle,
            bundleRewardClusterPayoutOraclePinnedAt,
            bundleQuestionTerminalSyncCursor,
            votingEngine,
            bundleId,
            roundSetIndex,
            PAYOUT_DOMAIN_QUESTION_BUNDLE_REWARD
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
            bundleQuestionTerminalSyncCursor,
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
            bundleRewardClusterPayoutOracle,
            bundleRewardClusterPayoutOraclePinnedAt,
            bundleQuestionTerminalSyncCursor,
            qualifiedBundleRoundSetClaimants,
            contentBundleId,
            contentBundleIndex,
            registry,
            votingEngine,
            votingEngine.protocolConfig(),
            PAYOUT_DOMAIN_QUESTION_BUNDLE_REWARD,
            contentId,
            roundId
        );
    }

    function syncQuestionBundleTerminals(uint256 bundleId, uint256 maxRounds)
        external
        returns (uint256 processedRounds, bool complete)
    {
        return QuestionRewardPoolEscrowBundleActionsLib.syncQuestionBundleTerminals(
            bundleRewards,
            bundleQuestions,
            bundleQuestionRecordedRounds,
            bundleRoundIds,
            bundleRoundSetSnapshots,
            bundleRewardClusterPayoutOracle,
            bundleRewardClusterPayoutOraclePinnedAt,
            bundleQuestionTerminalSyncCursor,
            qualifiedBundleRoundSetClaimants,
            contentBundleId,
            contentBundleIndex,
            registry,
            votingEngine,
            votingEngine.protocolConfig(),
            PAYOUT_DOMAIN_QUESTION_BUNDLE_REWARD,
            bundleId,
            maxRounds
        );
    }

    function claimQuestionBundleReward(uint256 bundleId, uint256 roundSetIndex)
        external
        nonReentrant
        returns (uint256 rewardAmount)
    {
        bytes32[] memory proof;
        IClusterPayoutOracle.PayoutWeight memory payoutWeight;
        return _claimQuestionBundleReward(bundleId, roundSetIndex, payoutWeight, proof, false);
    }

    function claimQuestionBundleReward(
        uint256 bundleId,
        uint256 roundSetIndex,
        IClusterPayoutOracle.PayoutWeight calldata payoutWeight,
        bytes32[] calldata proof
    ) external nonReentrant returns (uint256 rewardAmount) {
        return _claimQuestionBundleReward(bundleId, roundSetIndex, payoutWeight, proof, true);
    }

    function _claimQuestionBundleReward(
        uint256 bundleId,
        uint256 roundSetIndex,
        IClusterPayoutOracle.PayoutWeight memory payoutWeight,
        bytes32[] memory proof,
        bool hasCorrelationProof
    ) internal returns (uint256 rewardAmount) {
        _qualifyRecoveredSnapshotBundleRoundSetIfNeeded(bundleId, roundSetIndex);
        return QuestionRewardPoolEscrowBundleActionsLib.claimQuestionBundleReward(
            bundleRewards,
            bundleQuestions,
            bundleQuestionRecordedRounds,
            bundleRoundIds,
            bundleRoundSetSnapshots,
            bundleRewardClusterPayoutOracle,
            bundleRewardClusterPayoutOraclePinnedAt,
            bundleQuestionTerminalSyncCursor,
            bundleRoundSetRewardClaimed,
            qualifiedBundleRoundSetClaimants,
            registry,
            votingEngine,
            votingEngine.protocolConfig(),
            lrepToken,
            usdcToken,
            payoutWeight,
            proof,
            PAYOUT_DOMAIN_QUESTION_BUNDLE_REWARD,
            hasCorrelationProof,
            bundleId,
            roundSetIndex
        );
    }

    function _qualifyRecoveredSnapshotBundleRoundSetIfNeeded(uint256 bundleId, uint256 roundSetIndex) private {
        QuestionRewardPoolEscrowBundleRecoveryLib.qualifyRecoveredRoundSetIfNeeded(
            bundleRewards,
            bundleQuestions,
            bundleQuestionRecordedRounds,
            bundleRoundIds,
            bundleRoundSetSnapshots,
            bundleRewardClusterPayoutOracle,
            bundleRewardClusterPayoutOraclePinnedAt,
            bundleQuestionTerminalSyncCursor,
            qualifiedBundleRoundSetClaimants,
            rejectedRecoveredBundleRoundSet,
            reopenedRecoveredBundleRoundSet,
            registry,
            votingEngine,
            votingEngine.protocolConfig(),
            PAYOUT_DOMAIN_QUESTION_BUNDLE_REWARD,
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
            bundleRewardClusterPayoutOracle,
            bundleRoundSetRewardClaimed,
            qualifiedBundleRoundSetClaimants,
            registry,
            votingEngine,
            votingEngine.protocolConfig(),
            bundleId,
            roundSetIndex,
            account
        );
    }

    function claimableQuestionBundleRewardWithPayoutWeight(
        uint256 bundleId,
        uint256 roundSetIndex,
        address account,
        IClusterPayoutOracle.PayoutWeight calldata payoutWeight,
        bytes32[] calldata proof
    ) external view returns (uint256 claimableAmount) {
        return QuestionRewardPoolEscrowBundlePreviewLib.claimableQuestionBundleRewardWithPayoutWeight(
            bundleRewards,
            bundleQuestions,
            bundleRoundIds,
            bundleRoundSetSnapshots,
            bundleRewardClusterPayoutOracle,
            bundleRoundSetRewardClaimed,
            qualifiedBundleRoundSetClaimants,
            registry,
            votingEngine,
            votingEngine.protocolConfig(),
            payoutWeight,
            proof,
            PAYOUT_DOMAIN_QUESTION_BUNDLE_REWARD,
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
            bundleRewardClusterPayoutOracle,
            bundleRewardClusterPayoutOraclePinnedAt,
            bundleQuestionTerminalSyncCursor,
            qualifiedBundleRoundSetClaimants,
            contentBundleId,
            contentBundleIndex,
            QuestionRewardPoolEscrowBundleActionsLib.BundleRefundParams({
                registry: registry,
                votingEngine: votingEngine,
                lrepToken: lrepToken,
                usdcToken: usdcToken,
                payoutDomain: PAYOUT_DOMAIN_QUESTION_BUNDLE_REWARD,
                bundleId: bundleId
            })
        );
    }

    function refundExpiredRewardPool(uint256 rewardPoolId) external nonReentrant returns (uint256 refundAmount) {
        return QuestionRewardPoolEscrowPoolActionsLib.refundExpiredRewardPool(
            rewardPools, votingEngine, lrepToken, usdcToken, rewardPoolId, BUNDLE_CLAIM_GRACE
        );
    }

    function refundInactiveRewardPool(uint256 rewardPoolId) external nonReentrant returns (uint256 refundAmount) {
        return QuestionRewardPoolEscrowPoolActionsLib.refundInactiveRewardPool(
            rewardPools, registry, votingEngine, lrepToken, usdcToken, rewardPoolId
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
            qualifiedQuestionRewardClaimants,
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
            qualifiedQuestionRewardClaimants,
            rewardPoolPayerIdentity,
            rewardPoolPayerIdentityKey,
            rewardPoolClusterPayoutOracle,
            rewardPoolClusterPayoutOraclePinnedAt,
            votingEngine,
            votingEngine.protocolConfig(),
            payoutWeight,
            proof,
            ClaimableQuestionRewardParams({
                rewardPoolId: rewardPoolId,
                roundId: roundId,
                account: account,
                bpsScale: BPS_SCALE,
                payoutDomain: PAYOUT_DOMAIN_QUESTION_REWARD,
                bypassQualificationCursor: reopenedRecoveredRound[rewardPoolId][roundId]
                    || preQualificationRejectedRound[rewardPoolId][roundId],
                useRecoveredAllocation: reopenedRecoveredRound[rewardPoolId][roundId]
            })
        );
    }

    function getRoundSnapshot(uint256 rewardPoolId, uint256 roundId) external view returns (RoundSnapshot memory) {
        return roundSnapshots[rewardPoolId][roundId];
    }

    function supportsRoundPayoutSnapshotDomain(uint8 domain) external pure returns (bool) {
        assembly ("memory-safe") {
            mstore(0, or(eq(domain, 1), eq(domain, 4)))
            // aderyn-fp-next-line(yul-return)
            return(0, 0x20)
        }
    }

    function isRoundPayoutSnapshotConsumed(uint8 domain, uint256 rewardPoolId, uint256 contentId, uint256 roundId)
        external
        view
        returns (bool)
    {
        return QuestionRewardPoolEscrowSnapshotConsumerLib.isConsumed(
            rewardPools,
            roundSnapshots,
            bundleRewards,
            bundleRoundSetSnapshots,
            rewardPoolClusterPayoutOracle,
            bundleRewardClusterPayoutOracle,
            PAYOUT_DOMAIN_QUESTION_REWARD,
            PAYOUT_DOMAIN_QUESTION_BUNDLE_REWARD,
            domain,
            rewardPoolId,
            contentId,
            roundId
        );
    }

    /// @notice M-Oracle-1: report the timestamp at which a payout snapshot is acceptable for the
    ///         given (rewardPoolId, contentId, roundId). Returns 0 when the round is not yet
    ///         settled, the reward pool does not exist or has been refunded, or the domain /
    ///         rewardPool / content do not match. The oracle uses this to reject slot-squat
    ///         proposals that would otherwise censor honest payouts during the challenge window.
    function roundPayoutSnapshotSourceReadyAt(uint8 domain, uint256 rewardPoolId, uint256 contentId, uint256 roundId)
        external
        view
        returns (uint64)
    {
        return QuestionRewardPoolEscrowSnapshotConsumerLib.sourceReadyAt(
            rewardPools,
            bundleRewards,
            bundleQuestions,
            bundleQuestionRecordedRounds,
            bundleRoundIds,
            rewardPoolClusterPayoutOracle,
            bundleRewardClusterPayoutOracle,
            votingEngine,
            PAYOUT_DOMAIN_QUESTION_REWARD,
            PAYOUT_DOMAIN_QUESTION_BUNDLE_REWARD,
            domain,
            rewardPoolId,
            contentId,
            roundId
        );
    }

    function getRewardPoolEligibility(uint256 rewardPoolId)
        external
        view
        returns (uint8 bountyEligibility, bytes32 bountyEligibilityDataHash)
    {
        RewardPool storage rewardPool = _getExistingRewardPool(rewardPoolId);
        return (rewardPool.bountyEligibility, rewardPool.bountyEligibilityDataHash);
    }

    /// @notice Returns the unix timestamp at which the funder of `rewardPoolId` becomes eligible
    ///         to call `refundExpiredRewardPool` for the COMPLETE-pool refund path. The funder
    ///         must wait until `claimDeadline + 7 days`. Returns 0 if the pool is already fully
    ///         refunded or does not exist.
    /// @dev FE-2 (2026-05-20 follow-up audit): off-chain helper. `claimDeadline` advances as
    ///      late rounds qualify, so this value is only meaningful in tandem with
    ///      `qualifiedRounds == requiredSettledRounds` (i.e., the pool is complete). Until then,
    ///      future qualifications can push the deadline further out.
    function rewardPoolRefundEligibleAt(uint256 rewardPoolId) external view returns (uint64) {
        RewardPool storage rewardPool = rewardPools[rewardPoolId];
        if (rewardPool.id == 0 || rewardPool.refunded || rewardPool.claimDeadline == 0) return 0;
        uint256 eligibleAt = uint256(rewardPool.claimDeadline) + BUNDLE_CLAIM_GRACE;
        uint64 refundEligibleAt;
        assembly ("memory-safe") {
            if gt(eligibleAt, 0xffffffffffffffff) { revert(0, 0) }
            refundEligibleAt := eligibleAt
        }
        return refundEligibleAt;
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

    function _requireRegistryVotingEngine() internal view {
        if (registry.votingEngine() != address(votingEngine)) revert StaleEngine();
    }

    function _requireCurrentRegistryEscrow() internal view {
        _requireRegistryVotingEngine();
        if (registry.questionRewardPoolEscrow() != address(this)) revert StaleEscrow();
    }

    function _getExistingRewardPool(uint256 rewardPoolId) internal view returns (RewardPool storage rewardPool) {
        rewardPool = rewardPools[rewardPoolId];
        if (rewardPool.id == 0) revert();
    }

    function _getExistingBundleReward(uint256 bundleId) internal view returns (BundleReward storage bundle) {
        bundle = bundleRewards[bundleId];
        if (bundle.id == 0) revert();
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
            bool reopened = reopenedRecoveredRound[rewardPoolId][roundId];
            _requireQualifiableRewardPool(rewardPool, reopened);
            _qualifyRound(rewardPoolId, rewardPool, roundId);
        }
    }

    function _requireIncompleteRewardPool(RewardPool storage rewardPool) internal view {
        require(!rewardPool.refunded, "Bounty refunded");
        require(!rewardPool.unallocatedRefunded, "Bounty refunded");
        require(rewardPool.qualifiedRounds < rewardPool.requiredSettledRounds, "Bounty complete");
    }

    function _requireQualifiableRewardPool(RewardPool storage rewardPool, bool reopened) internal view {
        require(!rewardPool.refunded, "Bounty refunded");
        if (!reopened) {
            require(!rewardPool.unallocatedRefunded, "Bounty refunded");
        }
        require(rewardPool.qualifiedRounds < rewardPool.requiredSettledRounds, "Bounty complete");
    }

    function _qualifyRound(uint256 rewardPoolId, RewardPool storage rewardPool, uint256 roundId) internal {
        // FE-1 / 2026-06 follow-up: cluster qualification admits either the normal cursor,
        // a recovered-and-reopened round, or a pre-qualification rejected round that was
        // explicitly skipped. Only recovered rounds use parked allocation.
        bool reopened = reopenedRecoveredRound[rewardPoolId][roundId];
        bool preQualificationSkipped = preQualificationRejectedRound[rewardPoolId][roundId];
        uint256 recoveredAllocation;
        if (reopened) {
            recoveredAllocation = roundSnapshots[rewardPoolId][roundId].allocation;
        } else {
            _requireNoPendingRecoveredRounds(rewardPool);
        }
        if (_usesClusterPayoutSnapshot(rewardPool)) {
            QuestionRewardPoolEscrowQualificationLib.qualifyRoundWithClusterSnapshot(
                roundSnapshots,
                qualifiedQuestionRewardClaimants,
                rewardPoolPayerIdentity,
                rewardPoolPayerIdentityKey,
                rewardPoolClusterPayoutOracle,
                rewardPoolClusterPayoutOraclePinnedAt,
                votingEngine,
                rewardPool,
                rewardPoolId,
                roundId,
                PAYOUT_DOMAIN_QUESTION_REWARD,
                reopened || preQualificationSkipped,
                reopened,
                recoveredAllocation
            );
            if (reopened) {
                _finishRecoveredRoundQualification(rewardPool, rewardPoolId, roundId);
            } else if (preQualificationSkipped) {
                _finishPreQualificationRejectedRoundQualification(rewardPoolId, roundId);
            }
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
            qualifiedQuestionRewardClaimants,
            rewardPoolPayerIdentity,
            rewardPoolPayerIdentityKey,
            votingEngine,
            rewardPool,
            rewardPoolId,
            roundId,
            BPS_SCALE
        );
        if (reopened) {
            _finishRecoveredRoundQualification(rewardPool, rewardPoolId, roundId);
        } else if (preQualificationSkipped) {
            _finishPreQualificationRejectedRoundQualification(rewardPoolId, roundId);
        }

        emit RewardPoolRoundQualified(
            rewardPoolId, rewardPool.contentId, roundId, allocation, effectiveParticipantUnits, frontendFeeAllocation
        );
        emit RewardPoolRoundEffectiveUnits(
            rewardPoolId, rewardPool.contentId, roundId, rawEligibleVoters, effectiveParticipantUnits, totalClaimWeight
        );
    }

    function _timelyRevealedCommitFrontend(
        uint256 contentId,
        uint256 roundId,
        bytes32 commitKey,
        uint64 opensAt,
        uint64 closesAt
    ) internal view returns (bool revealed, address frontend) {
        return QuestionRewardPoolEscrowVoterLib.timelyRevealedCommitFrontend(
            votingEngine, contentId, roundId, commitKey, opensAt, closesAt
        );
    }

    function _roundClaimWeight(uint256, uint256, bytes32) internal pure returns (uint256) {
        return BPS_SCALE;
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
            roundSnapshots[rewardPoolId][roundId].clusterSnapshotDigest,
            roundSnapshots[rewardPoolId][roundId].totalClaimWeight
        );
    }

    function _usesClusterPayoutSnapshot(RewardPool storage rewardPool) internal view returns (bool) {
        return rewardPoolClusterPayoutOracle[rewardPool.id] != address(0);
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

    function _wasQuestionBountyEligibleAtQualification(uint256 rewardPoolId, uint256 roundId, bytes32 commitKey)
        internal
        view
        returns (bool)
    {
        RoundSnapshot storage snapshot = roundSnapshots[rewardPoolId][roundId];
        return qualifiedQuestionRewardClaimants[rewardPoolId][roundId][snapshot.clusterSnapshotDigest][commitKey];
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

    function _requireNoPendingRecoveredRounds(RewardPool storage rewardPool) private view {
        require(rewardPool.pendingRecoveredRounds == 0, "Recovered round pending");
    }

    function _consumePendingRecoveredRound(RewardPool storage rewardPool) private {
        require(rewardPool.pendingRecoveredRounds > 0, "Recovered round pending");
        unchecked {
            rewardPool.pendingRecoveredRounds -= 1;
        }
    }

    function _finishRecoveredRoundQualification(RewardPool storage rewardPool, uint256 rewardPoolId, uint256 roundId)
        private
    {
        _consumePendingRecoveredRound(rewardPool);
        reopenedRecoveredRound[rewardPoolId][roundId] = false;
        rejectedRecoveredRound[rewardPoolId][roundId] = false;
    }

    function _finishPreQualificationRejectedRoundQualification(uint256 rewardPoolId, uint256 roundId) private {
        preQualificationRejectedRound[rewardPoolId][roundId] = false;
    }

    uint256[41] private __gap;
}
