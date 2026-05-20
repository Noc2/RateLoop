// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IRoundPayoutSnapshotConsumer {
    function isRoundPayoutSnapshotConsumed(uint8 domain, uint256 rewardPoolId, uint256 contentId, uint256 roundId)
        external
        view
        returns (bool);

    /// @notice Timestamp (uint64) at which the consumer is ready to receive a payout snapshot for
    ///         the given (domain, rewardPoolId, contentId, roundId). Returns 0 when the source is
    ///         not yet ready (e.g. round not settled, no pending credit recorded, or
    ///         domain/rewardPool mismatched). Used by ClusterPayoutOracle.proposeRoundPayoutSnapshot
    ///         to reject pre-source proposals that would otherwise squat the slot. M-Oracle-1.
    function roundPayoutSnapshotSourceReadyAt(
        uint8 domain,
        uint256 rewardPoolId,
        uint256 contentId,
        uint256 roundId
    ) external view returns (uint64);
}
