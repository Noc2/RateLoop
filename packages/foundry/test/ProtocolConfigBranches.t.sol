// SPDX-License-Identifier: MIT
pragma solidity ^0.8.34;

import { Test } from "forge-std/Test.sol";
import { ERC1967Proxy } from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import { ProtocolConfig } from "../contracts/ProtocolConfig.sol";
import { FrontendRegistry } from "../contracts/FrontendRegistry.sol";
import { IConfidentialityEscrow } from "../contracts/interfaces/IConfidentialityEscrow.sol";
import { IRaterIdentityRegistry } from "../contracts/interfaces/IRaterIdentityRegistry.sol";
import { RatingLib } from "../contracts/libraries/RatingLib.sol";
import { RoundLib } from "../contracts/libraries/RoundLib.sol";
import { MockRaterIdentityRegistry } from "./mocks/MockRaterIdentityRegistry.sol";
import { MockCategoryRegistry } from "../contracts/mocks/MockCategoryRegistry.sol";
import { deployInitializedProtocolConfig } from "./helpers/VotingTestHelpers.sol";

contract MockRewardDistributorForConfig {
    bytes32 public constant RATELOOP_REWARD_DISTRIBUTOR_MARKER = keccak256("rateloop.round-reward-distributor.v1");
    address public votingEngine;
    address public registry;
    address public lrepToken;
    bool public claimAccountingStarted;

    constructor(address votingEngine_) {
        votingEngine = votingEngine_;
        if (votingEngine_.code.length != 0) {
            try MockVotingEngineForConfig(votingEngine_).registry() returns (address registry_) {
                registry = registry_;
            } catch { }
            try MockVotingEngineForConfig(votingEngine_).lrepToken() returns (address lrepToken_) {
                lrepToken = lrepToken_;
            } catch { }
        }
    }
}

contract MockRewardDistributorWithClaimStateForConfig is MockRewardDistributorForConfig {
    constructor(address votingEngine_, bool claimAccountingStarted_) MockRewardDistributorForConfig(votingEngine_) {
        claimAccountingStarted = claimAccountingStarted_;
    }

    function setClaimAccountingStarted(bool started) external {
        claimAccountingStarted = started;
    }
}

contract MockRewardDistributorWithoutEngineForConfig { }

contract MockRewardDistributorWithoutClaimStateForConfig {
    bytes32 public constant RATELOOP_REWARD_DISTRIBUTOR_MARKER = keccak256("rateloop.round-reward-distributor.v1");
    address public votingEngine;
    address public registry;
    address public lrepToken;

    constructor(address votingEngine_) {
        votingEngine = votingEngine_;
        if (votingEngine_.code.length != 0) {
            try MockVotingEngineForConfig(votingEngine_).registry() returns (address registry_) {
                registry = registry_;
            } catch { }
            try MockVotingEngineForConfig(votingEngine_).lrepToken() returns (address lrepToken_) {
                lrepToken = lrepToken_;
            } catch { }
        }
    }
}

contract MockRewardDistributorRevertingEngineForConfig {
    bytes32 public constant RATELOOP_REWARD_DISTRIBUTOR_MARKER = keccak256("rateloop.round-reward-distributor.v1");
    bool public claimAccountingStarted;

    function votingEngine() external pure returns (address) {
        revert("mock engine revert");
    }
}

contract MockVotingEngineForConfig {
    address public protocolConfig;
    address public registry;
    address public lrepToken;

    constructor(address protocolConfig_, address registry_, address lrepToken_) {
        protocolConfig = protocolConfig_;
        registry = registry_;
        lrepToken = lrepToken_;
    }

    function rewardDistributorConfigShape()
        external
        view
        returns (address registry_, address lrepToken_, address protocolConfig_)
    {
        return (registry, lrepToken, protocolConfig);
    }
}

contract MockContentRegistryForConfig {
    address public questionRewardPoolEscrow;

    function setQuestionRewardPoolEscrow(address escrow) external {
        questionRewardPoolEscrow = escrow;
    }
}

contract MockQuestionRewardPoolEscrowForConfig {
    address public registry;
    address public votingEngine;

    constructor(address registry_, address votingEngine_) {
        registry = registry_;
        votingEngine = votingEngine_;
    }

    function questionRewardPoolEscrowConfigShape() external view returns (address registry_, address votingEngine_) {
        return (registry, votingEngine);
    }
}

contract MockFrontendRegistryForConfig {
    mapping(address => address) public feeCreditorForEngine;

    function setFeeCreditorForEngine(address engine, address creditor) external {
        feeCreditorForEngine[engine] = creditor;
    }

    function STAKE_AMOUNT() external pure returns (uint256) {
        return 1_000e6;
    }

    function getFrontendInfo(address frontend)
        external
        pure
        returns (address operator, uint256 stakedAmount, bool eligible, bool slashed)
    {
        return (frontend, 0, false, false);
    }
}

contract MockLaunchDistributionPoolForConfig {
    mapping(address => bool) public authorizedCallers;
    address public clusterPayoutOracle;
    address public raterRegistry;
    address public roundClusterReadyAtSource;

    function setAuthorizedCaller(address caller, bool authorized) external {
        authorizedCallers[caller] = authorized;
    }

    function setClusterPayoutOracle(address oracle) external {
        clusterPayoutOracle = oracle;
    }

    function setRaterRegistry(address registry) external {
        raterRegistry = registry;
    }

    function setRoundClusterReadyAtSource(address source) external {
        roundClusterReadyAtSource = source;
    }

    function launchAnchorCredentialAgeSeconds() external pure returns (uint32) {
        return 1 days;
    }
}

contract MockClusterPayoutOracleForConfig {
    address internal launchConsumer;
    address internal questionRewardConsumer;
    address internal publicRatingConsumer;
    address internal questionBundleRewardConsumer;
    address public frontendRegistry;

    constructor(address launchConsumer_) {
        launchConsumer = launchConsumer_;
    }

    function setLaunchConsumer(address launchConsumer_) external {
        launchConsumer = launchConsumer_;
    }

    function setQuestionRewardConsumer(address questionRewardConsumer_) external {
        questionRewardConsumer = questionRewardConsumer_;
    }

    function setPublicRatingConsumer(address publicRatingConsumer_) external {
        publicRatingConsumer = publicRatingConsumer_;
    }

    function setQuestionBundleRewardConsumer(address questionBundleRewardConsumer_) external {
        questionBundleRewardConsumer = questionBundleRewardConsumer_;
    }

    function setFrontendRegistry(address frontendRegistry_) external {
        frontendRegistry = frontendRegistry_;
    }

    function roundPayoutSnapshotKey(uint8 domain, uint256 rewardPoolId, uint256 contentId, uint256 roundId)
        external
        pure
        returns (bytes32)
    {
        return keccak256(abi.encode(domain, rewardPoolId, contentId, roundId));
    }

    function roundPayoutSnapshotProposedAt(uint8, uint256, uint256, uint256) external pure returns (uint64) {
        return 0;
    }

    function roundPayoutSnapshotConsumer(uint8 domain) external view returns (address) {
        if (domain == 1) return questionRewardConsumer;
        if (domain == 2) return launchConsumer;
        if (domain == 3) return publicRatingConsumer;
        if (domain == 4) return questionBundleRewardConsumer;
        return address(0);
    }
}

contract WeakRaterRegistryForConfig {
    function addressIdentityKey(address account) external pure returns (bytes32) {
        if (account == address(0)) return bytes32(0);
        return bytes32(uint256(1));
    }
}

contract RaterRegistryWithoutCredentialAbiForConfig is IRaterIdentityRegistry {
    function addressIdentityKey(address account) external pure returns (bytes32) {
        if (account == address(0)) return bytes32(0);
        return keccak256(abi.encodePacked("rateloop.address-identity-v1", account));
    }

    function resolveRater(address actor) external pure returns (ResolvedRater memory resolved) {
        resolved = ResolvedRater({
            holder: actor,
            identityKey: keccak256(abi.encodePacked("rateloop.address-identity-v1", actor)),
            humanNullifier: bytes32(0),
            hasActiveHumanCredential: false,
            delegated: false
        });
    }

    function hasActiveHumanCredential(address) external pure returns (bool) {
        return false;
    }

    function credentialStatusBits(address) external pure returns (uint8 activeMask, uint8 freshMask) {
        return (0, 0);
    }

    function isIdentityKeyBanned(bytes32) external pure virtual returns (bool) {
        return false;
    }
}

contract RaterRegistryWithoutBanStatusForConfig is IRaterIdentityRegistry {
    function addressIdentityKey(address account) external pure returns (bytes32) {
        if (account == address(0)) return bytes32(0);
        return keccak256(abi.encodePacked("rateloop.address-identity-v1", account));
    }

    function resolveRater(address actor) external pure returns (ResolvedRater memory resolved) {
        resolved = ResolvedRater({
            holder: actor,
            identityKey: keccak256(abi.encodePacked("rateloop.address-identity-v1", actor)),
            humanNullifier: bytes32(0),
            hasActiveHumanCredential: false,
            delegated: false
        });
    }

    function hasActiveHumanCredential(address) external pure returns (bool) {
        return false;
    }

    function credentialStatusBits(address) external pure returns (uint8 activeMask, uint8 freshMask) {
        return (0, 0);
    }
}

contract RaterRegistryBansZeroKeyForConfig is RaterRegistryWithoutCredentialAbiForConfig {
    function isIdentityKeyBanned(bytes32) external pure override returns (bool) {
        return true;
    }
}

contract MockRaterRegistryWithEscrowForConfig is MockRaterIdentityRegistry {
    address public confidentialityEscrow;

    function setConfidentialityEscrow(address value) external {
        confidentialityEscrow = value;
    }
}

contract MockAdvisoryVoteRecorderForConfig {
    address internal recorderProtocolConfig;
    address internal recorderVotingEngine;
    address internal recorderRegistry;
    bool internal revertProtocolConfig;

    constructor(address protocolConfig_, bool revertProtocolConfig_) {
        address registry_ = address(0xCAFE);
        address lrepToken_ = address(0xBEEF);
        address votingEngine_ = address(new MockVotingEngineForConfig(protocolConfig_, registry_, lrepToken_));
        recorderProtocolConfig = protocolConfig_;
        recorderVotingEngine = votingEngine_;
        recorderRegistry = registry_;
        revertProtocolConfig = revertProtocolConfig_;
    }

    function setEngineShape(address votingEngine_, address registry_) external {
        recorderVotingEngine = votingEngine_;
        recorderRegistry = registry_;
    }

    function protocolConfig() external view returns (address) {
        if (revertProtocolConfig) revert("mock protocol config");
        return recorderProtocolConfig;
    }

    function votingEngine() external view returns (address) {
        return recorderVotingEngine;
    }

    function registry() external view returns (address) {
        return recorderRegistry;
    }

    function advisoryCommitKeyByRater(uint256, uint256, address) external pure returns (bytes32) {
        return bytes32(0);
    }

    function advisoryCommitKeyByIdentity(uint256, uint256, bytes32) external pure returns (bytes32) {
        return bytes32(0);
    }

    function lastAdvisoryVoteTimestamp(uint256, address) external pure returns (uint256) {
        return 0;
    }

    function lastAdvisoryVoteTimestampByIdentity(uint256, bytes32) external pure returns (uint256) {
        return 0;
    }
}

