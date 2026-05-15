// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IAdvisoryVoteRecorder {
    function advisoryCommitKeyByRater(uint256 contentId, uint256 roundId, address rater) external view returns (bytes32);

    function advisoryCommitKeyByIdentity(uint256 contentId, uint256 roundId, bytes32 identityKey)
        external
        view
        returns (bytes32);

    function lastAdvisoryVoteTimestamp(uint256 contentId, address rater) external view returns (uint256);

    function lastAdvisoryVoteTimestampByIdentity(uint256 contentId, bytes32 identityKey) external view returns (uint256);
}
