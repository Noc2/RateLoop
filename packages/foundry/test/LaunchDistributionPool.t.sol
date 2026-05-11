// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {LaunchDistributionPool} from "../contracts/LaunchDistributionPool.sol";
import {LoopReputation} from "../contracts/LoopReputation.sol";
import {RaterRegistry} from "../contracts/RaterRegistry.sol";
import {MockWorldIDRouter} from "../contracts/mocks/MockWorldIDRouter.sol";

contract LaunchDistributionPoolTest is Test {
    LoopReputation internal lrep;
    RaterRegistry internal registry;
    MockWorldIDRouter internal worldIdRouter;
    LaunchDistributionPool internal pool;

    address internal alice = address(0xA11CE);
    address internal bob = address(0xB0B);
    address internal referrer = address(0xA11CE5);

    function setUp() public {
        lrep = new LoopReputation(address(this), address(this));
        worldIdRouter = new MockWorldIDRouter();
        registry =
            new RaterRegistry(address(this), address(this), address(worldIdRouter), bytes32("rate-loop"), 1, 365 days);
        pool = new LaunchDistributionPool(address(lrep), address(registry), address(this));
        pool.setAuthorizedCaller(address(this), true);

        lrep.mint(address(this), pool.TOTAL_POOL_AMOUNT());
        lrep.approve(address(pool), pool.TOTAL_POOL_AMOUNT());
        pool.depositPool(pool.TOTAL_POOL_AMOUNT());
    }

    function test_PoolSplitSumsToLaunchDistribution() public view {
        assertEq(pool.LEGACY_POOL_AMOUNT(), 2_000_000e6);
        assertEq(pool.EARNED_RATER_POOL_AMOUNT(), 25_000_000e6);
        assertEq(pool.VERIFIED_REFERRAL_POOL_AMOUNT(), 25_000_000e6);
        assertEq(
            pool.LEGACY_POOL_AMOUNT() + pool.EARNED_RATER_POOL_AMOUNT() + pool.VERIFIED_REFERRAL_POOL_AMOUNT(),
            pool.TOTAL_POOL_AMOUNT()
        );
    }

    function test_RecordEarnedRaterRewardPaysAfterFiveQualifiedRatings() public {
        for (uint256 i = 0; i < 4; i++) {
            assertEq(pool.recordEarnedRaterReward(alice, 8_000), 0);
        }
        assertEq(lrep.balanceOf(alice), 0);
        assertEq(pool.qualifyingRatingCount(alice), 4);

        uint256 firstReward = pool.recordEarnedRaterReward(alice, 8_000);
        assertEq(firstReward, 1_200_000);
        assertEq(pool.raterLaunchCap(alice), 12e6);
        assertEq(pool.eligibleRaterCount(), 1);
        assertEq(lrep.balanceOf(alice), firstReward);

        for (uint256 i = 0; i < 9; i++) {
            pool.recordEarnedRaterReward(alice, 8_000);
        }
        assertEq(pool.rewardedRatingCount(alice), 10);
        assertEq(pool.raterLaunchPaid(alice), 12e6);
        assertEq(lrep.balanceOf(alice), 12e6);

        assertEq(pool.recordEarnedRaterReward(alice, 8_000), 0);
        assertEq(lrep.balanceOf(alice), 12e6);
    }

    function test_RecordEarnedRaterRewardIgnoresLowScoresAndUnauthorizedCallers() public {
        assertEq(pool.recordEarnedRaterReward(alice, 6_999), 0);
        assertEq(pool.qualifyingRatingCount(alice), 0);

        vm.prank(bob);
        vm.expectRevert(LaunchDistributionPool.InvalidAddress.selector);
        pool.recordEarnedRaterReward(alice, 8_000);
    }

    function test_ClaimVerifiedBonusPaysOneTimeBonusAndReferral() public {
        _verify(referrer, bytes32("referrer"));
        _verify(alice, bytes32("alice"));

        vm.prank(referrer);
        uint256 referrerBase = pool.claimVerifiedBonus(address(0));
        assertEq(referrerBase, 10e6);
        assertEq(lrep.balanceOf(referrer), 10e6);

        vm.prank(alice);
        uint256 alicePayout = pool.claimVerifiedBonus(referrer);
        assertEq(alicePayout, 15e6);
        assertEq(lrep.balanceOf(alice), 10e6);
        assertEq(lrep.balanceOf(referrer), 15e6);
        assertEq(pool.referralEarnings(referrer), 5e6);

        vm.prank(alice);
        vm.expectRevert(LaunchDistributionPool.AlreadyClaimed.selector);
        pool.claimVerifiedBonus(referrer);
    }

    function test_ClaimVerifiedBonusRejectsLegacyCredentials() public {
        registry.seedLegacySelfCredential(alice, uint64(block.timestamp + 30 days), 10_000, 10_000, bytes32("root"), 0);

        vm.prank(alice);
        vm.expectRevert(LaunchDistributionPool.NotVerified.selector);
        pool.claimVerifiedBonus(address(0));
    }

    function test_ClaimLegacyUsesMerkleRootAndPreventsDoubleClaim() public {
        uint256 amount = 123e6;
        bytes32 leaf = keccak256(abi.encode(alice, amount));
        pool.setLegacyRoot(leaf);

        vm.prank(alice);
        assertEq(pool.claimLegacy(amount, new bytes32[](0)), amount);
        assertEq(lrep.balanceOf(alice), amount);

        vm.prank(alice);
        vm.expectRevert(LaunchDistributionPool.AlreadyClaimed.selector);
        pool.claimLegacy(amount, new bytes32[](0));
    }

    function _verify(address account, bytes32 nullifier) internal {
        uint256[8] memory proof;
        vm.prank(account);
        registry.attestSelfCredentialWithProof(1, uint256(nullifier), proof);
    }
}
