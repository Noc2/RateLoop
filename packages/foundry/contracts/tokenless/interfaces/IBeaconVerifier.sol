// SPDX-License-Identifier: MIT
pragma solidity ^0.8.35;

/// @title IBeaconVerifier
/// @notice Immutable adapter boundary for verifying a frozen public-beacon round on-chain.
/// @dev A production implementation must cryptographically bind `randomness` to the exact
///      `(networkHash, round)` pair. The panel never accepts operator-authenticated randomness.
interface IBeaconVerifier {
    function verifyBeacon(bytes32 networkHash, uint64 round, bytes32 randomness, bytes calldata proof)
        external
        view
        returns (bool);
}
