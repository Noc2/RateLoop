// SPDX-License-Identifier: MIT
pragma solidity ^0.8.34;

/// @title IRoundVotingSettlement
/// @notice Settlement, terminal-state, and cleanup surface for the round voting engine.
interface IRoundVotingSettlement {
    function settleRound(uint256 contentId, uint256 roundId) external;

    function cancelExpiredRound(uint256 contentId, uint256 roundId) external;

    function finalizeRevealFailedRound(uint256 contentId, uint256 roundId) external;

    function claimCancelledRoundRefund(uint256 contentId, uint256 roundId) external;

    function processUnrevealedVotes(uint256 contentId, uint256 roundId, uint256 startIndex, uint256 count) external;

    function flushPendingTreasuryForfeit() external;

    function replayBundleObserverNotify(uint256 contentId, uint256 roundId) external returns (bool settled);
}
