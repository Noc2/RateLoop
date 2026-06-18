// SPDX-License-Identifier: MIT
pragma solidity ^0.8.34;

import { Initializable } from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import { AccessControlUpgradeable } from "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import { PausableUpgradeable } from "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import { ReentrancyGuardTransient } from "@openzeppelin/contracts/utils/ReentrancyGuardTransient.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { SafeCast } from "@openzeppelin/contracts/utils/math/SafeCast.sol";
import { ICategoryRegistry } from "./interfaces/ICategoryRegistry.sol";
import { IClusterPayoutOracle } from "./interfaces/IClusterPayoutOracle.sol";
import { IRoundVotingEngine } from "./interfaces/IRoundVotingEngine.sol";
import { IRaterIdentityRegistry } from "./interfaces/IRaterIdentityRegistry.sol";
import { IConfidentialityEscrow } from "./interfaces/IConfidentialityEscrow.sol";
import { RoundLib } from "./libraries/RoundLib.sol";
import { RatingLib } from "./libraries/RatingLib.sol";
import { ContentRegistryDormancyLib } from "./libraries/ContentRegistryDormancyLib.sol";
import { ContentRegistryRewardLib } from "./libraries/ContentRegistryRewardLib.sol";
import { ContentRegistryRatingSnapshotLib } from "./libraries/ContentRegistryRatingSnapshotLib.sol";
import { ContentRegistryTypes } from "./libraries/ContentRegistryTypes.sol";
import { ProtocolConfig } from "./ProtocolConfig.sol";
import { SubmissionMediaValidator } from "./SubmissionMediaValidator.sol";
import { SubmissionMediaValidatorFactory } from "./SubmissionMediaValidatorFactory.sol";

interface IQuestionRewardPoolEscrow {
    function createSubmissionRewardPoolFromRegistry(
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
        uint8 bountyEligibility
    ) external returns (uint256 rewardPoolId);

    function createSubmissionBundleFromRegistry(
        uint256 bundleId,
        uint256[] calldata contentIds,
        address funder,
        uint8 asset,
        uint256 amount,
        uint256 requiredCompleters,
        uint256 requiredSettledRounds,
        uint256 bountyStartBy,
        uint256 bountyWindowSeconds,
        uint256 feedbackWindowSeconds,
        uint8 bountyEligibility
    ) external returns (uint256 rewardPoolId);
}

interface IRoundVotingEngineCoreView {
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
            uint48 settledAt,
            uint8 upWins
        );
}

