// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { Test, stdStorage, StdStorage } from "forge-std/Test.sol";
import { LaunchDistributionPool } from "../contracts/LaunchDistributionPool.sol";
import { LoopReputation } from "../contracts/LoopReputation.sol";
import { RaterRegistry } from "../contracts/RaterRegistry.sol";
import { ILaunchDistributionPool } from "../contracts/interfaces/ILaunchDistributionPool.sol";
import { MockWorldIDRouter } from "../contracts/mocks/MockWorldIDRouter.sol";

contract LaunchDistributionPoolTest is Test {
    using stdStorage for StdStorage;

    event EarnedRaterRewardCreditRecorded(
        address indexed rater,
        uint256 indexed contentId,
        uint256 indexed roundId,
        bytes32 commitKey,
        uint16 scoreBps,
        uint32 qualifyingRatingCount,
        uint32 distinctVerifiedAnchorCount,
        uint32 distinctAnchorRoundCount,
        bool payoutEligible
    );

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
        assertEq(pool.LEGACY_POOL_AMOUNT(), 4_000_000e6);
        assertEq(pool.EARNED_RATER_POOL_AMOUNT(), 25_000_000e6);
        assertEq(pool.VERIFIED_REFERRAL_POOL_AMOUNT(), 35_000_000e6);
        assertEq(
            pool.LEGACY_POOL_AMOUNT() + pool.EARNED_RATER_POOL_AMOUNT() + pool.VERIFIED_REFERRAL_POOL_AMOUNT(),
            pool.TOTAL_POOL_AMOUNT()
        );
    }

    function test_DefaultLaunchRewardPolicyUsesAntiFarmDefaults() public view {
        (
            uint16 minQualifyingScoreBps,
            uint16 minVoters,
            uint16 minVerifiedHumans,
            uint16 minDistinctVerifiedAnchors,
            uint16 minDistinctAnchorRounds,
            uint32 eligibilityRatingCount,
            uint32 rewardingRatingCount,
            bool requireNoPendingCleanup
        ) = pool.launchRewardPolicy();

        assertEq(minQualifyingScoreBps, 7_000);
        assertEq(minVoters, 3);
        assertEq(minVerifiedHumans, 1);
        assertEq(minDistinctVerifiedAnchors, 2);
        assertEq(minDistinctAnchorRounds, 2);
        assertEq(eligibilityRatingCount, 5);
        assertEq(rewardingRatingCount, 10);
        assertTrue(requireNoPendingCleanup);
    }

    function test_SetLaunchRewardPolicyUpdatesRewardMath() public {
        ILaunchDistributionPool.LaunchRewardPolicy memory policy = _defaultPolicy();
        policy.minQualifyingScoreBps = 8_500;
        pool.setLaunchRewardPolicy(policy);

        assertEq(_recordLaunchRewardWithScore(alice, 1, bytes32("anchor-a"), 8_499), 0);
        assertEq(pool.qualifyingRatingCount(alice), 0);

        for (uint256 i = 0; i < 4; i++) {
            bytes32 anchorId = i % 2 == 0 ? bytes32("anchor-a") : bytes32("anchor-b");
            assertEq(_recordLaunchRewardWithScore(alice, i + 1, anchorId, 9_000), 0);
        }

        uint256 firstReward = _recordLaunchRewardWithScore(alice, 5, bytes32("anchor-a"), 9_000);
        assertEq(firstReward, 1e6);
        assertEq(pool.raterLaunchPaid(alice), 1e6);
    }

    function test_SetLaunchRewardPolicyRejectsUnsafeAntiFarmFloors() public {
        ILaunchDistributionPool.LaunchRewardPolicy memory policy = _defaultPolicy();

        policy.minVoters = pool.MIN_EARNED_REWARD_VOTERS() - 1;
        vm.expectRevert(LaunchDistributionPool.InvalidPolicy.selector);
        pool.setLaunchRewardPolicy(policy);

        policy = _defaultPolicy();
        policy.minVerifiedHumans = pool.MIN_EARNED_REWARD_VERIFIED_HUMANS() - 1;
        vm.expectRevert(LaunchDistributionPool.InvalidPolicy.selector);
        pool.setLaunchRewardPolicy(policy);

        policy = _defaultPolicy();
        policy.minDistinctVerifiedAnchors = pool.MIN_EARNED_REWARD_DISTINCT_VERIFIED_ANCHORS() - 1;
        vm.expectRevert(LaunchDistributionPool.InvalidPolicy.selector);
        pool.setLaunchRewardPolicy(policy);

        policy = _defaultPolicy();
        policy.minDistinctAnchorRounds = pool.MIN_EARNED_REWARD_DISTINCT_ANCHOR_ROUNDS() - 1;
        vm.expectRevert(LaunchDistributionPool.InvalidPolicy.selector);
        pool.setLaunchRewardPolicy(policy);

        policy = _defaultPolicy();
        policy.eligibilityRatingCount = pool.ELIGIBILITY_RATING_COUNT() - 1;
        vm.expectRevert(LaunchDistributionPool.InvalidPolicy.selector);
        pool.setLaunchRewardPolicy(policy);

        policy = _defaultPolicy();
        policy.rewardingRatingCount = pool.REWARDING_RATING_COUNT() - 1;
        vm.expectRevert(LaunchDistributionPool.InvalidPolicy.selector);
        pool.setLaunchRewardPolicy(policy);
    }

    function test_RecordEarnedRaterRewardPaysAfterFiveQualifiedRatings() public {
        for (uint256 i = 0; i < 4; i++) {
            bytes32 anchorId = i % 2 == 0 ? bytes32("anchor-a") : bytes32("anchor-b");
            assertEq(_recordLaunchReward(alice, i + 1, anchorId), 0);
        }
        assertEq(lrep.balanceOf(alice), 0);
        assertEq(pool.qualifyingRatingCount(alice), 4);

        uint256 firstReward = _recordLaunchReward(alice, 5, bytes32("anchor-a"));
        assertEq(firstReward, 1e6);
        assertEq(pool.raterLaunchCap(alice), 10e6);
        assertEq(pool.eligibleRaterCount(), 1);
        assertEq(lrep.balanceOf(alice), firstReward);

        for (uint256 i = 0; i < 9; i++) {
            bytes32 anchorId = i % 2 == 0 ? bytes32("anchor-b") : bytes32("anchor-a");
            pool.recordEarnedRaterReward(alice, 1, 6 + i, _commitKey(6 + i), 8_000, 3, true, _singleAnchor(anchorId));
        }
        assertEq(pool.rewardedRatingCount(alice), 10);
        assertEq(pool.raterLaunchPaid(alice), 10e6);
        assertEq(lrep.balanceOf(alice), 10e6);

        assertEq(_recordLaunchReward(alice, 15, bytes32("anchor-a")), 0);
        assertEq(lrep.balanceOf(alice), 10e6);
    }

    function test_RecordEarnedRaterRewardEmitsCreditProgressBeforeAndAtEligibility() public {
        vm.expectEmit(true, true, true, true);
        emit EarnedRaterRewardCreditRecorded(alice, 1, 1, _commitKey(1), 8_000, 1, 1, 1, false);
        assertEq(
            pool.recordEarnedRaterReward(
                alice, 1, 1, _commitKey(1), 8_000, 3, true, _singleAnchor(bytes32("anchor-a"))
            ),
            0
        );

        for (uint256 i = 0; i < 3; i++) {
            bytes32 anchorId = i % 2 == 0 ? bytes32("anchor-b") : bytes32("anchor-a");
            pool.recordEarnedRaterReward(alice, 1, 2 + i, _commitKey(2 + i), 8_000, 3, true, _singleAnchor(anchorId));
        }

        vm.expectEmit(true, true, true, true);
        emit EarnedRaterRewardCreditRecorded(alice, 1, 5, _commitKey(5), 8_000, 5, 2, 5, true);
        assertEq(
            pool.recordEarnedRaterReward(
                alice, 1, 5, _commitKey(5), 8_000, 3, true, _singleAnchor(bytes32("anchor-a"))
            ),
            1e6
        );
    }

    function test_CurrentRaterLaunchCapUsesTenPointCurve() public {
        _setEligibleRaterCount(0);
        assertEq(pool.currentRaterLaunchCap(), 10e6);

        _setEligibleRaterCount(99_999);
        assertEq(pool.currentRaterLaunchCap(), 10e6);

        _setEligibleRaterCount(100_000);
        assertEq(pool.currentRaterLaunchCap(), 5e6);

        _setEligibleRaterCount(999_999);
        assertEq(pool.currentRaterLaunchCap(), 5e6);

        _setEligibleRaterCount(1_000_000);
        assertEq(pool.currentRaterLaunchCap(), 2_500_000);

        _setEligibleRaterCount(4_999_999);
        assertEq(pool.currentRaterLaunchCap(), 2_500_000);

        _setEligibleRaterCount(5_000_000);
        assertEq(pool.currentRaterLaunchCap(), 1_250_000);

        _setEligibleRaterCount(14_999_999);
        assertEq(pool.currentRaterLaunchCap(), 1_250_000);

        _setEligibleRaterCount(15_000_000);
        assertEq(pool.currentRaterLaunchCap(), 500_000);
    }

    function test_RecordEarnedRaterRewardIgnoresLowScoresAndUnauthorizedCallers() public {
        assertEq(_recordLaunchRewardWithScore(alice, 1, bytes32("anchor-a"), 6_999), 0);
        assertEq(pool.qualifyingRatingCount(alice), 0);

        bytes32[] memory anchors = _singleAnchor(bytes32("anchor-a"));
        vm.prank(bob);
        vm.expectRevert(LaunchDistributionPool.InvalidAddress.selector);
        pool.recordEarnedRaterReward(alice, 1, 1, _commitKey(1), 8_000, 3, true, anchors);
    }

    function test_RecordEarnedRaterRewardRequiresRoundContext() public {
        assertEq(
            pool.recordEarnedRaterReward(
                alice, 1, 1, _commitKey(1), 8_000, 2, true, _singleAnchor(bytes32("anchor-a"))
            ),
            0
        );
        assertEq(pool.recordEarnedRaterReward(alice, 1, 2, _commitKey(2), 8_000, 3, true, new bytes32[](0)), 0);
        assertEq(
            pool.recordEarnedRaterReward(
                alice, 1, 3, _commitKey(3), 8_000, 3, false, _singleAnchor(bytes32("anchor-a"))
            ),
            0
        );

        assertEq(pool.qualifyingRatingCount(alice), 0);
        assertEq(pool.raterDistinctVerifiedAnchorCount(alice), 0);
        assertEq(pool.raterDistinctAnchorRoundCount(alice), 0);
    }

    function test_RecordEarnedRaterRewardRequiresDistinctAnchorsAcrossRounds() public {
        for (uint256 i = 0; i < 5; i++) {
            assertEq(_recordLaunchReward(alice, i + 1, bytes32("anchor-a")), 0);
        }

        assertEq(pool.qualifyingRatingCount(alice), 5);
        assertEq(pool.raterDistinctVerifiedAnchorCount(alice), 1);
        assertEq(pool.raterDistinctAnchorRoundCount(alice), 5);
        assertEq(lrep.balanceOf(alice), 0);

        uint256 firstReward = _recordLaunchReward(alice, 6, bytes32("anchor-b"));
        assertEq(firstReward, 1e6);
        assertEq(pool.raterDistinctVerifiedAnchorCount(alice), 2);
        assertEq(lrep.balanceOf(alice), firstReward);
    }

    function test_RecordEarnedRaterRewardDeduplicatesCommitKeysAndAnchors() public {
        bytes32[] memory anchors = new bytes32[](2);
        anchors[0] = bytes32("anchor-a");
        anchors[1] = bytes32("anchor-a");
        bytes32 commitKey = _commitKey(1);

        assertEq(pool.recordEarnedRaterReward(alice, 1, 1, commitKey, 8_000, 3, true, anchors), 0);
        assertEq(pool.recordEarnedRaterReward(alice, 1, 1, commitKey, 8_000, 3, true, anchors), 0);

        assertTrue(pool.earnedRewardCreditRecorded(1, 1, commitKey));
        assertEq(pool.qualifyingRatingCount(alice), 1);
        assertEq(pool.raterDistinctVerifiedAnchorCount(alice), 1);
        assertEq(pool.raterDistinctAnchorRoundCount(alice), 1);
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
        registry.seedLegacySelfCredential(alice, uint64(block.timestamp + 30 days), 10_000, bytes32("root"), 0);

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

    function _recordLaunchReward(address rater, uint256 roundId, bytes32 anchorId) internal returns (uint256) {
        return _recordLaunchRewardWithScore(rater, roundId, anchorId, 8_000);
    }

    function _recordLaunchRewardWithScore(address rater, uint256 roundId, bytes32 anchorId, uint16 scoreBps)
        internal
        returns (uint256)
    {
        return pool.recordEarnedRaterReward(
            rater, 1, roundId, _commitKey(roundId), scoreBps, 3, true, _singleAnchor(anchorId)
        );
    }

    function _singleAnchor(bytes32 anchorId) internal pure returns (bytes32[] memory anchors) {
        anchors = new bytes32[](1);
        anchors[0] = anchorId;
    }

    function _defaultPolicy() internal view returns (ILaunchDistributionPool.LaunchRewardPolicy memory policy) {
        policy = ILaunchDistributionPool.LaunchRewardPolicy({
            minQualifyingScoreBps: pool.MIN_QUALIFYING_SCORE_BPS(),
            minVoters: pool.MIN_EARNED_REWARD_VOTERS(),
            minVerifiedHumans: pool.MIN_EARNED_REWARD_VERIFIED_HUMANS(),
            minDistinctVerifiedAnchors: pool.MIN_EARNED_REWARD_DISTINCT_VERIFIED_ANCHORS(),
            minDistinctAnchorRounds: pool.MIN_EARNED_REWARD_DISTINCT_ANCHOR_ROUNDS(),
            eligibilityRatingCount: pool.ELIGIBILITY_RATING_COUNT(),
            rewardingRatingCount: pool.REWARDING_RATING_COUNT(),
            requireNoPendingCleanup: true
        });
    }

    function _commitKey(uint256 roundId) internal pure returns (bytes32) {
        return keccak256(abi.encode("commit", roundId));
    }

    function _verify(address account, bytes32 nullifier) internal {
        uint256[8] memory proof;
        vm.prank(account);
        registry.attestSelfCredentialWithProof(1, uint256(nullifier), proof);
    }

    function _setEligibleRaterCount(uint256 count) internal {
        stdstore.target(address(pool)).sig("eligibleRaterCount()").checked_write(count);
    }
}
