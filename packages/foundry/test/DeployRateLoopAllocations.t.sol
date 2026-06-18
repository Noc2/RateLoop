// SPDX-License-Identifier: MIT
pragma solidity ^0.8.34;

import { Test } from "forge-std/Test.sol";
import { TimelockController } from "@openzeppelin/contracts/governance/TimelockController.sol";
import { DeployRateLoop } from "../script/Deploy.s.sol";
import { LaunchDistributionPool } from "../contracts/LaunchDistributionPool.sol";
import { LoopReputation } from "../contracts/LoopReputation.sol";
import { RaterRegistry } from "../contracts/RaterRegistry.sol";
import { MockERC20 } from "../contracts/mocks/MockERC20.sol";
import { MockWorldIDRouter } from "../contracts/mocks/MockWorldIDRouter.sol";
import { MockWorldIDVerifier } from "../contracts/mocks/MockWorldIDVerifier.sol";
import { IRaterIdentityRegistry } from "../contracts/interfaces/IRaterIdentityRegistry.sol";

contract DeployRateLoopHarness is DeployRateLoop {
    function worldIdActionHash(string memory action) external pure returns (uint256) {
        return uint256(keccak256(bytes(action)));
    }

    function worldIdExternalNullifierHash(string memory appId, string memory action) external pure returns (uint256) {
        return _worldIdExternalNullifierHash(appId, action);
    }

    function resolveWorldIdRouterAddress(bool isLocalDev) external view returns (address) {
        return _resolveWorldIdRouterAddress(isLocalDev);
    }

    function legacyContributorAccounts() external pure returns (address[9] memory) {
        return _legacyContributorAccounts();
    }

    function legacyContributorHumanAnchor(address account) external pure returns (bytes32) {
        return _legacyContributorHumanAnchor(account);
    }

    function legacyContributorHumanEvidence(address account) external pure returns (bytes32) {
        return _legacyContributorHumanEvidence(account);
    }

    function seedLegacyContributorHumanCredentials(RaterRegistry raterRegistry) external {
        _seedLegacyContributorHumanCredentials(raterRegistry);
    }

    function worldChainMainnetWorldIdRouter() external pure returns (address) {
        return WORLD_CHAIN_MAINNET_WORLD_ID_ROUTER;
    }

    function worldChainSepoliaWorldIdRouter() external pure returns (address) {
        return WORLD_CHAIN_SEPOLIA_WORLD_ID_ROUTER;
    }

    function baseMainnetWorldIdRouter() external pure returns (address) {
        return BASE_MAINNET_WORLD_ID_ROUTER;
    }

    function baseSepoliaWorldIdRouter() external pure returns (address) {
        return BASE_SEPOLIA_WORLD_ID_ROUTER;
    }

    function resolveUsdcAddress() external view returns (address) {
        return _resolveUsdcAddress();
    }

    function resolveDrandConfig() external view returns (bytes32 chainHash, uint64 genesisTime, uint64 period) {
        return _resolveDrandConfig();
    }

    function resolveWorldIdDeployConfig(bool isLocalDev, address router)
        external
        view
        returns (address resolvedRouter, bytes32 scope, uint256 externalNullifierHash, uint64 credentialTtl)
    {
        WorldIdDeployConfig memory config = _resolveWorldIdDeployConfig(isLocalDev, router);
        return (config.router, config.scope, config.externalNullifierHash, config.credentialTtl);
    }

    function validateUsdcToken(address token) external view {
        _validateUsdcToken(token);
    }

    function renounceRaterRegistryDeployerRoles(RaterRegistry raterRegistry, address temporaryDeployer) external {
        _renounceRaterRegistryDeployerRoles(raterRegistry, temporaryDeployer);
    }

    function buildQuorumExcludedHolders(
        address launchDistribution,
        address rewardDistributor,
        address votingEngine,
        address treasury,
        address contentRegistry,
        address frontendRegistry,
        address questionRewardPoolEscrow,
        address feedbackBonusEscrow,
        address confidentialityEscrow
    ) external pure returns (address[] memory) {
        return _buildQuorumExcludedHolders(
            launchDistribution,
            rewardDistributor,
            votingEngine,
            treasury,
            contentRegistry,
            frontendRegistry,
            questionRewardPoolEscrow,
            feedbackBonusEscrow,
            confidentialityEscrow
        );
    }

    function activateLegacyContributorRoot(LaunchDistributionPool launchPool) external {
        _activateLegacyContributorRoot(launchPool);
    }

    function fundLaunchDistributionPool(LoopReputation lrepToken, LaunchDistributionPool launchPool) external {
        _fundLaunchDistributionPool(lrepToken, launchPool);
    }
}

