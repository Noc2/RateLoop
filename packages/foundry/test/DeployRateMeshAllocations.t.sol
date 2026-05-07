// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { Test } from "forge-std/Test.sol";
import { DeployRateMesh } from "../script/Deploy.s.sol";
import { MeshReputation } from "../contracts/MeshReputation.sol";

contract DeployRateMeshAllocationsTest is Test {
    function test_LaunchAllocations_MintFullMrepSupplyAtLaunch() public {
        DeployRateMesh deployScript = new DeployRateMesh();
        MeshReputation mrepToken = new MeshReputation(address(this), address(this));

        uint256 totalLaunchAllocation = deployScript.CONSENSUS_POOL_AMOUNT() + deployScript.TREASURY_AMOUNT()
            + deployScript.PARTICIPATION_POOL_AMOUNT() + deployScript.LAUNCH_DISTRIBUTION_AMOUNT();

        assertEq(deployScript.TOTAL_SUPPLY_CAP(), mrepToken.MAX_SUPPLY(), "script cap should match token MAX_SUPPLY");
        assertEq(totalLaunchAllocation, deployScript.TOTAL_SUPPLY_CAP(), "launch allocations should sum to full cap");
        assertEq(deployScript.LAUNCH_DISTRIBUTION_AMOUNT(), 52_000_000 * 1e6, "launch distribution should be 52M");
        assertEq(deployScript.PARTICIPATION_POOL_AMOUNT(), 12_000_000 * 1e6, "bootstrap pool should be 12M");
        assertEq(deployScript.TREASURY_AMOUNT(), 32_000_000 * 1e6, "treasury should be 32M");
        assertEq(deployScript.CONSENSUS_POOL_AMOUNT(), 4_000_000 * 1e6, "consensus reserve should be 4M");
    }
}
