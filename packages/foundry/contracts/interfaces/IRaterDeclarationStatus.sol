// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IRaterDeclarationStatus {
    function hasActiveAiDeclaration(address rater) external view returns (bool);
    function activeAiDeclarationHash(address rater) external view returns (bytes32);
}
