// SPDX-License-Identifier: MIT
pragma solidity ^0.8.34;

/// @title IRoundRewardDistributor
/// @notice Minimal interface for direct reward-claim entrypoints.
interface IRoundRewardDistributor {
    /// @notice Marker proving the contract exposes the RateLoop reward-distributor integration surface.
    function RATELOOP_REWARD_DISTRIBUTOR_MARKER() external pure returns (bytes32);

    /// @notice Voting engine this distributor is allowed to pay claims for.
    function votingEngine() external view returns (address);

    /// @notice Content registry this distributor reads claims from.
    function registry() external view returns (address);

    /// @notice LREP token paid by this distributor's voting engine.
    function lrepToken() external view returns (address);

    /// @notice Whether any claim or dust accounting has started on this distributor.
    function claimAccountingStarted() external view returns (bool);

    /// @notice Claim frontend fees for a settled round.
    function claimFrontendFee(uint256 contentId, uint256 roundId, address frontend) external returns (uint256 fee);

    /// @notice Route a settled frontend fee to protocol once the frontend is slashed or underbonded.
    function confiscateFrontendFee(uint256 contentId, uint256 roundId, address frontend) external returns (uint256 fee);

    /// @notice Claim voter rewards for a settled round.
    function claimReward(uint256 contentId, uint256 roundId) external;

    /// @notice Confiscate a banned voter's reward for a settled round.
    function confiscateBannedReward(uint256 contentId, uint256 roundId, bytes32 commitKey) external;
}
