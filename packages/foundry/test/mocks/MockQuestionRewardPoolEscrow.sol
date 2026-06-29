// SPDX-License-Identifier: MIT
pragma solidity ^0.8.34;

contract MockQuestionRewardPoolEscrow {
    address public registry;
    address public votingEngine;

    /// @dev I-Identity-A: the registry validates this config shape before wiring the mock.
    uint16 public defaultFrontendFeeBps = 300;
    uint256 public nextRewardPoolId = 1;
    uint256 public lastContentId;
    address public lastFunder;
    uint8 public lastAsset;
    uint256 public lastAmount;
    uint256 public lastRequiredVoters;
    uint256 public lastRequiredSettledRounds;
    uint256 public lastBountyStartBy;
    uint256 public lastBountyWindowSeconds;
    uint256 public lastFeedbackWindowSeconds;
    uint8 public lastBountyEligibility;

    event MockSubmissionRewardPoolCreated(
        uint256 indexed rewardPoolId,
        uint256 indexed contentId,
        address funder,
        uint256 requiredVoters,
        uint256 requiredSettledRounds,
        uint256 bountyStartBy,
        uint256 bountyWindowSeconds,
        uint256 feedbackWindowSeconds
    );

    event MockSubmissionBundleCreated(
        uint256 indexed rewardPoolId,
        uint256 indexed bundleId,
        address funder,
        uint256 requiredCompleters,
        uint256 requiredSettledRounds,
        uint256 bountyStartBy,
        uint256 bountyWindowSeconds,
        uint256 feedbackWindowSeconds
    );

    function setConfigShape(address registry_, address votingEngine_) external {
        registry = registry_;
        votingEngine = votingEngine_;
    }

    function questionRewardPoolEscrowConfigShape() external view returns (address registry_, address votingEngine_) {
        return (registry, votingEngine);
    }

    function supportsRoundPayoutSnapshotDomain(uint8 domain) external pure returns (bool) {
        return domain == 1 || domain == 4;
    }

    function createSubmissionRewardPoolFromRegistry(
        uint256 contentId,
        address funder,
        address,
        /* payer */
        uint8 asset,
        uint256 amount,
        uint256 requiredVoters,
        uint256 rewardClosesAt,
        uint256 questionDurationSeconds,
        uint8 bountyEligibility
    ) external returns (uint256 rewardPoolId) {
        rewardPoolId = nextRewardPoolId++;
        lastContentId = contentId;
        lastFunder = funder;
        lastAsset = asset;
        lastAmount = amount;
        lastRequiredVoters = requiredVoters;
        lastRequiredSettledRounds = 1;
        lastBountyStartBy = rewardClosesAt;
        lastBountyWindowSeconds = questionDurationSeconds;
        lastFeedbackWindowSeconds = questionDurationSeconds;
        lastBountyEligibility = bountyEligibility;
        emit MockSubmissionRewardPoolCreated(
            rewardPoolId,
            contentId,
            funder,
            requiredVoters,
            1,
            rewardClosesAt,
            questionDurationSeconds,
            questionDurationSeconds
        );
    }

    function createSubmissionBundleFromRegistry(
        uint256 bundleId,
        uint256[] calldata,
        address funder,
        uint8 asset,
        uint256 amount,
        uint256 requiredCompleters,
        uint256 rewardClosesAt,
        uint256 questionDurationSeconds,
        uint8 bountyEligibility
    ) external returns (uint256 rewardPoolId) {
        rewardPoolId = nextRewardPoolId++;
        lastContentId = bundleId;
        lastFunder = funder;
        lastAsset = asset;
        lastAmount = amount;
        lastRequiredVoters = requiredCompleters;
        lastRequiredSettledRounds = 1;
        lastBountyStartBy = rewardClosesAt;
        lastBountyWindowSeconds = questionDurationSeconds;
        lastFeedbackWindowSeconds = questionDurationSeconds;
        lastBountyEligibility = bountyEligibility;
        emit MockSubmissionBundleCreated(
            rewardPoolId,
            bundleId,
            funder,
            requiredCompleters,
            1,
            rewardClosesAt,
            questionDurationSeconds,
            questionDurationSeconds
        );
    }
}
