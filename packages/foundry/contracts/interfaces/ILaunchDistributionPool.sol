// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface ILaunchDistributionPool {
    function recordEarnedRaterReward(address rater, uint16 scoreBps) external returns (uint256 paidAmount);
}