contract RevertingDecimalsToken {
    function decimals() external pure returns (uint8) {
        revert("no decimals");
    }
}

contract DeployRateLoopAllocationsTest is Test {
    function setUp() public {
        vm.setEnv("WORLD_ID_ROUTER_ADDRESS", vm.toString(address(0)));
    }

    function test_LaunchAllocations_MintFullLrepSupplyAtLaunch() public {
        DeployRateLoop deployScript = new DeployRateLoop();
        LoopReputation lrepToken = new LoopReputation(address(this), address(this));
        RaterRegistry raterRegistry = new RaterRegistry(
            address(this),
            address(this),
            address(new MockWorldIDVerifier()),
            42,
            uint256(keccak256("rateloop-human-credential-v4")),
            uint256(keccak256("rateloop-human-presence-v1")),
            365 days,
            15 minutes,
            7,
            0
        );
        LaunchDistributionPool launchPool =
            new LaunchDistributionPool(address(lrepToken), address(raterRegistry), address(this));

        uint256 totalLaunchAllocation = deployScript.TREASURY_AMOUNT() + deployScript.LAUNCH_DISTRIBUTION_AMOUNT();

        assertEq(deployScript.TOTAL_SUPPLY_CAP(), lrepToken.MAX_SUPPLY(), "script cap should match token MAX_SUPPLY");
        assertEq(totalLaunchAllocation, deployScript.TOTAL_SUPPLY_CAP(), "launch allocations should sum to full cap");
        assertEq(deployScript.LAUNCH_DISTRIBUTION_AMOUNT(), 75_000_000 * 1e6, "launch distribution should be 75M");
        assertEq(launchPool.VERIFIED_REFERRAL_POOL_AMOUNT(), 42_000_000 * 1e6, "verified/referral pool should be 42M");
        assertEq(launchPool.EARNED_RATER_POOL_AMOUNT(), 24_000_000 * 1e6, "earned rater pool should be 24M");
        assertEq(launchPool.LEGACY_CONTRIBUTOR_POOL_AMOUNT(), 9_000_000 * 1e6, "legacy pool should be 9M");
        assertEq(
            deployScript.LEGACY_CONTRIBUTOR_ALLOCATION_TOTAL(),
            launchPool.LEGACY_CONTRIBUTOR_POOL_AMOUNT(),
            "legacy manifest total should fill legacy pool"
        );
        assertEq(
            launchPool.TOTAL_POOL_AMOUNT(),
            deployScript.LAUNCH_DISTRIBUTION_AMOUNT(),
            "launch pool split should equal 75M"
        );
        assertEq(deployScript.TREASURY_AMOUNT(), 25_000_000 * 1e6, "treasury should be 25M");
    }

    function test_FundLaunchDistributionPoolMintsDirectlyToPool() public {
        DeployRateLoopHarness deployScript = new DeployRateLoopHarness();
        LoopReputation lrepToken = new LoopReputation(address(deployScript), address(this));
        RaterRegistry raterRegistry = new RaterRegistry(
            address(this),
            address(this),
            address(new MockWorldIDVerifier()),
            42,
            uint256(keccak256("rateloop-human-credential-v4")),
            uint256(keccak256("rateloop-human-presence-v1")),
            365 days,
            15 minutes,
            7,
            0
        );
        LaunchDistributionPool launchPool =
            new LaunchDistributionPool(address(lrepToken), address(raterRegistry), address(deployScript));
        launchPool.transferOwnership(address(deployScript));

        deployScript.fundLaunchDistributionPool(lrepToken, launchPool);

        assertEq(lrepToken.balanceOf(address(launchPool)), deployScript.LAUNCH_DISTRIBUTION_AMOUNT());
        assertEq(launchPool.poolBalance(), deployScript.LAUNCH_DISTRIBUTION_AMOUNT());
        assertEq(lrepToken.balanceOf(address(deployScript)), 0);
        assertEq(lrepToken.allowance(address(deployScript), address(launchPool)), 0);
    }

    function test_SeedLegacyContributorHumanCredentialsMarksManifestAddressesAsHumans() public {
        DeployRateLoopHarness deployScript = new DeployRateLoopHarness();
        RaterRegistry raterRegistry =
            new RaterRegistry(address(deployScript), address(this), address(0), 0, 0, 0, 0, 0, 0, 0);
        raterRegistry.setMaxSeededCredentialTtl(deployScript.LEGACY_CONTRIBUTOR_HUMAN_TTL_SECONDS());

        deployScript.seedLegacyContributorHumanCredentials(raterRegistry);

        address[9] memory legacyAccounts = deployScript.legacyContributorAccounts();
        for (uint256 i = 0; i < legacyAccounts.length; i++) {
            address account = legacyAccounts[i];
            RaterRegistry.HumanCredential memory credential = raterRegistry.getHumanCredential(account);
            IRaterIdentityRegistry.ResolvedRater memory resolved = raterRegistry.resolveRater(account);

            assertTrue(raterRegistry.hasActiveHumanCredential(account));
            assertTrue(resolved.hasActiveHumanCredential);
            assertEq(resolved.holder, account);
            assertEq(credential.verified, true);
            assertEq(credential.revoked, false);
            assertEq(uint256(credential.provider), uint256(RaterRegistry.HumanCredentialProvider.SeededHuman));
            assertEq(credential.nullifierHash, deployScript.legacyContributorHumanAnchor(account));
            assertEq(credential.evidenceHash, deployScript.legacyContributorHumanEvidence(account));
            assertEq(
                credential.expiresAt, uint64(block.timestamp + deployScript.LEGACY_CONTRIBUTOR_HUMAN_TTL_SECONDS())
            );
            assertEq(
                resolved.identityKey,
                raterRegistry.credentialIdentityKey(
                    RaterRegistry.HumanCredentialProvider.SeededHuman, credential.nullifierHash
                )
            );
        }
    }

    function test_ActivateLegacyContributorRootConfiguresGeneratedManifestRoot() public {
        DeployRateLoopHarness deployScript = new DeployRateLoopHarness();
        LoopReputation lrepToken = new LoopReputation(address(this), address(this));
        RaterRegistry raterRegistry = new RaterRegistry(
            address(this),
            address(this),
            address(new MockWorldIDVerifier()),
            42,
            uint256(keccak256("rateloop-human-credential-v4")),
            uint256(keccak256("rateloop-human-presence-v1")),
            365 days,
            15 minutes,
            7,
            0
        );
        LaunchDistributionPool launchPool =
            new LaunchDistributionPool(address(lrepToken), address(raterRegistry), address(deployScript));
        launchPool.transferOwnership(address(deployScript));

        deployScript.activateLegacyContributorRoot(launchPool);

        assertEq(launchPool.legacyContributorRoot(), deployScript.LEGACY_CONTRIBUTOR_ROOT());
        assertEq(launchPool.legacyContributorAllocationTotal(), deployScript.LEGACY_CONTRIBUTOR_ALLOCATION_TOTAL());
        assertEq(launchPool.legacyContributorVestingStart(), block.timestamp);
    }

    function test_WorldIdActionHashMatchesLocalConfigVector() public {
        DeployRateLoopHarness deployScript = new DeployRateLoopHarness();

        assertEq(
            deployScript.worldIdActionHash("rateloop-human-credential-v1"),
            uint256(keccak256(bytes("rateloop-human-credential-v1")))
        );
    }

    function test_WorldIdExternalNullifierHashMatchesLegacyDerivation() public {
        DeployRateLoopHarness deployScript = new DeployRateLoopHarness();
        string memory appId = "app_staging_rateloop";
        string memory action = "rateloop-human-credential-v1";
        uint256 appIdHash = uint256(keccak256(bytes(appId))) >> 8;
        uint256 expected = uint256(keccak256(abi.encodePacked(appIdHash, action))) >> 8;

        assertEq(deployScript.worldIdExternalNullifierHash(appId, action), expected);
    }

    function test_LocalDevDefersWorldIdRouterToMockDeploy() public {
        DeployRateLoopHarness deployScript = new DeployRateLoopHarness();
        vm.chainId(31337);

        assertEq(deployScript.resolveWorldIdRouterAddress(true), address(0));
    }

    function test_WorldChainMainnetRequiresWorldIdRouterCode() public {
        DeployRateLoopHarness deployScript = new DeployRateLoopHarness();
        address router = deployScript.worldChainMainnetWorldIdRouter();
        vm.setEnv("WORLD_ID_ROUTER_ADDRESS", vm.toString(address(0)));
        vm.chainId(480);

        vm.expectRevert(abi.encodeWithSelector(DeployRateLoop.WorldIdRouterHasNoCode.selector, router));
        deployScript.resolveWorldIdRouterAddress(false);
    }

    function test_WorldChainMainnetUsesCanonicalWorldIdRouterWhenCodeExists() public {
        DeployRateLoopHarness deployScript = new DeployRateLoopHarness();
        MockWorldIDRouter routerCode = new MockWorldIDRouter();
        address router = deployScript.worldChainMainnetWorldIdRouter();
        vm.setEnv("WORLD_ID_ROUTER_ADDRESS", vm.toString(address(0)));
        vm.etch(router, address(routerCode).code);
        vm.chainId(480);

        assertEq(deployScript.resolveWorldIdRouterAddress(false), router);
    }

    function test_BaseMainnetUsesCanonicalWorldIdRouterWhenCodeExists() public {
        DeployRateLoopHarness deployScript = new DeployRateLoopHarness();
        MockWorldIDRouter routerCode = new MockWorldIDRouter();
        address router = deployScript.baseMainnetWorldIdRouter();
        vm.setEnv("WORLD_ID_ROUTER_ADDRESS", vm.toString(address(0)));
        vm.etch(router, address(routerCode).code);
        vm.chainId(8453);

        assertEq(deployScript.resolveWorldIdRouterAddress(false), router);
    }

    function test_BaseSepoliaUsesCanonicalWorldIdRouterWhenCodeExists() public {
        DeployRateLoopHarness deployScript = new DeployRateLoopHarness();
        MockWorldIDRouter routerCode = new MockWorldIDRouter();
        address router = deployScript.baseSepoliaWorldIdRouter();
        vm.setEnv("WORLD_ID_ROUTER_ADDRESS", vm.toString(address(0)));
        vm.etch(router, address(routerCode).code);
        vm.chainId(84532);

        assertEq(deployScript.resolveWorldIdRouterAddress(false), router);
    }

    function test_WorldChainSepoliaAcceptsLiveWorldIdRouterOverride() public {
        DeployRateLoopHarness deployScript = new DeployRateLoopHarness();
        MockWorldIDRouter router = new MockWorldIDRouter();
        vm.setEnv("WORLD_ID_ROUTER_ADDRESS", vm.toString(address(router)));
        vm.chainId(4801);

        assertEq(deployScript.resolveWorldIdRouterAddress(false), address(router));
    }

    function test_BaseDeploysResolveCanonicalUsdcAddresses() public {
        DeployRateLoopHarness deployScript = new DeployRateLoopHarness();

        vm.chainId(84532);
        assertEq(deployScript.resolveUsdcAddress(), 0x036CbD53842c5426634e7929541eC2318f3dCF7e);

        vm.chainId(8453);
        assertEq(deployScript.resolveUsdcAddress(), 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913);
    }

    function test_BaseDeploysResolveExpectedDrandNetworks() public {
        DeployRateLoopHarness deployScript = new DeployRateLoopHarness();

        vm.chainId(84532);
        (bytes32 baseSepoliaHash, uint64 baseSepoliaGenesis, uint64 baseSepoliaPeriod) =
            deployScript.resolveDrandConfig();
        assertEq(baseSepoliaHash, 0xcc9c398442737cbd141526600919edd69f1d6f9b4adb67e4d912fbc64341a9a5);
        assertEq(baseSepoliaGenesis, 1_689_232_296);
        assertEq(baseSepoliaPeriod, 3);

        vm.chainId(8453);
        (bytes32 baseMainnetHash, uint64 baseMainnetGenesis, uint64 baseMainnetPeriod) =
            deployScript.resolveDrandConfig();
        assertEq(baseMainnetHash, 0x52db9ba70e0cc0f6eaf7803dd07447a1f5477735fd3f661792ba94600c84e971);
        assertEq(baseMainnetGenesis, 1_692_803_367);
        assertEq(baseMainnetPeriod, 3);
    }

    function test_WorldIdDeployConfigKeepsLegacyRouterScopeAndExternalNullifier() public {
        DeployRateLoopHarness deployScript = new DeployRateLoopHarness();
        MockWorldIDRouter router = new MockWorldIDRouter();
        string memory appId = "app_staging_rateloop";
        string memory action = "rateloop-human-credential-v1";
        vm.setEnv("NEXT_PUBLIC_WORLD_ID_APP_ID", appId);

        (address resolvedRouter, bytes32 scope, uint256 externalNullifierHash, uint64 credentialTtl) =
            deployScript.resolveWorldIdDeployConfig(false, address(router));

        assertEq(resolvedRouter, address(router));
        assertEq(scope, keccak256(bytes(action)));
        assertEq(externalNullifierHash, deployScript.worldIdExternalNullifierHash(appId, action));
        assertEq(credentialTtl, 365 days);
    }

    function test_RaterRegistryDeployHandoffLeavesWorldIdV4ConfigMutable() public {
        DeployRateLoopHarness deployScript = new DeployRateLoopHarness();
        address governance = address(0xBEEF);
        MockWorldIDVerifier initialVerifier = new MockWorldIDVerifier();
        MockWorldIDVerifier correctedVerifier = new MockWorldIDVerifier();
        RaterRegistry raterRegistry = new RaterRegistry(
            address(deployScript),
            governance,
            address(initialVerifier),
            42,
            uint256(keccak256("wrong-credential-action")),
            uint256(keccak256("wrong-presence-action")),
            365 days,
            15 minutes,
            7,
            0
        );

        assertFalse(raterRegistry.worldIdV4VerifierConfigFrozen());
        assertTrue(raterRegistry.hasRole(raterRegistry.ADMIN_ROLE(), address(deployScript)));
        assertTrue(raterRegistry.hasRole(raterRegistry.SEEDER_ROLE(), address(deployScript)));

        deployScript.renounceRaterRegistryDeployerRoles(raterRegistry, address(deployScript));

        assertFalse(raterRegistry.worldIdV4VerifierConfigFrozen());
        assertFalse(raterRegistry.hasRole(raterRegistry.ADMIN_ROLE(), address(deployScript)));
        assertFalse(raterRegistry.hasRole(raterRegistry.SEEDER_ROLE(), address(deployScript)));
        assertTrue(raterRegistry.hasRole(raterRegistry.ADMIN_ROLE(), governance));
        assertTrue(raterRegistry.hasRole(raterRegistry.SEEDER_ROLE(), governance));

        vm.prank(governance);
        raterRegistry.setWorldIdV4VerifierConfig(
            address(correctedVerifier), 43, uint256(keccak256("fixed-action")), 365 days, 8, 11
        );

        assertEq(address(raterRegistry.worldIdV4Verifier()), address(correctedVerifier));
        assertEq(raterRegistry.worldIdV4RpId(), 43);
        assertEq(raterRegistry.worldIdV4Action(), uint256(keccak256("fixed-action")));

        vm.prank(governance);
        raterRegistry.freezeWorldIdV4VerifierConfig();
        assertTrue(raterRegistry.worldIdV4VerifierConfigFrozen());
    }

    function test_ValidateUsdcTokenRequiresCodeAndSixDecimals() public {
        DeployRateLoopHarness deployScript = new DeployRateLoopHarness();
        MockERC20 usdc = new MockERC20("USD Coin", "USDC", 6);
        deployScript.validateUsdcToken(address(usdc));

        vm.expectRevert(bytes("USDC has no code on this chain"));
        deployScript.validateUsdcToken(address(0xBEEF));

        MockERC20 wrongDecimals = new MockERC20("Wrong USD", "USDC18", 18);
        vm.expectRevert(bytes("USDC must use 6 decimals"));
        deployScript.validateUsdcToken(address(wrongDecimals));

        RevertingDecimalsToken broken = new RevertingDecimalsToken();
        vm.expectRevert(bytes("USDC decimals probe failed"));
        deployScript.validateUsdcToken(address(broken));
    }

    function test_BuildQuorumExcludedHoldersIncludesRewardEscrows() public {
        DeployRateLoopHarness deployScript = new DeployRateLoopHarness();

        address[] memory holders = deployScript.buildQuorumExcludedHolders(
            address(0x1001),
            address(0x1002),
            address(0x1003),
            address(0x1004),
            address(0x1005),
            address(0x1006),
            address(0x1007),
            address(0x1008),
            address(0x1009)
        );

        assertEq(holders.length, 9);
        assertEq(holders[0], address(0x1001));
        assertEq(holders[5], address(0x1006));
        assertEq(holders[6], address(0x1007));
        assertEq(holders[7], address(0x1008));
        assertEq(holders[8], address(0x1009));
    }

    function test_BuildQuorumExcludedHoldersCompactsDuplicatesAndZeroes() public {
        DeployRateLoopHarness deployScript = new DeployRateLoopHarness();

        address[] memory holders = deployScript.buildQuorumExcludedHolders(
            address(0x1001),
            address(0),
            address(0x1001),
            address(0x1004),
            address(0),
            address(0x1004),
            address(0x1007),
            address(0x1007),
            address(0x1007)
        );

        assertEq(holders.length, 3);
        assertEq(holders[0], address(0x1001));
        assertEq(holders[1], address(0x1004));
        assertEq(holders[2], address(0x1007));
    }

    function test_GovernanceTimelockRolesStayGovernorOnly() public {
        DeployRateLoopHarness deployScript = new DeployRateLoopHarness();
        address[] memory proposers = new address[](0);
        address[] memory executors = new address[](1);
        executors[0] = address(0);
        TimelockController timelock =
            new TimelockController(deployScript.TIMELOCK_MIN_DELAY(), proposers, executors, address(deployScript));
        address governor = address(0xA11CE);
        address nonGovernor = address(new RevertingDecimalsToken());
        bytes32 proposerRole = timelock.PROPOSER_ROLE();
        bytes32 cancellerRole = timelock.CANCELLER_ROLE();
        bytes32 executorRole = timelock.EXECUTOR_ROLE();
        bytes32 defaultAdminRole = timelock.DEFAULT_ADMIN_ROLE();

        vm.prank(address(deployScript));
        timelock.grantRole(proposerRole, governor);
        vm.prank(address(deployScript));
        timelock.grantRole(cancellerRole, governor);
        vm.prank(address(deployScript));
        timelock.renounceRole(defaultAdminRole, address(deployScript));

        assertTrue(timelock.hasRole(proposerRole, governor));
        assertTrue(timelock.hasRole(cancellerRole, governor));
        assertTrue(timelock.hasRole(executorRole, address(0)));
        assertFalse(timelock.hasRole(proposerRole, nonGovernor));
        assertFalse(timelock.hasRole(cancellerRole, nonGovernor));
        assertFalse(timelock.hasRole(proposerRole, address(0)));
        assertFalse(timelock.hasRole(cancellerRole, address(0)));
        assertFalse(timelock.hasRole(defaultAdminRole, address(deployScript)));
    }
}
