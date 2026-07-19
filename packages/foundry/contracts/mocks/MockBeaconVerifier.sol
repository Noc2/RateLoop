// SPDX-License-Identifier: MIT
pragma solidity ^0.8.35;

import { IBeaconVerifier } from "../tokenless/interfaces/IBeaconVerifier.sol";

/// @notice Deterministic test-only verifier. Never deploy this mock outside local tests.
contract MockBeaconVerifier is IBeaconVerifier {
    bool public available = true;

    function setAvailable(bool value) external {
        available = value;
    }

    function proofFor(bytes32 networkHash, uint64 round, bytes32 randomness) public pure returns (bytes32) {
        return keccak256(abi.encode("rateloop-mock-beacon-proof", networkHash, round, randomness));
    }

    function verifyBeacon(bytes32 networkHash, uint64 round, bytes32 randomness, bytes calldata proof)
        external
        view
        returns (bool)
    {
        return available && randomness != bytes32(0) && proof.length == 32
            && bytes32(proof) == proofFor(networkHash, round, randomness);
    }
}
