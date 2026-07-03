// SPDX-License-Identifier: MIT
pragma solidity ^0.8.34;

import { Test } from "forge-std/Test.sol";
import { RoundLib } from "../contracts/libraries/RoundLib.sol";

/// @title RoundLibHarness
/// @notice Exposes RoundLib internal storage functions for fuzz testing.
contract RoundLibHarness {
    using RoundLib for RoundLib.Round;

    RoundLib.Round public round;

    function setRound(uint256 startTime) external {
        round.startTime = uint48(startTime);
        round.state = RoundLib.RoundState.Open;
    }

    function getComputeEpochEnd(uint256 epochDuration) external view returns (uint256) {
        return round.computeEpochEnd(epochDuration);
    }
}

/// @title RoundLibFuzz
/// @notice Fuzz tests for RoundLib single blind-window timing logic.
contract RoundLibFuzz is Test {
    RoundLibHarness public harness;

    function setUp() public {
        harness = new RoundLibHarness();
    }

    function testFuzz_computeEpochEnd_UsesSingleBlindWindow(uint256 startTime, uint256 epochDuration) public {
        startTime = bound(startTime, 1, type(uint48).max / 2);
        epochDuration = bound(epochDuration, 20 seconds, 30 days);

        harness.setRound(startTime);

        uint256 epochEnd = harness.getComputeEpochEnd(epochDuration);

        assertEq(epochEnd, startTime + epochDuration, "single-window reveal time should be round start + duration");
    }
}
