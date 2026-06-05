// SPDX-License-Identifier: MIT
pragma solidity ^0.8.34;

import { QuestionRewardPoolEscrowEligibilityLib } from "./QuestionRewardPoolEscrowEligibilityLib.sol";

/// @title ContentRegistryRewardLib
/// @notice Submission reward validation extracted from ContentRegistry to keep registry bytecode deployable.
library ContentRegistryRewardLib {
    uint8 internal constant SUBMISSION_REWARD_ASSET_LREP = 0;
    uint8 internal constant SUBMISSION_REWARD_ASSET_USDC = 1;
    uint256 internal constant MIN_SUBMISSION_REWARD_REQUIRED_VOTERS = 3;
    uint256 internal constant MIN_SUBMISSION_REWARD_SETTLED_ROUNDS = 1;
    uint256 internal constant MAX_SUBMISSION_REWARD_SETTLED_ROUNDS = 16;

    function validateSubmissionReward(
        uint8 asset,
        uint256 amount,
        uint256 requiredVoters,
        uint256 requiredSettledRounds,
        uint256 bountyStartBy,
        uint256 bountyWindowSeconds,
        uint256 feedbackWindowSeconds,
        uint8 bountyEligibility,
        uint256 minimumReward,
        uint256 nowTimestamp
    ) external pure {
        require(asset == SUBMISSION_REWARD_ASSET_LREP || asset == SUBMISSION_REWARD_ASSET_USDC, "Invalid reward asset");
        require(amount >= minimumReward, "Reward below minimum");
        require(requiredVoters >= MIN_SUBMISSION_REWARD_REQUIRED_VOTERS, "Too few voters");
        require(requiredSettledRounds >= MIN_SUBMISSION_REWARD_SETTLED_ROUNDS, "Too few rounds");
        require(requiredSettledRounds <= MAX_SUBMISSION_REWARD_SETTLED_ROUNDS, "Too many rounds");
        require(amount >= requiredSettledRounds * requiredVoters, "Reward too small");
        if (bountyWindowSeconds == 0) {
            require(bountyStartBy == 0, "Bad start-by");
            require(feedbackWindowSeconds == 0, "Bad feedback window");
        } else {
            require(bountyStartBy > nowTimestamp, "Bad start-by");
            require(bountyWindowSeconds <= type(uint32).max, "Bad bounty window");
            uint256 feedbackWindow = feedbackWindowSeconds == 0 ? bountyWindowSeconds : feedbackWindowSeconds;
            require(feedbackWindow <= type(uint32).max, "Bad feedback window");
            require(feedbackWindow <= bountyWindowSeconds, "Feedback after bounty");
        }
        require(QuestionRewardPoolEscrowEligibilityLib.isValidPolicy(bountyEligibility), "Invalid eligibility");
    }
}
