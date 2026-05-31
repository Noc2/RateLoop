// SPDX-License-Identifier: MIT
pragma solidity ^0.8.34;

import { Test } from "forge-std/Test.sol";
import { ERC1967Proxy } from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import { ProtocolConfig } from "../contracts/ProtocolConfig.sol";
import { RatingLib } from "../contracts/libraries/RatingLib.sol";
import { RoundLib } from "../contracts/libraries/RoundLib.sol";
import { MockRaterIdentityRegistry } from "./mocks/MockRaterIdentityRegistry.sol";
import { MockCategoryRegistry } from "../contracts/mocks/MockCategoryRegistry.sol";
import { deployInitializedProtocolConfig } from "./helpers/VotingTestHelpers.sol";

contract MockRewardDistributorForConfig {
    address public votingEngine;

    constructor(address votingEngine_) {
        votingEngine = votingEngine_;
    }
}

contract MockRewardDistributorWithoutEngineForConfig { }

contract MockRewardDistributorRevertingEngineForConfig {
    function votingEngine() external pure returns (address) {
        revert("mock engine revert");
    }
}

contract MockFrontendRegistryForConfig {
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
    function launchAnchorCredentialAgeSeconds() external pure returns (uint32) {
        return 1 days;
    }
}

contract MockClusterPayoutOracleForConfig {
    address internal launchConsumer;

    constructor(address launchConsumer_) {
        launchConsumer = launchConsumer_;
    }

    function setLaunchConsumer(address launchConsumer_) external {
        launchConsumer = launchConsumer_;
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
        if (domain == 2) return launchConsumer;
        return address(0);
    }
}

contract WeakRaterRegistryForConfig {
    function addressIdentityKey(address account) external pure returns (bytes32) {
        if (account == address(0)) return bytes32(0);
        return bytes32(uint256(1));
    }
}

