// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

import { RoundVotingEngine } from "../../contracts/RoundVotingEngine.sol";

/// @title RoundVotingEngineHarness
/// @notice Thin subclass that exposes the engine's internal LREP accounting total so
///         Certora can assert on it. Verification target for
///         certora/specs/RoundVotingEngine.spec (Phase 3).
contract RoundVotingEngineHarness is RoundVotingEngine {
    function accountedLrepBalance_() external view returns (uint256) {
        return accountedLrepBalance;
    }
}
