// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IRaterDeclarationWeights {
    function tierMultiplierBps(address rater) external view returns (uint16);
}
