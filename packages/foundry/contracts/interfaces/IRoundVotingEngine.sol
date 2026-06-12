// SPDX-License-Identifier: MIT
pragma solidity ^0.8.34;

import { RoundLib } from "../libraries/RoundLib.sol";

/// @title IRoundVotingEngine
/// @notice Interface for RoundVotingEngine contract used by ContentRegistry and other contracts.
interface IRoundVotingEngine {
    /// @notice Whether the content item has ever received at least one vote commit.
    function hasCommits(uint256 contentId) external view returns (bool);

    /// @notice Get the latest current-round slot for a content item.
    /// @param contentId The content ID to query.
    /// @return Latest current-round ID, or 0 if no round has been opened.
    function currentRoundId(uint256 contentId) external view returns (uint256);

    /// @notice Whether the current round should block dormancy for a content item.
    function isDormancyBlocked(uint256 contentId) external view returns (bool);

    function roundCore(uint256 contentId, uint256 roundId)
        external
        view
        returns (
            uint48 startTime,
            RoundLib.RoundState state,
            uint16 voteCount,
            uint16 revealedCount,
            uint64 totalStake,
            uint48 thresholdReachedAt,
            uint48 settledAt,
            uint8 upWins
        );

    /// @notice Transfer LREP reward tokens to a recipient. Only callable by RewardDistributor.
    /// @param recipient The address to receive tokens.
    /// @param lrepAmount The amount of LREP to transfer.
    function transferReward(address recipient, uint256 lrepAmount) external;
}
