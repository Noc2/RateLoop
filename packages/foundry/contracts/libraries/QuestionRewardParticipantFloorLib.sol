// SPDX-License-Identifier: MIT
pragma solidity ^0.8.34;

/// @title QuestionRewardParticipantFloorLib
/// @notice Shared participant floors for question bounty size tiers.
library QuestionRewardParticipantFloorLib {
    uint256 internal constant MIN_REWARD_POOL_PARTICIPANTS = 3;
    uint256 internal constant HIGH_VALUE_REWARD_POOL_THRESHOLD = 1_000e6;
    uint256 internal constant MIN_HIGH_VALUE_PARTICIPANTS = 5;
    uint256 internal constant VERY_HIGH_VALUE_REWARD_POOL_THRESHOLD = 10_000e6;
    uint256 internal constant MIN_VERY_HIGH_VALUE_PARTICIPANTS = 8;

    function requiredParticipantFloorForAmount(uint256 amount) internal pure returns (uint256) {
        if (amount >= VERY_HIGH_VALUE_REWARD_POOL_THRESHOLD) return MIN_VERY_HIGH_VALUE_PARTICIPANTS;
        if (amount >= HIGH_VALUE_REWARD_POOL_THRESHOLD) return MIN_HIGH_VALUE_PARTICIPANTS;
        return MIN_REWARD_POOL_PARTICIPANTS;
    }
}
