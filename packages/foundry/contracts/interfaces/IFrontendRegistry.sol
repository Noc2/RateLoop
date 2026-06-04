// SPDX-License-Identifier: MIT
pragma solidity ^0.8.34;

/// @title IFrontendRegistry
/// @notice Interface for the FrontendRegistry contract that manages frontend operator registration and fees
interface IFrontendRegistry {
    error FrontendIsSlashed();
    error FrontendExitPending();

    /// @notice Fixed LREP stake required for frontend registration
    function STAKE_AMOUNT() external view returns (uint256);

    /// @notice Check if a frontend address is eligible to earn fees
    /// @param frontend The frontend address to check
    /// @return True if the frontend is fully bonded, not slashed, and not exiting
    function isEligible(address frontend) external view returns (bool);

    /// @notice Resolve the bonded frontend operator that authorizes `proposer` to publish payout snapshots.
    /// @dev Returns `proposer` itself when it is an eligible frontend operator, otherwise returns the
    ///      eligible frontend that delegated snapshot proposal authority to `proposer`, or address(0).
    function authorizedSnapshotFrontend(address proposer) external view returns (address frontend);

    /// @notice Check whether `proposer` can publish payout snapshots on behalf of `frontend`.
    function isAuthorizedSnapshotProposer(address frontend, address proposer) external view returns (bool);

    /// @notice Credit LREP fees to a frontend operator (called by RoundVotingEngine)
    /// @param frontend The frontend address to credit
    /// @param lrepAmount Amount of LREP fees
    function creditFees(address frontend, uint256 lrepAmount) external;

    /// @notice Reward distributor authorized to credit fees for a voting engine.
    function feeCreditorForEngine(address engine) external view returns (address creditor);

    /// @notice Get the accumulated LREP fees for a frontend
    /// @param frontend The frontend address
    /// @return lrepFees Accumulated LREP fees
    function getAccumulatedFees(address frontend) external view returns (uint256 lrepFees);

    /// @notice Whether a registered frontend can receive historical fees right now.
    /// @dev Mirrors the `claimFees` eligibility (active operator, fully bonded, not slashed,
    ///      not mid-unbonding, active human credential). Does NOT verify the frontend was registered
    ///      at the time the round settled; use `canClaimFeesForRound` for that round-time
    ///      guard.
    function canReceiveHistoricalFees(address frontend) external view returns (bool);

    /// @notice Whether a frontend can claim fees for a round that settled at `roundSettledAt`.
    /// @dev Combines `canReceiveHistoricalFees` with a strict registration-window check:
    ///      `frontends[frontend].registeredAt < roundSettledAt`. A frontend that
    ///      deregistered and re-registered at or after a round settled cannot claim that
    ///      round's historical fees — those should route to Protocol disposition. The strict
    ///      `<` (rather than `<=`) is intentional: same-block re-registration must not
    ///      revive fees from the round settling in that same block.
    function canClaimFeesForRound(address frontend, uint48 roundSettledAt) external view returns (bool);

    /// @notice Get frontend info
    /// @param frontend The frontend address
    /// @return operator The operator address
    /// @return stakedAmount Amount of LREP staked
    /// @return eligible Whether the frontend is currently eligible to earn fees
    /// @return slashed Whether the frontend has been slashed
    function getFrontendInfo(address frontend)
        external
        view
        returns (address operator, uint256 stakedAmount, bool eligible, bool slashed);
}
