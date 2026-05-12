// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IRaterRegistryWeights {
    function credentialMultiplierBps(address rater) external view returns (uint16);
}
