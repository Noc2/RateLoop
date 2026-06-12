// SPDX-License-Identifier: MIT
pragma solidity ^0.8.34;

import { SubmissionMediaValidator } from "./SubmissionMediaValidator.sol";

/// @title SubmissionMediaValidatorFactory
/// @notice Deploys and one-shot initializes ContentRegistry media validators atomically.
contract SubmissionMediaValidatorFactory {
    function create() external returns (address validator) {
        SubmissionMediaValidator deployed = new SubmissionMediaValidator();
        deployed.initializeEmitter(msg.sender);
        validator = address(deployed);
    }
}
