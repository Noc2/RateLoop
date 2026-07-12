// SPDX-License-Identifier: MIT
pragma solidity ^0.8.35;

import { Test } from "forge-std/Test.sol";
import { CredentialIssuer } from "../../contracts/tokenless/CredentialIssuer.sol";

contract CredentialIssuerTest is Test {
    uint256 internal constant SIGNER_ONE_PK = 0xA11CE;
    uint256 internal constant SIGNER_TWO_PK = 0xB0B;
    address internal rotationAuthority = makeAddr("rotationAuthority");
    CredentialIssuer internal issuer;

    function setUp() public {
        issuer = new CredentialIssuer(rotationAuthority, vm.addr(SIGNER_ONE_PK), 2 days);
    }

    function test_ScheduledRotationHasBoundedPreviousEpochGrace() public {
        bytes32 digest = keccak256("voucher");
        bytes memory oldSignature = _sign(SIGNER_ONE_PK, digest);
        assertTrue(issuer.isValidVoucherSignature(1, digest, oldSignature));

        vm.prank(rotationAuthority);
        issuer.rotateScheduled(vm.addr(SIGNER_TWO_PK), 1 hours);

        assertEq(issuer.currentEpoch(), 2);
        assertTrue(issuer.isValidVoucherSignature(1, digest, oldSignature));
        assertTrue(issuer.isValidVoucherSignature(2, digest, _sign(SIGNER_TWO_PK, digest)));

        vm.warp(block.timestamp + 1 hours + 1);
        assertFalse(issuer.isValidVoucherSignature(1, digest, oldSignature));
    }

    function test_EmergencyRotationImmediatelyRejectsOldUncommittedVouchers() public {
        bytes32 digest = keccak256("voucher");
        bytes memory oldSignature = _sign(SIGNER_ONE_PK, digest);

        vm.prank(rotationAuthority);
        issuer.rotateEmergency(vm.addr(SIGNER_TWO_PK));

        assertFalse(issuer.isValidVoucherSignature(1, digest, oldSignature));
        assertTrue(issuer.isValidVoucherSignature(2, digest, _sign(SIGNER_TWO_PK, digest)));
    }

    function test_RotationAuthorityIsNarrowAndGraceIsCapped() public {
        vm.expectRevert(CredentialIssuer.Unauthorized.selector);
        issuer.rotateEmergency(vm.addr(SIGNER_TWO_PK));

        vm.prank(rotationAuthority);
        vm.expectRevert(CredentialIssuer.InvalidGracePeriod.selector);
        issuer.rotateScheduled(vm.addr(SIGNER_TWO_PK), 2 days + 1);

        assertEq(address(issuer).balance, 0);
    }

    function _sign(uint256 privateKey, bytes32 digest) private pure returns (bytes memory signature) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(privateKey, digest);
        signature = abi.encodePacked(r, s, v);
    }
}
