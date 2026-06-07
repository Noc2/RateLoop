// SPDX-License-Identifier: MIT
pragma solidity ^0.8.34;

import {Test} from "forge-std/Test.sol";
import {TimelockController} from "@openzeppelin/contracts/governance/TimelockController.sol";
import {DeployRateLoop} from "../script/Deploy.s.sol";
import {LaunchDistributionPool} from "../contracts/LaunchDistributionPool.sol";
import {LoopReputation} from "../contracts/LoopReputation.sol";
import {RaterRegistry} from "../contracts/RaterRegistry.sol";
import {MockERC20} from "../contracts/mocks/MockERC20.sol";
import {MockWorldIDVerifier} from "../contracts/mocks/MockWorldIDVerifier.sol";

contract DeployRateLoopHarness is DeployRateLoop {
    function worldIdActionHash(string memory action) external pure returns (uint256) {
        return uint256(keccak256(bytes(action)));
    }

    function resolveWorldIdVerifierCandidate(address verifier, bool requireLiveCode) external view returns (address) {
        return _resolveWorldIdVerifierCandidate(verifier, requireLiveCode);
    }

    function resolveWorldIdDeployConfig(address verifier)
        external
        view
        returns (
            address resolvedVerifier,
            uint64 rpId,
            uint256 credentialAction,
            uint256 presenceAction,
            uint64 credentialTtl,
            uint64 presenceTtl,
            uint64 issuerSchemaId,
            uint256 credentialGenesisIssuedAtMin
        )
    {
        WorldIdDeployConfig memory config = _resolveWorldIdDeployConfig(verifier);
        return (
            config.verifier,
            config.rpId,
            config.credentialAction,
            config.presenceAction,
            config.credentialTtl,
            config.presenceTtl,
            config.issuerSchemaId,
            config.credentialGenesisIssuedAtMin
        );
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
        address feedbackBonusEscrow
    ) external pure returns (address[] memory) {
        return _buildQuorumExcludedHolders(
            launchDistribution,
            rewardDistributor,
            votingEngine,
            treasury,
            contentRegistry,
            frontendRegistry,
            questionRewardPoolEscrow,
            feedbackBonusEscrow
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

    function test_WorldIdVerifierCandidateDisablesMissingBundledVerifier() public {
        DeployRateLoopHarness deployScript = new DeployRateLoopHarness();

        assertEq(deployScript.resolveWorldIdVerifierCandidate(address(0xBEEF), false), address(0));
    }

    function test_WorldIdVerifierCandidateRejectsMissingExplicitOverride() public {
        DeployRateLoopHarness deployScript = new DeployRateLoopHarness();
        address missingVerifier = address(0xBEEF);

        vm.expectRevert(
            abi.encodeWithSelector(DeployRateLoop.WorldIdVerifierOverrideHasNoCode.selector, missingVerifier)
        );
        deployScript.resolveWorldIdVerifierCandidate(missingVerifier, true);
    }

    function test_WorldIdVerifierCandidateAcceptsLiveVerifier() public {
        DeployRateLoopHarness deployScript = new DeployRateLoopHarness();
        MockWorldIDVerifier verifier = new MockWorldIDVerifier();

        assertEq(deployScript.resolveWorldIdVerifierCandidate(address(verifier), false), address(verifier));
        assertEq(deployScript.resolveWorldIdVerifierCandidate(address(verifier), true), address(verifier));
    }

    function test_WorldIdDeployConfigDisablesAllFieldsWithoutVerifier() public {
        DeployRateLoopHarness deployScript = new DeployRateLoopHarness();

        (
            address verifier,
            uint64 rpId,
            uint256 credentialAction,
            uint256 presenceAction,
            uint64 credentialTtl,
            uint64 presenceTtl,
            uint64 issuerSchemaId,
            uint256 credentialGenesisIssuedAtMin
        ) = deployScript.resolveWorldIdDeployConfig(address(0));

        assertEq(verifier, address(0));
        assertEq(rpId, 0);
        assertEq(credentialAction, 0);
        assertEq(presenceAction, 0);
        assertEq(credentialTtl, 0);
        assertEq(presenceTtl, 0);
        assertEq(issuerSchemaId, 0);
        assertEq(credentialGenesisIssuedAtMin, 0);
    }

    function test_WorldIdDeployConfigKeepsConfiguredFieldsWithVerifier() public {
        DeployRateLoopHarness deployScript = new DeployRateLoopHarness();
        MockWorldIDVerifier verifier = new MockWorldIDVerifier();

        (
            address resolvedVerifier,
            uint64 rpId,
            uint256 credentialAction,
            uint256 presenceAction,
            uint64 credentialTtl,
            uint64 presenceTtl,
            uint64 issuerSchemaId,
            uint256 credentialGenesisIssuedAtMin
        ) = deployScript.resolveWorldIdDeployConfig(address(verifier));

        assertEq(resolvedVerifier, address(verifier));
        assertEq(rpId, 1);
        assertEq(credentialAction, uint256(keccak256(bytes("rateloop-human-credential-v1"))));
        assertEq(presenceAction, uint256(keccak256(bytes("rateloop-human-presence-v1"))));
        assertEq(credentialTtl, 365 days);
        assertEq(presenceTtl, 15 minutes);
        assertEq(issuerSchemaId, 1);
        assertEq(credentialGenesisIssuedAtMin, 0);
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
            address(0x1008)
        );

        assertEq(holders.length, 8);
        assertEq(holders[0], address(0x1001));
        assertEq(holders[5], address(0x1006));
        assertEq(holders[6], address(0x1007));
        assertEq(holders[7], address(0x1008));
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
