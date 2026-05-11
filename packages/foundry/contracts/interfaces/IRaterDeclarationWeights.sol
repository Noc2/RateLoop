// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IRaterDeclarationWeights {
    function hasActiveAiDeclaration(address rater) external view returns (bool);
    function tierMultiplierBps(address rater) external view returns (uint16);
}
