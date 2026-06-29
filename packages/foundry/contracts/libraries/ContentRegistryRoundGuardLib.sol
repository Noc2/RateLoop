// SPDX-License-Identifier: MIT
pragma solidity ^0.8.34;

import { IRoundVotingEngine } from "../interfaces/IRoundVotingEngine.sol";

/// @title ContentRegistryRoundGuardLib
/// @notice Round guard helpers extracted from ContentRegistry for EIP-170 headroom.
library ContentRegistryRoundGuardLib {
    function requireNoCommits(address trackedEngine, address currentEngine, uint256 contentId) external view {
        if (trackedEngine != address(0)) {
            require(!IRoundVotingEngine(trackedEngine).hasCommits(contentId));
        }
        if (currentEngine != address(0) && currentEngine != trackedEngine) {
            require(!IRoundVotingEngine(currentEngine).hasCommits(contentId));
        }
    }
}
