// SPDX-License-Identifier: MIT
pragma solidity ^0.8.34;

import { Initializable } from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import { AccessControlUpgradeable } from "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import { IAdvisoryVoteRecorder } from "./interfaces/IAdvisoryVoteRecorder.sol";
import { IRoundRewardDistributor } from "./interfaces/IRoundRewardDistributor.sol";
import { IRaterIdentityRegistry } from "./interfaces/IRaterIdentityRegistry.sol";
import { ILaunchDistributionPool, IRoundClusterReadyAtSource } from "./interfaces/ILaunchDistributionPool.sol";
import { IClusterPayoutOracle } from "./interfaces/IClusterPayoutOracle.sol";
import { IFrontendRegistry } from "./interfaces/IFrontendRegistry.sol";
import { ICategoryRegistry } from "./interfaces/ICategoryRegistry.sol";
import { IConfidentialityEscrow } from "./interfaces/IConfidentialityEscrow.sol";
import { RaterRegistry } from "./RaterRegistry.sol";
import { RoundLib } from "./libraries/RoundLib.sol";
import { RatingLib } from "./libraries/RatingLib.sol";

interface IRewardDistributorVotingEngineShape {
    function rewardDistributorConfigShape()
        external
        view
        returns (address registry_, address lrepToken_, address protocolConfig_);
}

interface IQuestionRewardRegistryShape {
    function questionRewardPoolEscrow() external view returns (address);
}

interface IQuestionRewardPoolEscrowShape {
    function questionRewardPoolEscrowConfigShape() external view returns (address registry_, address votingEngine_);
}

