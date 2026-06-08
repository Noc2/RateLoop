// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

import { QuestionRewardPoolEscrow } from "../../contracts/QuestionRewardPoolEscrow.sol";

/// @title QuestionRewardPoolEscrowHarness
/// @notice Thin subclass exposing a reward pool's `refunded` flag. The `rewardPools`
///         mapping is private, but the inherited internal `_getExistingRewardPool`
///         reaches it (and reverts for a non-existent pool), so this getter both proves
///         the pool exists and reads the flag. Verification target for
///         certora/specs/QuestionRewardPoolEscrow.spec (Phase 4).
contract QuestionRewardPoolEscrowHarness is QuestionRewardPoolEscrow {
    function poolRefunded_(uint256 rewardPoolId) external view returns (bool) {
        return _getExistingRewardPool(rewardPoolId).refunded;
    }
}
