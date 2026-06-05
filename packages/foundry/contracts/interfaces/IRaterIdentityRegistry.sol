// SPDX-License-Identifier: MIT
pragma solidity ^0.8.34;

/// @title IRaterIdentityRegistry
/// @notice Canonical rater identity resolver for voting, rewards, delegation, and human credentials.
interface IRaterIdentityRegistry {
    struct ResolvedRater {
        address holder;
        bytes32 identityKey;
        bytes32 humanNullifier;
        bool hasActiveHumanCredential;
        bool delegated;
    }

    function resolveRater(address actor) external view returns (ResolvedRater memory);
    function addressIdentityKey(address account) external pure returns (bytes32);
    function hasActiveHumanCredential(address rater) external view returns (bool);
    function credentialStatusBits(address rater) external view returns (uint8 activeMask, uint8 freshMask);
}
