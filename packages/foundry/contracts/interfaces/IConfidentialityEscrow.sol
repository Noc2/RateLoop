// SPDX-License-Identifier: MIT
pragma solidity ^0.8.34;

import { Eip3009Authorization } from "./IEip3009.sol";

interface IConfidentialityEscrow {
    struct ConfidentialityConfig {
        bool gated;
        uint8 bondAsset;
        uint64 bondAmount;
        /// @dev Disclosure-policy flags such as private-forever do not change bond release rules.
        ///      Bonds remain slashable only while active and release under the escrow's normal
        ///      evidence-window / max-lock predicate.
        uint8 flags;
    }

    function configure(uint256 contentId, ConfidentialityConfig calldata config) external;
    function postBond(uint256 contentId) external returns (bytes32 identityKey);
    function postBondWithPermit(uint256 contentId, uint256 permitDeadline, uint8 v, bytes32 r, bytes32 s)
        external
        returns (bytes32 identityKey);
    function postBondWithAuthorization(uint256 contentId, Eip3009Authorization calldata authorization)
        external
        returns (bytes32 identityKey);
    function recordAccessNexus(uint256 contentId, address holder) external;
    function recordConfidentialityNexusForRegistry(uint256 contentId, address holder, address registryAddress) external;
    function publishLogRoot(
        string calldata epoch,
        bytes32 merkleRoot,
        bytes32 artifactHash,
        string calldata artifactUri
    ) external;
    function releaseBond(uint256 contentId, bytes32 identityKey) external returns (uint256 amount);
    function slashBond(
        uint256 contentId,
        bytes32 identityKey,
        string calldata reason,
        bytes32 evidenceHash,
        address reporterRecipient
    ) external returns (uint256 reporterAmount, uint256 confiscatedAmount);
    function hasActiveBond(uint256 contentId, bytes32 identityKey) external view returns (bool);
    function confidentialityConfig(uint256 contentId) external view returns (ConfidentialityConfig memory config);
    function hasConfidentialityNexus(uint8 provider, bytes32 nullifierHash) external view returns (bool);
    function confidentialityEscrowConfigShape() external view returns (address registry_, address protocolConfig_);
}