contract MockBrokenAdvisoryVoteRecorderForConfig {
    address public protocolConfig;

    constructor(address protocolConfig_) {
        protocolConfig = protocolConfig_;
    }
}

contract MockConfidentialityEscrowForConfig {
    address internal immutable registry;
    address internal immutable protocolConfig;

    constructor(address registry_, address protocolConfig_) {
        registry = registry_;
        protocolConfig = protocolConfig_;
    }

    function confidentialityEscrowConfigShape() external view returns (address registry_, address protocolConfig_) {
        return (registry, protocolConfig);
    }

    function confidentialityConfig(uint256)
        external
        pure
        returns (IConfidentialityEscrow.ConfidentialityConfig memory config)
    {
        return config;
    }

    function hasActiveBond(uint256, bytes32) external pure returns (bool) {
        return false;
    }

    function hasConfidentialityNexus(uint8, bytes32) external pure returns (bool) {
        return false;
    }
}

contract MockBrokenConfidentialityEscrowForConfig {
    function confidentialityConfig(uint256)
        external
        pure
        returns (IConfidentialityEscrow.ConfidentialityConfig memory config)
    {
        return config;
    }

    function hasActiveBond(uint256, bytes32) external pure returns (bool) {
        return false;
    }
}

contract ProtocolConfigBranchesTest is Test {
    bytes32 internal constant QUICKNET_CHAIN_HASH = 0x52db9ba70e0cc0f6eaf7803dd07447a1f5477735fd3f661792ba94600c84e971;
    uint64 internal constant QUICKNET_TEST_GENESIS_TIME = 1;
    uint64 internal constant QUICKNET_TEST_PERIOD = 3;
    address internal constant MOCK_LREP = address(0xA11CE);

    event DrandConfigUpdated(bytes32 drandChainHash, uint64 genesisTime, uint64 period);
    event RewardDistributorUpdated(address rewardDistributor);
    event RewardDistributorAuthorizationUpdated(address rewardDistributor, bool authorized);
    event RewardDistributorReplaced(
        address indexed oldDistributor, address indexed newDistributor, address indexed engine
    );
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
    event AdvisoryVoteRecorderUpdated(address advisoryVoteRecorder);
    event AdvisoryVoteRecorderAuthorizationUpdated(address advisoryVoteRecorder, bool authorized);
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

    function _newRewardEngine(ProtocolConfig config) internal returns (address) {
        MockContentRegistryForConfig contentRegistry = new MockContentRegistryForConfig();
        return address(new MockVotingEngineForConfig(address(config), address(contentRegistry), MOCK_LREP));
    }

    function _newRewardEngineWithQuestionEscrow(ProtocolConfig config)
        internal
        returns (
            address engine,
            MockContentRegistryForConfig contentRegistry,
            MockQuestionRewardPoolEscrowForConfig escrow
        )
    {
        contentRegistry = new MockContentRegistryForConfig();
        engine = address(new MockVotingEngineForConfig(address(config), address(contentRegistry), MOCK_LREP));
        escrow = new MockQuestionRewardPoolEscrowForConfig(address(contentRegistry), engine);
        contentRegistry.setQuestionRewardPoolEscrow(address(escrow));
    }

    function test_DrandConfig_UsesInitializerValues() public {
        ProtocolConfig config = deployInitializedProtocolConfig(address(this));

        assertEq(config.drandChainHash(), QUICKNET_CHAIN_HASH);
        assertEq(config.drandGenesisTime(), QUICKNET_TEST_GENESIS_TIME);
        assertEq(config.drandPeriod(), QUICKNET_TEST_PERIOD);
    }

    function test_DefaultSubmissionRewardMinimums_UseHardFloors() public {
        ProtocolConfig config = deployInitializedProtocolConfig(address(this));

        assertEq(config.minSubmissionLrepPool(), config.MIN_SUBMISSION_LREP_POOL_FLOOR());
        assertEq(config.minSubmissionUsdcPool(), config.MIN_SUBMISSION_USDC_POOL_FLOOR());
    }

    function test_SetSubmissionRewardMinimums_UpdatesAboveHardFloors() public {
        ProtocolConfig config = deployInitializedProtocolConfig(address(this));

        uint256 nextLrepMinimum = config.MIN_SUBMISSION_LREP_POOL_FLOOR() + 1e6;
        uint256 nextUsdcMinimum = config.MIN_SUBMISSION_USDC_POOL_FLOOR() + 2e6;

        vm.expectEmit(true, true, true, true);
        emit SubmissionRewardMinimumsUpdated(nextLrepMinimum, nextUsdcMinimum);

        config.setSubmissionRewardMinimums(nextLrepMinimum, nextUsdcMinimum);

        assertEq(config.minSubmissionLrepPool(), nextLrepMinimum);
        assertEq(config.minSubmissionUsdcPool(), nextUsdcMinimum);
    }

    function test_SetSubmissionRewardMinimums_RejectsBelowHardFloors() public {
        ProtocolConfig config = deployInitializedProtocolConfig(address(this));
        uint256 lrepFloor = config.MIN_SUBMISSION_LREP_POOL_FLOOR();
        uint256 usdcFloor = config.MIN_SUBMISSION_USDC_POOL_FLOOR();

        vm.expectRevert(ProtocolConfig.InvalidConfig.selector);
        config.setSubmissionRewardMinimums(lrepFloor - 1, usdcFloor);

        vm.expectRevert(ProtocolConfig.InvalidConfig.selector);
        config.setSubmissionRewardMinimums(lrepFloor, usdcFloor - 1);
    }

    function test_SetRaterRegistry_AllowsRotation() public {
        ProtocolConfig config = deployInitializedProtocolConfig(address(this));
        address raterRegistry = address(new MockRaterIdentityRegistry());
        address replacementRaterRegistry = address(new MockRaterIdentityRegistry());

        config.setRaterRegistry(raterRegistry);
        config.setRaterRegistry(replacementRaterRegistry);

        assertEq(config.raterRegistry(), replacementRaterRegistry);
    }

    function test_SetRaterRegistry_RejectsRotationUntilLaunchPoolRegistryMoves() public {
        ProtocolConfig config = deployInitializedProtocolConfig(address(this));
        address raterRegistry = address(new MockRaterIdentityRegistry());
        address replacementRaterRegistry = address(new MockRaterIdentityRegistry());
        MockLaunchDistributionPoolForConfig launchPool = new MockLaunchDistributionPoolForConfig();

        launchPool.setRaterRegistry(raterRegistry);
        config.setRaterRegistry(raterRegistry);
        config.setLaunchDistributionPool(address(launchPool));

        vm.expectRevert(ProtocolConfig.InvalidConfig.selector);
        config.setRaterRegistry(replacementRaterRegistry);

        launchPool.setRaterRegistry(replacementRaterRegistry);
        config.setRaterRegistry(replacementRaterRegistry);
        assertEq(config.raterRegistry(), replacementRaterRegistry);
    }

    function test_SetRaterRegistry_RejectsZeroAddress() public {
        ProtocolConfig config = deployInitializedProtocolConfig(address(this));

        vm.expectRevert(ProtocolConfig.InvalidAddress.selector);
        config.setRaterRegistry(address(0));
    }

    function test_SetRaterRegistry_RejectsWeakAbiShape() public {
        ProtocolConfig config = deployInitializedProtocolConfig(address(this));
        WeakRaterRegistryForConfig weakRegistry = new WeakRaterRegistryForConfig();

        vm.expectRevert(ProtocolConfig.InvalidConfig.selector);
        config.setRaterRegistry(address(weakRegistry));
    }

    function test_SetRaterRegistry_RejectsMissingGetHumanCredentialAbi() public {
        ProtocolConfig config = deployInitializedProtocolConfig(address(this));
        RaterRegistryWithoutCredentialAbiForConfig weakRegistry = new RaterRegistryWithoutCredentialAbiForConfig();

        vm.expectRevert(ProtocolConfig.InvalidConfig.selector);
        config.setRaterRegistry(address(weakRegistry));
    }

    function test_SetRaterRegistry_RejectsMissingOrInvalidBanStatusAbi() public {
        ProtocolConfig config = deployInitializedProtocolConfig(address(this));
        RaterRegistryWithoutBanStatusForConfig missingBanStatus = new RaterRegistryWithoutBanStatusForConfig();
        RaterRegistryBansZeroKeyForConfig bansZeroKey = new RaterRegistryBansZeroKeyForConfig();

        vm.expectRevert(ProtocolConfig.InvalidConfig.selector);
        config.setRaterRegistry(address(missingBanStatus));

        vm.expectRevert(ProtocolConfig.InvalidConfig.selector);
        config.setRaterRegistry(address(bansZeroKey));
    }

    function test_SetFrontendRegistry_ValidatesIntegration() public {
        ProtocolConfig config = deployInitializedProtocolConfig(address(this));
        address frontendRegistry = address(new MockFrontendRegistryForConfig());

        config.setFrontendRegistry(frontendRegistry);

        assertEq(config.frontendRegistry(), frontendRegistry);
    }

    function test_SetFrontendRegistry_RejectsInvalidIntegration() public {
        ProtocolConfig config = deployInitializedProtocolConfig(address(this));
        address invalidRegistry = address(new MockRewardDistributorForConfig(address(this)));

        vm.expectRevert(ProtocolConfig.InvalidAddress.selector);
        config.setFrontendRegistry(address(0xFEE));

        vm.expectRevert(ProtocolConfig.InvalidConfig.selector);
        config.setFrontendRegistry(invalidRegistry);
    }

    function test_SetFrontendRegistry_RequiresConfiguredOracleRegistryAlignment() public {
        ProtocolConfig config = deployInitializedProtocolConfig(address(this));
        MockFrontendRegistryForConfig frontend = new MockFrontendRegistryForConfig();
        MockFrontendRegistryForConfig staleFrontend = new MockFrontendRegistryForConfig();
        MockClusterPayoutOracleForConfig oracle = new MockClusterPayoutOracleForConfig(address(0));

        oracle.setFrontendRegistry(address(staleFrontend));
        config.setClusterPayoutOracle(address(oracle));

        vm.expectRevert(ProtocolConfig.InvalidConfig.selector);
        config.setFrontendRegistry(address(frontend));

        oracle.setFrontendRegistry(address(frontend));
        config.setFrontendRegistry(address(frontend));
        assertEq(config.frontendRegistry(), address(frontend));
    }

    function test_SetClusterPayoutOracle_RequiresConfiguredFrontendRegistryAlignment() public {
        ProtocolConfig config = deployInitializedProtocolConfig(address(this));
        MockFrontendRegistryForConfig frontend = new MockFrontendRegistryForConfig();
        MockFrontendRegistryForConfig staleFrontend = new MockFrontendRegistryForConfig();
        MockClusterPayoutOracleForConfig oracle = new MockClusterPayoutOracleForConfig(address(0));

        config.setFrontendRegistry(address(frontend));
        oracle.setFrontendRegistry(address(staleFrontend));

        vm.expectRevert(ProtocolConfig.InvalidConfig.selector);
        config.setClusterPayoutOracle(address(oracle));

        oracle.setFrontendRegistry(address(frontend));
        config.setClusterPayoutOracle(address(oracle));
        assertEq(config.clusterPayoutOracle(), address(oracle));
    }

    function test_SetCategoryRegistry_ValidatesIntegration() public {
        ProtocolConfig config = deployInitializedProtocolConfig(address(this));
        MockCategoryRegistry categoryRegistry = new MockCategoryRegistry();

        config.setCategoryRegistry(address(categoryRegistry));

        assertEq(config.categoryRegistry(), address(categoryRegistry));
    }

    function test_SetCategoryRegistry_RejectsInvalidIntegration() public {
        ProtocolConfig config = deployInitializedProtocolConfig(address(this));
        address invalidRegistry = address(new MockRewardDistributorForConfig(address(this)));

        vm.expectRevert(ProtocolConfig.InvalidAddress.selector);
        config.setCategoryRegistry(address(0xFEE));

        vm.expectRevert(ProtocolConfig.InvalidConfig.selector);
        config.setCategoryRegistry(invalidRegistry);
    }

    function test_SetConfidentialityEscrow_ValidatesIntegration() public {
        ProtocolConfig config = deployInitializedProtocolConfig(address(this));
        MockConfidentialityEscrowForConfig escrow =
            new MockConfidentialityEscrowForConfig(address(0xCAFE), address(config));

        config.setConfidentialityEscrow(address(escrow));

        assertEq(config.confidentialityEscrow(), address(escrow));
    }

    function test_SetConfidentialityEscrow_RequiresConfiguredRaterRegistryAlignment() public {
        ProtocolConfig config = deployInitializedProtocolConfig(address(this));
        MockRaterRegistryWithEscrowForConfig raterRegistry = new MockRaterRegistryWithEscrowForConfig();
        address staleRaterRegistry = address(new MockRaterIdentityRegistry());
        MockConfidentialityEscrowForConfig staleEscrow =
            new MockConfidentialityEscrowForConfig(staleRaterRegistry, address(config));
        MockConfidentialityEscrowForConfig alignedEscrow =
            new MockConfidentialityEscrowForConfig(address(raterRegistry), address(config));

        config.setRaterRegistry(address(raterRegistry));

        vm.expectRevert(ProtocolConfig.InvalidConfig.selector);
        config.setConfidentialityEscrow(address(staleEscrow));

        vm.expectRevert(ProtocolConfig.InvalidConfig.selector);
        config.setConfidentialityEscrow(address(alignedEscrow));

        raterRegistry.setConfidentialityEscrow(address(alignedEscrow));
        config.setConfidentialityEscrow(address(alignedEscrow));
        assertEq(config.confidentialityEscrow(), address(alignedEscrow));
    }

    function test_SetConfidentialityEscrow_RejectsInvalidIntegration() public {
        ProtocolConfig config = deployInitializedProtocolConfig(address(this));
        MockConfidentialityEscrowForConfig wrongConfigEscrow =
            new MockConfidentialityEscrowForConfig(address(0xCAFE), address(this));
        MockBrokenConfidentialityEscrowForConfig brokenEscrow = new MockBrokenConfidentialityEscrowForConfig();

        vm.expectRevert(ProtocolConfig.InvalidAddress.selector);
        config.setConfidentialityEscrow(address(0xC0FFEE));

        vm.expectRevert(ProtocolConfig.InvalidConfig.selector);
        config.setConfidentialityEscrow(address(wrongConfigEscrow));

        vm.expectRevert(ProtocolConfig.InvalidConfig.selector);
        config.setConfidentialityEscrow(address(brokenEscrow));
    }

    function test_SetConfidentialityEscrow_RejectsZeroRegistryShape() public {
        ProtocolConfig config = deployInitializedProtocolConfig(address(this));
        MockConfidentialityEscrowForConfig zeroRegistryEscrow =
            new MockConfidentialityEscrowForConfig(address(0), address(config));

        vm.expectRevert(ProtocolConfig.InvalidConfig.selector);
        config.setConfidentialityEscrow(address(zeroRegistryEscrow));
    }

    function test_SetConfidentialityEscrow_RejectsRotationOrUnsetAfterConfigured() public {
        ProtocolConfig config = deployInitializedProtocolConfig(address(this));
        MockConfidentialityEscrowForConfig escrow =
            new MockConfidentialityEscrowForConfig(address(0xCAFE), address(config));
        MockConfidentialityEscrowForConfig replacementEscrow =
            new MockConfidentialityEscrowForConfig(address(0xBEEF), address(config));

        config.setConfidentialityEscrow(address(escrow));

        vm.expectRevert(ProtocolConfig.InvalidConfig.selector);
        config.setConfidentialityEscrow(address(replacementEscrow));

        vm.expectRevert(ProtocolConfig.InvalidConfig.selector);
        config.setConfidentialityEscrow(address(0));

        config.setConfidentialityEscrow(address(escrow));
        assertEq(config.confidentialityEscrow(), address(escrow));
    }

    function test_SetClusterPayoutOracle_AllowsBootstrapBeforeLaunchPool() public {
        ProtocolConfig config = deployInitializedProtocolConfig(address(this));
        MockClusterPayoutOracleForConfig oracle = new MockClusterPayoutOracleForConfig(address(0));

        config.setClusterPayoutOracle(address(oracle));

        assertEq(config.clusterPayoutOracle(), address(oracle));
    }

    function test_SetClusterPayoutOracle_RequiresPinnedLaunchConsumerAfterLaunchPoolConfigured() public {
        ProtocolConfig config = deployInitializedProtocolConfig(address(this));
        MockLaunchDistributionPoolForConfig launchPool = new MockLaunchDistributionPoolForConfig();
        MockClusterPayoutOracleForConfig mismatchedOracle = new MockClusterPayoutOracleForConfig(address(0xBEEF));
        MockClusterPayoutOracleForConfig pinnedOracle = new MockClusterPayoutOracleForConfig(address(launchPool));

        config.setLaunchDistributionPool(address(launchPool));

        vm.expectRevert(ProtocolConfig.InvalidConfig.selector);
        config.setClusterPayoutOracle(address(mismatchedOracle));

        launchPool.setClusterPayoutOracle(address(pinnedOracle));
        config.setClusterPayoutOracle(address(pinnedOracle));
        assertEq(config.clusterPayoutOracle(), address(pinnedOracle));
    }

    function test_SetLaunchDistributionPool_RequiresPinnedLaunchConsumerAfterOracleConfigured() public {
        ProtocolConfig config = deployInitializedProtocolConfig(address(this));
        MockLaunchDistributionPoolForConfig launchPool = new MockLaunchDistributionPoolForConfig();
        MockClusterPayoutOracleForConfig oracle = new MockClusterPayoutOracleForConfig(address(0));

        config.setClusterPayoutOracle(address(oracle));

        vm.expectRevert(ProtocolConfig.InvalidConfig.selector);
        config.setLaunchDistributionPool(address(launchPool));

        oracle.setLaunchConsumer(address(launchPool));
        vm.expectRevert(ProtocolConfig.InvalidConfig.selector);
        config.setLaunchDistributionPool(address(launchPool));

        launchPool.setClusterPayoutOracle(address(oracle));
        config.setLaunchDistributionPool(address(launchPool));
        assertEq(config.launchDistributionPool(), address(launchPool));
    }

    function test_SetLaunchDistributionPool_RequiresConfiguredRaterRegistryAlignment() public {
        ProtocolConfig config = deployInitializedProtocolConfig(address(this));
        address raterRegistry = address(new MockRaterIdentityRegistry());
        address staleRaterRegistry = address(new MockRaterIdentityRegistry());
        MockLaunchDistributionPoolForConfig launchPool = new MockLaunchDistributionPoolForConfig();

        config.setRaterRegistry(raterRegistry);
        launchPool.setRaterRegistry(staleRaterRegistry);

        vm.expectRevert(ProtocolConfig.InvalidConfig.selector);
        config.setLaunchDistributionPool(address(launchPool));

        launchPool.setRaterRegistry(raterRegistry);
        config.setLaunchDistributionPool(address(launchPool));
        assertEq(config.launchDistributionPool(), address(launchPool));
    }

    function test_SetLaunchDistributionPool_RejectsRotationUntilOracleConsumerMoves() public {
        ProtocolConfig config = deployInitializedProtocolConfig(address(this));
        MockLaunchDistributionPoolForConfig launchPool = new MockLaunchDistributionPoolForConfig();
        MockLaunchDistributionPoolForConfig replacementLaunchPool = new MockLaunchDistributionPoolForConfig();
        MockClusterPayoutOracleForConfig oracle = new MockClusterPayoutOracleForConfig(address(launchPool));

        config.setClusterPayoutOracle(address(oracle));
        launchPool.setClusterPayoutOracle(address(oracle));
        config.setLaunchDistributionPool(address(launchPool));

        vm.expectRevert(ProtocolConfig.InvalidConfig.selector);
        config.setLaunchDistributionPool(address(replacementLaunchPool));

        oracle.setLaunchConsumer(address(replacementLaunchPool));
        vm.expectRevert(ProtocolConfig.InvalidConfig.selector);
        config.setLaunchDistributionPool(address(replacementLaunchPool));

        replacementLaunchPool.setClusterPayoutOracle(address(oracle));
        config.setLaunchDistributionPool(address(replacementLaunchPool));
        assertEq(config.launchDistributionPool(), address(replacementLaunchPool));
    }

    function test_SetClusterPayoutOracle_RequiresPinnedPublicRatingConsumerAfterRewardDistributorConfigured() public {
        ProtocolConfig config = deployInitializedProtocolConfig(address(this));
        address engine = _newRewardEngine(config);
        address contentRegistry = MockVotingEngineForConfig(engine).registry();
        address distributor = address(new MockRewardDistributorForConfig(engine));
        MockClusterPayoutOracleForConfig mismatchedOracle = new MockClusterPayoutOracleForConfig(address(0));
        MockClusterPayoutOracleForConfig pinnedOracle = new MockClusterPayoutOracleForConfig(address(0));

        config.setRewardDistributor(distributor);

        vm.expectRevert(ProtocolConfig.InvalidConfig.selector);
        config.setClusterPayoutOracle(address(mismatchedOracle));

        pinnedOracle.setPublicRatingConsumer(contentRegistry);
        config.setClusterPayoutOracle(address(pinnedOracle));
        assertEq(config.clusterPayoutOracle(), address(pinnedOracle));
    }

    function test_SetClusterPayoutOracle_RequiresPinnedQuestionRewardConsumersAfterRewardDistributorConfigured()
        public
    {
        ProtocolConfig config = deployInitializedProtocolConfig(address(this));
        (address engine, MockContentRegistryForConfig contentRegistry, MockQuestionRewardPoolEscrowForConfig escrow) =
            _newRewardEngineWithQuestionEscrow(config);
        address distributor = address(new MockRewardDistributorForConfig(engine));
        MockClusterPayoutOracleForConfig oracle = new MockClusterPayoutOracleForConfig(address(0));

        config.setRewardDistributor(distributor);
        oracle.setPublicRatingConsumer(address(contentRegistry));
        oracle.setQuestionRewardConsumer(address(escrow));

        vm.expectRevert(ProtocolConfig.InvalidConfig.selector);
        config.setClusterPayoutOracle(address(oracle));

        oracle.setQuestionBundleRewardConsumer(address(escrow));
        config.setClusterPayoutOracle(address(oracle));
        assertEq(config.clusterPayoutOracle(), address(oracle));
    }

    function test_SetRewardDistributor_RequiresPinnedQuestionRewardConsumersAfterOracleConfigured() public {
        ProtocolConfig config = deployInitializedProtocolConfig(address(this));
        (address engine, MockContentRegistryForConfig contentRegistry, MockQuestionRewardPoolEscrowForConfig escrow) =
            _newRewardEngineWithQuestionEscrow(config);
        address distributor = address(new MockRewardDistributorForConfig(engine));
        MockClusterPayoutOracleForConfig oracle = new MockClusterPayoutOracleForConfig(address(0));

        oracle.setPublicRatingConsumer(address(contentRegistry));
        oracle.setQuestionRewardConsumer(address(escrow));
        config.setClusterPayoutOracle(address(oracle));

        vm.expectRevert(ProtocolConfig.InvalidConfig.selector);
        config.setRewardDistributor(distributor);

        oracle.setQuestionBundleRewardConsumer(address(escrow));
        config.setRewardDistributor(distributor);
        assertTrue(config.isRewardDistributorForEngine(distributor, engine));
    }

    function test_SetClusterPayoutOracle_AllowsRewardDistributorWithZeroQuestionRewardEscrow() public {
        ProtocolConfig config = deployInitializedProtocolConfig(address(this));
        address engine = _newRewardEngine(config);
        address contentRegistry = MockVotingEngineForConfig(engine).registry();
        address distributor = address(new MockRewardDistributorForConfig(engine));
        MockClusterPayoutOracleForConfig oracle = new MockClusterPayoutOracleForConfig(address(0));

        config.setRewardDistributor(distributor);
        oracle.setPublicRatingConsumer(contentRegistry);
        config.setClusterPayoutOracle(address(oracle));

        assertEq(config.clusterPayoutOracle(), address(oracle));
    }

    function test_SetClusterPayoutOracle_AllowsBootstrapBeforeRewardDistributor() public {
        ProtocolConfig config = deployInitializedProtocolConfig(address(this));
        MockClusterPayoutOracleForConfig oracle = new MockClusterPayoutOracleForConfig(address(0));

        config.setClusterPayoutOracle(address(oracle));

        assertEq(config.clusterPayoutOracle(), address(oracle));
    }

    function test_SetAdvisoryVoteRecorder_UpdatesAddressAndEmits() public {
        ProtocolConfig config = deployInitializedProtocolConfig(address(this));
        address advisoryVoteRecorder = address(new MockAdvisoryVoteRecorderForConfig(address(config), false));

        vm.expectEmit(false, false, false, true);
        emit AdvisoryVoteRecorderUpdated(advisoryVoteRecorder);

        config.setAdvisoryVoteRecorder(advisoryVoteRecorder);

        assertEq(config.advisoryVoteRecorder(), advisoryVoteRecorder);
    }

    function test_SetAdvisoryVoteRecorder_RequiresLaunchPoolAuthorization() public {
        ProtocolConfig config = deployInitializedProtocolConfig(address(this));
        MockLaunchDistributionPoolForConfig launchPool = new MockLaunchDistributionPoolForConfig();
        address advisoryVoteRecorder = address(new MockAdvisoryVoteRecorderForConfig(address(config), false));

        config.setLaunchDistributionPool(address(launchPool));

        vm.expectRevert(ProtocolConfig.InvalidConfig.selector);
        config.setAdvisoryVoteRecorder(advisoryVoteRecorder);

        launchPool.setAuthorizedCaller(advisoryVoteRecorder, true);
        config.setAdvisoryVoteRecorder(advisoryVoteRecorder);

        assertEq(config.advisoryVoteRecorder(), advisoryVoteRecorder);
        assertTrue(config.advisoryVoteRecorderAuthorized(advisoryVoteRecorder));
    }

    function test_SetLaunchDistributionPool_RequiresExistingAdvisoryRecorderAuthorization() public {
        ProtocolConfig config = deployInitializedProtocolConfig(address(this));
        MockLaunchDistributionPoolForConfig launchPool = new MockLaunchDistributionPoolForConfig();
        address advisoryVoteRecorder = address(new MockAdvisoryVoteRecorderForConfig(address(config), false));

        config.setAdvisoryVoteRecorder(advisoryVoteRecorder);

        vm.expectRevert(ProtocolConfig.InvalidConfig.selector);
        config.setLaunchDistributionPool(address(launchPool));

        launchPool.setAuthorizedCaller(advisoryVoteRecorder, true);
        config.setLaunchDistributionPool(address(launchPool));

        assertEq(config.launchDistributionPool(), address(launchPool));
    }

    function test_SetAdvisoryVoteRecorder_AllowsEmergencyDisable() public {
        ProtocolConfig config = deployInitializedProtocolConfig(address(this));
        address advisoryVoteRecorder = address(new MockAdvisoryVoteRecorderForConfig(address(config), false));
        config.setAdvisoryVoteRecorder(advisoryVoteRecorder);
        assertTrue(config.advisoryVoteRecorderAuthorized(advisoryVoteRecorder));

        vm.expectEmit(false, false, false, true);
        emit AdvisoryVoteRecorderAuthorizationUpdated(advisoryVoteRecorder, false);
        vm.expectEmit(false, false, false, true);
        emit AdvisoryVoteRecorderUpdated(address(0));

        config.setAdvisoryVoteRecorder(address(0));

        assertEq(config.advisoryVoteRecorder(), address(0));
        assertFalse(config.advisoryVoteRecorderAuthorized(advisoryVoteRecorder));

        vm.expectRevert(ProtocolConfig.InvalidConfig.selector);
        vm.prank(advisoryVoteRecorder);
        config.recordAdvisoryCooldown(1, address(0xBEEF), address(0), bytes32("identity"));
    }

    function test_RevokeAdvisoryVoteRecorder_RemovesCooldownAuthorization() public {
        ProtocolConfig config = deployInitializedProtocolConfig(address(this));
        address firstRecorder = address(new MockAdvisoryVoteRecorderForConfig(address(config), false));
        address secondRecorder = address(new MockAdvisoryVoteRecorderForConfig(address(config), false));
        address voter = address(0xBEEF);

        config.setAdvisoryVoteRecorder(firstRecorder);
        config.setAdvisoryVoteRecorder(secondRecorder);
        assertTrue(config.advisoryVoteRecorderAuthorized(firstRecorder));

        vm.prank(firstRecorder);
        config.recordAdvisoryCooldown(1, voter, address(0), bytes32("identity"));
        assertEq(config.advisoryCooldownTimestamp(1, voter), block.timestamp);

        vm.expectEmit(false, false, false, true);
        emit AdvisoryVoteRecorderAuthorizationUpdated(firstRecorder, false);
        config.revokeAdvisoryVoteRecorder(firstRecorder);
        assertFalse(config.advisoryVoteRecorderAuthorized(firstRecorder));

        vm.expectRevert(ProtocolConfig.InvalidConfig.selector);
        vm.prank(firstRecorder);
        config.recordAdvisoryCooldown(2, voter, address(0), bytes32("identity"));

        vm.prank(secondRecorder);
        config.recordAdvisoryCooldown(2, voter, address(0), bytes32("identity"));
        assertEq(config.advisoryCooldownTimestamp(2, voter), block.timestamp);
    }

    function test_RevokeAdvisoryVoteRecorder_RejectsZeroOrActiveRecorder() public {
        ProtocolConfig config = deployInitializedProtocolConfig(address(this));
        address advisoryVoteRecorder = address(new MockAdvisoryVoteRecorderForConfig(address(config), false));
        config.setAdvisoryVoteRecorder(advisoryVoteRecorder);

        vm.expectRevert(ProtocolConfig.InvalidAddress.selector);
        config.revokeAdvisoryVoteRecorder(address(0));

        vm.expectRevert(ProtocolConfig.InvalidConfig.selector);
        config.revokeAdvisoryVoteRecorder(advisoryVoteRecorder);
    }

    function test_SetAdvisoryVoteRecorder_RejectsNoCodeAddress() public {
        ProtocolConfig config = deployInitializedProtocolConfig(address(this));

        vm.expectRevert(ProtocolConfig.InvalidAddress.selector);
        config.setAdvisoryVoteRecorder(address(0xAD11CE));
    }

    function test_SetAdvisoryVoteRecorder_RejectsWrongProtocolConfig() public {
        ProtocolConfig config = deployInitializedProtocolConfig(address(this));
        address advisoryVoteRecorder = address(new MockAdvisoryVoteRecorderForConfig(address(0xBEEF), false));

        vm.expectRevert(ProtocolConfig.InvalidConfig.selector);
        config.setAdvisoryVoteRecorder(advisoryVoteRecorder);
    }

    function test_SetAdvisoryVoteRecorder_RejectsRegistryMismatchedToEngine() public {
        ProtocolConfig config = deployInitializedProtocolConfig(address(this));
        address engine = address(new MockVotingEngineForConfig(address(config), address(0xCAFE), MOCK_LREP));
        MockAdvisoryVoteRecorderForConfig advisoryVoteRecorder =
            new MockAdvisoryVoteRecorderForConfig(address(config), false);
        advisoryVoteRecorder.setEngineShape(engine, address(0xBEEF));

        vm.expectRevert(ProtocolConfig.InvalidConfig.selector);
        config.setAdvisoryVoteRecorder(address(advisoryVoteRecorder));
    }

    function test_SetAdvisoryVoteRecorder_RejectsConfiguredRewardDistributorEngineMismatch() public {
        ProtocolConfig config = deployInitializedProtocolConfig(address(this));
        address engine = _newRewardEngine(config);
        address distributor = address(new MockRewardDistributorForConfig(engine));
        config.setRewardDistributor(distributor);

        address otherEngine = address(new MockVotingEngineForConfig(address(config), address(this), MOCK_LREP));
        MockAdvisoryVoteRecorderForConfig advisoryVoteRecorder =
            new MockAdvisoryVoteRecorderForConfig(address(config), false);
        advisoryVoteRecorder.setEngineShape(otherEngine, address(this));

        vm.expectRevert(ProtocolConfig.InvalidConfig.selector);
        config.setAdvisoryVoteRecorder(address(advisoryVoteRecorder));
    }

    function test_SetRewardDistributor_RejectsPreconfiguredAdvisoryRecorderEngineMismatch() public {
        ProtocolConfig config = deployInitializedProtocolConfig(address(this));
        address recorderEngine = address(new MockVotingEngineForConfig(address(config), address(this), MOCK_LREP));
        MockAdvisoryVoteRecorderForConfig advisoryVoteRecorder =
            new MockAdvisoryVoteRecorderForConfig(address(config), false);
        advisoryVoteRecorder.setEngineShape(recorderEngine, address(this));
        config.setAdvisoryVoteRecorder(address(advisoryVoteRecorder));

        address distributorEngine = _newRewardEngine(config);
        address distributor = address(new MockRewardDistributorForConfig(distributorEngine));

        vm.expectRevert(ProtocolConfig.InvalidConfig.selector);
        config.setRewardDistributor(distributor);
    }

    function test_SetAdvisoryVoteRecorder_RejectsRevertingProtocolConfig() public {
        ProtocolConfig config = deployInitializedProtocolConfig(address(this));
        address advisoryVoteRecorder = address(new MockAdvisoryVoteRecorderForConfig(address(config), true));

        vm.expectRevert(ProtocolConfig.InvalidConfig.selector);
        config.setAdvisoryVoteRecorder(advisoryVoteRecorder);
    }

    function test_SetAdvisoryVoteRecorder_RejectsIncompleteRecorderInterface() public {
        ProtocolConfig config = deployInitializedProtocolConfig(address(this));
        address advisoryVoteRecorder = address(new MockBrokenAdvisoryVoteRecorderForConfig(address(config)));

        vm.expectRevert(ProtocolConfig.InvalidConfig.selector);
        config.setAdvisoryVoteRecorder(advisoryVoteRecorder);
    }

    function test_InitializeWithDrandConfig_GovernanceCanRecoverTreasuryRoles() public {
        address admin = address(0xA11CE);
        address governance = address(0xB0B);
        address treasuryAuthority = address(0xCAFE);
        address newTreasuryOperator = address(0xDAD);

        ProtocolConfig configImpl = new ProtocolConfig();
        ProtocolConfig config = ProtocolConfig(
            address(
                new ERC1967Proxy(
                    address(configImpl),
                    abi.encodeCall(
                        ProtocolConfig.initializeWithDrandConfig,
                        (
                            admin,
                            governance,
                            treasuryAuthority,
                            QUICKNET_CHAIN_HASH,
                            QUICKNET_TEST_GENESIS_TIME,
                            QUICKNET_TEST_PERIOD
                        )
                    )
                )
            )
        );

        assertTrue(config.hasRole(config.DEFAULT_ADMIN_ROLE(), governance));
        assertTrue(config.hasRole(config.TREASURY_ADMIN_ROLE(), governance));
        assertTrue(config.hasRole(config.TREASURY_ADMIN_ROLE(), treasuryAuthority));
        assertTrue(config.hasRole(config.TREASURY_ROLE(), treasuryAuthority));
        assertFalse(config.hasRole(config.TREASURY_ROLE(), governance));
        assertEq(config.getRoleAdmin(config.TREASURY_ROLE()), config.TREASURY_ADMIN_ROLE());
        assertEq(config.getRoleAdmin(config.TREASURY_ADMIN_ROLE()), config.DEFAULT_ADMIN_ROLE());

        bytes32 treasuryRole = config.TREASURY_ROLE();
        bytes32 treasuryAdminRole = config.TREASURY_ADMIN_ROLE();
        vm.prank(governance);
        config.grantRole(treasuryRole, newTreasuryOperator);

        assertTrue(config.hasRole(treasuryRole, newTreasuryOperator));

        vm.startPrank(treasuryAuthority);
        vm.expectRevert();
        config.revokeRole(treasuryAdminRole, governance);
        vm.stopPrank();

        vm.prank(governance);
        config.revokeRole(treasuryAdminRole, governance);
        assertFalse(config.hasRole(treasuryAdminRole, governance));

        vm.prank(governance);
        config.grantRole(treasuryAdminRole, governance);
        assertTrue(config.hasRole(treasuryAdminRole, governance));
    }

    function test_SetDrandConfig_UpdatesStateAndEmits() public {
        ProtocolConfig config = deployInitializedProtocolConfig(address(this));

        bytes32 nextHash = bytes32(uint256(1234));
        uint64 nextGenesis = 42;
        uint64 nextPeriod = 9;
        vm.warp(100);

        vm.expectEmit(true, true, true, true);
        emit DrandConfigUpdated(nextHash, nextGenesis, nextPeriod);

        config.setDrandConfig(nextHash, nextGenesis, nextPeriod);

        assertEq(config.drandChainHash(), nextHash);
        assertEq(config.drandGenesisTime(), nextGenesis);
        assertEq(config.drandPeriod(), nextPeriod);
    }

    function test_SetRewardDistributor_RejectsReplacementForSameEngine() public {
        ProtocolConfig config = deployInitializedProtocolConfig(address(this));

        address engine = _newRewardEngine(config);
        address firstDistributor = address(new MockRewardDistributorForConfig(engine));
        address replacementDistributor = address(new MockRewardDistributorForConfig(engine));

        vm.expectEmit(false, false, false, true);
        emit RewardDistributorAuthorizationUpdated(firstDistributor, true);
        vm.expectEmit(false, false, false, true);
        emit RewardDistributorUpdated(firstDistributor);
        config.setRewardDistributor(firstDistributor);
        assertEq(config.rewardDistributor(), firstDistributor);
        assertTrue(config.isRewardDistributor(firstDistributor));
        assertTrue(config.isRewardDistributorForEngine(firstDistributor, engine));

        vm.expectRevert(ProtocolConfig.InvalidConfig.selector);
        config.setRewardDistributor(replacementDistributor);
        assertEq(config.rewardDistributor(), firstDistributor);
        assertTrue(config.isRewardDistributor(firstDistributor));
        assertFalse(config.isRewardDistributor(replacementDistributor));
        assertTrue(config.isRewardDistributorForEngine(firstDistributor, engine));
        assertFalse(config.isRewardDistributorForEngine(replacementDistributor, engine));
    }

    function test_SetRewardDistributor_RequiresLaunchPoolAuthorizationAndSource() public {
        ProtocolConfig config = deployInitializedProtocolConfig(address(this));

        address engine = _newRewardEngine(config);
        address distributor = address(new MockRewardDistributorForConfig(engine));
        MockLaunchDistributionPoolForConfig launchPool = new MockLaunchDistributionPoolForConfig();

        config.setLaunchDistributionPool(address(launchPool));

        vm.expectRevert(ProtocolConfig.InvalidConfig.selector);
        config.setRewardDistributor(distributor);

        launchPool.setAuthorizedCaller(distributor, true);
        vm.expectRevert(ProtocolConfig.InvalidConfig.selector);
        config.setRewardDistributor(distributor);

        launchPool.setRoundClusterReadyAtSource(address(0xBEEF));
        vm.expectRevert(ProtocolConfig.InvalidConfig.selector);
        config.setRewardDistributor(distributor);

        launchPool.setRoundClusterReadyAtSource(engine);
        config.setRewardDistributor(distributor);

        assertTrue(config.isRewardDistributorForEngine(distributor, engine));
    }

    function test_SetLaunchDistributionPool_RequiresExistingRewardDistributorIntegration() public {
        ProtocolConfig config = deployInitializedProtocolConfig(address(this));

        address engine = _newRewardEngine(config);
        address distributor = address(new MockRewardDistributorForConfig(engine));
        MockLaunchDistributionPoolForConfig launchPool = new MockLaunchDistributionPoolForConfig();

        config.setRewardDistributor(distributor);

        vm.expectRevert(ProtocolConfig.InvalidConfig.selector);
        config.setLaunchDistributionPool(address(launchPool));

        launchPool.setAuthorizedCaller(distributor, true);
        vm.expectRevert(ProtocolConfig.InvalidConfig.selector);
        config.setLaunchDistributionPool(address(launchPool));

        launchPool.setRoundClusterReadyAtSource(engine);
        config.setLaunchDistributionPool(address(launchPool));

        assertEq(config.launchDistributionPool(), address(launchPool));
    }

    function test_SetRewardDistributor_RejectsEoa() public {
        ProtocolConfig config = deployInitializedProtocolConfig(address(this));
        address eoaDistributor = address(0xBEEF);

        vm.expectRevert(ProtocolConfig.InvalidAddress.selector);
        config.setRewardDistributor(eoaDistributor);

        assertFalse(config.isRewardDistributor(eoaDistributor));
        assertEq(config.rewardDistributor(), address(0));
    }

    function test_SetRewardDistributor_RejectsMissingVotingEngine() public {
        ProtocolConfig config = deployInitializedProtocolConfig(address(this));
        address distributor = address(new MockRewardDistributorWithoutEngineForConfig());

        vm.expectRevert(ProtocolConfig.InvalidConfig.selector);
        config.setRewardDistributor(distributor);

        assertFalse(config.isRewardDistributor(distributor));
        assertEq(config.rewardDistributor(), address(0));
    }

    function test_SetRewardDistributor_RejectsEngineForDifferentProtocolConfig() public {
        ProtocolConfig config = deployInitializedProtocolConfig(address(this));
        ProtocolConfig otherConfig = deployInitializedProtocolConfig(address(0xBEEF));
        address engine = address(new MockVotingEngineForConfig(address(otherConfig), address(this), MOCK_LREP));
        address distributor = address(new MockRewardDistributorForConfig(engine));

        vm.expectRevert(ProtocolConfig.InvalidConfig.selector);
        config.setRewardDistributor(distributor);

        assertFalse(config.isRewardDistributor(distributor));
        assertEq(config.rewardDistributor(), address(0));
    }

    function test_SetRewardDistributor_RejectsMissingOrStartedClaimAccounting() public {
        ProtocolConfig config = deployInitializedProtocolConfig(address(this));
        address engine = _newRewardEngine(config);
        address missingClaimStateDistributor = address(new MockRewardDistributorWithoutClaimStateForConfig(engine));
        address claimStartedDistributor = address(new MockRewardDistributorWithClaimStateForConfig(engine, true));

        vm.expectRevert(ProtocolConfig.InvalidConfig.selector);
        config.setRewardDistributor(missingClaimStateDistributor);
        vm.expectRevert(ProtocolConfig.InvalidConfig.selector);
        config.setRewardDistributor(claimStartedDistributor);

        assertFalse(config.isRewardDistributor(missingClaimStateDistributor));
        assertFalse(config.isRewardDistributor(claimStartedDistributor));
        assertEq(config.rewardDistributor(), address(0));
    }

    function test_SetRewardDistributor_RejectsRevertingOrZeroVotingEngine() public {
        ProtocolConfig config = deployInitializedProtocolConfig(address(this));
        address revertingDistributor = address(new MockRewardDistributorRevertingEngineForConfig());
        address zeroEngineDistributor = address(new MockRewardDistributorForConfig(address(0)));

        vm.expectRevert(ProtocolConfig.InvalidConfig.selector);
        config.setRewardDistributor(revertingDistributor);
        vm.expectRevert(ProtocolConfig.InvalidConfig.selector);
        config.setRewardDistributor(zeroEngineDistributor);

        assertFalse(config.isRewardDistributor(revertingDistributor));
        assertFalse(config.isRewardDistributor(zeroEngineDistributor));
        assertEq(config.rewardDistributor(), address(0));
    }

    function test_SetRewardDistributor_KeepsPreviousEngineAuthorized() public {
        ProtocolConfig config = deployInitializedProtocolConfig(address(this));

        address firstEngine = _newRewardEngine(config);
        address replacementEngine = _newRewardEngine(config);
        address firstDistributor = address(new MockRewardDistributorForConfig(firstEngine));
        address replacementDistributor = address(new MockRewardDistributorForConfig(replacementEngine));

        config.setRewardDistributor(firstDistributor);
        config.setRewardDistributor(replacementDistributor);

        assertEq(config.rewardDistributor(), replacementDistributor);
        assertTrue(config.isRewardDistributor(firstDistributor));
        assertTrue(config.isRewardDistributor(replacementDistributor));
        assertTrue(config.isRewardDistributorForEngine(firstDistributor, firstEngine));
        assertTrue(config.isRewardDistributorForEngine(replacementDistributor, replacementEngine));
    }

    function test_RevokeRewardDistributor_RemovesAuthorization() public {
        ProtocolConfig config = deployInitializedProtocolConfig(address(this));
        address distributor = address(new MockRewardDistributorForConfig(_newRewardEngine(config)));
        config.setRewardDistributor(distributor);

        vm.expectEmit(false, false, false, true);
        emit RewardDistributorAuthorizationUpdated(distributor, false);
        config.revokeRewardDistributor(distributor);
        assertFalse(config.isRewardDistributor(distributor));
    }

    function test_RevokeRewardDistributor_KeepsSameEngineReplacementBlocked() public {
        ProtocolConfig config = deployInitializedProtocolConfig(address(this));

        address engine = _newRewardEngine(config);
        address firstDistributor = address(new MockRewardDistributorForConfig(engine));
        address replacementDistributor = address(new MockRewardDistributorForConfig(engine));

        config.setRewardDistributor(firstDistributor);
        assertTrue(config.isRewardDistributorForEngine(firstDistributor, engine));

        config.revokeRewardDistributor(firstDistributor);
        assertFalse(config.isRewardDistributor(firstDistributor));
        assertFalse(config.isRewardDistributorForEngine(firstDistributor, engine));
        assertEq(config.rewardDistributorForVotingEngine(engine), firstDistributor);
        assertEq(config.rewardDistributorVotingEngine(firstDistributor), engine);

        vm.expectRevert(ProtocolConfig.InvalidConfig.selector);
        config.setRewardDistributor(replacementDistributor);
        assertEq(config.rewardDistributor(), firstDistributor);
        assertFalse(config.isRewardDistributor(replacementDistributor));
        assertFalse(config.isRewardDistributorForEngine(replacementDistributor, engine));
    }

    function test_RevokeRewardDistributor_RejectsAfterClaimAccountingStarts() public {
        ProtocolConfig config = deployInitializedProtocolConfig(address(this));

        address engine = _newRewardEngine(config);
        MockRewardDistributorWithClaimStateForConfig distributor =
            new MockRewardDistributorWithClaimStateForConfig(engine, false);

        config.setRewardDistributor(address(distributor));
        distributor.setClaimAccountingStarted(true);

        vm.expectRevert(ProtocolConfig.InvalidConfig.selector);
        config.revokeRewardDistributor(address(distributor));

        assertTrue(config.isRewardDistributor(address(distributor)));
        assertTrue(config.isRewardDistributorForEngine(address(distributor), engine));
    }

    function test_ReplaceRevokedRewardDistributor_AllowsDefaultAdminBeforeClaims() public {
        ProtocolConfig config = deployInitializedProtocolConfig(address(this));

        address engine = _newRewardEngine(config);
        address firstDistributor = address(new MockRewardDistributorWithClaimStateForConfig(engine, false));
        address replacementDistributor = address(new MockRewardDistributorWithClaimStateForConfig(engine, false));

        config.setRewardDistributor(firstDistributor);
        config.revokeRewardDistributor(firstDistributor);

        vm.expectEmit(false, false, false, true);
        emit RewardDistributorAuthorizationUpdated(replacementDistributor, true);
        vm.expectEmit(false, false, false, true);
        emit RewardDistributorUpdated(replacementDistributor);
        vm.expectEmit(true, true, true, true);
        emit RewardDistributorReplaced(firstDistributor, replacementDistributor, engine);
        config.replaceRevokedRewardDistributor(firstDistributor, replacementDistributor);

        assertEq(config.rewardDistributor(), replacementDistributor);
        assertFalse(config.isRewardDistributor(firstDistributor));
        assertTrue(config.isRewardDistributor(replacementDistributor));
        assertEq(config.rewardDistributorForVotingEngine(engine), replacementDistributor);
        assertTrue(config.isRewardDistributorForEngine(replacementDistributor, engine));
    }

    function test_ReplaceRevokedRewardDistributor_RequiresConfiguredLaunchIntegration() public {
        ProtocolConfig config = deployInitializedProtocolConfig(address(this));

        address engine = _newRewardEngine(config);
        address firstDistributor = address(new MockRewardDistributorWithClaimStateForConfig(engine, false));
        address replacementDistributor = address(new MockRewardDistributorWithClaimStateForConfig(engine, false));
        MockFrontendRegistryForConfig frontend = new MockFrontendRegistryForConfig();
        MockLaunchDistributionPoolForConfig launchPool = new MockLaunchDistributionPoolForConfig();

        config.setFrontendRegistry(address(frontend));
        config.setLaunchDistributionPool(address(launchPool));
        launchPool.setRoundClusterReadyAtSource(engine);
        launchPool.setAuthorizedCaller(firstDistributor, true);
        config.setRewardDistributor(firstDistributor);
        config.revokeRewardDistributor(firstDistributor);

        vm.expectRevert(ProtocolConfig.InvalidConfig.selector);
        config.replaceRevokedRewardDistributor(firstDistributor, replacementDistributor);

        launchPool.setAuthorizedCaller(replacementDistributor, true);
        config.replaceRevokedRewardDistributor(firstDistributor, replacementDistributor);

        assertEq(config.rewardDistributor(), replacementDistributor);
        assertTrue(config.isRewardDistributorForEngine(replacementDistributor, engine));
        assertEq(frontend.feeCreditorForEngine(engine), address(0));
    }

    function test_ReplaceRevokedRewardDistributor_RequiresConfiguredQuestionRewardConsumers() public {
        ProtocolConfig config = deployInitializedProtocolConfig(address(this));

        (address engine, MockContentRegistryForConfig contentRegistry, MockQuestionRewardPoolEscrowForConfig escrow) =
            _newRewardEngineWithQuestionEscrow(config);
        address firstDistributor = address(new MockRewardDistributorWithClaimStateForConfig(engine, false));
        address replacementDistributor = address(new MockRewardDistributorWithClaimStateForConfig(engine, false));
        MockClusterPayoutOracleForConfig oracle = new MockClusterPayoutOracleForConfig(address(0));

        oracle.setPublicRatingConsumer(address(contentRegistry));
        oracle.setQuestionRewardConsumer(address(escrow));
        oracle.setQuestionBundleRewardConsumer(address(escrow));
        config.setRewardDistributor(firstDistributor);
        config.setClusterPayoutOracle(address(oracle));
        config.revokeRewardDistributor(firstDistributor);

        oracle.setQuestionBundleRewardConsumer(address(0xBEEF));
        vm.expectRevert(ProtocolConfig.InvalidConfig.selector);
        config.replaceRevokedRewardDistributor(firstDistributor, replacementDistributor);

        oracle.setQuestionBundleRewardConsumer(address(escrow));
        config.replaceRevokedRewardDistributor(firstDistributor, replacementDistributor);

        assertTrue(config.isRewardDistributorForEngine(replacementDistributor, engine));
    }

    function test_ReplaceRevokedRewardDistributor_AllowsRealFrontendRegistryRotationAfterReplacement() public {
        ProtocolConfig config = deployInitializedProtocolConfig(address(this));

        address engine = _newRewardEngine(config);
        address firstDistributor = address(new MockRewardDistributorWithClaimStateForConfig(engine, false));
        address replacementDistributor = address(new MockRewardDistributorWithClaimStateForConfig(engine, false));
        FrontendRegistry frontend = FrontendRegistry(
            address(
                new ERC1967Proxy(
                    address(new FrontendRegistry()),
                    abi.encodeCall(FrontendRegistry.initialize, (address(this), address(this), MOCK_LREP))
                )
            )
        );

        frontend.setVotingEngine(engine);
        config.setFrontendRegistry(address(frontend));
        config.setRewardDistributor(firstDistributor);
        frontend.initializeFeeCreditor(firstDistributor);
        assertEq(frontend.feeCreditorForEngine(engine), firstDistributor);

        config.revokeRewardDistributor(firstDistributor);

        vm.expectRevert("Invalid fee creditor");
        frontend.addFeeCreditor(replacementDistributor);

        config.replaceRevokedRewardDistributor(firstDistributor, replacementDistributor);
        frontend.addFeeCreditor(replacementDistributor);

        assertEq(frontend.feeCreditorForEngine(engine), replacementDistributor);
        assertEq(frontend.feeCreditor(), replacementDistributor);
        assertFalse(frontend.hasRole(frontend.FEE_CREDITOR_ROLE(), firstDistributor));
        assertTrue(frontend.hasRole(frontend.FEE_CREDITOR_ROLE(), replacementDistributor));
    }

    function test_ReplaceRevokedRewardDistributor_RejectsActiveOrClaimStartedDistributor() public {
        ProtocolConfig config = deployInitializedProtocolConfig(address(this));

        address engine = _newRewardEngine(config);
        MockRewardDistributorWithClaimStateForConfig firstDistributorContract =
            new MockRewardDistributorWithClaimStateForConfig(engine, false);
        address firstDistributor = address(firstDistributorContract);
        address replacementDistributor = address(new MockRewardDistributorWithClaimStateForConfig(engine, false));

        config.setRewardDistributor(firstDistributor);
        vm.expectRevert(ProtocolConfig.InvalidConfig.selector);
        config.replaceRevokedRewardDistributor(firstDistributor, replacementDistributor);

        config.revokeRewardDistributor(firstDistributor);
        address claimedNewDistributor = address(new MockRewardDistributorWithClaimStateForConfig(engine, true));

        firstDistributorContract.setClaimAccountingStarted(true);
        vm.expectRevert(ProtocolConfig.InvalidConfig.selector);
        config.replaceRevokedRewardDistributor(firstDistributor, replacementDistributor);

        vm.expectRevert(ProtocolConfig.InvalidConfig.selector);
        config.replaceRevokedRewardDistributor(firstDistributor, claimedNewDistributor);
    }

    function test_ReplaceRevokedRewardDistributor_RejectsWrongEngineOrMissingClaimStateAbi() public {
        ProtocolConfig config = deployInitializedProtocolConfig(address(this));

        address engine = _newRewardEngine(config);
        address firstDistributor = address(new MockRewardDistributorWithClaimStateForConfig(engine, false));
        address differentEngineDistributor =
            address(new MockRewardDistributorWithClaimStateForConfig(_newRewardEngine(config), false));
        address missingClaimStateDistributor = address(new MockRewardDistributorWithoutClaimStateForConfig(engine));

        config.setRewardDistributor(firstDistributor);
        config.revokeRewardDistributor(firstDistributor);

        vm.expectRevert(ProtocolConfig.InvalidConfig.selector);
        config.replaceRevokedRewardDistributor(firstDistributor, differentEngineDistributor);

        vm.expectRevert(ProtocolConfig.InvalidConfig.selector);
        config.replaceRevokedRewardDistributor(firstDistributor, missingClaimStateDistributor);
    }

    function test_ReplaceRevokedRewardDistributor_RequiresDefaultAdmin() public {
        address deployAdmin = address(0xA11CE);
        address governance = address(0xB0B);
        ProtocolConfig config = deployInitializedProtocolConfig(deployAdmin, governance);

        address engine = _newRewardEngine(config);
        address firstDistributor = address(new MockRewardDistributorWithClaimStateForConfig(engine, false));
        address replacementDistributor = address(new MockRewardDistributorWithClaimStateForConfig(engine, false));

        vm.prank(deployAdmin);
        config.setRewardDistributor(firstDistributor);
        vm.prank(deployAdmin);
        config.revokeRewardDistributor(firstDistributor);

        vm.prank(deployAdmin);
        vm.expectRevert();
        config.replaceRevokedRewardDistributor(firstDistributor, replacementDistributor);

        vm.prank(governance);
        config.replaceRevokedRewardDistributor(firstDistributor, replacementDistributor);
        assertTrue(config.isRewardDistributorForEngine(replacementDistributor, engine));
    }

    function test_SetDrandConfig_RejectsZeroHashOrPeriod() public {
        ProtocolConfig config = deployInitializedProtocolConfig(address(this));

        vm.expectRevert(ProtocolConfig.InvalidConfig.selector);
        config.setDrandConfig(bytes32(0), 1, 3);

        vm.expectRevert(ProtocolConfig.InvalidConfig.selector);
        config.setDrandConfig(QUICKNET_CHAIN_HASH, 1, 0);
    }

    function test_SetDrandConfig_RejectsFutureGenesisOrPeriodLongerThanMinEpoch() public {
        ProtocolConfig config = deployInitializedProtocolConfig(address(this));
        vm.warp(100);

        vm.expectRevert(ProtocolConfig.InvalidConfig.selector);
        config.setDrandConfig(QUICKNET_CHAIN_HASH, 101, 3);

        vm.expectRevert(ProtocolConfig.InvalidConfig.selector);
        config.setDrandConfig(QUICKNET_CHAIN_HASH, 1, 20 seconds + 1);
    }

    function test_InitializeWithDrandConfig_RejectsFutureGenesisOrPeriodLongerThanMinEpoch() public {
        vm.warp(100);
        ProtocolConfig configImpl = new ProtocolConfig();

        vm.expectRevert(ProtocolConfig.InvalidConfig.selector);
        new ERC1967Proxy(
            address(configImpl),
            abi.encodeCall(
                ProtocolConfig.initializeWithDrandConfig,
                (address(this), address(this), address(this), QUICKNET_CHAIN_HASH, uint64(101), uint64(3))
            )
        );

        vm.expectRevert(ProtocolConfig.InvalidConfig.selector);
        new ERC1967Proxy(
            address(configImpl),
            abi.encodeCall(
                ProtocolConfig.initializeWithDrandConfig,
                (address(this), address(this), address(this), QUICKNET_CHAIN_HASH, uint64(1), uint64(20 seconds + 1))
            )
        );
    }

    function test_DefaultRatingAndSlashConfig_UseRedeployDefaults() public {
        ProtocolConfig config = deployInitializedProtocolConfig(address(this));

        RatingLib.RatingConfig memory ratingCfg = config.getRatingConfig();
        RatingLib.SlashConfig memory slashCfg = config.getSlashConfig();

        assertEq(ratingCfg.smoothingAlpha, 10e6);
        assertEq(ratingCfg.smoothingBeta, 10e6);
        assertEq(ratingCfg.observationBetaX18, 2e18);
        assertEq(ratingCfg.confidenceMassInitial, 80e6);
        assertEq(ratingCfg.confidenceMassMin, 50e6);
        assertEq(ratingCfg.confidenceMassMax, 500e6);
        assertEq(ratingCfg.confidenceGainBps, 1_500);
        assertEq(ratingCfg.confidenceReopenBps, 2_000);
        assertEq(ratingCfg.surpriseReferenceX18, 8e17);
        assertEq(ratingCfg.maxDeltaLogitX18, 6e17);
        assertEq(ratingCfg.maxAbsLogitX18, 4_595_119_850_134_590_000);
        assertEq(ratingCfg.conservativePenaltyMaxBps, 1_500);
        assertEq(ratingCfg.conservativePenaltyMinBps, 250);

        assertEq(slashCfg.slashThresholdBps, 2_500);
        assertEq(slashCfg.minSlashSettledRounds, 2);
        assertEq(slashCfg.minSlashLowDuration, 7 days);
        assertEq(slashCfg.minSlashEvidence, 200e6);
    }

    function test_SetRatingConfig_UpdatesStateAndEmits() public {
        ProtocolConfig config = deployInitializedProtocolConfig(address(this));

        vm.expectEmit(true, true, true, true);
        emit RatingConfigUpdated(12e6, 8e6, 3e18, 90e6, 60e6, 600e6, 2_000, 1_000, 9e17, 5e17, 4e18, 1_200, 300);

        config.setRatingConfig(12e6, 8e6, 3e18, 90e6, 60e6, 600e6, 2_000, 1_000, 9e17, 5e17, 4e18, 1_200, 300);

        RatingLib.RatingConfig memory ratingCfg = config.getRatingConfig();
        assertEq(ratingCfg.smoothingAlpha, 12e6);
        assertEq(ratingCfg.smoothingBeta, 8e6);
        assertEq(ratingCfg.observationBetaX18, 3e18);
        assertEq(ratingCfg.confidenceMassInitial, 90e6);
        assertEq(ratingCfg.confidenceMassMin, 60e6);
        assertEq(ratingCfg.confidenceMassMax, 600e6);
        assertEq(ratingCfg.confidenceGainBps, 2_000);
        assertEq(ratingCfg.confidenceReopenBps, 1_000);
        assertEq(ratingCfg.surpriseReferenceX18, 9e17);
        assertEq(ratingCfg.maxDeltaLogitX18, 5e17);
        assertEq(ratingCfg.maxAbsLogitX18, 4e18);
        assertEq(ratingCfg.conservativePenaltyMaxBps, 1_200);
        assertEq(ratingCfg.conservativePenaltyMinBps, 300);
    }

    function test_SetRatingConfig_RejectsInvalidBounds() public {
        ProtocolConfig config = deployInitializedProtocolConfig(address(this));

        vm.expectRevert(ProtocolConfig.InvalidConfig.selector);
        config.setRatingConfig(10e6, 10e6, 0, 80e6, 50e6, 500e6, 1_500, 2_000, 8e17, 6e17, 4e18, 1_500, 250);

        vm.expectRevert(ProtocolConfig.InvalidConfig.selector);
        config.setRatingConfig(10e6, 10e6, 2e18, 80e6, 90e6, 500e6, 1_500, 2_000, 8e17, 6e17, 4e18, 1_500, 250);

        vm.expectRevert(ProtocolConfig.InvalidConfig.selector);
        config.setRatingConfig(10e6, 10e6, 2e18, 80e6, 50e6, 500e6, 10_001, 2_000, 8e17, 6e17, 4e18, 1_500, 250);

        vm.expectRevert(ProtocolConfig.InvalidConfig.selector);
        config.setRatingConfig(10e6, 10e6, 2e18, 80e6, 50e6, 500e6, 1_500, 2_000, 0, 6e17, 4e18, 1_500, 250);

        vm.expectRevert(ProtocolConfig.InvalidConfig.selector);
        config.setRatingConfig(10e6, 10e6, 2e18, 80e6, 50e6, 500e6, 1_500, 2_000, 8e17, 5e18, 4e18, 1_500, 250);

        vm.expectRevert(ProtocolConfig.InvalidConfig.selector);
        config.setRatingConfig(10e6, 10e6, 2e18, 80e6, 50e6, 500e6, 1_500, 2_000, 8e17, 6e17, 4e18, 200, 300);
    }

    function test_SetRatingConfig_RejectsOverflowingMathAndStorageInputs() public {
        ProtocolConfig config = deployInitializedProtocolConfig(address(this));

        vm.expectRevert(ProtocolConfig.InvalidConfig.selector);
        config.setRatingConfig(
            uint256(type(uint128).max) + 1, 10e6, 2e18, 80e6, 50e6, 500e6, 1_500, 2_000, 8e17, 6e17, 4e18, 1_500, 250
        );

        vm.expectRevert(ProtocolConfig.InvalidConfig.selector);
        config.setRatingConfig(
            10e6,
            10e6,
            2e18,
            uint256(type(uint128).max) + 1,
            50e6,
            uint256(type(uint128).max) + 1,
            1_500,
            2_000,
            8e17,
            6e17,
            4e18,
            1_500,
            250
        );

        vm.expectRevert(ProtocolConfig.InvalidConfig.selector);
        config.setRatingConfig(
            10e6, 10e6, uint256(type(int256).max) + 1, 80e6, 50e6, 500e6, 1_500, 2_000, 8e17, 6e17, 4e18, 1_500, 250
        );

        vm.expectRevert(ProtocolConfig.InvalidConfig.selector);
        config.setRatingConfig(
            10e6,
            10e6,
            2e18,
            80e6,
            50e6,
            500e6,
            1_500,
            2_000,
            8e17,
            6e17,
            uint256(uint128(type(int128).max)) + 1,
            1_500,
            250
        );
    }

    function test_SetSlashConfig_UpdatesStateAndEmits() public {
        ProtocolConfig config = deployInitializedProtocolConfig(address(this));

        vm.expectEmit(true, true, true, true);
        emit SlashConfigUpdated(2_000, 3, 5 days, 300e6);

        config.setSlashConfig(2_000, 3, 5 days, 300e6);

        RatingLib.SlashConfig memory slashCfg = config.getSlashConfig();
        assertEq(slashCfg.slashThresholdBps, 2_000);
        assertEq(slashCfg.minSlashSettledRounds, 3);
        assertEq(slashCfg.minSlashLowDuration, 5 days);
        assertEq(slashCfg.minSlashEvidence, 300e6);
    }

    function test_SetSlashConfig_RejectsInvalidBounds() public {
        ProtocolConfig config = deployInitializedProtocolConfig(address(this));

        vm.expectRevert(ProtocolConfig.InvalidConfig.selector);
        config.setSlashConfig(0, 2, 7 days, 200e6);

        vm.expectRevert(ProtocolConfig.InvalidConfig.selector);
        config.setSlashConfig(10_000, 2, 7 days, 200e6);

        vm.expectRevert(ProtocolConfig.InvalidConfig.selector);
        config.setSlashConfig(2_500, 0, 7 days, 200e6);

        vm.expectRevert(ProtocolConfig.InvalidConfig.selector);
        config.setSlashConfig(2_500, 2, 0, 200e6);
    }

    function test_SetConfig_RejectsEpochDurationAboveUint32Max() public {
        ProtocolConfig config = deployInitializedProtocolConfig(address(this));

        vm.expectRevert(ProtocolConfig.InvalidConfig.selector);
        config.setConfig(uint256(type(uint32).max) + 1, 30 days, 3, 200);
    }

    function test_DefaultRoundConfigBounds_ExposeCreatorAllowedRange() public {
        ProtocolConfig config = deployInitializedProtocolConfig(address(this));

        ProtocolConfig.RoundConfigBounds memory bounds = config.getRoundConfigBounds();
        assertEq(bounds.minEpochDuration, 20 seconds);
        assertEq(bounds.maxEpochDuration, 30 days);
        assertEq(bounds.minRoundDuration, 20 seconds);
        assertEq(bounds.maxRoundDuration, 60 days);
        assertEq(config.ABSOLUTE_MAX_ROUND_DURATION(), 60 days);
        assertEq(bounds.minSettlementVoters, 3);
        assertEq(bounds.maxSettlementVoters, 100);
        assertEq(bounds.minVoterCap, 3);
        assertEq(bounds.maxVoterCap, 200);
    }

    function test_DefaultRoundConfig_UsesSingleBlindPhaseWindow() public {
        ProtocolConfig config = deployInitializedProtocolConfig(address(this));

        (uint32 epochDuration, uint32 maxDuration, uint16 minVoters, uint16 maxVoters) = config.config();

        assertEq(epochDuration, 20 minutes);
        assertEq(maxDuration, 20 minutes);
        assertEq(minVoters, 3);
        assertEq(maxVoters, 100);
    }

    function test_ValidateRoundConfig_AcceptsGovernedCreatorChoice() public {
        ProtocolConfig config = deployInitializedProtocolConfig(address(this));

        RoundLib.RoundConfig memory roundCfg = config.validateRoundConfig(10 minutes, 10 minutes, 4, 25);

        assertEq(roundCfg.epochDuration, 10 minutes);
        assertEq(roundCfg.maxDuration, 10 minutes);
        assertEq(roundCfg.minVoters, 4);
        assertEq(roundCfg.maxVoters, 25);

        roundCfg = config.validateRoundConfig(2 minutes, 2 minutes, 3, 25);
        assertEq(roundCfg.epochDuration, 2 minutes);
        assertEq(roundCfg.maxDuration, 2 minutes);

        roundCfg = config.validateRoundConfig(3 days, 3 days, 5, 100);
        assertEq(roundCfg.epochDuration, 3 days);
        assertEq(roundCfg.maxDuration, 3 days);

        roundCfg = config.validateRoundConfig(30 days, 30 days, 5, 100);
        assertEq(roundCfg.epochDuration, 30 days);
        assertEq(roundCfg.maxDuration, 30 days);
    }

    function test_ValidateRoundConfig_AcceptsTwentySecondFastRound() public {
        ProtocolConfig config = deployInitializedProtocolConfig(address(this));

        RoundLib.RoundConfig memory roundCfg = config.validateRoundConfig(20 seconds, 20 seconds, 3, 3);

        assertEq(roundCfg.epochDuration, 20 seconds);
        assertEq(roundCfg.maxDuration, 20 seconds);
        assertEq(roundCfg.minVoters, 3);
        assertEq(roundCfg.maxVoters, 3);
    }

    function test_GovernanceCanRatchetDefaultAndMinimumSettlementVoters() public {
        ProtocolConfig config = deployInitializedProtocolConfig(address(this));

        config.setConfig(20 minutes, 20 minutes, 5, 100);
        (,, uint16 minVoters, uint16 maxVoters) = config.config();
        assertEq(minVoters, 5, "default quorum ratchets up");
        assertEq(maxVoters, 100, "default voter cap remains launch-compatible");

        config.setRoundConfigBounds(20 seconds, 30 days, 20 seconds, 60 days, 5, 100, 5, 200);

        ProtocolConfig.RoundConfigBounds memory bounds = config.getRoundConfigBounds();
        assertEq(bounds.minSettlementVoters, 5, "hard creator floor ratchets up");
        assertEq(bounds.minVoterCap, 5, "voter cap floor follows settlement floor");

        vm.expectRevert(ProtocolConfig.InvalidConfig.selector);
        config.validateRoundConfig(20 minutes, 20 minutes, 3, 100);

        RoundLib.RoundConfig memory roundCfg = config.validateRoundConfig(20 minutes, 20 minutes, 5, 100);
        assertEq(roundCfg.minVoters, 5, "new floor remains valid");
    }

    function test_GovernanceCannotRaiseMinimumSettlementVotersPastCurrentDefault() public {
        ProtocolConfig config = deployInitializedProtocolConfig(address(this));

        vm.expectRevert(ProtocolConfig.InvalidConfig.selector);
        config.setRoundConfigBounds(20 seconds, 30 days, 20 seconds, 60 days, 5, 100, 5, 200);
    }

    function test_ValidateRoundConfig_RejectsOutsideGovernanceBounds() public {
        ProtocolConfig config = deployInitializedProtocolConfig(address(this));

        vm.expectRevert(ProtocolConfig.InvalidConfig.selector);
        config.validateRoundConfig(19 seconds, 2 hours, 4, 25);

        vm.expectRevert(ProtocolConfig.InvalidConfig.selector);
        config.validateRoundConfig(31 days, 31 days, 4, 25);

        vm.expectRevert(ProtocolConfig.InvalidConfig.selector);
        config.validateRoundConfig(30 days, 60 days + 1, 4, 25);

        vm.expectRevert(ProtocolConfig.InvalidConfig.selector);
        config.validateRoundConfig(10 minutes, 5 minutes, 4, 25);

        vm.expectRevert(ProtocolConfig.InvalidConfig.selector);
        config.validateRoundConfig(10 minutes, 2 hours, 1, 25);

        vm.expectRevert(ProtocolConfig.InvalidConfig.selector);
        config.validateRoundConfig(10 minutes, 2 hours, 4, 3);
    }

    function test_SetRoundConfigBounds_UpdatesRangeWithoutGlobalRevealGraceFloor() public {
        ProtocolConfig config = deployInitializedProtocolConfig(address(this));

        vm.expectEmit(true, true, true, true);
        emit RoundConfigBoundsUpdated(10 minutes, 2 hours, 10 minutes, 14 days, 3, 50, 3, 200);

        config.setRoundConfigBounds(10 minutes, 2 hours, 10 minutes, 14 days, 3, 50, 3, 200);

        ProtocolConfig.RoundConfigBounds memory bounds = config.getRoundConfigBounds();
        assertEq(bounds.minEpochDuration, 10 minutes);
        assertEq(bounds.maxEpochDuration, 2 hours);
        assertEq(bounds.maxRoundDuration, 14 days);
        assertEq(bounds.maxVoterCap, 200);
        assertEq(config.revealGracePeriod(), 60 minutes);
    }

    function test_SetRoundConfigBounds_RejectsEpochFloorBelowTwentySeconds() public {
        ProtocolConfig config = deployInitializedProtocolConfig(address(this));

        vm.expectRevert(ProtocolConfig.InvalidConfig.selector);
        config.setRoundConfigBounds(19 seconds, 7 days, 20 seconds, 30 days, 3, 100, 3, 200);
    }

    function test_SetConfig_RaisesRevealGraceToDefaultEpochDuration() public {
        ProtocolConfig config = deployInitializedProtocolConfig(address(this));

        config.setConfig(2 hours, 2 hours, 3, 100);

        assertEq(config.revealGracePeriod(), 2 hours);
    }

    function test_SetConfig_RejectsDefaultRoundVoterCapAboveMandatoryRewardCap() public {
        ProtocolConfig config = deployInitializedProtocolConfig(address(this));

        vm.expectRevert(ProtocolConfig.InvalidConfig.selector);
        config.setConfig(20 minutes, 20 minutes, 3, 101);
    }

    function test_SetRoundConfigBounds_RevalidatesStoredDrandPeriod() public {
        ProtocolConfig config = deployInitializedProtocolConfig(address(this));
        vm.warp(100);

        config.setRoundConfigBounds(10 minutes, 60 minutes, 10 minutes, 30 days, 3, 100, 3, 200);
        config.setDrandConfig(QUICKNET_CHAIN_HASH, 1, uint64(10 minutes));

        vm.expectRevert(ProtocolConfig.InvalidConfig.selector);
        config.setRoundConfigBounds(5 minutes, 60 minutes, 5 minutes, 30 days, 3, 100, 3, 200);
    }

    function test_SetRoundConfigBounds_RejectsBoundsThatExcludeCurrentDefault() public {
        ProtocolConfig config = deployInitializedProtocolConfig(address(this));

        vm.expectRevert(ProtocolConfig.InvalidConfig.selector);
        config.setRoundConfigBounds(1 minutes, 7 days, 1 minutes, 10 minutes, 3, 100, 3, 200);
    }

    function test_SetRoundConfigBounds_RejectsBundleIncompatibleMinimumVoterCap() public {
        ProtocolConfig config = deployInitializedProtocolConfig(address(this));

        vm.expectRevert(ProtocolConfig.InvalidConfig.selector);
        config.setRoundConfigBounds(1 minutes, 7 days, 1 minutes, 30 days, 3, 100, 101, 200);
    }

    function test_SetRoundConfigBounds_RejectsAbsoluteMaxRoundDuration() public {
        ProtocolConfig config = deployInitializedProtocolConfig(address(this));

        vm.expectRevert(ProtocolConfig.InvalidConfig.selector);
        config.setRoundConfigBounds(1 minutes, 30 days, 1 minutes, 60 days + 1, 3, 100, 3, 200);
    }

    function test_SetRaterRegistry() public {
        ProtocolConfig config = deployInitializedProtocolConfig(address(this));
        address raterRegistry = address(new MockRaterIdentityRegistry());

        config.setRaterRegistry(raterRegistry);

        assertEq(config.raterRegistry(), raterRegistry);
    }
}
