// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { Test } from "forge-std/Test.sol";
import { DeployRateLoop } from "../script/Deploy.s.sol";
import { LaunchDistributionPool } from "../contracts/LaunchDistributionPool.sol";
import { LoopReputation } from "../contracts/LoopReputation.sol";
import { RaterRegistry } from "../contracts/RaterRegistry.sol";
import { MockWorldIDRouter } from "../contracts/mocks/MockWorldIDRouter.sol";

contract DeployRateLoopHarness is DeployRateLoop {
    function worldIdExternalNullifierHash(string memory appId, string memory action) external pure returns (uint256) {
        return _worldIdExternalNullifierHash(appId, action);
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

        uint256 totalLaunchAllocation = deployScript.TREASURY_AMOUNT() + deployScript.PARTICIPATION_POOL_AMOUNT()
            + deployScript.LAUNCH_DISTRIBUTION_AMOUNT();

        assertEq(deployScript.TOTAL_SUPPLY_CAP(), lrepToken.MAX_SUPPLY(), "script cap should match token MAX_SUPPLY");
        assertEq(totalLaunchAllocation, deployScript.TOTAL_SUPPLY_CAP(), "launch allocations should sum to full cap");
        assertEq(deployScript.LAUNCH_DISTRIBUTION_AMOUNT(), 68_000_000 * 1e6, "launch distribution should be 68M");
        assertEq(launchPool.LEGACY_POOL_AMOUNT(), 4_000_000 * 1e6, "legacy pool should be 4M");
        assertEq(launchPool.EARNED_RATER_POOL_AMOUNT(), 29_000_000 * 1e6, "earned rater pool should be 29M");
        assertEq(launchPool.VERIFIED_REFERRAL_POOL_AMOUNT(), 35_000_000 * 1e6, "verified/referral pool should be 35M");
        assertEq(
            launchPool.TOTAL_POOL_AMOUNT(),
            deployScript.LAUNCH_DISTRIBUTION_AMOUNT(),
            "launch pool split should equal 68M"
        );
        assertEq(deployScript.PARTICIPATION_POOL_AMOUNT(), 0, "participation pool should have no launch allocation");
        assertEq(deployScript.TREASURY_AMOUNT(), 32_000_000 * 1e6, "treasury should be 32M");
    }

    function test_WorldIdExternalNullifierHashMatchesLocalConfigVector() public {
        DeployRateLoopHarness deployScript = new DeployRateLoopHarness();

        assertEq(
            deployScript.worldIdExternalNullifierHash("app_staging_rateloop_local", "rateloop-human-credential-v1"),
            253743144824180352641159477734894791954336336003057463640256567965128781153
        );
    }
}
