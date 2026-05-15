// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IRoundPayoutSnapshotConsumer {
    function isRoundPayoutSnapshotConsumed(uint8 domain, uint256 rewardPoolId, uint256 contentId, uint256 roundId)
        external
        view
        returns (bool);
}
