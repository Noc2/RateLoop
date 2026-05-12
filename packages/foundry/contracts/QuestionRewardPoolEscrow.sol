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
import {IVoterIdNFT} from "./interfaces/IVoterIdNFT.sol";
import {RoundLib} from "./libraries/RoundLib.sol";
import {QuestionRewardPoolEscrowBundleLib} from "./libraries/QuestionRewardPoolEscrowBundleLib.sol";
import {QuestionRewardPoolEscrowClaimLib} from "./libraries/QuestionRewardPoolEscrowClaimLib.sol";
import {QuestionRewardPoolEscrowQualificationLib} from "./libraries/QuestionRewardPoolEscrowQualificationLib.sol";
import {QuestionRewardPoolEscrowTransferLib} from "./libraries/QuestionRewardPoolEscrowTransferLib.sol";
import {
    RewardPool,
    RoundSnapshot,
    BundleReward,
    BundleQuestion,
    BundleRoundSetSnapshot
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

    uint256 internal constant MIN_REQUIRED_VOTERS = 3;
    uint256 internal constant MIN_REQUIRED_SETTLED_ROUNDS = 1;
    uint256 internal constant MAX_REQUIRED_SETTLED_ROUNDS = 16;
    uint256 internal constant MAX_REWARD_POOL_ROUND_VOTERS = 200;
    uint256 internal constant MIN_REWARD_POOL_PARTICIPANTS = 3;
    uint256 internal constant HIGH_VALUE_REWARD_POOL_THRESHOLD = 1_000e6;
    uint256 internal constant MIN_HIGH_VALUE_PARTICIPANTS = 5;
    uint256 internal constant BPS_SCALE = 10_000;
    uint256 internal constant DEFAULT_FRONTEND_FEE_BPS = 300;
    uint256 internal constant MAX_FRONTEND_FEE_BPS = 500;
    /// @notice Grace period voters have after bountyClosesAt to claim on a still-claimable bundle
    ///         before a third party can sweep the remainder back to the funder.
    uint256 internal constant BUNDLE_CLAIM_GRACE = 7 days;
    /// @dev Worst-case settlement delay for a threshold-reached bundle round:
    ///      2 * absolute max epoch/round duration + max reveal grace + claim grace.
    uint256 internal constant BUNDLE_REFUND_GRACE = 98 days;
    uint8 internal constant REWARD_ASSET_HREP = 0;
    uint8 internal constant REWARD_ASSET_USDC = 1;

    error RewardPoolCursorNeedsAdvance();

    IERC20 internal hrepToken;
    IERC20 internal usdcToken;
    ContentRegistry internal registry;
    RoundVotingEngine internal votingEngine;
    IVoterIdNFT internal voterIdNFT;
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
    mapping(uint256 => uint256) private rewardPoolSubmitterNullifier;
    mapping(uint256 => address) private rewardPoolPayerIdentity;
    mapping(uint256 => uint256) private rewardPoolPayerNullifier;
    mapping(uint256 => uint256) private contentBundleId;
    mapping(uint256 => uint256) private contentBundleIndex;
    uint16 public defaultFrontendFeeBps;

    event RewardPoolCreated(
        uint256 indexed rewardPoolId,
        uint256 indexed contentId,
        address indexed funder,
        uint256 funderVoterId,
        uint256 amount,
        uint256 requiredVoters,
        uint256 requiredSettledRounds,
        uint256 startRoundId,
        uint256 bountyOpensAt,
        uint256 bountyClosesAt,
        uint256 feedbackClosesAt,
        uint256 frontendFeeBps,
        uint8 asset,
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
    event RewardPoolCursorAdvanced(
        uint256 indexed rewardPoolId, uint256 indexed contentId, uint256 fromRoundId, uint256 toRoundId, uint256 skipped
    );
    event QuestionRewardClaimed(
        uint256 indexed rewardPoolId,
        uint256 indexed contentId,
        uint256 indexed roundId,
        address claimant,
        uint256 voterId,
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
    event QuestionBundleRewardCreated(
        uint256 indexed bundleId,
        address indexed funder,
        uint256 funderVoterId,
        uint256 amount,
        uint256 requiredCompleters,
        uint256 questionCount,
        uint256 requiredSettledRounds,
        uint256 bountyOpensAt,
        uint256 bountyClosesAt,
        uint256 feedbackClosesAt,
        uint256 frontendFeeBps,
        uint8 asset
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
    /// @dev Removed: QuestionBundleFailed is no longer emitted after the retry-after-
    ///      failed-round refactor, so subscribing to that event is a no-op on current deployments.
    event QuestionBundleRewardClaimed(
        uint256 indexed bundleId,
        uint256 indexed roundSetIndex,
        address indexed claimant,
        uint256 voterId,
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
        address voterIdNFT_
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
        voterIdNFT = IVoterIdNFT(voterIdNFT_);
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
            contentId, amount, requiredVoters, challengedRoundId, reasonHash, bountyClosesAt, feedbackClosesAt, 1
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
            contentId, amount, requiredVoters, previousRoundId, reasonHash, bountyClosesAt, feedbackClosesAt, 2
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
        uint8 bountyKind
    ) private returns (uint256 rewardPoolId) {
        _requireCurrentRegistryEscrow();
        rewardPoolId = _createRewardPool(
            contentId,
            msg.sender,
            address(0),
            REWARD_ASSET_USDC,
            amount,
            requiredVoters,
            MIN_REQUIRED_SETTLED_ROUNDS,
            bountyClosesAt,
            feedbackClosesAt,
            false
        );
        _setRewardPoolPurpose(rewardPoolId, bountyKind, relatedRoundId, reasonHash);
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
        require(msg.sender == address(registry), "Only registry");
        _requireRegistryVotingEngine();
        require(bundleId != 0, "Invalid bundle");
        require(bundleRewards[bundleId].id == 0, "Bundle exists");
        require(contentIds.length > 0, "No questions");
        require(funder != address(0), "Invalid funder");
        require(asset == REWARD_ASSET_HREP || asset == REWARD_ASSET_USDC, "Invalid asset");
        require(requiredCompleters >= MIN_REQUIRED_VOTERS, "Too few voters");
        require(requiredCompleters >= _requiredParticipantFloorForAmount(amount), "High-value floor");
        require(requiredSettledRounds >= MIN_REQUIRED_SETTLED_ROUNDS, "Too few rounds");
        require(requiredSettledRounds <= MAX_REQUIRED_SETTLED_ROUNDS, "Too many rounds");
        require(amount >= requiredCompleters * requiredSettledRounds, "Amount too small");
        _requireBundleFundingCoversMaxCompleters(contentIds, amount, requiredSettledRounds);
        // Bundles must have a strict future bountyClosesAt. Without this, a bountyClosesAt
        // of 0 would silently pass _requireFutureBountyWindow and render the bundle instantly
        // refundable through refundQuestionBundleReward (block.timestamp > 0 + BUNDLE_REFUND_GRACE
        // is trivially true). Today this is shielded by the registry's bountyClosesAt!=0 check,
        // but this escrow is the trust boundary — keep the constraint local.
        require(bountyClosesAt > block.timestamp, "Bad close");
        uint256 normalizedFeedbackClosesAt = _normalizeFeedbackClosesAt(bountyClosesAt, feedbackClosesAt);

        uint256 fundedAmount = _pullExactToken(funder, asset, amount);
        (uint256 funderVoterId, address funderIdentity, uint256 funderNullifier) = _resolveFunderIdentity(funder);

        BundleReward storage bundle = bundleRewards[bundleId];
        bundle.id = bundleId.toUint64();
        bundle.bountyClosesAt = bountyClosesAt.toUint64();
        bundle.feedbackClosesAt = normalizedFeedbackClosesAt.toUint64();
        bundle.funder = funder;
        bundle.funderIdentity = funderIdentity;
        bundle.asset = asset;
        bundle.questionCount = uint32(contentIds.length);
        bundle.requiredCompleters = uint32(requiredCompleters);
        bundle.requiredSettledRounds = uint32(requiredSettledRounds);
        bundle.frontendFeeBps = defaultFrontendFeeBps;
        bundle.funderNullifier = funderNullifier;
        bundle.fundedAmount = fundedAmount;
        bundle.unallocatedAmount = fundedAmount;
        // Registry-initiated submissions carry the mandatory-bounty anti-spam model:
        // unclaimed residue is forfeited to treasury rather than refunded, matching
        // the single-pool path (`createSubmissionRewardPoolFromRegistry`).
        bundle.nonRefundable = true;

        for (uint256 i = 0; i < contentIds.length;) {
            uint256 contentId = contentIds[i];
            require(registry.isContentActive(contentId), "Content not active");
            require(contentBundleId[contentId] == 0, "Bundled");
            contentBundleId[contentId] = bundleId;
            contentBundleIndex[contentId] = i;
            uint256 submitterNullifier =
                QuestionRewardPoolEscrowQualificationLib.resolveSubmitterNullifier(registry, voterIdNFT, contentId);
            bundleQuestions[bundleId].push(
                BundleQuestion({contentId: contentId, submitterNullifier: submitterNullifier})
            );
            unchecked {
                ++i;
            }
        }

        emit QuestionBundleRewardCreated(
            bundleId,
            funder,
            funderVoterId,
            fundedAmount,
            requiredCompleters,
            contentIds.length,
            requiredSettledRounds,
            block.timestamp,
            bountyClosesAt,
            normalizedFeedbackClosesAt,
            defaultFrontendFeeBps,
            asset
        );
        rewardPoolId = bundleId;
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
        bool nonRefundable
    ) internal returns (uint256 rewardPoolId) {
        uint256 fundedAmount = _pullExactToken(funder, asset, amount);

        rewardPoolId = _createRewardPoolFromFundedAmount(
            contentId,
            funder,
            payer,
            asset,
            fundedAmount,
            requiredVoters,
            requiredSettledRounds,
            bountyClosesAt,
            feedbackClosesAt,
            nonRefundable
        );
    }

    function _createRewardPoolFromFundedAmount(
        uint256 contentId,
        address funder,
        address payer,
        uint8 asset,
        uint256 fundedAmount,
        uint256 requiredVoters,
        uint256 requiredSettledRounds,
        uint256 bountyClosesAt,
        uint256 feedbackClosesAt,
        bool nonRefundable
    ) internal returns (uint256 rewardPoolId) {
        uint256 amount = fundedAmount;
        require(amount > 0, "Amount required");
        require(asset == REWARD_ASSET_HREP || asset == REWARD_ASSET_USDC, "Invalid asset");
        require(registry.isContentActive(contentId), "Content not active");
        require(requiredVoters >= MIN_REQUIRED_VOTERS, "Too few voters");
        require(requiredVoters >= _requiredParticipantFloorForAmount(amount), "High-value floor");
        require(requiredSettledRounds >= MIN_REQUIRED_SETTLED_ROUNDS, "Too few rounds");
        require(requiredSettledRounds <= MAX_REQUIRED_SETTLED_ROUNDS, "Too many rounds");
        require(amount >= requiredSettledRounds * requiredVoters, "Amount too small");
        _requireFutureBountyWindow(bountyClosesAt);
        uint256 normalizedFeedbackClosesAt = _normalizeFeedbackClosesAt(bountyClosesAt, feedbackClosesAt);
        RoundLib.RoundConfig memory contentCfg = registry.getContentRoundConfig(contentId);
        require(requiredVoters <= contentCfg.maxVoters, "Voters exceed max");
        require(contentCfg.maxVoters <= MAX_REWARD_POOL_ROUND_VOTERS, "Voters exceed max");
        if (!nonRefundable) {
            require(amount >= requiredSettledRounds * uint256(contentCfg.maxVoters), "Amount too small");
            require(bountyClosesAt > block.timestamp, "Bad close");
        }

        uint256 currentRoundId = votingEngine.currentRoundId(contentId);
        uint256 startRoundId = currentRoundId == 0 ? 1 : currentRoundId + 1;
        (uint256 funderVoterId, address funderIdentity,) = _resolveFunderIdentity(funder);
        // For X402 and other gateway-mediated payments, the actual human payer (submitter)
        // differs from the refund destination (funder/gateway). Resolve the payer's identity
        // for funder-side voter-eligibility exclusion so the payer cannot vote on their own question.
        address effectivePayer = payer == address(0) ? funder : payer;
        (, address payerIdentity, uint256 payerNullifier) = _resolveFunderIdentity(effectivePayer);
        address submitterIdentity = registry.getSubmitterIdentity(contentId);
        uint256 submitterNullifier = registry.contentSubmitterNullifier(contentId);

        rewardPoolId = nextRewardPoolId++;
        rewardPools[rewardPoolId] = RewardPool({
            id: rewardPoolId.toUint64(),
            contentId: contentId.toUint64(),
            startRoundId: startRoundId.toUint64(),
            nextRoundToEvaluate: startRoundId.toUint64(),
            challengedRoundId: 0,
            bountyOpensAt: block.timestamp.toUint64(),
            bountyClosesAt: bountyClosesAt.toUint64(),
            claimDeadline: bountyClosesAt.toUint64(),
            funder: funder,
            funderIdentity: funderIdentity,
            submitterIdentity: submitterIdentity,
            submitterVoterId: 0,
            submitterVoterIdNFT: address(0),
            asset: asset,
            fundedAmount: fundedAmount,
            unallocatedAmount: fundedAmount,
            claimedAmount: 0,
            requiredVoters: uint32(requiredVoters),
            requiredSettledRounds: uint32(requiredSettledRounds),
            qualifiedRounds: 0,
            refunded: false,
            unallocatedRefunded: false,
            frontendFeeBps: defaultFrontendFeeBps,
            bountyKind: 0,
            nonRefundable: nonRefundable,
            reasonHash: bytes32(0)
        });
        rewardPoolSubmitterNullifier[rewardPoolId] = submitterNullifier;
        rewardPoolPayerIdentity[rewardPoolId] = payerIdentity;
        rewardPoolPayerNullifier[rewardPoolId] = payerNullifier;

        emit RewardPoolCreated(
            rewardPoolId,
            contentId,
            funder,
            funderVoterId,
            fundedAmount,
            requiredVoters,
            requiredSettledRounds,
            startRoundId,
            block.timestamp,
            bountyClosesAt,
            normalizedFeedbackClosesAt,
            defaultFrontendFeeBps,
            asset,
            nonRefundable
        );
    }

    function _setRewardPoolPurpose(
        uint256 rewardPoolId,
        uint8 bountyKind,
        uint256 challengedRoundId,
        bytes32 reasonHash
    ) internal {
        require(bountyKind == 1 || bountyKind == 2, "Invalid bounty kind");
        require(challengedRoundId != 0, "Invalid round");

        RewardPool storage rewardPool = _getExistingRewardPool(rewardPoolId);
        rewardPool.bountyKind = bountyKind;
        rewardPool.challengedRoundId = challengedRoundId.toUint64();
        rewardPool.reasonHash = reasonHash;

        emit RewardPoolPurposeSet(rewardPoolId, bountyKind, challengedRoundId, reasonHash);
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
        RewardPool storage rewardPool = _getExistingRewardPool(rewardPoolId);
        require(!rewardPool.refunded, "Bounty refunded");
        require(votingEngine.roundUnrevealedCleanupRemaining(rewardPool.contentId, roundId) == 0, "Cleanup pending");
        _qualifyRoundIfNeeded(rewardPoolId, rewardPool, roundId);

        (uint256 voterId, bytes32 commitKey, address rewardRecipient) =
            _resolveQuestionRewardClaim(rewardPool, roundId, msg.sender);
        require(!_isExcludedClaimant(rewardPool, roundId, voterId, msg.sender), "Excluded voter");
        require(commitKey != bytes32(0), "No commit");
        require(!rewardClaimed[rewardPoolId][roundId][commitKey], "Already claimed");

        (bool revealed, address frontend) =
            _timelyRevealedCommitFrontend(rewardPool.contentId, roundId, commitKey, rewardPool.bountyClosesAt);
        require(revealed, "Vote not revealed");

        RoundSnapshot storage snapshot = roundSnapshots[rewardPoolId][roundId];
        uint256 claimWeight = _roundClaimWeight(rewardPool.contentId, roundId, commitKey);
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
            voterId,
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
        _recordBundleQuestionTerminal(contentId, roundId, settled);
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
        // Existing bundles keep using this escrow's snapshotted engine after registry rotation.
        (RoundLib.RoundState state, uint48 settledAt,) = _roundTerminalState(contentId, roundId);
        require(settledAt != 0, "Round not terminal");
        _recordBundleQuestionTerminal(contentId, roundId, state == RoundLib.RoundState.Settled);
        uint256 bundleId = contentBundleId[contentId];
        if (bundleId == 0) return;
        BundleReward storage bundle = bundleRewards[bundleId];
        if (bundle.refunded) return;
        _qualifyPendingBundleRoundSet(bundleId, bundle);
    }

    function _qualifyPendingBundleRoundSet(uint256 bundleId, BundleReward storage bundle) internal {
        uint256 roundSetIndex = bundle.completedRoundSets;
        if (roundSetIndex >= bundle.requiredSettledRounds) return;
        if (bundleRoundSetSnapshots[bundleId][roundSetIndex].qualified) return;
        if (!_isBundleRoundSetComplete(bundleId, roundSetIndex)) return;
        _qualifyBundleRoundSet(bundleId, bundle, roundSetIndex);
    }

    function _recordBundleQuestionTerminal(uint256 contentId, uint256 roundId, bool settled) internal {
        uint256 bundleId = contentBundleId[contentId];
        if (bundleId == 0) return;

        BundleReward storage bundle = _getExistingBundleReward(bundleId);
        if (bundle.refunded) return;

        uint256 bundleIndex = contentBundleIndex[contentId];
        uint256 roundSetIndex = bundleQuestionRecordedRounds[bundleId][bundleIndex];
        if (roundSetIndex >= bundle.requiredSettledRounds) return;
        if (roundSetIndex < bundle.completedRoundSets) return;
        if (roundId <= bundleRoundIds[bundleId][bundleIndex][roundSetIndex]) return;
        if (roundSetIndex != 0) {
            unchecked {
                if (roundId <= bundleRoundIds[bundleId][bundleIndex][roundSetIndex - 1]) return;
            }
        }

        if (!settled || !_bundleRoundSettledWithinWindow(bundle, contentId, roundId)) return;

        bundleRoundIds[bundleId][bundleIndex][roundSetIndex] = uint64(roundId);
        bundleQuestionRecordedRounds[bundleId][bundleIndex] = uint32(roundSetIndex + 1);
        emit QuestionBundleRoundRecorded(bundleId, contentId, roundId, bundleIndex, roundSetIndex);

        // Qualification is intentionally NOT triggered here. With large bundles + high
        // per-content `maxVoters`, `_qualifyBundleRoundSet` is O(maxVoters * bundleSize)
        // and can exceed the settlement-block gas budget. Anyone can call
        // `syncBundleQuestionTerminal(contentId, roundId)` once the round set is complete
        // to evaluate eligibility and either qualify the snapshot or reset it for retry.
        // Indexers can detect round-set completion by counting QuestionBundleRoundRecorded
        // events for a given (bundleId, roundSetIndex) and matching against bundleQuestions.length.
    }

    function claimQuestionBundleReward(uint256 bundleId, uint256 roundSetIndex)
        external
        nonReentrant
        returns (uint256 rewardAmount)
    {
        BundleReward storage bundle = _getExistingBundleReward(bundleId);
        require(_isBundleRoundSetClaimOpen(bundle, bundleId, roundSetIndex), "Bundle not claimable");

        require(!_isBundleExcludedVoter(bundle, bundleId, roundSetIndex, msg.sender), "Excluded voter");

        (address frontend, bytes32 firstCommitKey) =
            _requireCompletedBundleRoundSet(bundleId, roundSetIndex, msg.sender);
        BundleQuestion storage firstQuestion = bundleQuestions[bundleId][0];
        uint256 firstRoundId = bundleRoundIds[bundleId][0][roundSetIndex];
        (uint256 voterId, bytes32 resolvedFirstCommitKey, address rewardRecipient) =
            _resolveRoundRewardClaim(firstQuestion.contentId, firstRoundId, msg.sender);
        require(resolvedFirstCommitKey == firstCommitKey, "Bundle incomplete");
        require(!bundleRoundSetRewardClaimed[bundleId][roundSetIndex][firstCommitKey], "Already claimed");
        BundleRoundSetSnapshot storage snapshot = bundleRoundSetSnapshots[bundleId][roundSetIndex];
        uint256 grossAmount;
        uint256 reservedFrontendFee;
        address frontendRecipient;
        (grossAmount, rewardAmount, reservedFrontendFee, frontendRecipient) =
            QuestionRewardPoolEscrowClaimLib.computeEqualShareClaimSplit(
                votingEngine,
                firstQuestion.contentId,
                firstRoundId,
                firstCommitKey,
                frontend,
                snapshot.allocation,
                snapshot.frontendFeeAllocation,
                snapshot.eligibleCompleters,
                snapshot.claimedCount
            );
        require(grossAmount > 0, "No reward");

        bundleRoundSetRewardClaimed[bundleId][roundSetIndex][firstCommitKey] = true;
        unchecked {
            snapshot.claimedCount++;
            bundle.claimedCount++;
        }
        bundle.claimedAmount += grossAmount;

        (rewardAmount, reservedFrontendFee, frontendRecipient) = _settleClaimPayout(
            _rewardToken(bundle.asset), rewardRecipient, rewardAmount, frontendRecipient, reservedFrontendFee
        );

        emit QuestionBundleRewardClaimed(
            bundleId,
            roundSetIndex,
            rewardRecipient,
            voterId,
            rewardAmount,
            frontend,
            frontendRecipient,
            reservedFrontendFee,
            grossAmount
        );
    }

    function claimableQuestionBundleReward(uint256 bundleId, uint256 roundSetIndex, address account)
        external
        view
        returns (uint256 claimableAmount)
    {
        BundleReward storage bundle = bundleRewards[bundleId];
        if (bundle.id == 0 || !_isBundleRoundSetClaimOpen(bundle, bundleId, roundSetIndex)) return 0;

        if (_isBundleExcludedVoter(bundle, bundleId, roundSetIndex, account)) {
            return 0;
        }
        (bool completed, address frontend, bytes32 firstCommitKey) =
            _completedBundleRoundSetCommit(bundleId, roundSetIndex, account);
        if (!completed) return 0;
        if (bundleRoundSetRewardClaimed[bundleId][roundSetIndex][firstCommitKey]) return 0;

        BundleQuestion storage firstQuestion = bundleQuestions[bundleId][0];
        uint256 firstRoundId = bundleRoundIds[bundleId][0][roundSetIndex];
        BundleRoundSetSnapshot storage snapshot = bundleRoundSetSnapshots[bundleId][roundSetIndex];
        (, claimableAmount,,) = QuestionRewardPoolEscrowClaimLib.computeEqualShareClaimSplit(
            votingEngine,
            firstQuestion.contentId,
            firstRoundId,
            firstCommitKey,
            frontend,
            snapshot.allocation,
            snapshot.frontendFeeAllocation,
            snapshot.eligibleCompleters,
            snapshot.claimedCount
        );
    }

    function refundQuestionBundleReward(uint256 bundleId) external nonReentrant returns (uint256 refundAmount) {
        BundleReward storage bundle = _getExistingBundleReward(bundleId);
        require(!bundle.refunded, "Already refunded");
        require(block.timestamp > bundle.bountyClosesAt, "Bundle active");
        require(block.timestamp > uint256(bundle.bountyClosesAt) + BUNDLE_REFUND_GRACE, "Grace");
        _qualifyPendingBundleRoundSet(bundleId, bundle);
        if (bundle.completedRoundSets != 0) {
            _requireBundleCleanupComplete(bundleId, bundle.completedRoundSets);
            if (bundle.bountyOpensAt == 0) {
                bundle.bountyOpensAt = (block.timestamp + BUNDLE_CLAIM_GRACE).toUint64();
                return 0;
            }
            require(block.timestamp > bundle.bountyOpensAt, "Grace");
        }
        refundAmount = bundle.fundedAmount - bundle.claimedAmount;
        require(refundAmount > 0, "No refund");

        bundle.refunded = true;
        if (bundle.nonRefundable) {
            address treasury = _protocolTreasury();
            QuestionRewardPoolEscrowTransferLib.transferResidue(
                _rewardToken(bundle.asset), true, bundle.funder, treasury, refundAmount
            );
            emit QuestionBundleRewardForfeited(bundleId, treasury, refundAmount);
        } else {
            QuestionRewardPoolEscrowTransferLib.transferResidue(
                _rewardToken(bundle.asset), false, bundle.funder, address(0), refundAmount
            );
            emit QuestionBundleRewardRefunded(bundleId, bundle.funder, refundAmount);
        }
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
        return QuestionRewardPoolEscrowClaimLib.claimableQuestionReward(
            rewardPools,
            roundSnapshots,
            rewardClaimed,
            rewardPoolPayerIdentity,
            rewardPoolPayerNullifier,
            rewardPoolSubmitterNullifier,
            votingEngine,
            voterIdNFT,
            rewardPoolId,
            roundId,
            account,
            BPS_SCALE
        );
    }

    function getRoundSnapshot(uint256 rewardPoolId, uint256 roundId) external view returns (RoundSnapshot memory) {
        return roundSnapshots[rewardPoolId][roundId];
    }

    function pause() external onlyRole(PAUSER_ROLE) {
        _pause();
    }

    function unpause() external onlyRole(PAUSER_ROLE) {
        _unpause();
    }

    function _resolveFunderIdentity(address funder)
        internal
        view
        returns (uint256 funderVoterId, address funderIdentity, uint256 funderNullifier)
    {
        if (address(voterIdNFT) == address(0)) {
            return (0, funder, 0);
        }
        funderVoterId = voterIdNFT.getTokenId(funder);
        if (funderVoterId == 0) {
            return (0, funder, 0);
        }

        funderIdentity = voterIdNFT.getHolder(funderVoterId);
        if (funderIdentity == address(0)) {
            funderIdentity = funder;
        }
        funderNullifier = voterIdNFT.getNullifier(funderVoterId);
    }

    function _pullExactToken(address funder, uint8 asset, uint256 amount) internal returns (uint256 receivedAmount) {
        receivedAmount = QuestionRewardPoolEscrowTransferLib.pullExactToken(_rewardToken(asset), funder, amount);
    }

    function _requiredParticipantFloorForAmount(uint256 amount) internal pure returns (uint256) {
        return amount >= HIGH_VALUE_REWARD_POOL_THRESHOLD ? MIN_HIGH_VALUE_PARTICIPANTS : MIN_REWARD_POOL_PARTICIPANTS;
    }

    function _requireFutureBountyWindow(uint256 bountyClosesAt) internal view {
        if (bountyClosesAt != 0) {
            require(bountyClosesAt > block.timestamp, "Bad close");
        }
    }

    function _normalizeFeedbackClosesAt(uint256 bountyClosesAt, uint256 feedbackClosesAt)
        internal
        view
        returns (uint256)
    {
        if (feedbackClosesAt == 0) {
            return bountyClosesAt;
        }
        require(feedbackClosesAt > block.timestamp, "Bad feedback close");
        if (bountyClosesAt != 0) {
            require(feedbackClosesAt <= bountyClosesAt, "Late feedback");
        }
        return feedbackClosesAt;
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

    function _isBundleRoundSetClaimOpen(BundleReward storage bundle, uint256 bundleId, uint256 roundSetIndex)
        internal
        view
        returns (bool)
    {
        return QuestionRewardPoolEscrowBundleLib.isRoundSetClaimOpen(
            bundleRoundSetSnapshots, bundle, bundleId, roundSetIndex
        );
    }

    function _requireBundleCleanupComplete(uint256 bundleId, uint256 completedRoundSets) internal view {
        QuestionRewardPoolEscrowBundleLib.requireCleanupComplete(
            bundleQuestions, bundleRoundIds, votingEngine, bundleId, completedRoundSets
        );
    }

    function _bundleRoundSettledWithinWindow(BundleReward storage, uint256 contentId, uint256 roundId)
        internal
        view
        returns (bool)
    {
        (RoundLib.RoundState state, uint48 settledAt,) = _roundTerminalState(contentId, roundId);
        return state == RoundLib.RoundState.Settled && settledAt != 0;
    }

    function _roundTerminalState(uint256 contentId, uint256 roundId)
        internal
        view
        returns (RoundLib.RoundState state, uint48 settledAt, uint48 thresholdReachedAt)
    {
        (, state,,,,,,,,, settledAt, thresholdReachedAt,,) = votingEngine.rounds(contentId, roundId);
    }

    function _requireCompletedBundleRoundSet(uint256 bundleId, uint256 roundSetIndex, address account)
        internal
        view
        returns (address frontend, bytes32 firstCommitKey)
    {
        (bool completed, address completedFrontend, bytes32 completedFirstCommitKey) =
            _completedBundleRoundSetCommit(bundleId, roundSetIndex, account);
        require(completed, "Bundle incomplete");
        return (completedFrontend, completedFirstCommitKey);
    }

    function _completedBundleRoundSetCommit(uint256 bundleId, uint256 roundSetIndex, address account)
        internal
        view
        returns (bool completed, address frontend, bytes32 firstCommitKey)
    {
        return _bundleRoundSetCommitStatus(bundleId, roundSetIndex, account, true, true);
    }

    function _bundleRoundSetCommitStatus(
        uint256 bundleId,
        uint256 roundSetIndex,
        address account,
        bool requireCleanupComplete,
        bool trackFrontend
    ) internal view returns (bool completed, address frontend, bytes32 firstCommitKey) {
        return QuestionRewardPoolEscrowBundleLib.bundleRoundSetCommitStatus(
            bundleQuestions,
            bundleRoundIds,
            votingEngine,
            voterIdNFT,
            bundleRewards[bundleId].bountyClosesAt,
            bundleId,
            roundSetIndex,
            account,
            requireCleanupComplete,
            trackFrontend
        );
    }

    function _isBundleRoundSetComplete(uint256 bundleId, uint256 roundSetIndex) internal view returns (bool) {
        return QuestionRewardPoolEscrowBundleLib.isRoundSetComplete(
            bundleQuestions, bundleQuestionRecordedRounds, bundleId, roundSetIndex
        );
    }

    function _qualifyBundleRoundSet(uint256 bundleId, BundleReward storage bundle, uint256 roundSetIndex) internal {
        if (bundleRoundSetSnapshots[bundleId][roundSetIndex].qualified) return;

        uint256 completerCount = _bundleRoundSetCompleterCount(bundleId, bundle, roundSetIndex);
        if (completerCount < bundle.requiredCompleters) {
            _resetBundleRoundSet(bundleId, roundSetIndex);
            return;
        }

        uint256 allocation = _previewBundleRoundSetAllocation(bundle);
        if (allocation == 0 || allocation < completerCount) {
            _resetBundleRoundSet(bundleId, roundSetIndex);
            return;
        }
        uint256 frontendFeeAllocation = (allocation * bundle.frontendFeeBps) / BPS_SCALE;

        unchecked {
            bundle.completedRoundSets++;
        }
        if (bundle.bountyOpensAt != 0) bundle.bountyOpensAt = 0;
        bundle.unallocatedAmount -= allocation;

        bundleRoundSetSnapshots[bundleId][roundSetIndex] = BundleRoundSetSnapshot({
            qualified: true,
            claimedCount: 0,
            eligibleCompleters: uint32(completerCount),
            allocation: allocation,
            frontendFeeAllocation: frontendFeeAllocation
        });
        emit QuestionBundleRoundSetQualified(bundleId, roundSetIndex, allocation, frontendFeeAllocation);
    }

    function _requireBundleFundingCoversMaxCompleters(
        uint256[] calldata contentIds,
        uint256 amount,
        uint256 requiredSettledRounds
    ) internal view {
        QuestionRewardPoolEscrowBundleLib.requireFundingCoversMaxCompleters(
            registry, contentIds, amount, requiredSettledRounds
        );
    }

    function _bundleRoundSetCompleterCount(uint256 bundleId, BundleReward storage bundle, uint256 roundSetIndex)
        internal
        view
        returns (uint256 completerCount)
    {
        BundleQuestion[] storage questions = bundleQuestions[bundleId];
        if (questions.length == 0) return 0;

        uint256 firstContentId = questions[0].contentId;
        uint256 firstRoundId = bundleRoundIds[bundleId][0][roundSetIndex];
        (,, uint16 commitCount,,,,,,,,,,,) = votingEngine.rounds(firstContentId, firstRoundId);
        for (uint256 i = 0; i < commitCount;) {
            bytes32 commitKey = votingEngine.getRoundCommitKey(firstContentId, firstRoundId, i);
            address voter = _bundleCompleterAccount(firstContentId, firstRoundId, commitKey);
            if (
                voter != address(0) && !_isBundleExcludedVoter(bundle, bundleId, roundSetIndex, voter)
                    && _completedBundleRoundSetCommitIgnoringCleanup(bundleId, roundSetIndex, voter)
            ) {
                unchecked {
                    completerCount++;
                }
            }
            unchecked {
                ++i;
            }
        }
    }

    function _completedBundleRoundSetCommitIgnoringCleanup(uint256 bundleId, uint256 roundSetIndex, address account)
        internal
        view
        returns (bool completed)
    {
        (completed,,) = _bundleRoundSetCommitStatus(bundleId, roundSetIndex, account, false, false);
    }

    function _bundleCompleterAccount(uint256 contentId, uint256 roundId, bytes32 commitKey)
        internal
        view
        returns (address voter)
    {
        return QuestionRewardPoolEscrowVoterLib.bundleCompleterAccount(
            votingEngine, voterIdNFT, contentId, roundId, commitKey
        );
    }

    function _resetBundleRoundSet(uint256 bundleId, uint256 roundSetIndex) internal {
        QuestionRewardPoolEscrowBundleLib.resetRoundSet(
            bundleQuestions, bundleQuestionRecordedRounds, bundleRoundIds, bundleId, roundSetIndex
        );
    }

    function _previewBundleRoundSetAllocation(BundleReward storage bundle) internal view returns (uint256 allocation) {
        return QuestionRewardPoolEscrowBundleLib.previewRoundSetAllocation(bundle);
    }

    function _isBundleExcludedVoter(
        BundleReward storage bundle,
        uint256 bundleId,
        uint256 roundSetIndex,
        address account
    ) internal view returns (bool) {
        return QuestionRewardPoolEscrowBundleLib.isBundleExcludedVoter(
            bundleQuestions,
            bundleRoundIds,
            registry,
            votingEngine,
            voterIdNFT,
            bundle,
            bundleId,
            roundSetIndex,
            account
        );
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
        (
            uint256 allocation,
            uint256 effectiveParticipantUnits,
            uint256 frontendFeeAllocation,
            uint256 rawEligibleVoters,
            uint256 totalClaimWeight
        ) = QuestionRewardPoolEscrowQualificationLib.qualifyRound(
            roundSnapshots,
            rewardPoolPayerIdentity,
            rewardPoolPayerNullifier,
            rewardPoolSubmitterNullifier,
            votingEngine,
            voterIdNFT,
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
        (
            roundSettled, canQualify, rawEligibleVoters, effectiveParticipantUnits, totalClaimWeight,,,, settledAt
        ) =
            QuestionRewardPoolEscrowQualificationLib.previewRoundQualification(
                QuestionRewardPoolEscrowQualificationLib.QualificationContext({
                    votingEngine: votingEngine,
                    voterIdNft: _roundVoterIdNft(rewardPool.contentId, roundId),
                    contentId: rewardPool.contentId,
                    roundId: roundId,
                    bountyClosesAt: rewardPool.bountyClosesAt,
                    requiredVoters: rewardPool.requiredVoters,
                    funder: rewardPool.funder,
                    // Use payer identity for exclusion checks so gateway-mediated payments
                    // (e.g. X402) correctly exclude the actual human payer, not the gateway contract.
                    funderIdentity: rewardPoolPayerIdentity[rewardPool.id],
                    funderNullifier: rewardPoolPayerNullifier[rewardPool.id],
                    submitterIdentity: rewardPool.submitterIdentity,
                    submitterNullifier: rewardPoolSubmitterNullifier[rewardPool.id]
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

    function _isExcludedVoter(RewardPool storage rewardPool, uint256 roundId, uint256 voterId)
        internal
        view
        returns (bool)
    {
        return QuestionRewardPoolEscrowQualificationLib.isExcludedVoter(
            _roundVoterIdNft(rewardPool.contentId, roundId),
            voterId,
            rewardPool.funder,
            // Use payer identity for exclusion checks so gateway-mediated payments
            // (e.g. X402) correctly exclude the actual human payer, not the gateway contract.
            rewardPoolPayerIdentity[rewardPool.id],
            rewardPoolPayerNullifier[rewardPool.id],
            rewardPool.submitterIdentity,
            rewardPoolSubmitterNullifier[rewardPool.id]
        );
    }

    function _isExcludedClaimant(RewardPool storage rewardPool, uint256 roundId, uint256 voterId, address account)
        internal
        view
        returns (bool)
    {
        if (voterId != 0) return _isExcludedVoter(rewardPool, roundId, voterId);
        return account == rewardPool.funder || account == rewardPoolPayerIdentity[rewardPool.id]
            || account == rewardPool.submitterIdentity;
    }

    function _resolveQuestionRewardClaim(RewardPool storage rewardPool, uint256 roundId, address account)
        internal
        view
        returns (uint256 voterId, bytes32 commitKey, address rewardRecipient)
    {
        return _resolveRoundRewardClaim(rewardPool.contentId, roundId, account);
    }

    function _resolveRoundRewardClaim(uint256 contentId, uint256 roundId, address account)
        internal
        view
        returns (uint256 voterId, bytes32 commitKey, address rewardRecipient)
    {
        return QuestionRewardPoolEscrowVoterLib.resolveRoundRewardClaim(
            votingEngine, voterIdNFT, contentId, roundId, account
        );
    }

    function _roundVoterIdNft(uint256 contentId, uint256 roundId) internal view returns (IVoterIdNFT) {
        return IVoterIdNFT(_roundVoterIdNftAddress(contentId, roundId));
    }

    function _roundVoterIdNftAddress(uint256 contentId, uint256 roundId) internal view returns (address) {
        address snapshot = votingEngine.roundVoterIdNFTSnapshot(contentId, roundId);
        return snapshot == address(0) ? address(voterIdNFT) : snapshot;
    }

    uint256[50] private __gap;
}
