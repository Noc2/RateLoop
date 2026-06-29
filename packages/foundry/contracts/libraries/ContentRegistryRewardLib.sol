// SPDX-License-Identifier: MIT
pragma solidity ^0.8.34;

import { QuestionRewardPoolEscrowEligibilityLib } from "./QuestionRewardPoolEscrowEligibilityLib.sol";
import { QuestionRewardParticipantFloorLib } from "./QuestionRewardParticipantFloorLib.sol";
import { ProtocolConfig } from "../ProtocolConfig.sol";

/// @title ContentRegistryRewardLib
/// @notice Submission reward validation extracted from ContentRegistry to keep registry bytecode deployable.
library ContentRegistryRewardLib {
    uint8 internal constant SUBMISSION_REWARD_ASSET_LREP = 0;
    uint8 internal constant SUBMISSION_REWARD_ASSET_USDC = 1;
    uint256 internal constant MIN_SUBMISSION_REWARD_REQUIRED_VOTERS = 3;
    uint256 internal constant MIN_SUBMISSION_REWARD_SETTLED_ROUNDS = 1;
    uint256 internal constant REQUIRED_SUBMISSION_REWARD_SETTLED_ROUNDS = 1;
    uint16 internal constant DEFAULT_MAX_VOTERS = 100;

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
        uint256 questionDuration
    ) external pure {
        require(asset == SUBMISSION_REWARD_ASSET_LREP || asset == SUBMISSION_REWARD_ASSET_USDC, "Invalid reward asset");
        require(amount >= minimumReward, "Reward below minimum");
        require(requiredVoters >= MIN_SUBMISSION_REWARD_REQUIRED_VOTERS, "Too few voters");
        require(
            requiredVoters >= QuestionRewardParticipantFloorLib.requiredParticipantFloorForAmount(amount),
            "High-value floor"
        );
        require(requiredSettledRounds == REQUIRED_SUBMISSION_REWARD_SETTLED_ROUNDS, "One round only");
        require(amount >= requiredSettledRounds * requiredVoters, "Reward too small");
        require(questionDuration != 0 && questionDuration <= type(uint32).max, "Bad duration");
        require(bountyStartBy == 0, "Bad start-by");
        require(bountyWindowSeconds == questionDuration, "Bad bounty window");
        uint256 feedbackWindow = feedbackWindowSeconds == 0 ? questionDuration : feedbackWindowSeconds;
        require(feedbackWindow == questionDuration, "Bad feedback window");
        require(QuestionRewardPoolEscrowEligibilityLib.isValidPolicy(bountyEligibility), "Invalid eligibility");
    }

    function minimumSubmissionReward(
        ProtocolConfig protocolConfig,
        uint8 rewardAsset,
        uint256 defaultMinimum,
        uint256 minSettledRounds,
        uint256 participantUnit
    ) external view returns (uint256 minimum) {
        uint16 maxVoters = DEFAULT_MAX_VOTERS;
        if (address(protocolConfig) != address(0)) {
            minimum = rewardAsset == SUBMISSION_REWARD_ASSET_LREP
                ? protocolConfig.minSubmissionLrepPool()
                : protocolConfig.minSubmissionUsdcPool();
            (,,, maxVoters) = protocolConfig.config();
        }
        if (minimum == 0) minimum = defaultMinimum;
        uint256 maxTurnoutMinimum = uint256(maxVoters) * minSettledRounds * participantUnit;
        return minimum > maxTurnoutMinimum ? minimum : maxTurnoutMinimum;
    }
}