/// @title ProtocolConfig
/// @notice Governance-controlled configuration and address book for RoundVotingEngine.
/// @dev Upgradeable behind a transparent proxy, so storage layout must remain stable across future upgrades.
contract ProtocolConfig is Initializable, AccessControlUpgradeable {
    bytes32 public constant CONFIG_ROLE = keccak256("CONFIG_ROLE");
    bytes32 public constant TREASURY_ROLE = keccak256("TREASURY_ROLE");
    bytes32 public constant TREASURY_ADMIN_ROLE = keccak256("TREASURY_ADMIN_ROLE");
    uint256 public constant ABSOLUTE_MAX_ROUND_DURATION = 60 days;
    uint256 public constant MIN_SUBMISSION_LREP_POOL_FLOOR = 1e6;
    uint256 public constant MIN_SUBMISSION_USDC_POOL_FLOOR = 1e6;
    uint16 internal constant MAX_DEFAULT_ROUND_VOTERS = 100;
    uint16 internal constant MAX_BUNDLE_COMPATIBLE_MIN_VOTER_CAP = 100;
    uint16 internal constant MAX_CREATOR_ROUND_VOTERS = 200;
    uint32 internal constant MIN_ROUND_DURATION_FLOOR = 20 seconds;
    uint8 internal constant PAYOUT_DOMAIN_QUESTION_REWARD = 1;
    uint8 internal constant PAYOUT_DOMAIN_LAUNCH_CREDIT = 2;
    uint8 internal constant PAYOUT_DOMAIN_PUBLIC_RATING = 3;
    uint8 internal constant PAYOUT_DOMAIN_QUESTION_BUNDLE_REWARD = 4;
    bytes32 internal constant RATELOOP_REWARD_DISTRIBUTOR_MARKER = keccak256("rateloop.round-reward-distributor.v1");

    error InvalidAddress();
    error InvalidConfig();

    address public rewardDistributor;
    address public categoryRegistry;
    address public frontendRegistry;
    address public treasury;
    RoundLib.RoundConfig public config;
    uint256 public revealGracePeriod;
    bytes32 public drandChainHash;
    uint64 public drandGenesisTime;
    uint64 public drandPeriod;
    RatingLib.RatingConfig public ratingConfig;
    RatingLib.SlashConfig public slashConfig;
    uint256 public minSubmissionLrepPool;
    uint256 public minSubmissionUsdcPool;
    RoundConfigBounds public roundConfigBounds;
    mapping(address => bool) private rewardDistributorAuthorized;
    mapping(address => address) public rewardDistributorVotingEngine;
    mapping(address => address) public rewardDistributorForVotingEngine;
    address public raterRegistry;
    address public launchDistributionPool;
    address public clusterPayoutOracle;
    address public advisoryVoteRecorder;
    mapping(address => bool) public advisoryVoteRecorderAuthorized;
    mapping(uint256 => mapping(address => uint256)) public advisoryCooldownTimestamp;
    mapping(uint256 => mapping(bytes32 => uint256)) public advisoryCooldownTimestampByIdentity;
    address public confidentialityEscrow;

    struct RoundConfigBounds {
        uint32 minEpochDuration;
        uint32 maxEpochDuration;
        uint32 minRoundDuration;
        uint32 maxRoundDuration;
        uint16 minSettlementVoters;
        uint16 maxSettlementVoters;
        uint16 minVoterCap;
        uint16 maxVoterCap;
    }

    /// @dev Reserved storage gap for future proxy-safe upgrades.
    uint256[19] private __gap;

    event RewardDistributorUpdated(address rewardDistributor);
    event RewardDistributorAuthorizationUpdated(address rewardDistributor, bool authorized);
    event RewardDistributorReplaced(
        address indexed oldDistributor, address indexed newDistributor, address indexed engine
    );
    event FrontendRegistryUpdated(address frontendRegistry);
    event CategoryRegistryUpdated(address categoryRegistry);
    event TreasuryUpdated(address treasury);
    event RevealGracePeriodUpdated(uint256 revealGracePeriod);
    event RaterRegistryUpdated(address raterRegistry);
    event LaunchDistributionPoolUpdated(address launchDistributionPool);
    event ClusterPayoutOracleUpdated(address clusterPayoutOracle);
    event AdvisoryVoteRecorderUpdated(address advisoryVoteRecorder);
    event AdvisoryVoteRecorderAuthorizationUpdated(address advisoryVoteRecorder, bool authorized);
    event ConfidentialityEscrowUpdated(address confidentialityEscrow);
    event AdvisoryCooldownRecorded(
        uint256 indexed contentId, address indexed voter, address indexed identityHolder, bytes32 identityKey
    );
    event ConfigUpdated(uint256 epochDuration, uint256 maxDuration, uint256 minVoters, uint256 maxVoters);
    event DrandConfigUpdated(bytes32 drandChainHash, uint64 genesisTime, uint64 period);
    event RatingConfigUpdated(
        uint256 smoothingAlpha,
        uint256 smoothingBeta,
        uint256 observationBetaX18,
        uint256 confidenceMassInitial,
        uint256 confidenceMassMin,
        uint256 confidenceMassMax,
        uint16 confidenceGainBps,
        uint16 confidenceReopenBps,
        uint256 surpriseReferenceX18,
        uint256 maxDeltaLogitX18,
        uint256 maxAbsLogitX18,
        uint16 conservativePenaltyMaxBps,
        uint16 conservativePenaltyMinBps
    );
    event SlashConfigUpdated(
        uint16 slashThresholdBps, uint16 minSlashSettledRounds, uint48 minSlashLowDuration, uint256 minSlashEvidence
    );
    event SubmissionRewardMinimumsUpdated(uint256 minLrepPool, uint256 minUsdcPool);
    event RoundConfigBoundsUpdated(
        uint256 minEpochDuration,
        uint256 maxEpochDuration,
        uint256 minRoundDuration,
        uint256 maxRoundDuration,
        uint256 minSettlementVoters,
        uint256 maxSettlementVoters,
        uint256 minVoterCap,
        uint256 maxVoterCap
    );

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    /// @notice Initializer: caller MUST pass per-chain drand config. Required for testnet
    ///         (World Chain Sepolia uses drand `quicknet-t` with a different G1 public key and chain hash).
    function initializeWithDrandConfig(
        address admin,
        address governance,
        address treasuryAuthority,
        bytes32 drandChainHash_,
        uint64 drandGenesisTime_,
        uint64 drandPeriod_
    ) external initializer {
        _initialize(admin, governance, treasuryAuthority, drandChainHash_, drandGenesisTime_, drandPeriod_);
    }

    function _initialize(
        address admin,
        address governance,
        address treasuryAuthority,
        bytes32 drandChainHash_,
        uint64 drandGenesisTime_,
        uint64 drandPeriod_
    ) internal {
        if (admin == address(0)) revert InvalidAddress();
        if (governance == address(0)) revert InvalidAddress();
        if (treasuryAuthority == address(0)) revert InvalidAddress();

        __AccessControl_init();

        _grantRole(DEFAULT_ADMIN_ROLE, governance);
        _grantRole(CONFIG_ROLE, governance);
        _setRoleAdmin(TREASURY_ROLE, TREASURY_ADMIN_ROLE);
        _setRoleAdmin(TREASURY_ADMIN_ROLE, DEFAULT_ADMIN_ROLE);
        _grantRole(TREASURY_ADMIN_ROLE, governance);
        _grantRole(TREASURY_ADMIN_ROLE, treasuryAuthority);
        _grantRole(TREASURY_ROLE, treasuryAuthority);
        if (admin != governance) {
            _grantRole(CONFIG_ROLE, admin);
        }

        config = RoundLib.RoundConfig({
            epochDuration: uint32(20 minutes),
            maxDuration: uint32(20 minutes),
            minVoters: uint16(3),
            maxVoters: MAX_DEFAULT_ROUND_VOTERS
        });
        roundConfigBounds = RoundConfigBounds({
            minEpochDuration: MIN_ROUND_DURATION_FLOOR,
            maxEpochDuration: uint32(30 days),
            minRoundDuration: MIN_ROUND_DURATION_FLOOR,
            maxRoundDuration: uint32(60 days),
            minSettlementVoters: uint16(3),
            maxSettlementVoters: uint16(100),
            minVoterCap: uint16(3),
            maxVoterCap: MAX_CREATOR_ROUND_VOTERS
        });
        revealGracePeriod = 60 minutes;
        if (drandChainHash_ == bytes32(0)) revert InvalidConfig();
        if (drandGenesisTime_ == 0) revert InvalidConfig();
        if (drandPeriod_ == 0) revert InvalidConfig();
        if (drandGenesisTime_ > block.timestamp) revert InvalidConfig();
        if (drandPeriod_ > roundConfigBounds.minEpochDuration) revert InvalidConfig();
        drandChainHash = drandChainHash_;
        drandGenesisTime = drandGenesisTime_;
        drandPeriod = drandPeriod_;
        ratingConfig = RatingLib.RatingConfig({
            smoothingAlpha: 10e6,
            smoothingBeta: 10e6,
            observationBetaX18: 2e18,
            confidenceMassInitial: 80e6,
            confidenceMassMin: 50e6,
            confidenceMassMax: 500e6,
            confidenceGainBps: 1_500,
            confidenceReopenBps: 2_000,
            surpriseReferenceX18: 8e17,
            maxDeltaLogitX18: 6e17,
            maxAbsLogitX18: 4_595_119_850_134_590_000,
            conservativePenaltyMaxBps: 1_500,
            conservativePenaltyMinBps: 250
        });
        slashConfig = RatingLib.SlashConfig({
            slashThresholdBps: 2_500,
            minSlashSettledRounds: 2,
            minSlashLowDuration: uint48(7 days),
            minSlashEvidence: 200e6
        });
        minSubmissionLrepPool = MIN_SUBMISSION_LREP_POOL_FLOOR;
        minSubmissionUsdcPool = MIN_SUBMISSION_USDC_POOL_FLOOR;
        _setTreasury(treasuryAuthority);
    }

    function setRewardDistributor(address value) external onlyRole(CONFIG_ROLE) {
        _setRewardDistributor(value);
    }

    function revokeRewardDistributor(address value) external onlyRole(CONFIG_ROLE) {
        if (value == address(0)) revert InvalidAddress();
        if (_readRewardDistributorClaimAccountingStarted(value)) revert InvalidConfig();
        // Keep the engine slot pinned. Claim accounting lives in the distributor,
        // so a fresh same-engine distributor would reopen historical claims.
        rewardDistributorAuthorized[value] = false;
        emit RewardDistributorAuthorizationUpdated(value, false);
    }

    function replaceRevokedRewardDistributor(address oldValue, address newValue) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (oldValue == address(0) || newValue == address(0)) revert InvalidAddress();
        if (oldValue == newValue) revert InvalidConfig();

        address engine = rewardDistributorVotingEngine[oldValue];
        if (engine == address(0)) revert InvalidConfig();
        if (rewardDistributorForVotingEngine[engine] != oldValue) revert InvalidConfig();
        if (rewardDistributorAuthorized[oldValue]) revert InvalidConfig();
        if (_readRewardDistributorClaimAccountingStarted(oldValue)) revert InvalidConfig();

        address newEngine = _readRewardDistributorVotingEngine(newValue);
        if (newEngine != engine) revert InvalidConfig();
        if (_readRewardDistributorClaimAccountingStarted(newValue)) revert InvalidConfig();

        address previousNewEngine = rewardDistributorVotingEngine[newValue];
        if (previousNewEngine != address(0) && previousNewEngine != engine) revert InvalidConfig();
        _validateRewardDistributorIntegrations(newValue, engine);
        _validateConfiguredClusterPayoutOracleRewardConsumers(newValue, engine);

        rewardDistributorVotingEngine[newValue] = engine;
        rewardDistributorForVotingEngine[engine] = newValue;
        rewardDistributor = newValue;
        if (!rewardDistributorAuthorized[newValue]) {
            rewardDistributorAuthorized[newValue] = true;
            emit RewardDistributorAuthorizationUpdated(newValue, true);
        }
        emit RewardDistributorUpdated(newValue);
        emit RewardDistributorReplaced(oldValue, newValue, engine);
    }

    function setFrontendRegistry(address value) external onlyRole(CONFIG_ROLE) {
        _setFrontendRegistry(value);
    }

    function setCategoryRegistry(address value) external onlyRole(CONFIG_ROLE) {
        _setCategoryRegistry(value);
    }

    function setTreasury(address value) external onlyRole(TREASURY_ROLE) {
        _setTreasury(value);
    }

    function setRevealGracePeriod(uint256 value) external onlyRole(CONFIG_ROLE) {
        _setRevealGracePeriod(value);
    }

    function setRaterRegistry(address value) external onlyRole(CONFIG_ROLE) {
        if (value == address(0)) revert InvalidAddress();
        _validateRaterRegistry(value);
        _validateConfiguredConfidentialityEscrowRaterRegistry(value);
        _validateLaunchDistributionPoolRaterRegistry(launchDistributionPool, value);
        raterRegistry = value;
        address escrow = confidentialityEscrow;
        if (escrow != address(0)) _validateConfidentialityEscrow(escrow);
        emit RaterRegistryUpdated(value);
    }

    function isSubmitterIdentityBanned(address submitter, address submitterIdentity, bytes32 submitterIdentityKey)
        external
        view
        returns (bool)
    {
        address registry = raterRegistry;
        if (registry == address(0)) return false;
        RaterRegistry status = RaterRegistry(registry);
        return _isIdentityBannedAt(status, submitterIdentityKey)
            || _isIdentityBannedAt(status, _addressIdentityKey(submitter))
            || _isIdentityBannedAt(status, _addressIdentityKey(submitterIdentity));
    }

    function setLaunchDistributionPool(address value) external onlyRole(CONFIG_ROLE) {
        if (value == address(0)) revert InvalidAddress();
        _validateLaunchDistributionPool(value);
        _validateLaunchDistributionPoolRaterRegistry(value, raterRegistry);
        _validateConfiguredClusterPayoutOracleLaunchConsumer(value);
        _validateConfiguredClusterPayoutOracleLaunchPool(value);
        _validateLaunchDistributionPoolRewardDistributor(value, rewardDistributor);
        launchDistributionPool = value;
        emit LaunchDistributionPoolUpdated(value);
    }

    function setClusterPayoutOracle(address value) external onlyRole(CONFIG_ROLE) {
        if (value == address(0)) revert InvalidAddress();
        _validateClusterPayoutOracle(value);
        clusterPayoutOracle = value;
        emit ClusterPayoutOracleUpdated(value);
    }

    function setAdvisoryVoteRecorder(address value) external onlyRole(CONFIG_ROLE) {
        address oldValue = advisoryVoteRecorder;
        if (oldValue != address(0)) {
            advisoryVoteRecorderAuthorized[oldValue] = value != address(0);
            if (value == address(0)) {
                emit AdvisoryVoteRecorderAuthorizationUpdated(oldValue, false);
            }
        }
        if (value != address(0)) {
            _validateAdvisoryVoteRecorder(value);
            advisoryVoteRecorderAuthorized[value] = true;
        }
        advisoryVoteRecorder = value;
        emit AdvisoryVoteRecorderUpdated(value);
    }

    function revokeAdvisoryVoteRecorder(address value) external onlyRole(CONFIG_ROLE) {
        if (value == address(0)) revert InvalidAddress();
        if (value == advisoryVoteRecorder) revert InvalidConfig();
        advisoryVoteRecorderAuthorized[value] = false;
        emit AdvisoryVoteRecorderAuthorizationUpdated(value, false);
    }

    function setConfidentialityEscrow(address value) external onlyRole(CONFIG_ROLE) {
        address oldValue = confidentialityEscrow;
        if (oldValue != address(0) && value != oldValue) revert InvalidConfig();
        if (value != address(0)) {
            _validateConfidentialityEscrow(value);
        }
        confidentialityEscrow = value;
        emit ConfidentialityEscrowUpdated(value);
    }

    function recordAdvisoryCooldown(uint256 contentId, address voter, address identityHolder, bytes32 identityKey)
        external
    {
        if (msg.sender != advisoryVoteRecorder && !advisoryVoteRecorderAuthorized[msg.sender]) {
            revert InvalidConfig();
        }

        uint256 timestamp = block.timestamp;
        advisoryCooldownTimestamp[contentId][voter] = timestamp;
        if (identityHolder != address(0) && identityHolder != voter) {
            advisoryCooldownTimestamp[contentId][identityHolder] = timestamp;
        }
        advisoryCooldownTimestampByIdentity[contentId][identityKey] = timestamp;
        emit AdvisoryCooldownRecorded(contentId, voter, identityHolder, identityKey);
    }

    function setConfig(uint256 epochDuration, uint256 maxDuration, uint256 minVoters, uint256 maxVoters)
        external
        onlyRole(CONFIG_ROLE)
    {
        _setConfig(epochDuration, maxDuration, minVoters, maxVoters);
    }

    function setRoundConfigBounds(
        uint256 minEpochDuration,
        uint256 maxEpochDuration,
        uint256 minRoundDuration,
        uint256 maxRoundDuration,
        uint256 minSettlementVoters,
        uint256 maxSettlementVoters,
        uint256 minVoterCap,
        uint256 maxVoterCap
    ) external onlyRole(CONFIG_ROLE) {
        _setRoundConfigBounds(
            minEpochDuration,
            maxEpochDuration,
            minRoundDuration,
            maxRoundDuration,
            minSettlementVoters,
            maxSettlementVoters,
            minVoterCap,
            maxVoterCap
        );
    }

    function setDrandConfig(bytes32 chainHash, uint64 genesisTime, uint64 period) external onlyRole(CONFIG_ROLE) {
        _setDrandConfig(chainHash, genesisTime, period);
    }

    function setRatingConfig(
        uint256 smoothingAlpha,
        uint256 smoothingBeta,
        uint256 observationBetaX18,
        uint256 confidenceMassInitial,
        uint256 confidenceMassMin,
        uint256 confidenceMassMax,
        uint16 confidenceGainBps,
        uint16 confidenceReopenBps,
        uint256 surpriseReferenceX18,
        uint256 maxDeltaLogitX18,
        uint256 maxAbsLogitX18,
        uint16 conservativePenaltyMaxBps,
        uint16 conservativePenaltyMinBps
    ) external onlyRole(CONFIG_ROLE) {
        _setRatingConfig(
            smoothingAlpha,
            smoothingBeta,
            observationBetaX18,
            confidenceMassInitial,
            confidenceMassMin,
            confidenceMassMax,
            confidenceGainBps,
            confidenceReopenBps,
            surpriseReferenceX18,
            maxDeltaLogitX18,
            maxAbsLogitX18,
            conservativePenaltyMaxBps,
            conservativePenaltyMinBps
        );
    }

    function setSlashConfig(
        uint16 slashThresholdBps,
        uint16 minSlashSettledRounds,
        uint48 minSlashLowDuration,
        uint256 minSlashEvidence
    ) external onlyRole(CONFIG_ROLE) {
        _setSlashConfig(slashThresholdBps, minSlashSettledRounds, minSlashLowDuration, minSlashEvidence);
    }

    function setSubmissionRewardMinimums(uint256 minLrepPool, uint256 minUsdcPool) external onlyRole(CONFIG_ROLE) {
        if (minLrepPool < MIN_SUBMISSION_LREP_POOL_FLOOR || minUsdcPool < MIN_SUBMISSION_USDC_POOL_FLOOR) {
            revert InvalidConfig();
        }
        minSubmissionLrepPool = minLrepPool;
        minSubmissionUsdcPool = minUsdcPool;
        emit SubmissionRewardMinimumsUpdated(minLrepPool, minUsdcPool);
    }

    function getRatingConfig() external view returns (RatingLib.RatingConfig memory cfg) {
        cfg = ratingConfig;
    }

    function getInitialConfidenceMass() external view returns (uint256) {
        return ratingConfig.confidenceMassInitial;
    }

    function getSlashConfig() external view returns (RatingLib.SlashConfig memory cfg) {
        cfg = slashConfig;
    }

    function getRoundConfigBounds() external view returns (RoundConfigBounds memory bounds) {
        bounds = roundConfigBounds;
    }

    function validateRoundConfig(uint256 epochDuration, uint256 maxDuration, uint256 minVoters, uint256 maxVoters)
        external
        view
        returns (RoundLib.RoundConfig memory cfg)
    {
        cfg = _validateRoundConfig(epochDuration, maxDuration, minVoters, maxVoters, roundConfigBounds);
    }

    function isRewardDistributor(address value) external view returns (bool) {
        return rewardDistributorAuthorized[value];
    }

    function isRewardDistributorForEngine(address value, address engine) external view returns (bool) {
        return
            engine != address(0) && rewardDistributorAuthorized[value] && rewardDistributorVotingEngine[value] == engine;
    }

    function _setRewardDistributor(address value) internal {
        if (value == address(0)) revert InvalidAddress();
        address engine = _readRewardDistributorVotingEngine(value);
        if (_readRewardDistributorClaimAccountingStarted(value)) revert InvalidConfig();
        _validateRewardDistributorIntegrations(value, engine);
        _validateConfiguredClusterPayoutOracleRewardConsumers(value, engine);
        if (advisoryVoteRecorder != address(0)) _validateAdvisoryVoteRecorderForEngine(advisoryVoteRecorder, engine);
        address previousForEngine = rewardDistributorForVotingEngine[engine];
        if (previousForEngine != address(0) && previousForEngine != value) revert InvalidConfig();
        rewardDistributorVotingEngine[value] = engine;
        rewardDistributorForVotingEngine[engine] = value;
        rewardDistributor = value;
        if (!rewardDistributorAuthorized[value]) {
            rewardDistributorAuthorized[value] = true;
            emit RewardDistributorAuthorizationUpdated(value, true);
        }
        emit RewardDistributorUpdated(value);
    }

    function _readRewardDistributorVotingEngine(address value) internal view returns (address engine) {
        if (value.code.length == 0) revert InvalidAddress();
        try IRoundRewardDistributor(value).votingEngine() returns (address distributorEngine) {
            engine = distributorEngine;
            if (engine == address(0)) revert InvalidConfig();
        } catch {
            revert InvalidConfig();
        }
    }

    function _readRewardDistributorClaimAccountingStarted(address value) internal view returns (bool started) {
        if (value.code.length == 0) revert InvalidAddress();
        try IRoundRewardDistributor(value).claimAccountingStarted() returns (bool claimAccountingStarted) {
            return claimAccountingStarted;
        } catch {
            revert InvalidConfig();
        }
    }

    function _validateRewardDistributorShape(address value, address engine) internal view {
        try IRoundRewardDistributor(value).RATELOOP_REWARD_DISTRIBUTOR_MARKER() returns (bytes32 marker) {
            if (marker != RATELOOP_REWARD_DISTRIBUTOR_MARKER) revert InvalidConfig();
        } catch {
            revert InvalidConfig();
        }

        if (engine.code.length == 0) revert InvalidConfig();
        address engineRegistry;
        address engineLrepToken;
        try IRewardDistributorVotingEngineShape(engine).rewardDistributorConfigShape() returns (
            address registry_, address lrepToken_, address engineConfig
        ) {
            if (engineConfig != address(this)) revert InvalidConfig();
            if (registry_ == address(0)) revert InvalidConfig();
            if (lrepToken_ == address(0)) revert InvalidConfig();
            engineRegistry = registry_;
            engineLrepToken = lrepToken_;
        } catch {
            revert InvalidConfig();
        }

        try IRoundRewardDistributor(value).registry() returns (address distributorRegistry) {
            if (distributorRegistry != engineRegistry) revert InvalidConfig();
        } catch {
            revert InvalidConfig();
        }
        try IRoundRewardDistributor(value).lrepToken() returns (address distributorLrepToken) {
            if (distributorLrepToken != engineLrepToken) revert InvalidConfig();
        } catch {
            revert InvalidConfig();
        }
    }

    function _validateRewardDistributorIntegrations(address value, address engine) internal view {
        _validateRewardDistributorShape(value, engine);

        address launchPool = launchDistributionPool;
        if (launchPool != address(0)) {
            _validateLaunchDistributionPoolRewardDistributor(launchPool, value);
        }
    }

    function _validateLaunchDistributionPoolRewardDistributor(address launchPool, address distributor) internal view {
        if (launchPool == address(0) || distributor == address(0)) return;
        address engine = rewardDistributorVotingEngine[distributor];
        if (engine == address(0)) engine = _readRewardDistributorVotingEngine(distributor);

        try ILaunchDistributionPool(launchPool).authorizedCallers(distributor) returns (bool authorized) {
            if (!authorized) revert InvalidConfig();
        } catch {
            revert InvalidConfig();
        }
        try ILaunchDistributionPool(launchPool).roundClusterReadyAtSource() returns (
            IRoundClusterReadyAtSource source
        ) {
            if (address(source) != engine) revert InvalidConfig();
        } catch {
            revert InvalidConfig();
        }
    }

    function _setFrontendRegistry(address value) internal {
        if (value == address(0)) revert InvalidAddress();
        _validateFrontendRegistry(value);
        _validateConfiguredClusterPayoutOracleFrontendRegistry(value);
        frontendRegistry = value;
        emit FrontendRegistryUpdated(value);
    }

    function _setCategoryRegistry(address value) internal {
        if (value == address(0)) revert InvalidAddress();
        if (value.code.length == 0) revert InvalidAddress();
        try ICategoryRegistry(value).isCategory(0) returns (bool) { }
        catch {
            revert InvalidConfig();
        }
        categoryRegistry = value;
        emit CategoryRegistryUpdated(value);
    }

    function _setTreasury(address value) internal {
        if (value == address(0)) revert InvalidAddress();
        treasury = value;
        emit TreasuryUpdated(value);
    }

    function _setRevealGracePeriod(uint256 value) internal {
        uint256 minRevealGrace =
            config.epochDuration == 0 ? uint256(roundConfigBounds.minEpochDuration) : uint256(config.epochDuration);
        if (value < minRevealGrace) revert InvalidConfig();
        // Upper bound: without it, an extreme value (e.g. type(uint256).max) would make
        // RevealFailed finalization unreachable and lock every in-flight stake indefinitely.
        // Bounding to the configured maxRoundDuration + 1 day leaves keepers ample headroom
        // while still keeping the grace period within an order of magnitude of a round.
        uint256 maxRevealGrace = uint256(roundConfigBounds.maxRoundDuration) + 1 days;
        if (value > maxRevealGrace) revert InvalidConfig();
        revealGracePeriod = value;
        emit RevealGracePeriodUpdated(value);
    }

    function _validateRaterRegistry(address value) internal view {
        if (value.code.length == 0) revert InvalidAddress();
        IRaterIdentityRegistry registry = IRaterIdentityRegistry(value);
        address sample = address(uint160(uint256(keccak256("rateloop.rater-registry.validation"))));
        bytes32 expectedSampleKey = keccak256(abi.encodePacked("rateloop.address-identity-v1", sample));
        try registry.addressIdentityKey(address(0)) returns (bytes32 zeroKey) {
            if (zeroKey != bytes32(0)) revert InvalidConfig();
        } catch {
            revert InvalidConfig();
        }
        try registry.addressIdentityKey(sample) returns (bytes32 sampleKey) {
            if (sampleKey != expectedSampleKey) revert InvalidConfig();
        } catch {
            revert InvalidConfig();
        }
        try registry.resolveRater(sample) returns (IRaterIdentityRegistry.ResolvedRater memory resolved) {
            if (
                resolved.holder != sample || resolved.identityKey != expectedSampleKey
                    || resolved.humanNullifier != bytes32(0) || resolved.hasActiveHumanCredential || resolved.delegated
            ) {
                revert InvalidConfig();
            }
        } catch {
            revert InvalidConfig();
        }
        try registry.hasActiveHumanCredential(sample) returns (bool active) {
            if (active) revert InvalidConfig();
        } catch {
            revert InvalidConfig();
        }
        try RaterRegistry(value).isIdentityKeyBanned(bytes32(0)) returns (bool banned) {
            if (banned) revert InvalidConfig();
        } catch {
            revert InvalidConfig();
        }
        try RaterRegistry(value).getHumanCredential(address(0)) returns (RaterRegistry.HumanCredential memory) { }
        catch {
            revert InvalidConfig();
        }
    }

    function _isIdentityBannedAt(RaterRegistry registry, bytes32 identityKey) private view returns (bool) {
        return identityKey != bytes32(0) && registry.isIdentityKeyBanned(identityKey);
    }

    function _addressIdentityKey(address account) private pure returns (bytes32) {
        if (account == address(0)) return bytes32(0);
        return keccak256(abi.encodePacked("rateloop.address-identity-v1", account));
    }

    function _validateConfiguredConfidentialityEscrowRaterRegistry(address value) internal view {
        address escrow = confidentialityEscrow;
        if (escrow == address(0)) return;
        try RaterRegistry(value).confidentialityEscrow() returns (address registryEscrow) {
            if (registryEscrow != escrow) revert InvalidConfig();
        } catch {
            revert InvalidConfig();
        }
    }

    function _validateLaunchDistributionPool(address value) internal view {
        if (value.code.length == 0) revert InvalidAddress();
        try ILaunchDistributionPool(value).launchAnchorCredentialAgeSeconds() returns (uint32) { }
        catch {
            revert InvalidConfig();
        }
    }

    function _validateLaunchDistributionPoolRaterRegistry(address launchPool, address registry) internal view {
        if (launchPool == address(0) || registry == address(0)) return;
        try ILaunchDistributionPool(launchPool).raterRegistry() returns (RaterRegistry poolRegistry) {
            if (address(poolRegistry) != registry) revert InvalidConfig();
        } catch {
            revert InvalidConfig();
        }
    }

    function _validateClusterPayoutOracle(address value) internal view {
        if (value.code.length == 0) revert InvalidAddress();
        try IClusterPayoutOracle(value).roundPayoutSnapshotKey(0, 0, 0, 0) returns (bytes32) { }
        catch {
            revert InvalidConfig();
        }
        try IClusterPayoutOracle(value).roundPayoutSnapshotProposedAt(0, 0, 0, 0) returns (uint64) { }
        catch {
            revert InvalidConfig();
        }
        _validateClusterPayoutOracleFrontendRegistry(value, frontendRegistry);
        address launchPool = launchDistributionPool;
        if (launchPool != address(0)) {
            _validateClusterPayoutOracleLaunchConsumer(value, launchPool);
            _validateLaunchDistributionPoolClusterPayoutOracle(launchPool, value);
        }
        address distributor = rewardDistributor;
        if (distributor != address(0)) {
            _validateClusterPayoutOracleRewardConsumers(value, distributor, rewardDistributorVotingEngine[distributor]);
        }
    }

    function _validateConfiguredClusterPayoutOracleFrontendRegistry(address registry) internal view {
        address oracle = clusterPayoutOracle;
        if (oracle == address(0)) return;
        _validateClusterPayoutOracleFrontendRegistry(oracle, registry);
    }

    function _validateClusterPayoutOracleFrontendRegistry(address oracle, address registry) internal view {
        if (registry == address(0)) return;
        try IClusterPayoutOracle(oracle).frontendRegistry() returns (IFrontendRegistry oracleRegistry) {
            if (address(oracleRegistry) != registry) revert InvalidConfig();
        } catch {
            revert InvalidConfig();
        }
    }

    function _validateConfidentialityEscrow(address value) internal view {
        if (value.code.length == 0) revert InvalidAddress();
        address configuredRegistry = raterRegistry;
        try IConfidentialityEscrow(value).confidentialityEscrowConfigShape() returns (
            address registry_, address protocolConfig_
        ) {
            if (
                registry_ == address(0) || protocolConfig_ != address(this)
                    || (configuredRegistry != address(0) && registry_ != configuredRegistry)
            ) {
                revert InvalidConfig();
            }
        } catch {
            revert InvalidConfig();
        }
        if (configuredRegistry != address(0)) {
            try RaterRegistry(configuredRegistry).confidentialityEscrow() returns (address registryEscrow) {
                if (registryEscrow != value) revert InvalidConfig();
            } catch {
                revert InvalidConfig();
            }
        }
        try IConfidentialityEscrow(value).confidentialityConfig(0) returns (
            IConfidentialityEscrow.ConfidentialityConfig memory
        ) { }
        catch {
            revert InvalidConfig();
        }
        try IConfidentialityEscrow(value).hasActiveBond(0, bytes32(0)) returns (bool) { }
        catch {
            revert InvalidConfig();
        }
        try IConfidentialityEscrow(value).hasConfidentialityNexus(0, bytes32(0)) returns (bool) { }
        catch {
            revert InvalidConfig();
        }
    }

    function _validateConfiguredClusterPayoutOracleLaunchConsumer(address launchPool) internal view {
        address oracle = clusterPayoutOracle;
        if (oracle == address(0)) return;
        _validateClusterPayoutOracleLaunchConsumer(oracle, launchPool);
    }

    function _validateConfiguredClusterPayoutOracleLaunchPool(address launchPool) internal view {
        address oracle = clusterPayoutOracle;
        if (oracle == address(0)) return;
        _validateLaunchDistributionPoolClusterPayoutOracle(launchPool, oracle);
    }

    function _validateClusterPayoutOracleLaunchConsumer(address oracle, address launchPool) internal view {
        try IClusterPayoutOracle(oracle).roundPayoutSnapshotConsumer(PAYOUT_DOMAIN_LAUNCH_CREDIT) returns (
            address consumer
        ) {
            if (consumer != launchPool) revert InvalidConfig();
        } catch {
            revert InvalidConfig();
        }
    }

    function _validateConfiguredClusterPayoutOracleRewardConsumers(address distributor, address engine) internal view {
        address oracle = clusterPayoutOracle;
        if (oracle == address(0)) return;
        _validateClusterPayoutOracleRewardConsumers(oracle, distributor, engine);
    }

    function _validateClusterPayoutOracleRewardConsumers(address oracle, address distributor, address engine)
        internal
        view
    {
        address contentRegistry = _readRewardDistributorRegistry(distributor);
        if (contentRegistry == address(0)) revert InvalidConfig();
        _validateClusterPayoutOraclePublicRatingConsumer(oracle, contentRegistry);
        address questionRewardEscrow = _readQuestionRewardPoolEscrow(contentRegistry);
        if (questionRewardEscrow == address(0)) return;
        _validateQuestionRewardPoolEscrowShape(questionRewardEscrow, contentRegistry, engine);
        _validateClusterPayoutOracleConsumer(oracle, PAYOUT_DOMAIN_QUESTION_REWARD, questionRewardEscrow);
        _validateClusterPayoutOracleConsumer(oracle, PAYOUT_DOMAIN_QUESTION_BUNDLE_REWARD, questionRewardEscrow);
    }

    function _validateClusterPayoutOraclePublicRatingConsumer(address oracle, address contentRegistry) internal view {
        try IClusterPayoutOracle(oracle).roundPayoutSnapshotConsumer(PAYOUT_DOMAIN_PUBLIC_RATING) returns (
            address consumer
        ) {
            if (consumer != contentRegistry) revert InvalidConfig();
        } catch {
            revert InvalidConfig();
        }
    }

    function _validateClusterPayoutOracleConsumer(address oracle, uint8 domain, address expectedConsumer) internal view {
        try IClusterPayoutOracle(oracle).roundPayoutSnapshotConsumer(domain) returns (address consumer) {
            if (consumer != expectedConsumer) revert InvalidConfig();
        } catch {
            revert InvalidConfig();
        }
    }

    function _readQuestionRewardPoolEscrow(address contentRegistry) internal view returns (address escrow) {
        try IQuestionRewardRegistryShape(contentRegistry).questionRewardPoolEscrow() returns (address configuredEscrow) {
            return configuredEscrow;
        } catch {
            revert InvalidConfig();
        }
    }

    function _validateQuestionRewardPoolEscrowShape(address escrow, address contentRegistry, address engine)
        internal
        view
    {
        if (escrow.code.length == 0 || engine == address(0)) revert InvalidConfig();
        try IQuestionRewardPoolEscrowShape(escrow).questionRewardPoolEscrowConfigShape() returns (
            address registry_, address votingEngine_
        ) {
            if (registry_ != contentRegistry || votingEngine_ != engine) revert InvalidConfig();
        } catch {
            revert InvalidConfig();
        }
    }

    function _readRewardDistributorRegistry(address distributor) internal view returns (address registry) {
        try IRoundRewardDistributor(distributor).registry() returns (address distributorRegistry) {
            return distributorRegistry;
        } catch {
            revert InvalidConfig();
        }
    }

    function _validateLaunchDistributionPoolClusterPayoutOracle(address launchPool, address oracle) internal view {
        try ILaunchDistributionPool(launchPool).clusterPayoutOracle() returns (IClusterPayoutOracle poolOracle) {
            if (address(poolOracle) != oracle) revert InvalidConfig();
        } catch {
            revert InvalidConfig();
        }
    }

    function _validateFrontendRegistry(address value) internal view {
        if (value.code.length == 0) revert InvalidAddress();
        try IFrontendRegistry(value).STAKE_AMOUNT() returns (uint256) { }
        catch {
            revert InvalidConfig();
        }
        try IFrontendRegistry(value).getFrontendInfo(address(this)) returns (address, uint256, bool, bool) { }
        catch {
            revert InvalidConfig();
        }
    }

    function _validateAdvisoryVoteRecorder(address value) internal view {
        if (value.code.length == 0) revert InvalidAddress();
        IAdvisoryVoteRecorder recorder = IAdvisoryVoteRecorder(value);

        try recorder.protocolConfig() returns (address recorderConfig) {
            if (recorderConfig != address(this)) revert InvalidConfig();
        } catch {
            revert InvalidConfig();
        }

        address recorderEngine = _readAdvisoryVoteRecorderEngine(recorder);
        address recorderRegistry = _readAdvisoryVoteRecorderRegistry(recorder);
        _validateAdvisoryVoteRecorderEngineShape(recorderEngine, recorderRegistry);

        address configuredRewardDistributor = rewardDistributor;
        if (configuredRewardDistributor != address(0)) {
            _validateAdvisoryVoteRecorderForEngine(value, rewardDistributorVotingEngine[configuredRewardDistributor]);
        }

        try recorder.advisoryCommitKeyByRater(0, 0, address(this)) returns (bytes32) { }
        catch {
            revert InvalidConfig();
        }

        try recorder.advisoryCommitKeyByIdentity(0, 0, bytes32(0)) returns (bytes32) { }
        catch {
            revert InvalidConfig();
        }

        try recorder.lastAdvisoryVoteTimestamp(0, address(this)) returns (uint256) { }
        catch {
            revert InvalidConfig();
        }

        try recorder.lastAdvisoryVoteTimestampByIdentity(0, bytes32(0)) returns (uint256) { }
        catch {
            revert InvalidConfig();
        }
    }

    function _validateAdvisoryVoteRecorderForEngine(address value, address expectedEngine) internal view {
        if (expectedEngine == address(0)) revert InvalidConfig();
        IAdvisoryVoteRecorder recorder = IAdvisoryVoteRecorder(value);
        address recorderEngine = _readAdvisoryVoteRecorderEngine(recorder);
        if (recorderEngine != expectedEngine) revert InvalidConfig();
        _validateAdvisoryVoteRecorderEngineShape(recorderEngine, _readAdvisoryVoteRecorderRegistry(recorder));
    }

    function _readAdvisoryVoteRecorderEngine(IAdvisoryVoteRecorder recorder)
        internal
        view
        returns (address recorderEngine)
    {
        try recorder.votingEngine() returns (address engine) {
            recorderEngine = engine;
            if (recorderEngine == address(0) || recorderEngine.code.length == 0) revert InvalidConfig();
        } catch {
            revert InvalidConfig();
        }
    }

    function _readAdvisoryVoteRecorderRegistry(IAdvisoryVoteRecorder recorder)
        internal
        view
        returns (address recorderRegistry)
    {
        try recorder.registry() returns (address registry_) {
            recorderRegistry = registry_;
            if (recorderRegistry == address(0)) revert InvalidConfig();
        } catch {
            revert InvalidConfig();
        }
    }

    function _validateAdvisoryVoteRecorderEngineShape(address recorderEngine, address recorderRegistry) internal view {
        try IRewardDistributorVotingEngineShape(recorderEngine).rewardDistributorConfigShape() returns (
            address engineRegistry, address engineLrepToken, address engineConfig
        ) {
            if (engineConfig != address(this)) revert InvalidConfig();
            if (engineRegistry == address(0) || engineLrepToken == address(0)) revert InvalidConfig();
            if (recorderRegistry != engineRegistry) revert InvalidConfig();
        } catch {
            revert InvalidConfig();
        }
    }

    function _setConfig(uint256 epochDuration, uint256 maxDuration, uint256 minVoters, uint256 maxVoters) internal {
        RoundLib.RoundConfig memory nextConfig =
            _validateRoundConfig(epochDuration, maxDuration, minVoters, maxVoters, roundConfigBounds);
        if (nextConfig.maxVoters > MAX_DEFAULT_ROUND_VOTERS) revert InvalidConfig();
        if (drandPeriod > nextConfig.epochDuration) revert InvalidConfig();

        if (revealGracePeriod > 0 && revealGracePeriod < nextConfig.epochDuration) {
            revealGracePeriod = nextConfig.epochDuration;
            emit RevealGracePeriodUpdated(nextConfig.epochDuration);
        }

        config = nextConfig;

        emit ConfigUpdated(epochDuration, maxDuration, minVoters, maxVoters);
    }

    function _setRoundConfigBounds(
        uint256 minEpochDuration,
        uint256 maxEpochDuration,
        uint256 minRoundDuration,
        uint256 maxRoundDuration,
        uint256 minSettlementVoters,
        uint256 maxSettlementVoters,
        uint256 minVoterCap,
        uint256 maxVoterCap
    ) internal {
        RoundConfigBounds memory bounds = _validateRoundConfigBounds(
            minEpochDuration,
            maxEpochDuration,
            minRoundDuration,
            maxRoundDuration,
            minSettlementVoters,
            maxSettlementVoters,
            minVoterCap,
            maxVoterCap
        );
        _validateRoundConfig(config.epochDuration, config.maxDuration, config.minVoters, config.maxVoters, bounds);
        if (drandPeriod > bounds.minEpochDuration) revert InvalidConfig();

        roundConfigBounds = bounds;
        if (revealGracePeriod > 0 && revealGracePeriod < config.epochDuration) {
            revealGracePeriod = config.epochDuration;
            emit RevealGracePeriodUpdated(config.epochDuration);
        }
        // Symmetric clamp on the other side: _setRevealGracePeriod caps values at
        // maxRoundDuration + 1 day. If governance shrinks maxRoundDuration here without
        // re-pushing revealGracePeriod, the stored value can silently exceed that cap
        // and get snapshotted into new rounds. Clamp down to keep the invariant.
        uint256 maxRevealGrace = maxRoundDuration + 1 days;
        if (revealGracePeriod > maxRevealGrace) {
            revealGracePeriod = maxRevealGrace;
            emit RevealGracePeriodUpdated(maxRevealGrace);
        }

        emit RoundConfigBoundsUpdated(
            minEpochDuration,
            maxEpochDuration,
            minRoundDuration,
            maxRoundDuration,
            minSettlementVoters,
            maxSettlementVoters,
            minVoterCap,
            maxVoterCap
        );
    }

    function _validateRoundConfigBounds(
        uint256 minEpochDuration,
        uint256 maxEpochDuration,
        uint256 minRoundDuration,
        uint256 maxRoundDuration,
        uint256 minSettlementVoters,
        uint256 maxSettlementVoters,
        uint256 minVoterCap,
        uint256 maxVoterCap
    ) internal pure returns (RoundConfigBounds memory bounds) {
        if (minEpochDuration < MIN_ROUND_DURATION_FLOOR || maxEpochDuration < minEpochDuration) {
            revert InvalidConfig();
        }
        if (maxEpochDuration > type(uint32).max) revert InvalidConfig();
        if (minRoundDuration < minEpochDuration || maxRoundDuration < minRoundDuration) revert InvalidConfig();
        if (maxRoundDuration < maxEpochDuration) revert InvalidConfig();
        if (maxRoundDuration > type(uint32).max || maxRoundDuration > ABSOLUTE_MAX_ROUND_DURATION) {
            revert InvalidConfig();
        }
        if (minRoundDuration / minEpochDuration > 2016) revert InvalidConfig();
        // L-Vote-B: the `>= 3` floor must match RoundVotingEngine.MIN_RBTS_PARTICIPANTS. The
        // engine's finalizeRevealFailedRound / _canCancelExpiredRound pre-checks use raw
        // `minVoters` (engine size budget) and rely on this bound to stay aligned with the
        // max(minVoters, MIN_RBTS_PARTICIPANTS) quorum in RoundCleanupLib; relaxing it below 3
        // without updating those engine paths would permanently lock stakes in rounds whose
        // revealedCount lands in [minVoters, 3).
        if (minSettlementVoters < 3 || maxSettlementVoters < minSettlementVoters) revert InvalidConfig();
        if (minVoterCap < minSettlementVoters || maxVoterCap < maxSettlementVoters) revert InvalidConfig();
        if (minVoterCap > MAX_BUNDLE_COMPATIBLE_MIN_VOTER_CAP) revert InvalidConfig();
        if (maxVoterCap > MAX_CREATOR_ROUND_VOTERS) revert InvalidConfig();

        bounds = RoundConfigBounds({
            minEpochDuration: uint32(minEpochDuration),
            maxEpochDuration: uint32(maxEpochDuration),
            minRoundDuration: uint32(minRoundDuration),
            maxRoundDuration: uint32(maxRoundDuration),
            minSettlementVoters: uint16(minSettlementVoters),
            maxSettlementVoters: uint16(maxSettlementVoters),
            minVoterCap: uint16(minVoterCap),
            maxVoterCap: uint16(maxVoterCap)
        });
    }

    function _validateRoundConfig(
        uint256 epochDuration,
        uint256 maxDuration,
        uint256 minVoters,
        uint256 maxVoters,
        RoundConfigBounds memory bounds
    ) internal pure returns (RoundLib.RoundConfig memory cfg) {
        if (epochDuration < bounds.minEpochDuration || epochDuration > bounds.maxEpochDuration) {
            revert InvalidConfig();
        }
        if (maxDuration < bounds.minRoundDuration || maxDuration > bounds.maxRoundDuration) revert InvalidConfig();
        if (epochDuration > type(uint32).max || maxDuration > type(uint32).max) revert InvalidConfig();
        if (maxDuration < epochDuration) revert InvalidConfig();
        if (maxDuration / epochDuration > 2016) revert InvalidConfig();
        if (minVoters < bounds.minSettlementVoters || minVoters > bounds.maxSettlementVoters) revert InvalidConfig();
        if (maxVoters < bounds.minVoterCap || maxVoters > bounds.maxVoterCap) revert InvalidConfig();
        if (maxVoters < minVoters) revert InvalidConfig();

        cfg = RoundLib.RoundConfig({
            epochDuration: uint32(epochDuration),
            maxDuration: uint32(maxDuration),
            minVoters: uint16(minVoters),
            maxVoters: uint16(maxVoters)
        });
    }

    function _setDrandConfig(bytes32 chainHash, uint64 genesisTime, uint64 period) internal {
        if (chainHash == bytes32(0)) revert InvalidConfig();
        if (genesisTime == 0) revert InvalidConfig();
        if (period == 0) revert InvalidConfig();
        if (genesisTime > block.timestamp) revert InvalidConfig();
        if (period > roundConfigBounds.minEpochDuration) revert InvalidConfig();

        drandChainHash = chainHash;
        drandGenesisTime = genesisTime;
        drandPeriod = period;

        emit DrandConfigUpdated(chainHash, genesisTime, period);
    }

    function _setRatingConfig(
        uint256 smoothingAlpha,
        uint256 smoothingBeta,
        uint256 observationBetaX18,
        uint256 confidenceMassInitial,
        uint256 confidenceMassMin,
        uint256 confidenceMassMax,
        uint16 confidenceGainBps,
        uint16 confidenceReopenBps,
        uint256 surpriseReferenceX18,
        uint256 maxDeltaLogitX18,
        uint256 maxAbsLogitX18,
        uint16 conservativePenaltyMaxBps,
        uint16 conservativePenaltyMinBps
    ) internal {
        if (smoothingAlpha > type(uint128).max || smoothingBeta > type(uint128).max) {
            revert InvalidConfig();
        }
        if (
            confidenceMassMin == 0 || confidenceMassInitial < confidenceMassMin
                || confidenceMassMax < confidenceMassInitial
        ) {
            revert InvalidConfig();
        }
        if (
            confidenceMassInitial > type(uint128).max || confidenceMassMin > type(uint128).max
                || confidenceMassMax > type(uint128).max
        ) {
            revert InvalidConfig();
        }
        // Lower-bound WAD-scaled parameters to prevent governance from passing degenerate
        // values that would cause PRBMath SD59x18 overflow in RatingMath.applySettlement
        // and permanently brick any future round created after the bad config is set
        // (ratingConfig is snapshotted per-round at creation time).
        // 1e16 = 0.01 in WAD, two orders of magnitude below the launch defaults
        // (observationBetaX18=2e18, surpriseReferenceX18=8e17, maxDeltaLogitX18=6e17),
        // which gives governance ample room to tune while keeping the logit pipeline stable.
        uint256 minWadLowerBound = 1e16;
        if (observationBetaX18 < minWadLowerBound) revert InvalidConfig();
        if (observationBetaX18 > uint256(type(int256).max)) revert InvalidConfig();
        if (confidenceGainBps > 10_000 || confidenceReopenBps > 10_000) revert InvalidConfig();
        if (surpriseReferenceX18 < minWadLowerBound) revert InvalidConfig();
        if (maxAbsLogitX18 > uint256(uint128(type(int128).max))) revert InvalidConfig();
        if (maxDeltaLogitX18 < minWadLowerBound || maxAbsLogitX18 < minWadLowerBound) revert InvalidConfig();
        if (maxDeltaLogitX18 > maxAbsLogitX18) revert InvalidConfig();
        // Conservative penalty is capped at 50% (5000 BPS); governance could previously
        // choose 100%, which zeroes out every conservative rating -- not useful and a
        // needless foot-gun.
        uint16 conservativePenaltyMaxBpsCap = 5_000;
        if (
            conservativePenaltyMaxBps > conservativePenaltyMaxBpsCap
                || conservativePenaltyMinBps > conservativePenaltyMaxBps
        ) {
            revert InvalidConfig();
        }

        ratingConfig = RatingLib.RatingConfig({
            smoothingAlpha: smoothingAlpha,
            smoothingBeta: smoothingBeta,
            observationBetaX18: observationBetaX18,
            confidenceMassInitial: confidenceMassInitial,
            confidenceMassMin: confidenceMassMin,
            confidenceMassMax: confidenceMassMax,
            confidenceGainBps: confidenceGainBps,
            confidenceReopenBps: confidenceReopenBps,
            surpriseReferenceX18: surpriseReferenceX18,
            maxDeltaLogitX18: maxDeltaLogitX18,
            maxAbsLogitX18: maxAbsLogitX18,
            conservativePenaltyMaxBps: conservativePenaltyMaxBps,
            conservativePenaltyMinBps: conservativePenaltyMinBps
        });

        emit RatingConfigUpdated(
            smoothingAlpha,
            smoothingBeta,
            observationBetaX18,
            confidenceMassInitial,
            confidenceMassMin,
            confidenceMassMax,
            confidenceGainBps,
            confidenceReopenBps,
            surpriseReferenceX18,
            maxDeltaLogitX18,
            maxAbsLogitX18,
            conservativePenaltyMaxBps,
            conservativePenaltyMinBps
        );
    }

    function _setSlashConfig(
        uint16 slashThresholdBps,
        uint16 minSlashSettledRounds,
        uint48 minSlashLowDuration,
        uint256 minSlashEvidence
    ) internal {
        if (slashThresholdBps == 0 || slashThresholdBps >= RatingLib.BPS_SCALE) {
            revert InvalidConfig();
        }
        if (minSlashSettledRounds == 0) revert InvalidConfig();
        if (minSlashLowDuration == 0) revert InvalidConfig();

        slashConfig = RatingLib.SlashConfig({
            slashThresholdBps: slashThresholdBps,
            minSlashSettledRounds: minSlashSettledRounds,
            minSlashLowDuration: minSlashLowDuration,
            minSlashEvidence: minSlashEvidence
        });

        emit SlashConfigUpdated(slashThresholdBps, minSlashSettledRounds, minSlashLowDuration, minSlashEvidence);
    }
}
