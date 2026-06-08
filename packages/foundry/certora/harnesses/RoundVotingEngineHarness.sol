// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

import { RoundVotingEngine } from "../../contracts/RoundVotingEngine.sol";
import { RoundLib } from "../../contracts/libraries/RoundLib.sol";

/// @title RoundVotingEngineHarness
/// @notice Thin subclass that exposes the engine's internal LREP accounting total and
///         per-round / per-commit state so Certora can assert on them. Verification
///         target for certora/specs/RoundVotingEngine.spec (Phase 3, transferReward)
///         and certora/specs/RoundVotingEngineLifecycle.spec (Phase 3b, lifecycle +
///         refund). All getters read internal state without mutating it.
contract RoundVotingEngineHarness is RoundVotingEngine {
    /// @notice Engine's accounted LREP inventory (Phase 3 transferReward slice).
    function accountedLrepBalance_() external view returns (uint256) {
        return accountedLrepBalance;
    }

    /// @notice Raw round-state enum as uint8 (Open=0, Settled=1, Cancelled=2, Tied=3,
    ///         RevealFailed=4) for the lifecycle-monotonicity rules.
    function roundStateU_(uint256 contentId, uint256 roundId) external view returns (uint8) {
        return uint8(rounds[contentId][roundId].state);
    }

    /// @notice Recorded stake for a commit; zeroed once a refund is paid.
    function commitStakeAmount_(uint256 contentId, uint256 roundId, bytes32 commitKey)
        external
        view
        returns (uint256)
    {
        return commits[contentId][roundId][commitKey].stakeAmount;
    }

    /// @notice Per-commit single-use refund flag (the internal companion to the public
    ///         per-recipient `cancelledRoundRefundClaimed`).
    function refundCommitClaimed_(uint256 contentId, uint256 roundId, bytes32 commitKey)
        external
        view
        returns (bool)
    {
        return cancelledRoundRefundCommitClaimed[contentId][roundId][commitKey];
    }
}
