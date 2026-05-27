// SPDX-License-Identifier: MIT
pragma solidity ^0.8.34;

interface IFeedbackRegistry {
    function isAwardableFeedback(uint256 contentId, uint256 roundId, bytes32 commitKey, bytes32 feedbackHash)
        external
        view
        returns (bool);
}
