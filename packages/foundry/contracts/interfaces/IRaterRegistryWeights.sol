// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IRaterRegistryWeights {
    function getClusterScore(address rater)
        external
        view
        returns (bytes32 clusterId, uint16 discountBps, uint64 scorerEpoch, uint64 updatedAt);

    function getSelfCredential(address rater)
        external
        view
        returns (
            bool verified,
            bool legacy,
            bool revoked,
            bytes32 nullifierHash,
            bytes32 scope,
            uint64 verifiedAt,
            uint64 expiresAt,
            uint16 multiplierBps,
            bytes32 evidenceHash
        );
}