/// @title ContentRegistry
/// @notice Manages content lifecycle: submission → active → dormant → revived / cancelled.
/// @dev Stores only a metadata hash on-chain; full URL/question details are emitted in events.
contract ContentRegistry is Initializable, AccessControlUpgradeable, PausableUpgradeable, ReentrancyGuardTransient {
    using SafeERC20 for IERC20;
    using SafeCast for uint256;

    error OnlyVotingEngine();
    error ActiveRoundOnPreviousEngine();
    error InvalidState();

    // --- Access Control Roles ---
    bytes32 internal constant CONFIG_ROLE = keccak256("CONFIG_ROLE");
    bytes32 internal constant PAUSER_ROLE = keccak256("PAUSER_ROLE");
    bytes32 internal constant TREASURY_ROLE = keccak256("TREASURY_ROLE");
    bytes32 internal constant TREASURY_ADMIN_ROLE = keccak256("TREASURY_ADMIN_ROLE");
    bytes32 internal constant X402_GATEWAY_ROLE = keccak256("X402_GATEWAY_ROLE");

    // --- Constants ---
    uint256 internal constant REVIVAL_STAKE = 5e6; // 5 LREP (6 decimals)
    uint256 internal constant DORMANCY_PERIOD = 30 days;
    uint256 internal constant SUBMISSION_RESERVATION_PERIOD = 30 minutes;
    uint256 internal constant RESERVED_SUBMISSION_MIN_AGE = 1 seconds;
    uint256 internal constant DORMANT_EXCLUSIVE_REVIVAL_PERIOD = 1 days;
    uint8 internal constant MAX_REVIVALS = 2;
    uint8 internal constant SUBMISSION_REWARD_ASSET_LREP = 0;
    uint8 internal constant SUBMISSION_REWARD_ASSET_USDC = 1;
    uint256 internal constant DEFAULT_MIN_SUBMISSION_REWARD_POOL = 1e6;
    uint256 internal constant SUBMISSION_REWARD_PARTICIPANT_UNIT = 10_000;
    uint256 internal constant MIN_SUBMISSION_REWARD_SETTLED_ROUNDS = 1;
    uint256 internal constant MAX_QUESTION_BUNDLE_COUNT = 10;
    bytes32 internal constant QUESTION_CONTEXT_DOMAIN = keccak256("rateloop-question-context-v5");
    bytes32 internal constant QUESTION_REVEAL_DOMAIN = keccak256("rateloop-question-reveal-v8");
    bytes32 internal constant QUESTION_BUNDLE_ITEM_DOMAIN = keccak256("rateloop-question-bundle-item-v5");
    bytes32 internal constant QUESTION_BUNDLE_DOMAIN = keccak256("rateloop-question-bundle-v5");
    bytes32 internal constant QUESTION_BUNDLE_REVEAL_DOMAIN = keccak256("rateloop-question-bundle-reveal-v6");
    uint8 internal constant CONFIDENTIALITY_FLAG_PRIVATE_FOREVER = 1;

    uint16 internal constant DEFAULT_SLASH_THRESHOLD_BPS = 2500;
    uint16 internal constant DEFAULT_MIN_SLASH_SETTLED_ROUNDS = 2;
    uint48 internal constant DEFAULT_MIN_SLASH_LOW_DURATION = 7 days;
    uint256 internal constant DEFAULT_MIN_SLASH_EVIDENCE = 200e6;
    uint256 internal constant DEFAULT_CONFIDENCE_MASS_INITIAL = 80e6;

    // String length limits (prevent storage bloat)
    uint16 internal constant MAX_QUESTION_BUNDLE_ROUND_VOTERS = 100;

    // --- Structs ---
    struct PendingSubmission {
        address submitter;
        uint48 reservedAt;
        uint48 expiresAt;
        address submitterIdentity;
        bytes32 submitterIdentityKey;
    }

    struct SubmissionMetadata {
        string url;
        string title;
        string tags;
        uint256 categoryId;
    }

    struct SubmissionDetails {
        string detailsUrl;
        bytes32 detailsHash;
    }

    struct SubmissionRewardTerms {
        uint8 asset;
        uint256 amount;
        uint256 requiredVoters;
        uint256 requiredSettledRounds;
        uint256 bountyStartBy;
        uint256 bountyWindowSeconds;
        uint256 feedbackWindowSeconds;
        uint8 bountyEligibility;
    }

    struct QuestionSpecCommitment {
        bytes32 questionMetadataHash;
        bytes32 resultSpecHash;
    }

    struct BundleQuestionInput {
        string contextUrl;
        string[] imageUrls;
        string videoUrl;
        string title;
        string tags;
        uint256 categoryId;
        SubmissionDetails details;
        bytes32 salt;
        QuestionSpecCommitment spec;
    }

    // --- State ---
    IERC20 public lrepToken;
    address public votingEngine;
    ICategoryRegistry internal categoryRegistry;
    address public treasury; // Receives 100% of slashed stakes (governance timelock)
    uint256 public nextContentId;
    uint256 internal nextQuestionBundleId;
    mapping(uint256 => ContentRegistryTypes.Content) public contents;
    mapping(bytes32 => bool) public submissionKeyUsed; // Canonical submission keys prevent duplicate content variants
    /// @notice Escrow that holds mandatory bounties.
    address public questionRewardPoolEscrow;
    uint256 internal votingEngineGeneration;
    mapping(address => uint256) internal votingEngineCallbackGeneration;
    mapping(uint256 => uint256) internal contentSettlementEngineGeneration;

    /// @notice Canonical submission key per content ID (for releasing/reserving uniqueness on status changes)
    mapping(uint256 => bytes32) internal contentSubmissionKey;

    /// @notice Canonical submitter identity snapshot (holder address if submitted through a delegate).
    /// @dev Public to expose the auto-getter as `getSubmitterIdentity(uint256)` and skip the
    ///      explicit external wrapper, keeping ContentRegistry under the EIP-170 size limit.
    mapping(uint256 => address) public getSubmitterIdentity;

    /// @notice Stable rater identity key for the canonical submitter identity.
    mapping(uint256 => bytes32) public contentSubmitterIdentityKey;

    /// @notice Per-question round settings selected at submission and bounded by governance.
    mapping(uint256 => RoundLib.RoundConfig) internal contentRoundConfig;

    mapping(uint256 => uint256) internal contentBundleId;

    /// @notice Meaningful-activity anchor used for dormancy checks.
    /// @dev Vote commits still update `lastActivityAt` for UI/analytics, but only submission, revival,
    ///      and milestone-0 settlement move the dormancy window forward.
    mapping(uint256 => uint256) internal dormancyAnchorAt;

    /// @notice Voting engine whose current round may still need to block dormancy for this content.
    mapping(uint256 => address) internal contentRoundTrackingEngine;
    /// @notice Latest globally allocated voting round id per content, shared across engine rotations.
    mapping(uint256 => uint256) internal latestVotingRoundId;

    /// @notice ProtocolConfig used for governance-tunable rating and slash parameters.
    ProtocolConfig public protocolConfig;

    /// @notice Hidden, time-bounded reservations for future content reveals.
    mapping(bytes32 => PendingSubmission) internal pendingSubmissions;

    /// @notice Timestamp after which a dormant content key may be publicly released for replacement.
    mapping(uint256 => uint256) public dormantKeyReleasableAt;

    /// @notice Rich rating state used by the score-relative rating system.
    mapping(uint256 => RatingLib.RatingState) internal _ratingState;

    /// @notice Settled rounds whose canonical rating impact is waiting for finalized correlation weights.
    mapping(uint256 => mapping(uint256 => ContentRegistryTypes.PendingRatingSettlement)) internal
        pendingRatingSettlement;

    /// @notice Applied rating snapshot digests keyed by content and round. Nonzero means the canonical rating consumed the root.
    mapping(uint256 => mapping(uint256 => bytes32)) internal appliedRatingSnapshotDigest;

    /// @notice Slash policy frozen at content creation so governance cannot retroactively rewrite stake terms.
    mapping(uint256 => RatingLib.SlashConfig) internal contentSlashConfigSnapshot;

    address private immutable _submissionMediaValidatorFactory;
    SubmissionMediaValidator public submissionMediaValidator;
    mapping(uint256 => address) internal questionBundleRoundObserverByContent;

    /// @dev Reserved storage gap for future upgrades
    uint256[37] private __gap;

    // --- Events ---
    event ContentSubmitted(
        uint256 indexed contentId,
        address indexed submitter,
        bytes32 contentHash,
        string url,
        string title,
        string tags,
        uint256 indexed categoryId
    );
    event QuestionContentAnchored(
        uint256 indexed contentId,
        uint8 indexed mediaType,
        uint256 mediaIndex,
        string url,
        bytes32 questionMetadataHash,
        bytes32 resultSpecHash
    );
    event ContentDetailsSubmitted(uint256 indexed contentId, string detailsUrl, bytes32 detailsHash);
    event ContentCancelled(uint256 indexed contentId);
    event SubmissionReserved(address indexed submitter, bytes32 indexed revealCommitment, uint256 expiresAt);
    event SubmissionReservationCancelled(address indexed submitter, bytes32 indexed revealCommitment);
    event SubmissionRewardPoolAttached(
        uint256 indexed contentId,
        address indexed submitter,
        uint8 indexed rewardAsset,
        uint256 amount,
        uint256 requiredVoters,
        uint256 requiredSettledRounds,
        uint256 bountyStartBy,
        uint256 bountyWindowSeconds,
        uint256 feedbackWindowSeconds,
        uint8 bountyEligibility,
        bytes32 bountyEligibilityDataHash,
        uint256 rewardPoolId
    );
    event QuestionBundleSubmitted(
        uint256 indexed bundleId,
        address indexed submitter,
        uint256 questionCount,
        uint8 indexed rewardAsset,
        uint256 amount,
        uint256 requiredCompleters,
        uint256 bountyStartBy,
        uint256 bountyWindowSeconds,
        uint256 feedbackWindowSeconds,
        uint8 bountyEligibility,
        bytes32 bountyEligibilityDataHash,
        bytes32 bundleHash,
        uint256 rewardPoolId
    );
    event QuestionBundleContentLinked(uint256 indexed bundleId, uint256 indexed contentId, uint256 indexed bundleIndex);
    event ContentDormant(uint256 indexed contentId);
    event ContentRevived(uint256 indexed contentId, address indexed reviver);
    event DormantSubmissionKeyReleased(uint256 indexed contentId, bytes32 indexed submissionKey);
    event PendingRatingClusterPayoutOracleRepointed(
        uint256 indexed contentId,
        uint256 indexed roundId,
        address indexed oldClusterPayoutOracle,
        address newClusterPayoutOracle
    );
    event RatingUpdated(uint256 indexed contentId, uint256 oldRating, uint256 newRating);
    event RatingStateUpdated(
        uint256 indexed contentId,
        uint256 indexed roundId,
        uint16 referenceRatingBps,
        uint16 oldRatingBps,
        uint16 newRatingBps,
        uint16 conservativeRatingBps,
        uint256 upEvidence,
        uint256 downEvidence,
        uint256 confidenceMass,
        uint256 effectiveEvidence,
        uint32 settledRounds,
        uint48 lowSince
    );
    event RatingReviewPending(
        uint256 indexed contentId,
        uint256 indexed roundId,
        uint16 referenceRatingBps,
        uint256 rawUpEvidence,
        uint256 rawDownEvidence,
        uint256 readyAt
    );
    event RatingSnapshotApplied(
        uint256 indexed contentId,
        uint256 indexed roundId,
        bytes32 indexed snapshotKey,
        bytes32 snapshotDigest,
        uint256 adjustedUpEvidence,
        uint256 adjustedDownEvidence
    );
    event QuestionRewardPoolEscrowUpdated(address rewardPoolEscrow);
    event ContentRoundConfigSet(
        uint256 indexed contentId, uint32 epochDuration, uint32 maxDuration, uint16 minVoters, uint16 maxVoters
    );

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _submissionMediaValidatorFactory = address(new SubmissionMediaValidatorFactory());
        _disableInitializers();
    }

    function initializeWithTreasury(address _admin, address _governance, address _treasuryAuthority, address _lrepToken)
        public
        initializer
    {
        _initialize(_admin, _governance, _treasuryAuthority, _lrepToken);
    }

    function _initialize(address _admin, address _governance, address _treasuryAuthority, address _lrepToken) private {
        __AccessControl_init();
        __Pausable_init();

        if (
            _admin == address(0) || _governance == address(0) || _treasuryAuthority == address(0)
                || _lrepToken == address(0)
        ) revert InvalidState();
        _initializeSubmissionMediaValidator();

        // Governance gets all permanent roles
        _grantRole(DEFAULT_ADMIN_ROLE, _governance);
        _grantRole(CONFIG_ROLE, _governance);
        _grantRole(PAUSER_ROLE, _governance);
        _setRoleAdmin(TREASURY_ROLE, TREASURY_ADMIN_ROLE);
        _setRoleAdmin(TREASURY_ADMIN_ROLE, DEFAULT_ADMIN_ROLE);
        _setRoleAdmin(X402_GATEWAY_ROLE, CONFIG_ROLE);
        _grantRole(TREASURY_ADMIN_ROLE, _governance);
        _grantRole(TREASURY_ADMIN_ROLE, _treasuryAuthority);
        _grantRole(TREASURY_ROLE, _treasuryAuthority);

        // Admin gets CONFIG_ROLE and PAUSER_ROLE for initial cross-contract wiring;
        // PAUSER_ROLE lets the deploy script bracket the first setVotingEngine call with
        // pause/unpause so first-set and rotation share the same observable surface
        // (L-Identity-5, audit 2026-05-17). Both roles are renounced at the end of Deploy.
        if (_admin != _governance) {
            _grantRole(CONFIG_ROLE, _admin);
            _grantRole(PAUSER_ROLE, _admin);
        }

        lrepToken = IERC20(_lrepToken);
        nextContentId = 1;
        nextQuestionBundleId = 1;
        treasury = _treasuryAuthority;
    }

    function _initializeSubmissionMediaValidator() private {
        address validator;
        address factory = _submissionMediaValidatorFactory;
        assembly ("memory-safe") {
            let ptr := mload(0x40)
            mstore(ptr, shl(224, 0xefc81a8c))
            if iszero(call(gas(), factory, 0, ptr, 4, ptr, 32)) { revert(0, 0) }
            validator := mload(ptr)
        }
        submissionMediaValidator = SubmissionMediaValidator(validator);
    }

    /// @notice Set the VotingEngine address (can only be called by CONFIG_ROLE).
    /// @dev Authorization for the previous engine is NOT cleared by this call so already-tracked
    ///      rounds can finish settlement callbacks, while fresh submissions route through the
    ///      canonical engine.
    function setVotingEngine(address _votingEngine) external onlyRole(CONFIG_ROLE) {
        if (_votingEngine == address(0)) revert InvalidState();
        if (_votingEngine.code.length == 0) revert InvalidState();
        if (votingEngine == _votingEngine) return;
        if (votingEngine != address(0) && !paused()) revert InvalidState();
        address currentProtocolConfig = address(protocolConfig);
        if (currentProtocolConfig != address(0)) _requireEngineProtocolConfig(_votingEngine, currentProtocolConfig);
        uint256 nextGeneration;
        unchecked {
            nextGeneration = votingEngineGeneration + 1;
        }
        votingEngine = _votingEngine;
        votingEngineGeneration = nextGeneration;
        votingEngineCallbackGeneration[_votingEngine] = nextGeneration;
    }

    /// @notice Set the CategoryRegistry address (can only be called by CONFIG_ROLE).
    function setCategoryRegistry(address _categoryRegistry) external onlyRole(CONFIG_ROLE) {
        if (!_probeContractShape(_categoryRegistry, ICategoryRegistry.isCategory.selector, 36)) revert InvalidState();
        categoryRegistry = ICategoryRegistry(_categoryRegistry);
    }

    function setProtocolConfig(address _protocolConfig) external onlyRole(CONFIG_ROLE) {
        address currentProtocolConfig = address(protocolConfig);
        if (currentProtocolConfig != address(0) && _protocolConfig != currentProtocolConfig) revert InvalidState();
        if (!_probeContractShape(_protocolConfig, 0x79502c55, 4)) revert InvalidState();
        protocolConfig = ProtocolConfig(_protocolConfig);
    }

    function _requireEngineProtocolConfig(address engine, address expectedConfig) private view {
        assembly ("memory-safe") {
            let ptr := mload(0x40)
            mstore(ptr, shl(224, 0xf5efbb4f))
            if iszero(staticcall(gas(), engine, ptr, 4, ptr, 32)) {
                mstore(0, shl(224, 0xbaf3f0f7))
                revert(0, 4)
            }
            if iszero(eq(and(mload(ptr), 0xffffffffffffffffffffffffffffffffffffffff), expectedConfig)) {
                mstore(0, shl(224, 0xbaf3f0f7))
                revert(0, 4)
            }
        }
    }

    function _probeContractShape(address target, bytes4 selector, uint256 inputSize) private view returns (bool valid) {
        assembly ("memory-safe") {
            let ptr := mload(0x40)
            mstore(ptr, selector)
            mstore(add(ptr, 0x04), 0)
            valid := staticcall(gas(), target, ptr, inputSize, 0, 0)
            valid := and(valid, gt(returndatasize(), 0))
        }
    }

    function _validQuestionRewardPoolEscrow(address target) private view returns (bool valid) {
        address expectedRegistry = address(this);
        address expectedEngine = votingEngine;
        assembly ("memory-safe") {
            let ptr := mload(0x40)
            mstore(ptr, shl(224, 0xe1b361ac))
            valid := staticcall(gas(), target, ptr, 4, ptr, 0x40)
            valid := and(valid, eq(returndatasize(), 0x40))
            valid := and(valid, eq(and(mload(ptr), 0xffffffffffffffffffffffffffffffffffffffff), expectedRegistry))
            valid := and(
                valid,
                eq(and(mload(add(ptr, 0x20)), 0xffffffffffffffffffffffffffffffffffffffff), expectedEngine)
            )
        }
    }

    /// @notice Set or update the bounty escrow.
    function setQuestionRewardPoolEscrow(address _questionRewardPoolEscrow) external onlyRole(CONFIG_ROLE) {
        if (_questionRewardPoolEscrow == address(0)) revert InvalidState();
        address currentEngine = votingEngine;
        if (currentEngine != address(0)) {
            address currentProtocolConfig = address(protocolConfig);
            if (currentProtocolConfig == address(0)) revert InvalidState();
            _requireEngineProtocolConfig(currentEngine, currentProtocolConfig);
        }
        if (!_validQuestionRewardPoolEscrow(_questionRewardPoolEscrow)) revert InvalidState();
        if (questionRewardPoolEscrow == _questionRewardPoolEscrow) return;
        if (questionRewardPoolEscrow != address(0) && !paused()) revert InvalidState();
        questionRewardPoolEscrow = _questionRewardPoolEscrow;
        emit QuestionRewardPoolEscrowUpdated(_questionRewardPoolEscrow);
    }

    /// @notice Set the treasury address that receives slashed stakes (can only be called by TREASURY_ROLE).
    function setTreasury(address _treasury) external onlyRole(TREASURY_ROLE) {
        if (_treasury == address(0)) revert InvalidState();
        treasury = _treasury;
    }

    // --- Content Lifecycle ---

    /// @notice Compute the internal storage key for a reservation.
    /// @dev Scoping the mapping key by `submitter` prevents a front-runner from copying a
    ///      victim's revealCommitment out of the mempool and squatting the reservation slot.
    ///      Each submitter has their own namespace, so collisions are impossible.
    function _reservationKey(bytes32 revealCommitment, address submitter) internal pure returns (bytes32) {
        return keccak256(abi.encode(revealCommitment, submitter));
    }

    /// @notice Reserve a hidden submission commitment before revealing the public content metadata.
    /// @param revealCommitment Keccak-256 hash of the future submission reveal payload.
    function reserveSubmission(bytes32 revealCommitment) external nonReentrant whenNotPaused {
        require(revealCommitment != bytes32(0));
        bytes32 key = _reservationKey(revealCommitment, msg.sender);
        PendingSubmission storage pending = pendingSubmissions[key];
        require(pending.submitter == address(0));

        // M-Identity-1: snapshot the submitter's identity at reservation time and store both
        // fields verbatim — never zero them out. The pre-fix shortcut zeroed the fields whenever
        // the reserver had a plain address-identity, and `_pendingSubmitterIdentity` then
        // re-resolved at reveal. A reserver could exploit that to accept a delegation or attest
        // a credential between reserve and reveal, attributing the submission to a different
        // identity than they had at reservation.
        (address submitterIdentity, bytes32 submitterIdentityKey) = _snapshotSubmitterIdentity(msg.sender);
        pendingSubmissions[key] = PendingSubmission({
            submitter: msg.sender,
            submitterIdentity: submitterIdentity,
            submitterIdentityKey: submitterIdentityKey,
            reservedAt: block.timestamp.toUint48(),
            expiresAt: (block.timestamp + SUBMISSION_RESERVATION_PERIOD).toUint48()
        });

        emit SubmissionReserved(msg.sender, revealCommitment, block.timestamp + SUBMISSION_RESERVATION_PERIOD);
    }

    function cancelReservedSubmission(bytes32 revealCommitment) external nonReentrant whenNotPaused {
        bytes32 key = _reservationKey(revealCommitment, msg.sender);
        PendingSubmission memory pending = pendingSubmissions[key];
        require(pending.submitter == msg.sender);
        delete pendingSubmissions[key];

        emit SubmissionReservationCancelled(msg.sender, revealCommitment);
    }

    function submitQuestionWithRewardAndRoundConfig(
        string memory contextUrl,
        string[] memory imageUrls,
        string memory videoUrl,
        string memory title,
        string memory tags,
        uint256 categoryId,
        SubmissionDetails memory details,
        bytes32 salt,
        SubmissionRewardTerms memory rewardTerms,
        RoundLib.RoundConfig memory roundConfig,
        QuestionSpecCommitment memory spec
    ) public returns (uint256) {
        return submitQuestionWithRewardAndRoundConfig(
            contextUrl,
            imageUrls,
            videoUrl,
            title,
            tags,
            categoryId,
            details,
            salt,
            rewardTerms,
            roundConfig,
            spec,
            _defaultConfidentialityConfig()
        );
    }

    function submitQuestionWithRewardAndRoundConfig(
        string memory contextUrl,
        string[] memory imageUrls,
        string memory videoUrl,
        string memory title,
        string memory tags,
        uint256 categoryId,
        SubmissionDetails memory details,
        bytes32 salt,
        SubmissionRewardTerms memory rewardTerms,
        RoundLib.RoundConfig memory roundConfig,
        QuestionSpecCommitment memory spec,
        IConfidentialityEscrow.ConfidentialityConfig memory confidentiality
    ) public nonReentrant whenNotPaused returns (uint256) {
        SubmissionMetadata memory metadata = _validatedContextSubmissionMetadata(
            contextUrl, imageUrls, videoUrl, title, tags, categoryId, confidentiality.gated
        );
        return _submitValidatedQuestionWithMedia(
            metadata,
            imageUrls,
            videoUrl,
            details,
            salt,
            rewardTerms,
            _validatedRoundConfig(roundConfig),
            0,
            spec,
            confidentiality,
            _hashConfidentiality(confidentiality)
        );
    }

    function submitQuestionBundleWithRewardAndRoundConfig(
        BundleQuestionInput[] calldata questions,
        SubmissionRewardTerms calldata rewardTerms,
        RoundLib.RoundConfig calldata roundConfig
    ) external nonReentrant whenNotPaused returns (uint256 bundleId, uint256[] memory contentIds) {
        require(questions.length != 0);
        require(questions.length > 1);
        require(questions.length <= MAX_QUESTION_BUNDLE_COUNT);
        require(questionRewardPoolEscrow != address(0));

        RoundLib.RoundConfig memory validatedRoundConfig = _validatedRoundConfig(roundConfig);
        require(validatedRoundConfig.maxVoters <= MAX_QUESTION_BUNDLE_ROUND_VOTERS);
        require(rewardTerms.requiredVoters == validatedRoundConfig.minVoters);
        _validateSubmissionReward(rewardTerms);
        require(rewardTerms.bountyWindowSeconds != 0);

        SubmissionMetadata[] memory metadataList = new SubmissionMetadata[](questions.length);
        bytes32[] memory submissionKeys = new bytes32[](questions.length);
        bytes32[] memory mediaHashes = new bytes32[](questions.length);
        uint256[] memory resolvedCategoryIds = new uint256[](questions.length);

        for (uint256 i = 0; i < questions.length; i++) {
            BundleQuestionInput calldata question = questions[i];
            _validateSubmissionDetails(question.details, false);
            _validateQuestionSpec(question.spec);
            SubmissionMetadata memory metadata = _validatedContextSubmissionMetadata(
                question.contextUrl,
                question.imageUrls,
                question.videoUrl,
                question.title,
                question.tags,
                question.categoryId,
                false
            );
            uint256 resolvedCategoryId = _resolveQuestionSubmissionCategory(metadata);
            bytes32 mediaHash = _submissionMediaHash(question.imageUrls, question.videoUrl);
            bytes32 submissionKey =
                _deriveQuestionMediaSubmissionKey(metadata, mediaHash, question.details, resolvedCategoryId);
            // Eager write in this loop also catches duplicates WITHIN the same bundle --
            // without it, two identical questions in one bundle would both pass the
            // check here and later point at the same submissionKey, so releasing one
            // in Dormant state would brick the sibling forever ("Dormant key released").
            require(!submissionKeyUsed[submissionKey]);
            submissionKeyUsed[submissionKey] = true;
            // A zero salt collapses the reveal commitment's entropy and lets a front-runner
            // pre-reserve the same (metadata, ..., salt=0) tuple. Force non-zero salt per
            // question so every reveal hash carries caller-supplied randomness.
            require(question.salt != bytes32(0));

            metadataList[i] = metadata;
            submissionKeys[i] = submissionKey;
            mediaHashes[i] = mediaHash;
            resolvedCategoryIds[i] = resolvedCategoryId;
        }

        bytes32 bundleHash = _computeQuestionBundleHash(metadataList, mediaHashes, resolvedCategoryIds, questions);
        bytes32 revealCommitment =
            _computeBundleRevealCommitment(bundleHash, msg.sender, rewardTerms, validatedRoundConfig);
        PendingSubmission memory pending = _consumeReservedSubmission(revealCommitment, msg.sender);

        bundleId = nextQuestionBundleId++;
        contentIds = new uint256[](questions.length);
        for (uint256 i = 0; i < questions.length; i++) {
            // submissionKeyUsed is already set in the preparation loop above to catch
            // duplicates within the same bundle.
            bytes32 contentHash = _questionContentHash(
                metadataList[i],
                questions[i].imageUrls,
                questions[i].videoUrl,
                questions[i].details,
                resolvedCategoryIds[i],
                questions[i].spec
            );
            (address submitterIdentity, bytes32 submitterIdentityKey) = _pendingSubmitterIdentity(pending);
            uint256 contentId = _storeSubmittedContent(
                submissionKeys[i],
                pending.submitter,
                submitterIdentity,
                submitterIdentityKey,
                contentHash,
                resolvedCategoryIds[i],
                validatedRoundConfig,
                bundleId
            );
            contentIds[i] = contentId;
            questionBundleRoundObserverByContent[contentId] = questionRewardPoolEscrow;
            emit QuestionBundleContentLinked(bundleId, contentId, i);

            emit ContentSubmitted(
                contentId,
                msg.sender,
                contentHash,
                metadataList[i].url,
                metadataList[i].title,
                metadataList[i].tags,
                resolvedCategoryIds[i]
            );
            _emitContentMediaSubmitted(contentId, questions[i].imageUrls, questions[i].videoUrl, questions[i].spec);
            _emitContentDetailsSubmitted(contentId, questions[i].details);
        }

        uint256 rewardPoolId = IQuestionRewardPoolEscrow(questionRewardPoolEscrow)
            .createSubmissionBundleFromRegistry(
                bundleId,
                contentIds,
                msg.sender,
                rewardTerms.asset,
                rewardTerms.amount,
                rewardTerms.requiredVoters,
                rewardTerms.requiredSettledRounds,
                rewardTerms.bountyStartBy,
                rewardTerms.bountyWindowSeconds,
                rewardTerms.feedbackWindowSeconds,
                rewardTerms.bountyEligibility
            );
        emit QuestionBundleSubmitted(
            bundleId,
            msg.sender,
            questions.length,
            rewardTerms.asset,
            rewardTerms.amount,
            rewardTerms.requiredVoters,
            rewardTerms.bountyStartBy,
            rewardTerms.bountyWindowSeconds,
            rewardTerms.feedbackWindowSeconds,
            rewardTerms.bountyEligibility,
            bytes32(0),
            bundleHash,
            rewardPoolId
        );
    }

    function questionBundleRoundObserver(uint256 contentId) external view returns (address bundleRewardPoolEscrow) {
        bundleRewardPoolEscrow = questionBundleRoundObserverByContent[contentId];
    }

    /// @notice Submit a question with a context link, image evidence, or video evidence.
    /// @dev Attaches the governance minimum LREP bounty and default round configuration.
    function submitQuestion(
        string memory contextUrl,
        string[] memory imageUrls,
        string memory videoUrl,
        string memory title,
        string memory tags,
        uint256 categoryId,
        SubmissionDetails memory details,
        bytes32 salt,
        QuestionSpecCommitment memory spec
    ) public returns (uint256) {
        RoundLib.RoundConfig memory defaultRoundConfig = _defaultRoundConfig();
        SubmissionRewardTerms memory rewardTerms = SubmissionRewardTerms({
            asset: SUBMISSION_REWARD_ASSET_LREP,
            amount: _minimumSubmissionReward(SUBMISSION_REWARD_ASSET_LREP),
            requiredVoters: defaultRoundConfig.minVoters,
            requiredSettledRounds: MIN_SUBMISSION_REWARD_SETTLED_ROUNDS,
            bountyStartBy: 0,
            bountyWindowSeconds: 0,
            feedbackWindowSeconds: 0,
            bountyEligibility: 0
        });
        return submitQuestionWithRewardAndRoundConfig(
            contextUrl,
            imageUrls,
            videoUrl,
            title,
            tags,
            categoryId,
            details,
            salt,
            rewardTerms,
            defaultRoundConfig,
            spec,
            _defaultConfidentialityConfig()
        );
    }

    function submitQuestionFromX402Gateway(
        string memory contextUrl,
        string[] memory imageUrls,
        string memory videoUrl,
        string memory title,
        string memory tags,
        uint256 categoryId,
        SubmissionDetails memory details,
        bytes32 salt,
        SubmissionRewardTerms memory rewardTerms,
        RoundLib.RoundConfig memory roundConfig,
        QuestionSpecCommitment memory spec,
        address submitter,
        IConfidentialityEscrow.ConfidentialityConfig memory confidentiality
    ) public onlyRole(X402_GATEWAY_ROLE) nonReentrant whenNotPaused returns (uint256 contentId) {
        require(submitter != address(0));
        require(rewardTerms.asset == SUBMISSION_REWARD_ASSET_USDC);
        SubmissionMetadata memory metadata = _validatedContextSubmissionMetadata(
            contextUrl, imageUrls, videoUrl, title, tags, categoryId, confidentiality.gated
        );
        RoundLib.RoundConfig memory validatedRoundConfig = _validatedRoundConfig(roundConfig);
        (uint256 resolvedCategoryId, bytes32 submissionKey, PendingSubmission memory pending) = _prepareQuestionMediaSubmission(
            metadata,
            imageUrls,
            videoUrl,
            details,
            salt,
            rewardTerms,
            validatedRoundConfig,
            spec,
            submitter,
            _hashConfidentiality(confidentiality),
            confidentiality.gated
        );
        contentId = _storeQuestionAndAttachReward(
            submissionKey,
            submitter,
            pending.submitterIdentity,
            pending.submitterIdentityKey,
            msg.sender,
            metadata,
            imageUrls,
            videoUrl,
            details,
            resolvedCategoryId,
            rewardTerms,
            validatedRoundConfig,
            0,
            spec,
            confidentiality
        );
    }

    function getContentRoundConfig(uint256 contentId) public view returns (RoundLib.RoundConfig memory cfg) {
        cfg = contentRoundConfig[contentId];
        if (cfg.epochDuration == 0) {
            cfg = _defaultRoundConfig();
        }
    }

    /// @notice Cancel content before any votes. Attached submission bounties stay non-refundable.
    /// @dev Only callable by the submitter. VotingEngine must confirm 0 votes.
    function cancelContent(uint256 contentId) external nonReentrant whenNotPaused {
        ContentRegistryTypes.Content storage c = contents[contentId];
        require(_isSubmitterIdentity(contentId, msg.sender));
        require(c.status == ContentRegistryTypes.ContentStatus.Active);
        require(contentRoundTrackingEngine[contentId] == address(0));
        if (votingEngine != address(0)) {
            require(!IRoundVotingEngine(votingEngine).hasCommits(contentId));
        }
        // Cancelling a bundle member would permanently prevent the bundle escrow from
        // completing all configured round sets. Treat bundles as atomic once submitted.
        require(contentBundleId[contentId] == 0);

        c.status = ContentRegistryTypes.ContentStatus.Cancelled;

        // Release the canonical submission key so the content can be resubmitted.
        bytes32 submissionKey = contentSubmissionKey[contentId];
        if (submissionKey != bytes32(0)) {
            submissionKeyUsed[submissionKey] = false;
        }

        emit ContentCancelled(contentId);
    }

    function _validatedContextSubmissionMetadata(
        string memory contextUrl,
        string[] memory imageUrls,
        string memory videoUrl,
        string memory title,
        string memory tags,
        uint256 categoryId,
        bool gated
    ) internal view returns (SubmissionMetadata memory metadata) {
        submissionMediaValidator.validateContextSubmission(contextUrl, imageUrls, videoUrl, title, tags, gated);
        metadata = SubmissionMetadata({ url: contextUrl, title: title, tags: tags, categoryId: categoryId });
        require(address(categoryRegistry) != address(0));
    }

    function _submitValidatedQuestionWithMedia(
        SubmissionMetadata memory metadata,
        string[] memory imageUrls,
        string memory videoUrl,
        SubmissionDetails memory details,
        bytes32 salt,
        SubmissionRewardTerms memory rewardTerms,
        RoundLib.RoundConfig memory roundConfig,
        uint256 bundleId,
        QuestionSpecCommitment memory spec,
        IConfidentialityEscrow.ConfidentialityConfig memory confidentiality,
        bytes32 confidentialityHash
    ) internal returns (uint256 contentId) {
        (uint256 resolvedCategoryId, bytes32 submissionKey, PendingSubmission memory pending) = _prepareQuestionMediaSubmission(
            metadata,
            imageUrls,
            videoUrl,
            details,
            salt,
            rewardTerms,
            roundConfig,
            spec,
            msg.sender,
            confidentialityHash,
            confidentiality.gated
        );
        contentId = _storeQuestionAndAttachReward(
            submissionKey,
            pending.submitter,
            pending.submitterIdentity,
            pending.submitterIdentityKey,
            msg.sender,
            metadata,
            imageUrls,
            videoUrl,
            details,
            resolvedCategoryId,
            rewardTerms,
            roundConfig,
            bundleId,
            spec,
            confidentiality
        );
    }

    function _prepareQuestionMediaSubmission(
        SubmissionMetadata memory metadata,
        string[] memory imageUrls,
        string memory videoUrl,
        SubmissionDetails memory details,
        bytes32 salt,
        SubmissionRewardTerms memory rewardTerms,
        RoundLib.RoundConfig memory roundConfig,
        QuestionSpecCommitment memory spec,
        address submitter,
        bytes32 confidentialityHash,
        bool gated
    ) internal returns (uint256 resolvedCategoryId, bytes32 submissionKey, PendingSubmission memory pending) {
        _validateQuestionSpec(spec);
        _validateSubmissionDetails(details, gated);
        resolvedCategoryId = _resolveQuestionSubmissionCategory(metadata);
        bytes32 mediaHash = _submissionMediaHash(imageUrls, videoUrl);
        submissionKey = _deriveQuestionMediaSubmissionKey(metadata, mediaHash, details, resolvedCategoryId);
        require(!submissionKeyUsed[submissionKey]);
        // A zero salt collapses the reveal commitment's entropy and lets a front-runner
        // pre-reserve the same (metadata, ..., salt=0) tuple. Force non-zero salt so every
        // reveal hash carries caller-supplied randomness.
        require(salt != bytes32(0));
        _validateSubmissionReward(rewardTerms);
        require(rewardTerms.requiredVoters == roundConfig.minVoters);

        bytes32 revealCommitment = _computeRevealCommitment(
            submissionKey,
            mediaHash,
            metadata.title,
            metadata.tags,
            details,
            metadata.categoryId,
            salt,
            submitter,
            rewardTerms,
            roundConfig,
            spec,
            confidentialityHash
        );
        pending = _consumeReservedSubmission(revealCommitment, submitter);
        submissionKeyUsed[submissionKey] = true;
    }

    function _consumeReservedSubmission(bytes32 revealCommitment, address submitter)
        internal
        returns (PendingSubmission memory pending)
    {
        bytes32 reservationKey = _reservationKey(revealCommitment, submitter);
        pending = pendingSubmissions[reservationKey];
        require(pending.submitter == submitter);
        require(block.timestamp <= pending.expiresAt);
        require(block.timestamp >= pending.reservedAt + RESERVED_SUBMISSION_MIN_AGE);
        (address submitterIdentity, bytes32 submitterIdentityKey) = _pendingSubmitterIdentity(pending);
        _requireSubmitterIdentityNotBanned(pending.submitter, submitterIdentity, submitterIdentityKey);
        _requireReservedSubmitterIdentityCurrent(pending, submitterIdentity, submitterIdentityKey);

        delete pendingSubmissions[reservationKey];
    }

    function _requireReservedSubmitterIdentityCurrent(
        PendingSubmission memory pending,
        address submitterIdentity,
        bytes32 submitterIdentityKey
    ) internal view {
        if (submitterIdentity == pending.submitter) return;
        IRaterIdentityRegistry.ResolvedRater memory resolved = _resolveRater(pending.submitter);
        if (resolved.holder != submitterIdentity || resolved.identityKey != submitterIdentityKey) {
            assembly ("memory-safe") {
                revert(0, 0)
            }
        }
    }

    function _requireSubmitterIdentityNotBanned(
        address submitter,
        address submitterIdentity,
        bytes32 submitterIdentityKey
    ) internal view {
        if (protocolConfig.isSubmitterIdentityBanned(submitter, submitterIdentity, submitterIdentityKey)) {
            assembly ("memory-safe") {
                revert(0, 0)
            }
        }
    }

    function _submissionMediaHash(string[] memory imageUrls, string memory videoUrl) private pure returns (bytes32) {
        return keccak256(abi.encode(imageUrls, videoUrl));
    }

    function _submissionDetailsHash(SubmissionDetails memory details) private pure returns (bytes32) {
        return keccak256(abi.encode(details.detailsUrl, details.detailsHash));
    }

    function _questionContentHash(
        SubmissionMetadata memory metadata,
        string[] memory imageUrls,
        string memory videoUrl,
        SubmissionDetails memory details,
        uint256 resolvedCategoryId,
        QuestionSpecCommitment memory spec
    ) private pure returns (bytes32) {
        return keccak256(
            abi.encode(
                QUESTION_CONTEXT_DOMAIN,
                metadata.url,
                imageUrls,
                videoUrl,
                _submissionDetailsHash(details),
                metadata.title,
                metadata.tags,
                resolvedCategoryId,
                spec.questionMetadataHash,
                spec.resultSpecHash
            )
        );
    }

    function _validateQuestionSpec(QuestionSpecCommitment memory spec) private pure {
        require(spec.questionMetadataHash != bytes32(0));
        require(spec.resultSpecHash != bytes32(0));
    }

    function _validateSubmissionDetails(SubmissionDetails memory details, bool gated) private view {
        submissionMediaValidator.validateSubmissionDetails(details.detailsUrl, details.detailsHash, gated);
    }

    function _resolveQuestionSubmissionCategory(SubmissionMetadata memory metadata)
        private
        view
        returns (uint256 resolvedCategoryId)
    {
        require(metadata.categoryId != 0);
        require(categoryRegistry.isCategory(metadata.categoryId));
        return metadata.categoryId;
    }

    function _deriveQuestionMediaSubmissionKey(
        SubmissionMetadata memory metadata,
        bytes32 mediaHash,
        SubmissionDetails memory details,
        uint256 resolvedCategoryId
    ) private pure returns (bytes32) {
        return keccak256(
            abi.encode(
                QUESTION_CONTEXT_DOMAIN,
                resolvedCategoryId,
                mediaHash,
                _submissionDetailsHash(details),
                metadata.url,
                metadata.title,
                metadata.tags
            )
        );
    }

    function _storeSubmittedContent(
        bytes32 submissionKey,
        address submitter,
        address submitterIdentity,
        bytes32 submitterIdentityKey,
        bytes32 contentHash,
        uint256 resolvedCategoryId,
        RoundLib.RoundConfig memory roundConfig,
        uint256 bundleId
    ) internal returns (uint256 contentId) {
        contentId = nextContentId++;
        contentSubmissionKey[contentId] = submissionKey;
        if (submitterIdentity == address(0) || submitterIdentityKey == bytes32(0)) {
            (submitterIdentity, submitterIdentityKey) = _snapshotSubmitterIdentity(submitter);
        }
        getSubmitterIdentity[contentId] = submitterIdentity;
        contentSubmitterIdentityKey[contentId] = submitterIdentityKey;
        contentRoundConfig[contentId] = roundConfig;
        contents[contentId] = ContentRegistryTypes.Content({
            id: contentId.toUint64(),
            contentHash: contentHash,
            submitter: submitter,
            createdAt: block.timestamp.toUint48(),
            lastActivityAt: block.timestamp.toUint48(),
            status: ContentRegistryTypes.ContentStatus.Active,
            dormantCount: 0,
            reviver: address(0),
            rating: 50,
            categoryId: resolvedCategoryId.toUint64()
        });
        if (bundleId != 0) {
            contentBundleId[contentId] = bundleId;
        }
        emit ContentRoundConfigSet(
            contentId, roundConfig.epochDuration, roundConfig.maxDuration, roundConfig.minVoters, roundConfig.maxVoters
        );
        RatingLib.RatingState storage ratingState = _ratingState[contentId];
        ratingState.confidenceMass = uint128(_getInitialConfidenceMass());
        ratingState.ratingBps = RatingLib.DEFAULT_RATING_BPS;
        ratingState.conservativeRatingBps = RatingLib.DEFAULT_RATING_BPS;
        contentSlashConfigSnapshot[contentId] = _getCurrentSlashConfig();
        dormancyAnchorAt[contentId] = block.timestamp;
        delete dormantKeyReleasableAt[contentId];
    }

    function _storeQuestionAndAttachReward(
        bytes32 submissionKey,
        address submitter,
        address submitterIdentity,
        bytes32 submitterIdentityKey,
        address funder,
        SubmissionMetadata memory metadata,
        string[] memory imageUrls,
        string memory videoUrl,
        SubmissionDetails memory details,
        uint256 resolvedCategoryId,
        SubmissionRewardTerms memory rewardTerms,
        RoundLib.RoundConfig memory roundConfig,
        uint256 bundleId,
        QuestionSpecCommitment memory spec,
        IConfidentialityEscrow.ConfidentialityConfig memory confidentiality
    ) internal returns (uint256 contentId) {
        bytes32 contentHash = _questionContentHash(metadata, imageUrls, videoUrl, details, resolvedCategoryId, spec);
        contentId = _storeSubmittedContent(
            submissionKey,
            submitter,
            submitterIdentity,
            submitterIdentityKey,
            contentHash,
            resolvedCategoryId,
            roundConfig,
            bundleId
        );
        _configureConfidentiality(contentId, confidentiality);
        require(questionRewardPoolEscrow != address(0));
        uint256 rewardPoolId = IQuestionRewardPoolEscrow(questionRewardPoolEscrow)
            .createSubmissionRewardPoolFromRegistry(
                contentId,
                funder,
                submitter,
                rewardTerms.asset,
                rewardTerms.amount,
                rewardTerms.requiredVoters,
                rewardTerms.requiredSettledRounds,
                rewardTerms.bountyStartBy,
                rewardTerms.bountyWindowSeconds,
                rewardTerms.feedbackWindowSeconds,
                rewardTerms.bountyEligibility
            );

        emit ContentSubmitted(
            contentId, submitter, contentHash, metadata.url, metadata.title, metadata.tags, resolvedCategoryId
        );
        _emitContentMediaSubmitted(contentId, imageUrls, videoUrl, spec);
        _emitContentDetailsSubmitted(contentId, details);
        emit SubmissionRewardPoolAttached(
            contentId,
            submitter,
            rewardTerms.asset,
            rewardTerms.amount,
            rewardTerms.requiredVoters,
            rewardTerms.requiredSettledRounds,
            rewardTerms.bountyStartBy,
            rewardTerms.bountyWindowSeconds,
            rewardTerms.feedbackWindowSeconds,
            rewardTerms.bountyEligibility,
            bytes32(0),
            rewardPoolId
        );
    }

    function _emitContentDetailsSubmitted(uint256 contentId, SubmissionDetails memory details) internal {
        if (bytes(details.detailsUrl).length != 0) {
            emit ContentDetailsSubmitted(contentId, details.detailsUrl, details.detailsHash);
        }
    }

    function _configureConfidentiality(
        uint256 contentId,
        IConfidentialityEscrow.ConfidentialityConfig memory confidentiality
    ) internal {
        require(confidentiality.flags <= CONFIDENTIALITY_FLAG_PRIVATE_FOREVER);
        require(confidentiality.gated || confidentiality.flags == 0);
        if (!confidentiality.gated && confidentiality.bondAmount == 0) {
            return;
        }
        address escrow = protocolConfig.confidentialityEscrow();
        require(escrow != address(0));
        IConfidentialityEscrow(escrow).configure(contentId, confidentiality);
    }

    function _defaultConfidentialityConfig()
        internal
        pure
        returns (IConfidentialityEscrow.ConfidentialityConfig memory confidentiality)
    { }

    function _emitContentMediaSubmitted(
        uint256 contentId,
        string[] memory imageUrls,
        string memory videoUrl,
        QuestionSpecCommitment memory spec
    ) internal {
        submissionMediaValidator.emitQuestionContentAnchored(
            contentId, imageUrls, videoUrl, spec.questionMetadataHash, spec.resultSpecHash
        );
    }

    function markDormant(uint256 contentId) external nonReentrant whenNotPaused {
        ContentRegistryDormancyLib.markDormant(
            contents[contentId],
            dormancyAnchorAt,
            contentSubmissionKey,
            dormantKeyReleasableAt,
            contentId,
            DORMANCY_PERIOD,
            DORMANT_EXCLUSIVE_REVIVAL_PERIOD,
            _hasDormancyBlockingRound(contentId),
            contentBundleId[contentId] != 0
        );
    }

    /// @notice Revive dormant content by staking REVIVAL_STAKE LREP tokens.
    /// @dev Resets the activity timer. Max MAX_REVIVALS revivals per content.
    ///      Revival stake is sent to treasury (non-refundable).
    function reviveContent(uint256 contentId) external nonReentrant whenNotPaused {
        ContentRegistryDormancyLib.reviveContent(
            contents[contentId],
            contentSubmissionKey,
            submissionKeyUsed,
            dormancyAnchorAt,
            dormantKeyReleasableAt,
            lrepToken,
            treasury,
            contentId,
            REVIVAL_STAKE,
            MAX_REVIVALS,
            _isSubmitterIdentity(contentId, msg.sender)
        );
    }

    /// @notice Release a dormant content key after the exclusive revival window expires.
    function releaseDormantSubmissionKey(uint256 contentId) external nonReentrant whenNotPaused {
        ContentRegistryDormancyLib.releaseDormantSubmissionKey(
            contents[contentId],
            contentSubmissionKey,
            submissionKeyUsed,
            dormantKeyReleasableAt,
            contentId,
            contentBundleId[contentId] != 0
        );
    }

    // --- VotingEngine callbacks ---

    function _authorizeCurrentEngineCallback() private view returns (uint256 callerGeneration) {
        if (msg.sender != votingEngine) revert OnlyVotingEngine();
        callerGeneration = votingEngineCallbackGeneration[msg.sender];
        if (callerGeneration == 0) revert OnlyVotingEngine();
    }

    function _authorizeSettlementCallback(uint256 contentId) private view returns (uint256 callerGeneration) {
        callerGeneration = votingEngineCallbackGeneration[msg.sender];
        if (callerGeneration == 0) revert OnlyVotingEngine();
        if (msg.sender == votingEngine) return callerGeneration;
        if (contentRoundTrackingEngine[contentId] != msg.sender) revert OnlyVotingEngine();
        if (callerGeneration < contentSettlementEngineGeneration[contentId]) revert OnlyVotingEngine();
    }

    function isContentRoundTrackingEngine(uint256 contentId, address engine) external view returns (bool) {
        return contentRoundTrackingEngine[contentId] == engine;
    }

    /// @notice Called by VotingEngine to update raw activity timestamp after commits.
    /// @dev Vote commits refresh UI-facing activity without extending the dormancy window.
    ///      Stamps the per-content generation so any pre-existing older-engine grants are
    ///      shut out from this content by the per-content callback generation.
    function updateActivity(uint256 contentId) external nonReentrant {
        uint256 callerGeneration = _authorizeSettlementCallback(contentId);

        address trackedEngine = contentRoundTrackingEngine[contentId];
        if (trackedEngine != address(0) && trackedEngine != msg.sender && _engineHasOpenRound(trackedEngine, contentId))
        {
            revert ActiveRoundOnPreviousEngine();
        }
        contentRoundTrackingEngine[contentId] = msg.sender;
        contents[contentId].lastActivityAt = uint48(block.timestamp);
        if (callerGeneration > contentSettlementEngineGeneration[contentId]) {
            contentSettlementEngineGeneration[contentId] = callerGeneration;
        }
    }

    function nextVotingRoundId(uint256 contentId) external view returns (uint256) {
        unchecked {
            return latestVotingRoundId[contentId] + 1;
        }
    }

    function reserveNextVotingRound(uint256 contentId) external nonReentrant returns (uint256 roundId) {
        _authorizeCurrentEngineCallback();

        ContentRegistryTypes.Content storage c = contents[contentId];
        require(c.id != 0 && c.status == ContentRegistryTypes.ContentStatus.Active);

        address trackedEngine = contentRoundTrackingEngine[contentId];
        if (trackedEngine != address(0) && trackedEngine != msg.sender && _engineHasOpenRound(trackedEngine, contentId))
        {
            revert ActiveRoundOnPreviousEngine();
        }

        unchecked {
            roundId = latestVotingRoundId[contentId] + 1;
        }
        latestVotingRoundId[contentId] = roundId;
    }

    /// @notice Called by VotingEngine when a round settles and its public rating impact must wait for correlation review.
    function recordPendingRatingSettlement(
        uint256 contentId,
        uint256 roundId,
        uint16 referenceRatingBps,
        uint64 upEvidence,
        uint64 downEvidence
    ) external {
        uint256 callerGeneration = _authorizeSettlementCallback(contentId);

        ContentRegistryTypes.Content storage c = contents[contentId];
        require(c.id != 0);
        c.lastActivityAt = uint48(block.timestamp);
        dormancyAnchorAt[contentId] = block.timestamp;
        contentSettlementEngineGeneration[contentId] = callerGeneration;

        ContentRegistryRatingSnapshotLib.recordPendingRatingSettlement(
            pendingRatingSettlement[contentId][roundId],
            msg.sender,
            protocolConfig,
            contentId,
            roundId,
            referenceRatingBps,
            upEvidence,
            downEvidence,
            uint48(block.timestamp)
        );
    }

    function applyRatingPayoutSnapshot(
        uint256 contentId,
        uint256 roundId,
        IClusterPayoutOracle.PayoutWeight[] calldata payoutWeights,
        bytes32[][] calldata proofs
    ) external {
        ContentRegistryRatingSnapshotLib.applyRatingPayoutSnapshot(
            pendingRatingSettlement[contentId][roundId],
            contents[contentId],
            _ratingState[contentId],
            contentSlashConfigSnapshot[contentId],
            appliedRatingSnapshotDigest,
            contentId,
            roundId,
            payoutWeights,
            proofs,
            uint48(block.timestamp)
        );
    }

    /// @notice Repoint the pinned cluster payout oracle for an in-flight pending public rating.
    function repointPendingRatingClusterPayoutOracle(uint256 contentId, uint256 roundId, address newOracle)
        external
        onlyRole(CONFIG_ROLE)
    {
        ContentRegistryRatingSnapshotLib.repointPendingRatingClusterPayoutOracle(
            pendingRatingSettlement[contentId][roundId], address(this), contentId, roundId, newOracle
        );
    }

    function isRoundPayoutSnapshotConsumed(uint8 domain, uint256 rewardPoolId, uint256 contentId, uint256 roundId)
        external
        view
        returns (bool)
    {
        if (domain != 3 || rewardPoolId != 0) return false;
        return appliedRatingSnapshotDigest[contentId][roundId] != bytes32(0);
    }

    function roundPayoutSnapshotSourceReadyAt(uint8 domain, uint256 rewardPoolId, uint256 contentId, uint256 roundId)
        external
        view
        returns (uint64)
    {
        if (domain != 3 || rewardPoolId != 0) return 0;
        return ContentRegistryRatingSnapshotLib.roundPayoutSnapshotSourceReadyAt(
            pendingRatingSettlement[contentId][roundId], contentId, roundId
        );
    }

    // --- View functions ---

    function getRating(uint256 contentId) external view returns (uint16) {
        uint16 ratingBps = _ratingState[contentId].ratingBps;
        if (ratingBps == 0) return uint16(uint256(contents[contentId].rating) * 100);
        return ratingBps;
    }

    function isContentActive(uint256 contentId) external view returns (bool) {
        ContentRegistryTypes.Content storage c = contents[contentId];
        return c.id != 0 && uint8(c.status) == 0;
    }

    function _computeRevealCommitment(
        bytes32 submissionKey,
        bytes32 mediaHash,
        string memory title,
        string memory tags,
        SubmissionDetails memory details,
        uint256 categoryId,
        bytes32 salt,
        address submitter,
        SubmissionRewardTerms memory rewardTerms,
        RoundLib.RoundConfig memory roundConfig,
        QuestionSpecCommitment memory spec,
        bytes32 confidentialityHash
    ) internal pure returns (bytes32) {
        bytes32 rewardHash = _hashRewardTerms(rewardTerms);
        bytes32 roundHash = keccak256(
            abi.encode(roundConfig.epochDuration, roundConfig.maxDuration, roundConfig.minVoters, roundConfig.maxVoters)
        );
        bytes32 titleTagsHash = keccak256(abi.encode(title, tags));
        return keccak256(
            abi.encode(
                QUESTION_REVEAL_DOMAIN,
                submissionKey,
                mediaHash,
                titleTagsHash,
                _submissionDetailsHash(details),
                categoryId,
                salt,
                submitter,
                rewardHash,
                roundHash,
                spec.questionMetadataHash,
                spec.resultSpecHash,
                confidentialityHash
            )
        );
    }

    function _hashConfidentiality(IConfidentialityEscrow.ConfidentialityConfig memory confidentiality)
        internal
        pure
        returns (bytes32)
    {
        return keccak256(
            abi.encode(
                confidentiality.gated, confidentiality.bondAsset, confidentiality.bondAmount, confidentiality.flags
            )
        );
    }

    function _computeQuestionBundleHash(
        SubmissionMetadata[] memory metadataList,
        bytes32[] memory mediaHashes,
        uint256[] memory resolvedCategoryIds,
        BundleQuestionInput[] calldata questions
    ) internal pure returns (bytes32) {
        bytes32[] memory questionHashes = new bytes32[](metadataList.length);
        for (uint256 i = 0; i < metadataList.length; i++) {
            questionHashes[i] = keccak256(
                abi.encode(
                    QUESTION_BUNDLE_ITEM_DOMAIN,
                    keccak256(abi.encode(metadataList[i].url, metadataList[i].title, metadataList[i].tags)),
                    mediaHashes[i],
                    _submissionDetailsHash(questions[i].details),
                    resolvedCategoryIds[i],
                    questions[i].salt,
                    i,
                    questions[i].spec.questionMetadataHash,
                    questions[i].spec.resultSpecHash
                )
            );
        }
        return keccak256(abi.encode(QUESTION_BUNDLE_DOMAIN, questionHashes));
    }

    function _computeBundleRevealCommitment(
        bytes32 bundleHash,
        address submitter,
        SubmissionRewardTerms memory rewardTerms,
        RoundLib.RoundConfig memory roundConfig
    ) internal pure returns (bytes32) {
        return keccak256(
            abi.encode(
                QUESTION_BUNDLE_REVEAL_DOMAIN,
                bundleHash,
                submitter,
                rewardTerms.asset,
                rewardTerms.amount,
                rewardTerms.requiredVoters,
                rewardTerms.requiredSettledRounds,
                rewardTerms.bountyStartBy,
                rewardTerms.bountyWindowSeconds,
                rewardTerms.feedbackWindowSeconds,
                rewardTerms.bountyEligibility,
                roundConfig.epochDuration,
                roundConfig.maxDuration,
                roundConfig.minVoters,
                roundConfig.maxVoters
            )
        );
    }

    function _validateSubmissionReward(SubmissionRewardTerms memory rewardTerms) internal view {
        ContentRegistryRewardLib.validateSubmissionReward(
            rewardTerms.asset,
            rewardTerms.amount,
            rewardTerms.requiredVoters,
            rewardTerms.requiredSettledRounds,
            rewardTerms.bountyStartBy,
            rewardTerms.bountyWindowSeconds,
            rewardTerms.feedbackWindowSeconds,
            rewardTerms.bountyEligibility,
            _minimumSubmissionReward(rewardTerms.asset),
            block.timestamp
        );
    }

    function _hashRewardTerms(SubmissionRewardTerms memory rewardTerms) internal pure returns (bytes32) {
        return keccak256(
            abi.encode(
                rewardTerms.asset,
                rewardTerms.amount,
                rewardTerms.requiredVoters,
                rewardTerms.requiredSettledRounds,
                rewardTerms.bountyStartBy,
                rewardTerms.bountyWindowSeconds,
                rewardTerms.feedbackWindowSeconds,
                rewardTerms.bountyEligibility
            )
        );
    }

    function _minimumSubmissionReward(uint8 rewardAsset) internal view returns (uint256 minimum) {
        return ContentRegistryRewardLib.minimumSubmissionReward(
            protocolConfig,
            rewardAsset,
            DEFAULT_MIN_SUBMISSION_REWARD_POOL,
            MIN_SUBMISSION_REWARD_SETTLED_ROUNDS,
            SUBMISSION_REWARD_PARTICIPANT_UNIT
        );
    }

    function _defaultRoundConfig() internal view returns (RoundLib.RoundConfig memory cfg) {
        if (address(protocolConfig) != address(0)) {
            (cfg.epochDuration, cfg.maxDuration, cfg.minVoters, cfg.maxVoters) = protocolConfig.config();
            return cfg;
        }
        cfg = RoundLib.RoundConfig({
            epochDuration: uint32(20 minutes),
            maxDuration: uint32(20 minutes),
            minVoters: uint16(3),
            maxVoters: uint16(100)
        });
    }

    function _validatedRoundConfig(RoundLib.RoundConfig memory roundConfig)
        internal
        view
        returns (RoundLib.RoundConfig memory cfg)
    {
        require(address(protocolConfig) != address(0));
        cfg = protocolConfig.validateRoundConfig(
            roundConfig.epochDuration, roundConfig.maxDuration, roundConfig.minVoters, roundConfig.maxVoters
        );
    }

    function _isSubmitterIdentity(uint256 contentId, address account) private view returns (bool) {
        ContentRegistryTypes.Content storage content = contents[contentId];
        address submitterIdentity = getSubmitterIdentity[contentId];
        if (submitterIdentity == address(0)) {
            if (content.submitter == account) return true;
        } else {
            if (submitterIdentity == account) return true;
            if (content.submitter == account && content.submitter == submitterIdentity) return true;
        }

        bytes32 submitterIdentityKey = contentSubmitterIdentityKey[contentId];
        if (submitterIdentityKey == bytes32(0)) return false;

        IRaterIdentityRegistry.ResolvedRater memory resolved = _resolveRater(account);
        if (submitterIdentity != address(0) && resolved.holder == submitterIdentity) return true;
        return resolved.identityKey == submitterIdentityKey;
    }

    function _snapshotSubmitterIdentity(address submitter)
        internal
        view
        returns (address submitterIdentity, bytes32 submitterIdentityKey)
    {
        if (submitter == address(0)) return (address(0), bytes32(0));
        IRaterIdentityRegistry.ResolvedRater memory resolved = _resolveRater(submitter);
        submitterIdentity = resolved.holder == address(0) ? submitter : resolved.holder;
        submitterIdentityKey =
            resolved.identityKey == bytes32(0) ? _addressIdentityKey(submitter) : resolved.identityKey;
    }

    function _pendingSubmitterIdentity(PendingSubmission memory pending)
        internal
        view
        returns (address submitterIdentity, bytes32 submitterIdentityKey)
    {
        submitterIdentity = pending.submitterIdentity;
        submitterIdentityKey = pending.submitterIdentityKey;
        // M-Identity-1: post-fix reservations always store a non-zero identity (the
        // reserver's snapshot at reservation time). The fallback re-resolution survives only
        // for legacy reservations created before the fix — keep the safety net but rely on
        // the stored values for all new submissions.
        if (submitterIdentity == address(0) || submitterIdentityKey == bytes32(0)) {
            (submitterIdentity, submitterIdentityKey) = _snapshotSubmitterIdentity(pending.submitter);
        }
    }

    function _resolveRater(address account)
        internal
        view
        returns (IRaterIdentityRegistry.ResolvedRater memory resolved)
    {
        IRaterIdentityRegistry identityRegistry = _raterRegistry();
        if (address(identityRegistry) != address(0)) {
            resolved = identityRegistry.resolveRater(account);
            if (resolved.identityKey != bytes32(0)) return resolved;
        }

        resolved = IRaterIdentityRegistry.ResolvedRater({
            holder: account,
            identityKey: _addressIdentityKey(account),
            humanNullifier: bytes32(0),
            hasActiveHumanCredential: false,
            delegated: false
        });
    }

    function _raterRegistry() internal view returns (IRaterIdentityRegistry identityRegistry) {
        if (address(protocolConfig) == address(0)) return IRaterIdentityRegistry(address(0));
        return IRaterIdentityRegistry(protocolConfig.raterRegistry());
    }

    function _addressIdentityKey(address account) internal pure returns (bytes32) {
        if (account == address(0)) return bytes32(0);
        return keccak256(abi.encodePacked("rateloop.address-identity-v1", account));
    }

    function _hasDormancyBlockingRound(uint256 contentId) internal view returns (bool) {
        address trackedEngine = contentRoundTrackingEngine[contentId];
        if (trackedEngine != address(0) && _engineHasDormancyBlockingRound(trackedEngine, contentId)) return true;
        address currentEngine = votingEngine;
        return currentEngine != trackedEngine && _engineHasDormancyBlockingRound(currentEngine, contentId);
    }

    function _engineHasDormancyBlockingRound(address engine, uint256 contentId) internal view returns (bool) {
        try IRoundVotingEngine(engine).isDormancyBlocked(contentId) returns (bool blocked) {
            return blocked;
        } catch { }

        return _engineHasOpenRound(engine, contentId);
    }

    function _engineHasOpenRound(address engine, uint256 contentId) internal view returns (bool) {
        uint256 activeRoundId = IRoundVotingEngine(engine).currentRoundId(contentId);
        if (activeRoundId == 0) return false;

        (, RoundLib.RoundState roundState, uint16 voteCount,, uint64 totalStake,,,) =
            IRoundVotingEngineCoreView(engine).roundCore(contentId, activeRoundId);
        return roundState == RoundLib.RoundState.Open && voteCount != 0 && totalStake != 0;
    }

    function _getInitialConfidenceMass() internal view returns (uint256) {
        if (address(protocolConfig) == address(0)) {
            return DEFAULT_CONFIDENCE_MASS_INITIAL;
        }

        uint256 initialConfidenceMass = protocolConfig.getInitialConfidenceMass();
        return initialConfidenceMass == 0 ? DEFAULT_CONFIDENCE_MASS_INITIAL : initialConfidenceMass;
    }

    function _getCurrentSlashConfig() internal view returns (RatingLib.SlashConfig memory slashConfig) {
        if (address(protocolConfig) == address(0)) {
            slashConfig = RatingLib.SlashConfig({
                slashThresholdBps: DEFAULT_SLASH_THRESHOLD_BPS,
                minSlashSettledRounds: DEFAULT_MIN_SLASH_SETTLED_ROUNDS,
                minSlashLowDuration: DEFAULT_MIN_SLASH_LOW_DURATION,
                minSlashEvidence: DEFAULT_MIN_SLASH_EVIDENCE
            });
            return slashConfig;
        }

        (
            slashConfig.slashThresholdBps,
            slashConfig.minSlashSettledRounds,
            slashConfig.minSlashLowDuration,
            slashConfig.minSlashEvidence
        ) = protocolConfig.slashConfig();
    }

    // --- Admin ---

    function pause() external onlyRole(PAUSER_ROLE) {
        _pause();
    }

    function unpause() external onlyRole(PAUSER_ROLE) {
        _unpause();
    }
}
