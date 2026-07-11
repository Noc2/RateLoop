// SPDX-License-Identifier: MIT
pragma solidity ^0.8.34;

interface IWorldIdV4BackendIssuer {
    struct Issuance {
        uint256 chainId;
        address registry;
        uint64 rpId;
        uint256 action;
        address rater;
        bytes32 nullifierHash;
        bytes32 evidenceHash;
        uint64 expiresAt;
        uint256 nonce;
        uint256 deadline;
    }

    function issue(Issuance calldata issuance, bytes calldata signature) external;

    function issuanceDigest(Issuance calldata issuance) external view returns (bytes32);
}
