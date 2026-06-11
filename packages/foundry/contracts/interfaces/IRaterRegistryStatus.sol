// SPDX-License-Identifier: MIT
pragma solidity ^0.8.34;

interface IRaterRegistryStatus {
    function hasActiveHumanCredential(address rater) external view returns (bool);
    function hasActiveCredentialKind(address rater, uint8 kind) external view returns (bool);
    function hasRecentCredentialRecheck(address rater, uint8 kind) external view returns (bool);
    function credentialStatusBits(address rater) external view returns (uint8 activeMask, uint8 freshMask);
    function isIdentityKeyBanned(bytes32 identityKey) external view returns (bool);
}
