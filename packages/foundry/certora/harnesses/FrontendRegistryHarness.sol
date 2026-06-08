// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

import { FrontendRegistry } from "../../contracts/FrontendRegistry.sol";

/// @title FrontendRegistryHarness
/// @notice Thin subclass exposing per-operator stake/operator/slashed scalars so Certora
///         can assert stake-conservation properties on the public `frontends` struct
///         mapping. Verification target for certora/specs/FrontendRegistry.spec (Phase 6).
contract FrontendRegistryHarness is FrontendRegistry {
    function stakedAmount_(address op) external view returns (uint256) {
        return uint256(frontends[op].stakedAmount);
    }

    function operator_(address op) external view returns (address) {
        return frontends[op].operator;
    }

    function slashed_(address op) external view returns (bool) {
        return frontends[op].slashed;
    }
}
