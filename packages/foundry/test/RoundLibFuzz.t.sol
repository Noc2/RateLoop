// SPDX-License-Identifier: MIT
pragma solidity ^0.8.34;

import { Test } from "forge-std/Test.sol";
import { RoundLib } from "../contracts/libraries/RoundLib.sol";

/// @title RoundLibHarness
/// @notice Exposes RoundLib internal storage functions for fuzz testing.
contract RoundLibHarness {
    using RoundLib for RoundLib.Commit;
    using RoundLib for RoundLib.Round;

    RoundLib.Commit public commit;
    RoundLib.Round public round;

    function setCommit(uint256 stakeAmount, uint8 epochIndex) external {
        commit.stakeAmount = uint64(stakeAmount);
        commit.epochIndex = epochIndex;
    }

    function getEffectiveStake() external view returns (uint256) {
        return commit.effectiveStake();
    }

    function setRound(uint256 startTime) external {
        round.startTime = uint48(startTime);
        round.state = RoundLib.RoundState.Open;
    }

    function getComputeEpochIndex(uint256 epochDuration, uint256 commitTimestamp) external view returns (uint8) {
        return round.computeEpochIndex(epochDuration, commitTimestamp);
    }
}

/// @title RoundLibFuzz
/// @notice Fuzz tests for RoundLib epoch weight and effective stake logic.
contract RoundLibFuzz is Test {
    RoundLibHarness public harness;

    function setUp() public {
        harness = new RoundLibHarness();
    }

    // =========================================================================
    // epochWeightBps
    // =========================================================================

    function testFuzz_epochWeightBps_Bounded(uint8 epochIndex) public pure {
        uint256 weight = RoundLib.epochWeightBps(epochIndex);
        assertEq(weight, 10000, "single-epoch protocol keeps all epoch weights at 100%");
    }

    // =========================================================================
    // effectiveStake
    // =========================================================================

    function testFuzz_effectiveStake_Epoch0FullStake(uint256 stakeAmount) public {
        stakeAmount = bound(stakeAmount, 0, type(uint64).max);

        harness.setCommit(stakeAmount, 0);
        uint256 effective = harness.getEffectiveStake();
        assertEq(effective, stakeAmount, "epoch 0 should return full stake");
    }

    function testFuzz_effectiveStake_NonzeroEpochStillFullStake(uint256 stakeAmount, uint8 epochIndex) public {
        stakeAmount = bound(stakeAmount, 0, type(uint64).max);

        vm.assume(epochIndex != 0);
        harness.setCommit(stakeAmount, epochIndex);
        uint256 effective = harness.getEffectiveStake();
        assertEq(effective, stakeAmount, "future epoch indexes are fenced to full stake until re-enabled");
    }

    // =========================================================================
    // computeEpochIndex monotonicity
    // =========================================================================

    function testFuzz_computeEpochIndex_Monotonic(
        uint256 startTime,
        uint256 epochDuration,
        uint256 offset1,
        uint256 offset2
    ) public {
        startTime = bound(startTime, 1, type(uint48).max / 2);
        epochDuration = bound(epochDuration, 60, 7 days); // reasonable range
        offset1 = bound(offset1, 0, 30 days);
        offset2 = bound(offset2, offset1, 30 days);

        harness.setRound(startTime);

        uint256 t1 = startTime + offset1;
        uint256 t2 = startTime + offset2;

        uint8 idx1 = harness.getComputeEpochIndex(epochDuration, t1);
        uint8 idx2 = harness.getComputeEpochIndex(epochDuration, t2);

        assertEq(idx1, 0, "current protocol always uses epoch index 0");
        assertEq(idx2, 0, "current protocol always uses epoch index 0");
    }
}
