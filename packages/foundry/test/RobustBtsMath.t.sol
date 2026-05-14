// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { Test } from "forge-std/Test.sol";
import { RobustBtsMath } from "../contracts/libraries/RobustBtsMath.sol";

contract RobustBtsMathHarness {
    function shadowPredictionBps(uint16 referencePredictionBps, bool signalIsUp) external pure returns (uint16) {
        return RobustBtsMath.shadowPredictionBps(referencePredictionBps, signalIsUp);
    }

    function quadraticScoreBps(uint16 predictionBps, bool actualIsUp) external pure returns (uint16) {
        return RobustBtsMath.quadraticScoreBps(predictionBps, actualIsUp);
    }

    function scoreBps(bool ownSignalIsUp, uint16 ownPredictionBps, uint16 referencePredictionBps, bool peerSignalIsUp)
        external
        pure
        returns (uint16)
    {
        return RobustBtsMath.scoreBps(ownSignalIsUp, ownPredictionBps, referencePredictionBps, peerSignalIsUp);
    }
}

contract RobustBtsMathTest is Test {
    RobustBtsMathHarness internal math;

    function setUp() public {
        math = new RobustBtsMathHarness();
    }

    function test_ShadowPredictionMovesTowardReportedSignal() public view {
        assertEq(math.shadowPredictionBps(3_000, true), 6_000);
        assertEq(math.shadowPredictionBps(3_000, false), 0);
        assertEq(math.shadowPredictionBps(8_000, true), 10_000);
        assertEq(math.shadowPredictionBps(8_000, false), 6_000);
    }

    function test_QuadraticScoreIsBoundedAndProperAtEndpoints() public view {
        assertEq(math.quadraticScoreBps(10_000, true), 10_000);
        assertEq(math.quadraticScoreBps(0, false), 10_000);
        assertEq(math.quadraticScoreBps(0, true), 0);
        assertEq(math.quadraticScoreBps(10_000, false), 0);
        assertEq(math.quadraticScoreBps(5_000, true), 7_500);
        assertEq(math.quadraticScoreBps(5_000, false), 7_500);
    }

    function test_RbtsScoreAveragesInformationAndPredictionScores() public view {
        uint16 score = math.scoreBps(true, 7_500, 3_000, true);
        assertEq(score, 8_887);
    }

    function test_InvalidPredictionReverts() public {
        vm.expectRevert(RobustBtsMath.InvalidPrediction.selector);
        math.quadraticScoreBps(10_001, true);
    }
}
