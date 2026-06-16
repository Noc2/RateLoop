// SPDX-License-Identifier: MIT
pragma solidity ^0.8.34;

/// @title IWorldIDRouter
/// @notice Legacy World ID 3.0 router interface for on-chain Orb proof verification.
interface IWorldIDRouter {
    function verifyProof(
        uint256 root,
        uint256 groupId,
        uint256 signalHash,
        uint256 nullifierHash,
        uint256 externalNullifierHash,
        uint256[8] calldata proof
    ) external view;
}
