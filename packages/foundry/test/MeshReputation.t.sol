// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { Test } from "forge-std/Test.sol";
import { MeshReputation } from "../contracts/MeshReputation.sol";

contract MeshReputationTest is Test {
    MeshReputation internal token;

    address internal admin = address(0xA11CE);
    address internal governance = address(0xB0B);
    address internal governor = address(0xCAFE);
    address internal rater = address(0x1234);
    address internal recipient = address(0x5678);

    function setUp() public {
        token = new MeshReputation(admin, governance);
    }

    function test_MetadataUsesRateMeshReputation() public view {
        assertEq(token.name(), "Mesh Reputation");
        assertEq(token.symbol(), "MREP");
        assertEq(token.decimals(), 6);
        assertEq(token.MAX_SUPPLY(), 100_000_000e6);
    }

    function test_ConstructorRejectsZeroLaunchRoles() public {
        vm.expectRevert("Invalid admin");
        new MeshReputation(address(0), governance);

        vm.expectRevert("Invalid governance");
        new MeshReputation(admin, address(0));
    }

    function test_AdminMintIsCappedAndSelfDelegatesRecipient() public {
        vm.prank(admin);
        token.mint(rater, 1_000e6);

        assertEq(token.balanceOf(rater), 1_000e6);
        assertEq(token.delegates(rater), rater);

        vm.prank(admin);
        vm.expectRevert("Exceeds max supply");
        token.mint(rater, token.MAX_SUPPLY());
    }

    function test_GovernanceCanMintWhenItIsAlsoAdmin() public {
        MeshReputation governanceToken = new MeshReputation(governance, governance);

        vm.prank(governance);
        governanceToken.mint(rater, 1_000e6);

        assertEq(governanceToken.balanceOf(rater), 1_000e6);
    }

    function test_GovernanceLockLimitsTransfersUntilExpired() public {
        vm.prank(admin);
        token.mint(rater, 1_000e6);

        vm.prank(governance);
        token.setGovernor(governor);

        vm.prank(governor);
        token.lockForGovernance(rater, 700e6);

        assertEq(token.getLockedBalance(rater), 700e6);
        assertEq(token.getTransferableBalance(rater), 300e6);

        vm.prank(rater);
        token.transfer(recipient, 300e6);

        vm.prank(rater);
        vm.expectRevert("Exceeds transferable balance (governance locked)");
        token.transfer(recipient, 1);

        vm.warp(block.timestamp + token.GOVERNANCE_LOCK_DURATION() + 1);

        vm.prank(rater);
        token.transfer(recipient, 700e6);
        assertEq(token.balanceOf(rater), 0);
    }
}
