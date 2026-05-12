// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IRaterDeclarationClusterView {
    function clusterKey(address rater) external view returns (bytes32);
}
