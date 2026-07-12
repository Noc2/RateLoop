// SPDX-License-Identifier: MIT
pragma solidity ^0.8.35;

/// @title ICredentialIssuer
/// @notice Read-only admission trust anchor used by the immutable tokenless panel core.
interface ICredentialIssuer {
    /// @notice Returns whether `signature` was produced by an accepted signer for `issuerEpoch`.
    /// @dev Signer rotation only affects future commits. The panel core never calls this interface
    ///      again after a commit has been accepted.
    function isValidVoucherSignature(uint64 issuerEpoch, bytes32 digest, bytes calldata signature)
        external
        view
        returns (bool);
}
