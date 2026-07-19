// SPDX-License-Identifier: MIT
pragma solidity ^0.8.35;

import { Test } from "forge-std/Test.sol";

import { DeployTokenlessScript } from "../../script/DeployTokenless.s.sol";

contract RotationAuthorityMock {
    address[] internal owners;
    uint256 internal threshold;

    constructor(address[] memory configuredOwners, uint256 configuredThreshold) {
        owners = configuredOwners;
        threshold = configuredThreshold;
    }

    function getOwners() external view returns (address[] memory) {
        return owners;
    }

    function getThreshold() external view returns (uint256) {
        return threshold;
    }
}

contract DeployTokenlessHarness is DeployTokenlessScript {
    function assertRotationAuthority(address authority) external view {
        _assertRotationAuthority(authority);
    }
}

contract DeployTokenlessTest is Test {
    DeployTokenlessHarness internal harness;

    function setUp() public {
        harness = new DeployTokenlessHarness();
    }

    function testRejectsEoaRotationAuthority() public {
        address authority = makeAddr("rotation-authority-eoa");
        vm.expectRevert(abi.encodeWithSelector(DeployTokenlessScript.RotationAuthorityMustBeContract.selector, authority));
        harness.assertRotationAuthority(authority);
    }

    function testRejectsOneOfThreeRotationAuthority() public {
        address[] memory owners = _owners();
        RotationAuthorityMock authority = new RotationAuthorityMock(owners, 1);
        vm.expectRevert(
            abi.encodeWithSelector(DeployTokenlessScript.RotationAuthorityThresholdTooLow.selector, uint256(1))
        );
        harness.assertRotationAuthority(address(authority));
    }

    function testRejectsTwoOwnerAndDuplicateOwnerPolicies() public {
        address[] memory twoOwners = new address[](2);
        twoOwners[0] = makeAddr("owner-one");
        twoOwners[1] = makeAddr("owner-two");
        RotationAuthorityMock twoOwnerAuthority = new RotationAuthorityMock(twoOwners, 2);
        vm.expectRevert(
            abi.encodeWithSelector(DeployTokenlessScript.RotationAuthorityOwnerSetTooSmall.selector, uint256(2))
        );
        harness.assertRotationAuthority(address(twoOwnerAuthority));

        address[] memory duplicateOwners = _owners();
        duplicateOwners[2] = duplicateOwners[0];
        RotationAuthorityMock duplicateAuthority = new RotationAuthorityMock(duplicateOwners, 2);
        vm.expectRevert(
            abi.encodeWithSelector(DeployTokenlessScript.RotationAuthorityOwnerInvalid.selector, duplicateOwners[2])
        );
        harness.assertRotationAuthority(address(duplicateAuthority));
    }

    function testAcceptsTwoOfThreeContractAuthority() public {
        RotationAuthorityMock authority = new RotationAuthorityMock(_owners(), 2);
        harness.assertRotationAuthority(address(authority));
    }

    function _owners() internal returns (address[] memory owners) {
        owners = new address[](3);
        owners[0] = makeAddr("owner-one");
        owners[1] = makeAddr("owner-two");
        owners[2] = makeAddr("owner-three");
    }
}
