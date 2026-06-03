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

contract DeployRateLoopHarness is DeployRateLoop {
    function worldIdExternalNullifierHash(string memory appId, string memory action) external pure returns (uint256) {
        return _worldIdExternalNullifierHash(appId, action);
    }

    function validateUsdcToken(address token) external view {
        _validateUsdcToken(token);
    }

    function buildQuorumExcludedHolders(
        address launchDistribution,
        address rewardDistributor,
        address votingEngine,
        address treasury,
        address contentRegistry,
        address frontendRegistry,
        address questionRewardPoolEscrow
    ) external pure returns (address[] memory) {
        return _buildQuorumExcludedHolders(
            launchDistribution,
            rewardDistributor,
            votingEngine,
            treasury,
            contentRegistry,
            frontendRegistry,
            questionRewardPoolEscrow
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
            address(this), address(this), address(new MockWorldIDRouter()), bytes32("rate-loop"), 1, 365 days
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
            address(this), address(this), address(new MockWorldIDRouter()), bytes32("rate-loop"), 1, 365 days
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
            address(this), address(this), address(new MockWorldIDRouter()), bytes32("rate-loop"), 1, 365 days
        );
        LaunchDistributionPool launchPool =
            new LaunchDistributionPool(address(lrepToken), address(raterRegistry), address(deployScript));
        launchPool.transferOwnership(address(deployScript));

        deployScript.activateLegacyContributorRoot(launchPool);

        assertEq(launchPool.legacyContributorRoot(), deployScript.LEGACY_CONTRIBUTOR_ROOT());
        assertEq(launchPool.legacyContributorAllocationTotal(), deployScript.LEGACY_CONTRIBUTOR_ALLOCATION_TOTAL());
        assertEq(launchPool.legacyContributorVestingStart(), block.timestamp);
    }

    function test_WorldIdExternalNullifierHashMatchesLocalConfigVector() public {
        DeployRateLoopHarness deployScript = new DeployRateLoopHarness();

        assertEq(
            deployScript.worldIdExternalNullifierHash("app_staging_rateloop_local", "rateloop-human-credential-v1"),
            253743144824180352641159477734894791954336336003057463640256567965128781153
        );
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

    function test_BuildQuorumExcludedHoldersIncludesQuestionRewardEscrow() public {
        DeployRateLoopHarness deployScript = new DeployRateLoopHarness();

        address[] memory holders = deployScript.buildQuorumExcludedHolders(
            address(0x1001),
            address(0x1002),
            address(0x1003),
            address(0x1004),
            address(0x1005),
            address(0x1006),
            address(0x1007)
        );

        assertEq(holders.length, 7);
        assertEq(holders[0], address(0x1001));
        assertEq(holders[5], address(0x1006));
        assertEq(holders[6], address(0x1007));
    }

    function test_BuildQuorumExcludedHoldersCompactsDuplicatesAndZeroes() public {
        DeployRateLoopHarness deployScript = new DeployRateLoopHarness();

        address[] memory holders = deployScript.buildQuorumExcludedHolders(
            address(0x1001), address(0), address(0x1001), address(0x1004), address(0), address(0x1004), address(0x1007)
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
