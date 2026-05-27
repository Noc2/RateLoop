// SPDX-License-Identifier: MIT
pragma solidity ^0.8.34;

import { IWorldIDVerifier } from "../interfaces/IWorldIDVerifier.sol";

contract MockWorldIDVerifier is IWorldIDVerifier {
    bool public shouldReject;
    uint256 public expectedAction;
    uint64 public expectedRpId;
    uint256 public expectedNonce;
    uint256 public expectedSignalHash;
    uint64 public expectedExpiresAtMin;
    uint64 public expectedIssuerSchemaId;
    uint256 public expectedCredentialGenesisIssuedAtMin;

    error InvalidMockWorldIdV4Proof();

    function setShouldReject(bool value) external {
        shouldReject = value;
    }

    function setExpectedAction(uint256 value) external {
        expectedAction = value;
    }

    function setExpectedRpId(uint64 value) external {
        expectedRpId = value;
    }

    function setExpectedNonce(uint256 value) external {
        expectedNonce = value;
    }

    function setExpectedSignalHash(uint256 value) external {
        expectedSignalHash = value;
    }

    function setExpectedExpiresAtMin(uint64 value) external {
        expectedExpiresAtMin = value;
    }

    function setExpectedIssuerSchemaId(uint64 value) external {
        expectedIssuerSchemaId = value;
    }

    function setExpectedCredentialGenesisIssuedAtMin(uint256 value) external {
        expectedCredentialGenesisIssuedAtMin = value;
    }

    function verify(
        uint256,
        uint256 action,
        uint64 rpId,
        uint256 nonce,
        uint256 signalHash,
        uint64 expiresAtMin,
        uint64 issuerSchemaId,
        uint256 credentialGenesisIssuedAtMin,
        uint256[5] calldata
    ) external view override {
        if (shouldReject) revert InvalidMockWorldIdV4Proof();
        if (expectedAction != 0 && action != expectedAction) revert InvalidMockWorldIdV4Proof();
        if (expectedRpId != 0 && rpId != expectedRpId) revert InvalidMockWorldIdV4Proof();
        if (expectedNonce != 0 && nonce != expectedNonce) revert InvalidMockWorldIdV4Proof();
        if (expectedSignalHash != 0 && signalHash != expectedSignalHash) revert InvalidMockWorldIdV4Proof();
        if (expectedExpiresAtMin != 0 && expiresAtMin != expectedExpiresAtMin) revert InvalidMockWorldIdV4Proof();
        if (expectedIssuerSchemaId != 0 && issuerSchemaId != expectedIssuerSchemaId) {
            revert InvalidMockWorldIdV4Proof();
        }
        if (
            expectedCredentialGenesisIssuedAtMin != 0
                && credentialGenesisIssuedAtMin != expectedCredentialGenesisIssuedAtMin
        ) {
            revert InvalidMockWorldIdV4Proof();
        }
    }
}
