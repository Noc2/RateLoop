// SPDX-License-Identifier: MIT
pragma solidity ^0.8.34;

import { Test } from "forge-std/Test.sol";
import { LoopReputation } from "../contracts/LoopReputation.sol";

contract LoopReputationTest is Test {
    LoopReputation internal token;

    address internal admin = address(0xA11CE);
    address internal governance = address(0xB0B);
    address internal governor = address(0xCAFE);
    address internal rater = address(0x1234);
    address internal recipient = address(0x5678);

    function setUp() public {
        token = new LoopReputation(admin, governance);
    }

    function test_MetadataUsesRateLoopReputation() public view {
        assertEq(token.name(), "Loop Reputation");
        assertEq(token.symbol(), "LREP");
        assertEq(token.decimals(), 6);
        assertEq(token.MAX_SUPPLY(), 100_000_000e6);
    }

    function test_ConstructorRejectsZeroLaunchRoles() public {
        vm.expectRevert("Invalid admin");
        new LoopReputation(address(0), governance);

        vm.expectRevert("Invalid governance");
        new LoopReputation(admin, address(0));
    }

    function test_AdminMintIsCappedAndSelfDelegatesRecipient() public {
        vm.prank(admin);
        token.mint(rater, 1_000e6);

        assertEq(token.balanceOf(rater), 1_000e6);
        assertEq(token.delegates(rater), rater);

        uint256 maxSupply = token.MAX_SUPPLY();

        vm.expectRevert("Exceeds max supply");
        vm.prank(admin);
        token.mint(rater, maxSupply);
    }

    function test_GovernanceCanMintWhenItIsAlsoAdmin() public {
        LoopReputation governanceToken = new LoopReputation(governance, governance);

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

    function test_GovernanceLockUntilDoesNotShortenLongerActiveLock() public {
        vm.prank(admin);
        token.mint(rater, 2_000e6);

        vm.prank(governance);
        token.setGovernor(governor);

        uint256 longUnlockTime = block.timestamp + 30 days;

        vm.prank(governor);
        token.lockForGovernanceUntil(rater, 500e6, longUnlockTime);

        vm.prank(governor);
        token.lockForGovernance(rater, 500e6);

        (uint256 amount, uint256 unlockTime) = token.getGovernanceLock(rater);
        assertEq(amount, 1_000e6);
        assertEq(unlockTime, longUnlockTime);
    }
}
