// SPDX-License-Identifier: MIT
pragma solidity ^0.8.34;

interface IAdvisoryVoteRecorder {
    function protocolConfig() external view returns (address);

    function votingEngine() external view returns (address);

    function registry() external view returns (address);

    function advisoryCommitKeyByRater(uint256 contentId, uint256 roundId, address rater) external view returns (bytes32);

    function advisoryCommitKeyByIdentity(uint256 contentId, uint256 roundId, bytes32 identityKey)
        external
        view
        returns (bytes32);

    function lastAdvisoryVoteTimestamp(uint256 contentId, address rater) external view returns (uint256);

    function lastAdvisoryVoteTimestampByIdentity(uint256 contentId, bytes32 identityKey) external view returns (uint256);
}
