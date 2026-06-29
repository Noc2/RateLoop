// SPDX-License-Identifier: MIT
pragma solidity ^0.8.34;

import {Test} from "forge-std/Test.sol";
import {ContentRegistryRewardLib} from "../contracts/libraries/ContentRegistryRewardLib.sol";
import {QuestionRewardParticipantFloorLib} from "../contracts/libraries/QuestionRewardParticipantFloorLib.sol";

contract QuestionRewardParticipantFloorHarness {
    function requiredParticipantFloorForAmount(uint256 amount) external pure returns (uint256) {
        return QuestionRewardParticipantFloorLib.requiredParticipantFloorForAmount(amount);
    }

    function validateSubmissionReward(uint256 amount, uint256 requiredVoters) external pure {
        ContentRegistryRewardLib.validateSubmissionReward(1, amount, requiredVoters, 0, 1_000);
    }
}

contract QuestionRewardParticipantFloorTest is Test {
    QuestionRewardParticipantFloorHarness internal harness;

    function setUp() public {
        harness = new QuestionRewardParticipantFloorHarness();
    }

    function test_RequiredParticipantFloor_TiersByAmount() public view {
        assertEq(harness.requiredParticipantFloorForAmount(999_999_999), 3, "small floor");
        assertEq(harness.requiredParticipantFloorForAmount(1_000e6), 5, "high-value floor");
        assertEq(harness.requiredParticipantFloorForAmount(9_999_999_999), 5, "high-value band");
        assertEq(harness.requiredParticipantFloorForAmount(10_000e6), 8, "very-high-value floor");
    }

    function test_SubmissionReward_RejectsVeryHighValueBelowEconomicFloor() public {
        vm.expectRevert("High-value floor");
        harness.validateSubmissionReward(10_000e6, 5);
    }

    function test_SubmissionReward_AcceptsVeryHighValueAtEconomicFloor() public view {
        harness.validateSubmissionReward(10_000e6, 8);
    }
}
