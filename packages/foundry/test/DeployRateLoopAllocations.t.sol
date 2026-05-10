// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { Test } from "forge-std/Test.sol";
import { DeployRateLoop } from "../script/Deploy.s.sol";
import { LaunchDistributionPool } from "../contracts/LaunchDistributionPool.sol";
import { LoopReputation } from "../contracts/LoopReputation.sol";

contract DeployRateLoopAllocationsTest is Test {
    function test_LaunchAllocations_MintFullLrepSupplyAtLaunch() public {
        DeployRateLoop deployScript = new DeployRateLoop();
        LoopReputation lrepToken = new LoopReputation(address(this), address(this));
        LaunchDistributionPool launchPool =
            new LaunchDistributionPool(address(lrepToken), address(this), address(this));

        uint256 totalLaunchAllocation = deployScript.CONSENSUS_POOL_AMOUNT() + deployScript.TREASURY_AMOUNT()
            + deployScript.PARTICIPATION_POOL_AMOUNT() + deployScript.LAUNCH_DISTRIBUTION_AMOUNT();

        assertEq(deployScript.TOTAL_SUPPLY_CAP(), lrepToken.MAX_SUPPLY(), "script cap should match token MAX_SUPPLY");
        assertEq(totalLaunchAllocation, deployScript.TOTAL_SUPPLY_CAP(), "launch allocations should sum to full cap");
        assertEq(deployScript.LAUNCH_DISTRIBUTION_AMOUNT(), 52_000_000 * 1e6, "launch distribution should be 52M");
        assertEq(launchPool.LEGACY_POOL_AMOUNT(), 2_000_000 * 1e6, "legacy pool should be 2M");
        assertEq(launchPool.EARNED_RATER_POOL_AMOUNT(), 25_000_000 * 1e6, "earned rater pool should be 25M");
        assertEq(
            launchPool.VERIFIED_REFERRAL_POOL_AMOUNT(),
            25_000_000 * 1e6,
            "verified/referral pool should be 25M"
        );
        assertEq(
            launchPool.TOTAL_POOL_AMOUNT(),
            deployScript.LAUNCH_DISTRIBUTION_AMOUNT(),
            "launch pool split should equal 52M"
        );
        assertEq(deployScript.PARTICIPATION_POOL_AMOUNT(), 12_000_000 * 1e6, "bootstrap pool should be 12M");
        assertEq(deployScript.TREASURY_AMOUNT(), 32_000_000 * 1e6, "treasury should be 32M");
        assertEq(deployScript.CONSENSUS_POOL_AMOUNT(), 4_000_000 * 1e6, "consensus reserve should be 4M");
    }
}
