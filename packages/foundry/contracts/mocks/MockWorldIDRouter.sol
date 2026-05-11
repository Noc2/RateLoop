// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IWorldIDRouter} from "../interfaces/IWorldIDRouter.sol";

contract MockWorldIDRouter is IWorldIDRouter {
    bool public shouldReject;
    uint256 public expectedSignalHash;
    uint256 public expectedExternalNullifierHash;

    error InvalidMockWorldIdProof();

    function setShouldReject(bool value) external {
        shouldReject = value;
    }

    function setExpectedSignalHash(uint256 value) external {
        expectedSignalHash = value;
    }

    function setExpectedExternalNullifierHash(uint256 value) external {
        expectedExternalNullifierHash = value;
    }

    function verifyProof(
        uint256,
        uint256,
        uint256 signalHash,
        uint256,
        uint256 externalNullifierHash,
        uint256[8] calldata
    ) external view override {
        if (shouldReject) revert InvalidMockWorldIdProof();
        if (expectedSignalHash != 0 && signalHash != expectedSignalHash) revert InvalidMockWorldIdProof();
        if (expectedExternalNullifierHash != 0 && externalNullifierHash != expectedExternalNullifierHash) {
            revert InvalidMockWorldIdProof();
        }
    }
}