contract MockAdvisoryVoteRecorderForConfig {
    address internal recorderProtocolConfig;
    bool internal revertProtocolConfig;

    constructor(address protocolConfig_, bool revertProtocolConfig_) {
        recorderProtocolConfig = protocolConfig_;
        revertProtocolConfig = revertProtocolConfig_;
    }

    function protocolConfig() external view returns (address) {
        if (revertProtocolConfig) revert("mock protocol config");
        return recorderProtocolConfig;
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

contract ProtocolConfigBranchesTest is Test {
    bytes32 internal constant QUICKNET_CHAIN_HASH = 0x52db9ba70e0cc0f6eaf7803dd07447a1f5477735fd3f661792ba94600c84e971;

    event DrandConfigUpdated(bytes32 drandChainHash, uint64 genesisTime, uint64 period);
    event RewardDistributorUpdated(address rewardDistributor);
    event RewardDistributorAuthorizationUpdated(address rewardDistributor, bool authorized);
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

    function test_DefaultDrandConfig_UsesQuicknetValues() public {
        ProtocolConfig config = deployInitializedProtocolConfig(address(this));

        assertEq(config.drandChainHash(), QUICKNET_CHAIN_HASH);
        assertEq(config.drandGenesisTime(), 1_692_803_367);
        assertEq(config.drandPeriod(), 3);
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
        config.setLaunchDistributionPool(address(launchPool));
        assertEq(config.launchDistributionPool(), address(launchPool));
    }

    function test_SetLaunchDistributionPool_RejectsRotationUntilOracleConsumerMoves() public {
        ProtocolConfig config = deployInitializedProtocolConfig(address(this));
        MockLaunchDistributionPoolForConfig launchPool = new MockLaunchDistributionPoolForConfig();
        MockLaunchDistributionPoolForConfig replacementLaunchPool = new MockLaunchDistributionPoolForConfig();
        MockClusterPayoutOracleForConfig oracle = new MockClusterPayoutOracleForConfig(address(launchPool));

        config.setClusterPayoutOracle(address(oracle));
        config.setLaunchDistributionPool(address(launchPool));

        vm.expectRevert(ProtocolConfig.InvalidConfig.selector);
        config.setLaunchDistributionPool(address(replacementLaunchPool));

        oracle.setLaunchConsumer(address(replacementLaunchPool));
        config.setLaunchDistributionPool(address(replacementLaunchPool));
        assertEq(config.launchDistributionPool(), address(replacementLaunchPool));
    }

    function test_SetAdvisoryVoteRecorder_UpdatesAddressAndEmits() public {
        ProtocolConfig config = deployInitializedProtocolConfig(address(this));
        address advisoryVoteRecorder = address(new MockAdvisoryVoteRecorderForConfig(address(config), false));

        vm.expectEmit(false, false, false, true);
        emit AdvisoryVoteRecorderUpdated(advisoryVoteRecorder);

        config.setAdvisoryVoteRecorder(advisoryVoteRecorder);

        assertEq(config.advisoryVoteRecorder(), advisoryVoteRecorder);
    }

    function test_SetAdvisoryVoteRecorder_AllowsEmergencyDisable() public {
        ProtocolConfig config = deployInitializedProtocolConfig(address(this));
        address advisoryVoteRecorder = address(new MockAdvisoryVoteRecorderForConfig(address(config), false));
        config.setAdvisoryVoteRecorder(advisoryVoteRecorder);

        vm.expectEmit(false, false, false, true);
        emit AdvisoryVoteRecorderUpdated(address(0));

        config.setAdvisoryVoteRecorder(address(0));

        assertEq(config.advisoryVoteRecorder(), address(0));
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

    function test_InitializeWithTreasury_GovernanceCanRecoverTreasuryRoles() public {
        address admin = address(0xA11CE);
        address governance = address(0xB0B);
        address treasuryAuthority = address(0xCAFE);
        address newTreasuryOperator = address(0xDAD);

        ProtocolConfig configImpl = new ProtocolConfig();
        ProtocolConfig config = ProtocolConfig(
            address(
                new ERC1967Proxy(
                    address(configImpl),
                    abi.encodeCall(ProtocolConfig.initializeWithTreasury, (admin, governance, treasuryAuthority))
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

        address engine = address(0xE641);
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

        address firstEngine = address(0xE641);
        address replacementEngine = address(0xE642);
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
        address distributor = address(new MockRewardDistributorForConfig(address(0xE641)));
        config.setRewardDistributor(distributor);

        vm.expectEmit(false, false, false, true);
        emit RewardDistributorAuthorizationUpdated(distributor, false);
        config.revokeRewardDistributor(distributor);
        assertFalse(config.isRewardDistributor(distributor));
    }

    function test_RevokeRewardDistributor_KeepsSameEngineReplacementBlocked() public {
        ProtocolConfig config = deployInitializedProtocolConfig(address(this));

        address engine = address(0xE641);
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
        config.setDrandConfig(QUICKNET_CHAIN_HASH, 1, 1 minutes + 1);
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
                (address(this), address(this), address(this), QUICKNET_CHAIN_HASH, uint64(1), uint64(1 minutes + 1))
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
        assertEq(bounds.minEpochDuration, 1 minutes);
        assertEq(bounds.maxEpochDuration, 30 days);
        assertEq(bounds.minRoundDuration, 1 minutes);
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

        RoundLib.RoundConfig memory roundCfg = config.validateRoundConfig(10 minutes, 2 hours, 4, 25);

        assertEq(roundCfg.epochDuration, 10 minutes);
        assertEq(roundCfg.maxDuration, 2 hours);
        assertEq(roundCfg.minVoters, 4);
        assertEq(roundCfg.maxVoters, 25);

        roundCfg = config.validateRoundConfig(2 minutes, 2 minutes, 3, 25);
        assertEq(roundCfg.epochDuration, 2 minutes);
        assertEq(roundCfg.maxDuration, 2 minutes);

        roundCfg = config.validateRoundConfig(3 days, 3 days, 5, 100);
        assertEq(roundCfg.epochDuration, 3 days);
        assertEq(roundCfg.maxDuration, 3 days);

        roundCfg = config.validateRoundConfig(30 days, 60 days, 5, 100);
        assertEq(roundCfg.epochDuration, 30 days);
        assertEq(roundCfg.maxDuration, 60 days);
    }

    function test_ValidateRoundConfig_RejectsOutsideGovernanceBounds() public {
        ProtocolConfig config = deployInitializedProtocolConfig(address(this));

        vm.expectRevert(ProtocolConfig.InvalidConfig.selector);
        config.validateRoundConfig(30 seconds, 2 hours, 4, 25);

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
