// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

import { FeedbackBonusEscrow } from "../../contracts/FeedbackBonusEscrow.sol";

/// @title FeedbackBonusEscrowHarness
/// @notice Thin subclass exposing the per-pool funded/remaining scalars so Certora can
///         assert the bonus-pool conservation invariant cleanly (the public mapping
///         getter returns the full 16-field struct, which is awkward to destructure in
///         CVL). Verification target for certora/specs/FeedbackBonusEscrow.spec (Phase 7).
contract FeedbackBonusEscrowHarness is FeedbackBonusEscrow {
    function poolFunded_(uint256 poolId) external view returns (uint256) {
        return feedbackBonusPools[poolId].fundedAmount;
    }

    function poolRemaining_(uint256 poolId) external view returns (uint256) {
        return feedbackBonusPools[poolId].remainingAmount;
    }
}
