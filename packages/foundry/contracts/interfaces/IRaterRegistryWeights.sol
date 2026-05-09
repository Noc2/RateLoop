// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IRaterRegistryWeights {
    function getClusterScore(address rater)
        external
        view
        returns (bytes32 clusterId, uint16 discountBps, uint64 scorerEpoch, uint64 updatedAt);

    function credentialMultiplierBps(address rater) external view returns (uint16);
}
