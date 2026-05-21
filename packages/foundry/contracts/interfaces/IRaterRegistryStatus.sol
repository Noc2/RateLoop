// SPDX-License-Identifier: MIT
pragma solidity ^0.8.34;

interface IRaterRegistryStatus {
    function hasActiveHumanCredential(address rater) external view returns (bool);
}
