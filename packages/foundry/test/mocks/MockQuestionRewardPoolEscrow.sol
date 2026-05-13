// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract MockQuestionRewardPoolEscrow {
    uint256 public nextRewardPoolId = 1;
    uint256 public lastContentId;
    address public lastFunder;
    uint8 public lastAsset;
    uint256 public lastAmount;
    uint256 public lastRequiredVoters;
    uint256 public lastRequiredSettledRounds;
    uint256 public lastBountyClosesAt;
    uint256 public lastFeedbackClosesAt;
    uint8 public lastBountyEligibility;
    bytes32[] public lastEligibleAiDeclarationIds;

    event MockSubmissionRewardPoolCreated(
        uint256 indexed rewardPoolId,
        uint256 indexed contentId,
        address funder,
        uint256 requiredVoters,
        uint256 requiredSettledRounds,
        uint256 bountyClosesAt,
        uint256 feedbackClosesAt
    );

    event MockSubmissionBundleCreated(
        uint256 indexed rewardPoolId,
        uint256 indexed bundleId,
        address funder,
        uint256 requiredCompleters,
        uint256 requiredSettledRounds,
        uint256 bountyClosesAt,
        uint256 feedbackClosesAt
    );

    function createSubmissionRewardPoolFromRegistry(
        uint256 contentId,
        address funder,
        address,
        /* payer */
        uint8 asset,
        uint256 amount,
        uint256 requiredVoters,
        uint256 requiredSettledRounds,
        uint256 bountyClosesAt,
        uint256 feedbackClosesAt,
        uint8 bountyEligibility,
        bytes32[] calldata eligibleAiDeclarationIds
    ) external returns (uint256 rewardPoolId) {
        rewardPoolId = nextRewardPoolId++;
        lastContentId = contentId;
        lastFunder = funder;
        lastAsset = asset;
        lastAmount = amount;
        lastRequiredVoters = requiredVoters;
        lastRequiredSettledRounds = requiredSettledRounds;
        lastBountyClosesAt = bountyClosesAt;
        lastFeedbackClosesAt = feedbackClosesAt;
        _storeEligibility(bountyEligibility, eligibleAiDeclarationIds);
        emit MockSubmissionRewardPoolCreated(
            rewardPoolId, contentId, funder, requiredVoters, requiredSettledRounds, bountyClosesAt, feedbackClosesAt
        );
    }

    function createSubmissionBundleFromRegistry(
        uint256 bundleId,
        uint256[] calldata,
        address funder,
        uint8 asset,
        uint256 amount,
        uint256 requiredCompleters,
        uint256 requiredSettledRounds,
        uint256 bountyClosesAt,
        uint256 feedbackClosesAt,
        uint8 bountyEligibility,
        bytes32[] calldata eligibleAiDeclarationIds
    ) external returns (uint256 rewardPoolId) {
        rewardPoolId = nextRewardPoolId++;
        lastContentId = bundleId;
        lastFunder = funder;
        lastAsset = asset;
        lastAmount = amount;
        lastRequiredVoters = requiredCompleters;
        lastRequiredSettledRounds = requiredSettledRounds;
        lastBountyClosesAt = bountyClosesAt;
        lastFeedbackClosesAt = feedbackClosesAt;
        _storeEligibility(bountyEligibility, eligibleAiDeclarationIds);
        emit MockSubmissionBundleCreated(
            rewardPoolId, bundleId, funder, requiredCompleters, requiredSettledRounds, bountyClosesAt, feedbackClosesAt
        );
    }

    function _storeEligibility(uint8 bountyEligibility, bytes32[] calldata eligibleAiDeclarationIds) private {
        lastBountyEligibility = bountyEligibility;
        delete lastEligibleAiDeclarationIds;
        for (uint256 i = 0; i < eligibleAiDeclarationIds.length; i++) {
            lastEligibleAiDeclarationIds.push(eligibleAiDeclarationIds[i]);
        }
    }
}
