// SPDX-License-Identifier: MIT
pragma solidity ^0.8.35;

import { Test } from "forge-std/Test.sol";

import { DeployTokenlessScript } from "../../script/DeployTokenless.s.sol";
import { QuicknetTBeaconVerifier } from "../../contracts/tokenless/QuicknetTBeaconVerifier.sol";

contract DeployTokenlessHarness is DeployTokenlessScript {
    function assertBeaconVerifierRuntimeCodeHash(address verifier) external view {
        _assertBeaconVerifierRuntimeCodeHash(verifier);
    }
}

contract DeployTokenlessTest is Test {
    DeployTokenlessHarness internal harness;

    function setUp() public {
        harness = new DeployTokenlessHarness();
    }

    function testAcceptsOnlyCompiledBeaconVerifierRuntimeCode() public {
        QuicknetTBeaconVerifier verifier = new QuicknetTBeaconVerifier();
        harness.assertBeaconVerifierRuntimeCodeHash(address(verifier));

        address differentRuntime = address(harness);
        bytes32 expected = keccak256(vm.getDeployedCode("QuicknetTBeaconVerifier.sol:QuicknetTBeaconVerifier"));
        vm.expectRevert(
            abi.encodeWithSelector(
                DeployTokenlessScript.BeaconVerifierRuntimeCodeHashMismatch.selector,
                expected,
                differentRuntime.codehash
            )
        );
        harness.assertBeaconVerifierRuntimeCodeHash(differentRuntime);
    }
}
