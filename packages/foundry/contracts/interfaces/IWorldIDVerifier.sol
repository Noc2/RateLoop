// SPDX-License-Identifier: MIT
pragma solidity ^0.8.34;

/// @title IWorldIDVerifier
/// @notice Preview interface for World ID 4.0 uniqueness proof verification.
/// @dev Mirrors the on-chain verifier surface documented by World for v4 readiness.
interface IWorldIDVerifier {
    function verify(
        uint256 nullifier,
        uint256 action,
        uint64 rpId,
        uint256 nonce,
        uint256 signalHash,
        uint64 expiresAtMin,
        uint64 issuerSchemaId,
        uint256 credentialGenesisIssuedAtMin,
        uint256[5] calldata zeroKnowledgeProof
    ) external view;
}
