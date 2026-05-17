// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { Test } from "forge-std/Test.sol";
import { LoopReputation } from "../contracts/LoopReputation.sol";

/// @title LoopReputation branch coverage tests
contract LoopReputationBranchesTest is Test {
    LoopReputation public lrep;

    address public admin = address(1);
    address public governance = address(2);
    address public mockGovernor = address(3);
    address public mockVotingEngine = address(4);
    address public mockContentRegistry = address(5);
    address public user1 = address(6);
    address public user2 = address(7);

    uint256 public constant T0 = 1000;

    function setUp() public {
        vm.warp(T0);
        vm.startPrank(admin);

        lrep = new LoopReputation(admin, governance);

        // Admin has MINTER_ROLE from constructor
        lrep.mint(user1, 1_000e6);
        lrep.mint(user2, 1_000e6);
        vm.stopPrank();

        // Set governor (prediction lock state was removed; transfer-lock tests still rely
        // on the governor wiring for lockForGovernance).
        vm.prank(governance);
        lrep.setGovernor(mockGovernor);
    }

    // =========================================================================
    // Transfer lock branches
    // =========================================================================

    function test_Transfer_GovernanceLocked_Reverts() public {
        // Lock user1's tokens via governor
        vm.prank(mockGovernor);
        lrep.lockForGovernance(user1, 800e6);

        // user1 has 1000e6 total, 800e6 locked, 200e6 transferable
        vm.prank(user1);
        vm.expectRevert("Exceeds transferable balance (governance locked)");
        lrep.transfer(user2, 300e6);
    }

    function test_Transfer_GovernanceLocked_ToVotingEngine_Reverts() public {
        vm.prank(mockGovernor);
        lrep.lockForGovernance(user1, 800e6);

        vm.prank(user1);
        vm.expectRevert("Exceeds transferable balance (governance locked)");
        lrep.transfer(mockVotingEngine, 900e6);
    }

    function test_Transfer_GovernanceLocked_ToContentRegistry_Reverts() public {
        vm.prank(mockGovernor);
        lrep.lockForGovernance(user1, 800e6);

        vm.prank(user1);
        vm.expectRevert("Exceeds transferable balance (governance locked)");
        lrep.transfer(mockContentRegistry, 900e6);
    }

    function test_TransferFrom_GovernanceLocked_ThirdPartyToVotingEngine_Reverts() public {
        address thirdPartySpender = address(100);

        vm.prank(mockGovernor);
        lrep.lockForGovernance(user1, 800e6);

        vm.prank(user1);
        lrep.approve(thirdPartySpender, 900e6);

        vm.prank(thirdPartySpender);
        vm.expectRevert("Exceeds transferable balance (governance locked)");
        lrep.transferFrom(user1, mockVotingEngine, 900e6);
    }

    function test_TransferFrom_GovernanceLocked_VotingEnginePull_Reverts() public {
        vm.prank(mockGovernor);
        lrep.lockForGovernance(user1, 800e6);

        vm.prank(user1);
        lrep.approve(mockVotingEngine, 900e6);

        vm.prank(mockVotingEngine);
        vm.expectRevert("Exceeds transferable balance (governance locked)");
        lrep.transferFrom(user1, mockVotingEngine, 900e6);
    }

    function test_TransferFrom_GovernanceLocked_ContentRegistryPull_Reverts() public {
        vm.prank(mockGovernor);
        lrep.lockForGovernance(user1, 800e6);

        vm.prank(user1);
        lrep.approve(mockContentRegistry, 900e6);

        vm.prank(mockContentRegistry);
        vm.expectRevert("Exceeds transferable balance (governance locked)");
        lrep.transferFrom(user1, mockContentRegistry, 900e6);
    }

    function test_Transfer_GovernanceLocked_PartialTransfer_Succeeds() public {
        vm.prank(mockGovernor);
        lrep.lockForGovernance(user1, 800e6);

        // 200e6 is transferable
        vm.prank(user1);
        lrep.transfer(user2, 200e6);

        assertEq(lrep.balanceOf(user2), 1_200e6);
    }

    function test_Transfer_NoLock_FullTransfer_Succeeds() public {
        vm.prank(user1);
        lrep.transfer(user2, 1_000e6);
        assertEq(lrep.balanceOf(user1), 0);
        assertEq(lrep.balanceOf(user2), 2_000e6);
    }

    function test_Transfer_MintBypasses_LockCheck() public {
        // Lock user1's tokens
        vm.prank(mockGovernor);
        lrep.lockForGovernance(user1, 800e6);

        // Mint to user1 should still work (from = address(0) bypasses lock check)
        vm.prank(admin);
        lrep.mint(user1, 100e6);

        assertEq(lrep.balanceOf(user1), 1_100e6);
    }

    function test_Transfer_AutoDelegateOnFirstReceipt() public {
        address newUser = address(10);
        assertEq(lrep.delegates(newUser), address(0));

        vm.prank(user1);
        lrep.transfer(newUser, 100e6);

        // Auto-delegation to self should have occurred
        assertEq(lrep.delegates(newUser), newUser);
    }

    function test_Transfer_AlreadyDelegated_NoChange() public {
        // user1 is already delegated from setUp (first mint triggered auto-delegate)
        assertEq(lrep.delegates(user1), user1);

        // Transfer more tokens — delegation should not change
        vm.prank(user2);
        lrep.transfer(user1, 100e6);

        assertEq(lrep.delegates(user1), user1);
    }

    // =========================================================================
    // Delegation branches
    // =========================================================================

    function test_Delegate_SelfDelegation_Succeeds() public {
        // Already self-delegated from auto-delegate, but explicit call should work
        vm.prank(user1);
        lrep.delegate(user1);
        assertEq(lrep.delegates(user1), user1);
    }

    function test_Delegate_ProxyDelegation_Reverts() public {
        vm.prank(user1);
        vm.expectRevert("Only self-delegation allowed");
        lrep.delegate(user2);
    }

    // =========================================================================
    // lockForGovernance branches
    // =========================================================================

    function test_LockForGovernance_OnlyGovernor() public {
        vm.prank(user1);
        vm.expectRevert("Only governor");
        lrep.lockForGovernance(user1, 100e6);
    }

    function test_LockForGovernance_ZeroAmount_Reverts() public {
        vm.prank(mockGovernor);
        vm.expectRevert("Amount must be > 0");
        lrep.lockForGovernance(user1, 0);
    }

    function test_LockForGovernance_FreshLock() public {
        vm.prank(mockGovernor);
        lrep.lockForGovernance(user1, 500e6);

        (uint256 amount, uint256 unlockTime) = lrep.getGovernanceLock(user1);
        assertEq(amount, 500e6);
        assertEq(unlockTime, T0 + 7 days);
    }

    function test_LockForGovernance_AccumulateLock() public {
        vm.prank(mockGovernor);
        lrep.lockForGovernance(user1, 300e6);

        vm.warp(T0 + 1 days);
        vm.prank(mockGovernor);
        lrep.lockForGovernance(user1, 200e6);

        (uint256 amount,) = lrep.getGovernanceLock(user1);
        assertEq(amount, 500e6); // 300 + 200 accumulated
    }

    function test_LockForGovernance_ExpiredLock_StartsNew() public {
        vm.prank(mockGovernor);
        lrep.lockForGovernance(user1, 300e6);

        // Warp past lock expiry (7 days)
        vm.warp(T0 + 8 days);

        vm.prank(mockGovernor);
        lrep.lockForGovernance(user1, 200e6);

        (uint256 amount,) = lrep.getGovernanceLock(user1);
        assertEq(amount, 200e6); // fresh lock, not accumulated
    }

    // =========================================================================
    // getTransferableBalance / getGovernanceLock / isLocked branches
    // =========================================================================

    function test_GetTransferableBalance_FullyLocked() public {
        vm.prank(mockGovernor);
        lrep.lockForGovernance(user1, 1_000e6);

        assertEq(lrep.getTransferableBalance(user1), 0);
    }

    function test_GetTransferableBalance_PartiallyLocked() public {
        vm.prank(mockGovernor);
        lrep.lockForGovernance(user1, 500e6);

        assertEq(lrep.getTransferableBalance(user1), 500e6);
    }

    function test_LockForGovernance_RejectsObligationAboveCurrentBalance() public {
        vm.prank(mockGovernor);
        vm.expectRevert("Insufficient balance for governance lock");
        lrep.lockForGovernance(user1, 2_000e6);
    }

    function test_LockForGovernance_PostSnapshotTransferRevertsWhenBalanceMoved() public {
        vm.prank(user1);
        lrep.transfer(user2, 1_000e6);
        assertEq(lrep.balanceOf(user1), 0);

        vm.prank(mockGovernor);
        vm.expectRevert("Insufficient balance for governance lock");
        lrep.lockForGovernance(user1, 500e6);
    }

    function test_GetGovernanceLock_Expired_ReturnsZero() public {
        vm.prank(mockGovernor);
        lrep.lockForGovernance(user1, 500e6);

        vm.warp(T0 + 8 days);

        (uint256 amount, uint256 unlockTime) = lrep.getGovernanceLock(user1);
        assertEq(amount, 0);
        assertGt(unlockTime, 0); // unlockTime is still stored
    }

    function test_GetGovernanceLock_Active_ReturnsAmount() public {
        vm.prank(mockGovernor);
        lrep.lockForGovernance(user1, 500e6);

        (uint256 amount, uint256 unlockTime) = lrep.getGovernanceLock(user1);
        assertEq(amount, 500e6);
        assertEq(unlockTime, T0 + 7 days);
    }

    function test_IsLocked_WithActiveLock() public {
        vm.prank(mockGovernor);
        lrep.lockForGovernance(user1, 500e6);
        assertTrue(lrep.isLocked(user1));
    }

    function test_IsLocked_NoLock() public view {
        assertFalse(lrep.isLocked(user1));
    }

    function test_IsLocked_ExpiredLock() public {
        vm.prank(mockGovernor);
        lrep.lockForGovernance(user1, 500e6);

        vm.warp(T0 + 8 days);
        assertFalse(lrep.isLocked(user1));
    }
}
