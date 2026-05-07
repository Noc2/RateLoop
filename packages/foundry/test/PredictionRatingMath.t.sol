// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { Test } from "forge-std/Test.sol";
import { PredictionRatingMath } from "../contracts/libraries/PredictionRatingMath.sol";

contract PredictionRatingMathHarness {
    function weightedContribution(uint16 ratingBps, uint256 weight) external pure returns (uint256) {
        return PredictionRatingMath.weightedContribution(ratingBps, weight);
    }

    function weightedAverageRating(uint256 weightedRatingSum, uint256 totalWeight) external pure returns (uint16) {
        return PredictionRatingMath.weightedAverageRating(weightedRatingSum, totalWeight);
    }

    function leaveOneOutRating(
        uint256 totalWeightedRating,
        uint256 totalWeight,
        uint16 ownPredictionBps,
        uint256 ownWeight
    ) external pure returns (uint16) {
        return PredictionRatingMath.leaveOneOutRating(totalWeightedRating, totalWeight, ownPredictionBps, ownWeight);
    }

    function absoluteErrorBps(uint16 predictionBps, uint16 finalRatingBps) external pure returns (uint16) {
        return PredictionRatingMath.absoluteErrorBps(predictionBps, finalRatingBps);
    }

    function accuracyScoreBps(
        uint16 predictionBps,
        uint16 finalRatingBps,
        uint16 fullCreditToleranceBps,
        uint16 zeroCreditToleranceBps
    ) external pure returns (uint16) {
        return PredictionRatingMath.accuracyScoreBps(
            predictionBps, finalRatingBps, fullCreditToleranceBps, zeroCreditToleranceBps
        );
    }
}

contract PredictionRatingMathTest is Test {
    PredictionRatingMathHarness internal math;

    function setUp() public {
        math = new PredictionRatingMathHarness();
    }

    function test_WeightedAverageUsesMrepWeight() public view {
        uint256 weightedSum = math.weightedContribution(8_000, 30e6) + math.weightedContribution(5_000, 10e6);

        assertEq(math.weightedAverageRating(weightedSum, 40e6), 7_250);
    }

    function test_WeightedAverageRoundsAndClamps() public view {
        assertEq(math.weightedAverageRating(10_001, 1), 10_000);
        assertEq(math.weightedAverageRating(10_001, 2), 5_001);
        assertEq(math.weightedAverageRating(0, 0), 0);
    }

    function test_LeaveOneOutUsesPeerRatingWhenPeersExist() public view {
        uint256 weightedSum = math.weightedContribution(8_000, 30e6) + math.weightedContribution(5_000, 10e6);

        assertEq(math.leaveOneOutRating(weightedSum, 40e6, 8_000, 30e6), 5_000);
        assertEq(math.leaveOneOutRating(weightedSum, 40e6, 5_000, 10e6), 8_000);
    }

    function test_LeaveOneOutFallsBackToFinalRatingForSingleRater() public view {
        uint256 weightedSum = math.weightedContribution(6_500, 20e6);

        assertEq(math.leaveOneOutRating(weightedSum, 20e6, 6_500, 20e6), 6_500);
    }

    function test_AccuracyScoreGivesFullNearMissAndZeroFarMiss() public view {
        assertEq(math.accuracyScoreBps(7_200, 7_250, 100, 1_000), 10_000);
        assertEq(math.accuracyScoreBps(6_250, 7_250, 100, 1_000), 0);
        assertEq(math.accuracyScoreBps(6_700, 7_250, 100, 1_000), 5_000);
    }

    function test_InvalidRatingReverts() public {
        vm.expectRevert(PredictionRatingMath.InvalidRating.selector);
        math.weightedContribution(10_001, 1);
    }

    function test_InvalidToleranceReverts() public {
        vm.expectRevert(PredictionRatingMath.InvalidTolerance.selector);
        math.accuracyScoreBps(7_000, 7_000, 1_000, 1_000);
    }
}
