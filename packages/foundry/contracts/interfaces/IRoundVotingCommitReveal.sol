// SPDX-License-Identifier: MIT
pragma solidity ^0.8.34;

/// @title IRoundVotingCommitReveal
/// @notice Commit/reveal surface for the round voting engine.
interface IRoundVotingCommitReveal {
    function openRound(uint256 contentId) external;

    function commitVote(
        uint256 contentId,
        uint256 roundContext,
        uint64 targetRound,
        bytes32 drandChainHash,
        bytes32 commitHash,
        bytes calldata ciphertext,
        uint256 stakeAmount,
        address frontend
    ) external;

    function commitVoteWithPermit(
        uint256 contentId,
        uint256 roundContext,
        uint64 targetRound,
        bytes32 drandChainHash,
        bytes32 commitHash,
        bytes calldata ciphertext,
        uint256 stakeAmount,
        address frontend,
        uint256 permitDeadline,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external;

    function revealVoteByCommitKey(
        uint256 contentId,
        uint256 roundId,
        bytes32 commitKey,
        bool isUp,
        uint16 predictedUpBps,
        bytes32 salt
    ) external;
}
