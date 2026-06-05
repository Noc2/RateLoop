// SPDX-License-Identifier: MIT
pragma solidity ^0.8.34;

import {Test, stdStorage, StdStorage} from "forge-std/Test.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ClusterPayoutOracle} from "../contracts/ClusterPayoutOracle.sol";
import {LaunchDistributionPool} from "../contracts/LaunchDistributionPool.sol";
import {LoopReputation} from "../contracts/LoopReputation.sol";
import {RaterRegistry} from "../contracts/RaterRegistry.sol";
import {IClusterPayoutOracle} from "../contracts/interfaces/IClusterPayoutOracle.sol";
import {ILaunchDistributionPool} from "../contracts/interfaces/ILaunchDistributionPool.sol";
import {IRaterIdentityRegistry} from "../contracts/interfaces/IRaterIdentityRegistry.sol";
import {MockWorldIDRouter} from "../contracts/mocks/MockWorldIDRouter.sol";
import {MockWorldIDVerifier} from "../contracts/mocks/MockWorldIDVerifier.sol";

function _launchEpochSources(uint256 toRoundId)
    pure
    returns (IClusterPayoutOracle.CorrelationEpochSourceRef[] memory sources)
{
    return _launchEpochSourcesForRange(1, toRoundId);
}

function _launchEpochSourcesForRange(uint256 fromRoundId, uint256 toRoundId)
    pure
    returns (IClusterPayoutOracle.CorrelationEpochSourceRef[] memory sources)
{
    uint256 sourceCount = toRoundId - fromRoundId + 1;
    sources = new IClusterPayoutOracle.CorrelationEpochSourceRef[](sourceCount);
    for (uint256 i; i < sourceCount;) {
        sources[i] = IClusterPayoutOracle.CorrelationEpochSourceRef({
            domain: 2, rewardPoolId: 0, contentId: 1, roundId: fromRoundId + i
        });
        unchecked {
            ++i;
        }
    }
}

contract WeakLaunchRaterRegistry {
    function getHumanCredential(address) external pure returns (RaterRegistry.HumanCredential memory credential) {
        return credential;
    }

    function addressIdentityKey(address account) external pure returns (bytes32) {
        if (account == address(0)) return bytes32(0);
        return bytes32(uint256(1));
    }

    function resolveRater(address actor) external pure returns (IRaterIdentityRegistry.ResolvedRater memory resolved) {
        resolved.holder = actor;
        resolved.identityKey = bytes32(uint256(1));
    }

    function hasActiveHumanCredential(address) external pure returns (bool) {
        return false;
    }
}

contract LaunchDistributionPoolTest is Test {
    using stdStorage for StdStorage;

    event EarnedRaterRewardCreditRecorded(
        address indexed rater,
        uint256 indexed contentId,
        uint256 indexed roundId,
        bytes32 commitKey,
        uint16 scoreBps,
        uint32 qualifyingRatingCount,
        uint256 qualifyingCreditBps,
        uint32 distinctVerifiedAnchorCount,
        uint32 distinctAnchorRoundCount,
        bool payoutEligible
    );
    event RaterLaunchCapUnlocked(
        address indexed rater, bytes32 indexed nullifierHash, uint256 previousCap, uint256 fullCap, uint256 catchUpPaid
    );
    event LegacyContributorRootUpdated(bytes32 indexed root, uint256 allocationTotal, uint64 vestingStart);
    event LegacyContributorClaimed(address indexed account, uint256 amount, uint256 allocation, uint256 totalClaimed);
    event LegacyContributorUnclaimedSwept(address indexed treasury, uint256 amount);

    LoopReputation internal lrep;
    RaterRegistry internal registry;
    MockWorldIDRouter internal worldIdRouter;
    LaunchDistributionPool internal pool;

    address internal alice = address(0xA11CE);
    address internal bob = address(0xB0B);
    address internal referrer = address(0xA11CE5);

    uint64 internal constant WORLD_ID_V4_RP_ID = 42;
    uint256 internal constant WORLD_ID_V4_ACTION = uint256(keccak256("rateloop-human-credential-v4"));
    uint64 internal constant WORLD_ID_V4_ISSUER_SCHEMA_ID = 7;
    uint256 internal constant WORLD_ID_V4_CREDENTIAL_GENESIS_ISSUED_AT_MIN = 1_700_000_000;
    uint256 internal constant FIRST_COHORT_FULL_CAP = 500e6;
    uint256 internal constant FIRST_COHORT_UNVERIFIED_CAP = 125e6;
    uint256 internal constant FIRST_COHORT_FULL_SLOT = 50e6;
    uint256 internal constant FIRST_COHORT_UNVERIFIED_SLOT = 12_500_000;

    function setUp() public {
        lrep = new LoopReputation(address(this), address(this));
        worldIdRouter = new MockWorldIDRouter();
        registry =
            new RaterRegistry(address(this), address(this), address(worldIdRouter), bytes32("rate-loop"), 1, 365 days);
        pool = new LaunchDistributionPool(address(lrep), address(registry), address(this));
        registry.grantRole(registry.LAUNCH_CONSUMER_ROLE(), address(pool));
        pool.setAuthorizedCaller(address(this), true);

        lrep.mint(address(this), pool.TOTAL_POOL_AMOUNT());
        lrep.approve(address(pool), pool.TOTAL_POOL_AMOUNT());
        pool.depositPool(pool.TOTAL_POOL_AMOUNT());
    }

    /// @dev M-Oracle-1: stub so the test contract can act as a launch-credit consumer in the
    ///      "different consumer" test paths. Returns 1 (always-ready) to advance past the
    ///      source-readiness gate; the downstream finalize then exercises the consumer-mismatch
    ///      path that those tests target.
    function roundPayoutSnapshotSourceReadyAt(uint8, uint256, uint256, uint256) external pure returns (uint64) {
        return 1;
    }

    function test_PoolSplitSumsToLaunchDistribution() public view {
        assertEq(pool.VERIFIED_REFERRAL_POOL_AMOUNT(), 42_000_000e6);
        assertEq(pool.EARNED_RATER_POOL_AMOUNT(), 24_000_000e6);
        assertEq(pool.LEGACY_CONTRIBUTOR_POOL_AMOUNT(), 9_000_000e6);
        assertEq(
            pool.VERIFIED_REFERRAL_POOL_AMOUNT() + pool.EARNED_RATER_POOL_AMOUNT()
                + pool.LEGACY_CONTRIBUTOR_POOL_AMOUNT(),
            pool.TOTAL_POOL_AMOUNT()
        );
    }

    function test_AccountPrefundedPoolDepositTracksDirectMint() public {
        LoopReputation directLrep = new LoopReputation(address(this), address(this));
        LaunchDistributionPool directPool =
            new LaunchDistributionPool(address(directLrep), address(registry), address(this));
        uint256 amount = directPool.TOTAL_POOL_AMOUNT();

        directLrep.mint(address(directPool), amount);
        directPool.accountPrefundedPoolDeposit(amount);

        assertEq(directPool.poolBalance(), amount);
        assertEq(directLrep.balanceOf(address(directPool)), amount);
    }

    function test_AccountPrefundedPoolDepositOnlyOwnerAndCannotOverAccount() public {
        lrep.mint(address(pool), 1e6);

        vm.prank(alice);
        vm.expectRevert();
        pool.accountPrefundedPoolDeposit(1e6);

        vm.expectRevert(LaunchDistributionPool.InvalidAmount.selector);
        pool.accountPrefundedPoolDeposit(2e6);

        vm.expectRevert(LaunchDistributionPool.InvalidAmount.selector);
        pool.accountPrefundedPoolDeposit(0);
    }

    function test_SetClusterPayoutOracleRequiresReadyAtSource() public {
        MockLaunchOracleFrontendRegistry frontendRegistry = new MockLaunchOracleFrontendRegistry();
        frontendRegistry.setEligible(address(this), true);
        ClusterPayoutOracle oracle = new ClusterPayoutOracle(address(this), address(frontendRegistry), address(lrep));
        oracle.setRoundPayoutSnapshotConsumer(oracle.PAYOUT_DOMAIN_LAUNCH_CREDIT(), address(pool));

        vm.expectRevert(LaunchDistributionPool.InvalidAddress.selector);
        pool.setClusterPayoutOracle(address(oracle));

        pool.setRoundClusterReadyAtSource(address(new MockAlwaysReadyClusterSource()));
        pool.setClusterPayoutOracle(address(oracle));
        assertEq(address(pool.clusterPayoutOracle()), address(oracle));
    }

    function test_ConstructorRejectsInvalidRaterRegistryIntegration() public {
        vm.expectRevert(LaunchDistributionPool.InvalidAddress.selector);
        new LaunchDistributionPool(address(lrep), address(0xBEEF), address(this));

        MockLaunchOracleFrontendRegistry incompatible = new MockLaunchOracleFrontendRegistry();
        vm.expectRevert(LaunchDistributionPool.InvalidAddress.selector);
        new LaunchDistributionPool(address(lrep), address(incompatible), address(this));
    }

    function test_SetIntegrationAddressesValidateContracts() public {
        vm.expectRevert(LaunchDistributionPool.InvalidAddress.selector);
        pool.setRaterRegistry(address(0));

        vm.expectRevert(LaunchDistributionPool.InvalidAddress.selector);
        pool.setRaterRegistry(address(0xBEEF));

        MockLaunchOracleFrontendRegistry incompatible = new MockLaunchOracleFrontendRegistry();
        vm.expectRevert(LaunchDistributionPool.InvalidAddress.selector);
        pool.setRaterRegistry(address(incompatible));

        WeakLaunchRaterRegistry weakRegistry = new WeakLaunchRaterRegistry();
        vm.expectRevert(LaunchDistributionPool.InvalidAddress.selector);
        pool.setRaterRegistry(address(weakRegistry));

        RaterRegistry replacementRegistry = new RaterRegistry(
            address(this), address(this), address(worldIdRouter), bytes32("replacement"), 2, 365 days
        );
        pool.setRaterRegistry(address(replacementRegistry));
        assertEq(address(pool.raterRegistry()), address(replacementRegistry));

        assertEq(address(pool.roundClusterReadyAtSource()), address(0));
        vm.expectRevert(LaunchDistributionPool.InvalidAddress.selector);
        pool.setRoundClusterReadyAtSource(address(0));
        MockWeakClusterSource weakReadySource = new MockWeakClusterSource();
        vm.expectRevert(LaunchDistributionPool.InvalidAddress.selector);
        pool.setRoundClusterReadyAtSource(address(weakReadySource));
        MockAlwaysReadyClusterSource readySource = new MockAlwaysReadyClusterSource();
        pool.setRoundClusterReadyAtSource(address(readySource));
        assertEq(address(pool.roundClusterReadyAtSource()), address(readySource));

        vm.expectRevert(LaunchDistributionPool.InvalidAddress.selector);
        pool.setClusterPayoutOracle(address(0));

        vm.expectRevert(LaunchDistributionPool.InvalidAddress.selector);
        pool.setClusterPayoutOracle(address(0xBEEF));

        vm.expectRevert(LaunchDistributionPool.InvalidAddress.selector);
        pool.setClusterPayoutOracle(address(incompatible));

        MockLaunchOracleFrontendRegistry frontendRegistry = new MockLaunchOracleFrontendRegistry();
        frontendRegistry.setEligible(address(this), true);
        ClusterPayoutOracle oracle = new ClusterPayoutOracle(address(this), address(frontendRegistry), address(lrep));
        // M-Oracle-1: setClusterPayoutOracle now requires the new oracle to route
        // PAYOUT_DOMAIN_LAUNCH_CREDIT back to this pool. Pin first, then swap.
        vm.expectRevert(LaunchDistributionPool.InvalidAddress.selector);
        pool.setClusterPayoutOracle(address(oracle));
        oracle.setRoundPayoutSnapshotConsumer(oracle.PAYOUT_DOMAIN_LAUNCH_CREDIT(), address(pool));
        pool.setClusterPayoutOracle(address(oracle));
        assertEq(address(pool.clusterPayoutOracle()), address(oracle));
    }

    function test_InterruptedDeploymentCannotRetargetGovernanceAndDrainPool() public {
        address deployer = address(0xD00D);
        address intendedGovernance = address(0xBEEF);
        LoopReputation interruptedLrep = new LoopReputation(address(this), address(this));

        LaunchDistributionPool interruptedPool;
        vm.prank(deployer);
        interruptedPool = new LaunchDistributionPool(address(interruptedLrep), address(registry), intendedGovernance);

        interruptedLrep.mint(address(interruptedPool), interruptedPool.TOTAL_POOL_AMOUNT());
        vm.startPrank(deployer);
        interruptedPool.accountPrefundedPoolDeposit(interruptedPool.TOTAL_POOL_AMOUNT());

        vm.expectRevert(LaunchDistributionPool.InvalidAddress.selector);
        interruptedPool.setGovernance(deployer);

        uint256 poolAmount = interruptedPool.TOTAL_POOL_AMOUNT();
        vm.expectRevert(LaunchDistributionPool.InvalidAddress.selector);
        interruptedPool.withdrawRemaining(deployer, poolAmount);
        vm.stopPrank();

        assertEq(interruptedPool.poolBalance(), interruptedPool.TOTAL_POOL_AMOUNT());
        assertEq(interruptedLrep.balanceOf(address(interruptedPool)), interruptedPool.TOTAL_POOL_AMOUNT());
        assertEq(interruptedLrep.balanceOf(deployer), 0);
    }

    function test_SetGovernanceTransfersOwnershipAndRevokesOldOwnerControl() public {
        address oldGovernance = address(this);
        address newGovernance = address(0xBEEF);

        pool.setGovernance(newGovernance);

        assertEq(pool.governance(), newGovernance);
        assertEq(pool.owner(), newGovernance);

        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, oldGovernance));
        pool.setAuthorizedCaller(address(0xCA11), true);

        vm.prank(newGovernance);
        pool.setAuthorizedCaller(address(0xCA11), true);
        assertTrue(pool.authorizedCallers(address(0xCA11)));
    }

    function test_WithdrawRemainingOnlyWithdrawsSurplusAboveReservedLaunchBuckets() public {
        vm.expectRevert(LaunchDistributionPool.InvalidAmount.selector);
        pool.withdrawRemaining(bob, 1);

        uint256 surplus = 100e6;
        lrep.mint(address(this), surplus);
        lrep.approve(address(pool), surplus);
        pool.depositPool(surplus);

        assertEq(pool.withdrawRemaining(bob, type(uint256).max), surplus);
        assertEq(lrep.balanceOf(bob), surplus);
        assertEq(pool.poolBalance(), pool.TOTAL_POOL_AMOUNT());
    }

    function test_DefaultLaunchRewardPolicyUsesAntiFarmDefaults() public view {
        (
            uint16 minQualifyingScoreBps,
            uint16 minVoters,
            uint16 minVerifiedHumans,
            uint16 minDistinctVerifiedAnchors,
            uint16 minDistinctAnchorRounds,
            uint64 minLaunchCreditStake,
            uint16 maxDistinctRatersPerVerifiedAnchor,
            uint16 maxUnverifiedCreditsPerRound,
            uint16 unverifiedEarnedRaterCapBps,
            uint32 minAnchorCredentialAgeSeconds,
            uint32 eligibilityRatingCount,
            uint32 rewardingRatingCount,
            bool requireNoPendingCleanup
        ) = pool.launchRewardPolicy();

        assertEq(minQualifyingScoreBps, 7_000);
        assertEq(minVoters, 3);
        assertEq(minVerifiedHumans, 1);
        assertEq(minDistinctVerifiedAnchors, 2);
        assertEq(minDistinctAnchorRounds, 2);
        assertEq(minLaunchCreditStake, 1e6);
        assertEq(maxDistinctRatersPerVerifiedAnchor, 25);
        assertEq(maxUnverifiedCreditsPerRound, 3);
        assertEq(unverifiedEarnedRaterCapBps, 2_500);
        assertEq(minAnchorCredentialAgeSeconds, 7 days);
        assertEq(pool.launchAnchorCredentialAgeSeconds(), 7 days);
        assertEq(eligibilityRatingCount, 5);
        assertEq(rewardingRatingCount, 10);
        assertTrue(requireNoPendingCleanup);
    }

    function test_RecoverSurplusRecoversDirectTransfersWithoutChangingPoolBalance() public {
        uint256 trackedBefore = pool.poolBalance();
        lrep.mint(address(pool), 123e6);

        uint256 recovered = pool.recoverSurplus(bob, type(uint256).max);

        assertEq(recovered, 123e6);
        assertEq(lrep.balanceOf(bob), 123e6);
        assertEq(pool.poolBalance(), trackedBefore);
    }

    function test_RecoverSurplusPartialAndValidation() public {
        lrep.mint(address(pool), 123e6);

        assertEq(pool.recoverSurplus(bob, 23e6), 23e6);
        assertEq(lrep.balanceOf(bob), 23e6);
        assertEq(pool.recoverSurplus(bob, type(uint256).max), 100e6);

        vm.expectRevert(LaunchDistributionPool.InvalidAmount.selector);
        pool.recoverSurplus(bob, type(uint256).max);

        lrep.mint(address(pool), 1);
        vm.expectRevert(LaunchDistributionPool.InvalidAddress.selector);
        pool.recoverSurplus(address(0), 1);
    }

    function test_SetLegacyContributorRootValidatesAndEmits() public {
        uint256 allocation = 1_000e6;
        uint256 allocationTotal = pool.LEGACY_CONTRIBUTOR_POOL_AMOUNT();
        bytes32 root = pool.legacyContributorLeaf(alice, allocation);

        vm.expectRevert(LaunchDistributionPool.InvalidProof.selector);
        pool.setLegacyContributorRoot(bytes32(0), allocationTotal);

        vm.expectRevert(LaunchDistributionPool.InvalidAmount.selector);
        pool.setLegacyContributorRoot(root, 0);

        vm.expectRevert(LaunchDistributionPool.InvalidAmount.selector);
        pool.setLegacyContributorRoot(root, allocation);

        uint256 tooLargeTotal = pool.LEGACY_CONTRIBUTOR_POOL_AMOUNT() + 1;
        vm.expectRevert(LaunchDistributionPool.InvalidAmount.selector);
        pool.setLegacyContributorRoot(root, tooLargeTotal);

        vm.expectEmit(true, false, false, true);
        emit LegacyContributorRootUpdated(root, allocationTotal, uint64(block.timestamp));
        pool.setLegacyContributorRoot(root, allocationTotal);

        assertEq(pool.legacyContributorRoot(), root);
        assertEq(pool.legacyContributorAllocationTotal(), allocationTotal);
        assertEq(pool.legacyContributorVestingStart(), uint64(block.timestamp));
    }

    function test_ClaimLegacyContributorAllocationPaysImmediateAndLinearDeltas() public {
        uint256 allocation = 1_000e6;
        bytes32 root = pool.legacyContributorLeaf(alice, allocation);
        pool.setLegacyContributorRoot(root, pool.LEGACY_CONTRIBUTOR_POOL_AMOUNT());
        bytes32[] memory proof = new bytes32[](0);

        uint256 immediate = (allocation * pool.LEGACY_IMMEDIATE_BPS()) / pool.BPS_DENOMINATOR();
        assertEq(pool.claimableLegacyContributorAllocation(alice, allocation, proof), immediate);

        vm.prank(alice);
        vm.expectEmit(true, false, false, true);
        emit LegacyContributorClaimed(alice, immediate, allocation, immediate);
        assertEq(pool.claimLegacyContributorAllocation(allocation, proof), immediate);
        assertEq(lrep.balanceOf(alice), immediate);
        assertEq(pool.legacyContributorClaimed(alice), immediate);
        assertEq(pool.legacyContributorDistributed(), immediate);

        vm.prank(alice);
        vm.expectRevert(LaunchDistributionPool.AlreadyClaimed.selector);
        pool.claimLegacyContributorAllocation(allocation, proof);

        vm.warp(block.timestamp + (pool.LEGACY_VESTING_DURATION() / 2));
        uint256 halfVested = pool.vestedLegacyContributorAllocation(alice, allocation, proof);
        uint256 halfDelta = halfVested - immediate;

        vm.prank(alice);
        assertEq(pool.claimLegacyContributorAllocation(allocation, proof), halfDelta);
        assertEq(lrep.balanceOf(alice), halfVested);
        assertEq(pool.legacyContributorClaimed(alice), halfVested);

        vm.warp(uint256(pool.legacyContributorVestingStart()) + pool.LEGACY_VESTING_DURATION());
        uint256 finalDelta = allocation - halfVested;

        vm.prank(alice);
        assertEq(pool.claimLegacyContributorAllocation(allocation, proof), finalDelta);
        assertEq(lrep.balanceOf(alice), allocation);
        assertEq(pool.legacyContributorClaimed(alice), allocation);
        assertEq(pool.legacyContributorDistributed(), allocation);
        assertEq(pool.remainingLegacyContributorPool(), pool.LEGACY_CONTRIBUTOR_POOL_AMOUNT() - allocation);
    }

    function test_SweepExpiredLegacyContributorAllocationRoutesUnclaimedToTreasury() public {
        uint256 allocation = 1_000e6;
        bytes32 root = pool.legacyContributorLeaf(alice, allocation);
        pool.setLegacyContributorRoot(root, pool.LEGACY_CONTRIBUTOR_POOL_AMOUNT());
        uint256 vestingStart = block.timestamp;
        bytes32[] memory proof = new bytes32[](0);

        uint256 immediate = (allocation * pool.LEGACY_IMMEDIATE_BPS()) / pool.BPS_DENOMINATOR();
        vm.prank(alice);
        pool.claimLegacyContributorAllocation(allocation, proof);

        vm.warp(vestingStart + pool.LEGACY_CLAIM_DURATION() - 1);
        assertEq(pool.claimableLegacyContributorAllocation(alice, allocation, proof), allocation - immediate);
        vm.expectRevert(LaunchDistributionPool.LegacyClaimWindowOpen.selector);
        pool.sweepExpiredLegacyContributorAllocationToTreasury();

        vm.warp(vestingStart + pool.LEGACY_CLAIM_DURATION());
        assertEq(pool.claimableLegacyContributorAllocation(alice, allocation, proof), 0);
        uint256 treasuryBefore = lrep.balanceOf(address(this));
        uint256 expectedSweep = pool.LEGACY_CONTRIBUTOR_POOL_AMOUNT() - immediate;

        vm.expectEmit(true, false, false, true);
        emit LegacyContributorUnclaimedSwept(address(this), expectedSweep);
        assertEq(pool.sweepExpiredLegacyContributorAllocationToTreasury(), expectedSweep);

        assertEq(lrep.balanceOf(address(this)), treasuryBefore + expectedSweep);
        assertEq(pool.legacyContributorDistributed(), immediate);
        assertEq(pool.legacyContributorTreasuryRecovered(), expectedSweep);
        assertEq(pool.remainingLegacyContributorPool(), 0);

        vm.prank(alice);
        vm.expectRevert(LaunchDistributionPool.LegacyClaimWindowClosed.selector);
        pool.claimLegacyContributorAllocation(allocation, proof);

        vm.expectRevert(LaunchDistributionPool.AlreadyClaimed.selector);
        pool.sweepExpiredLegacyContributorAllocationToTreasury();
    }

    function test_SweepExpiredLegacyContributorAllocationRequiresConfiguredRoot() public {
        vm.expectRevert(LaunchDistributionPool.InvalidProof.selector);
        pool.sweepExpiredLegacyContributorAllocationToTreasury();
    }

    function test_ClaimLegacyContributorAllocationRejectsInvalidProofsAndInconsistentAllocations() public {
        uint256 allocation = 1_000e6;
        bytes32 root = pool.legacyContributorLeaf(alice, allocation);
        pool.setLegacyContributorRoot(root, pool.LEGACY_CONTRIBUTOR_POOL_AMOUNT());
        bytes32[] memory proof = new bytes32[](0);

        vm.prank(bob);
        vm.expectRevert(LaunchDistributionPool.InvalidProof.selector);
        pool.claimLegacyContributorAllocation(allocation, proof);

        vm.prank(alice);
        vm.expectRevert(LaunchDistributionPool.InvalidAmount.selector);
        pool.claimLegacyContributorAllocation(0, proof);

        vm.prank(alice);
        vm.expectRevert(LaunchDistributionPool.InvalidProof.selector);
        pool.claimLegacyContributorAllocation(allocation + 1, proof);
    }

    function test_ClaimLegacyContributorAllocationCannotExceedConfiguredTotal() public {
        uint256 configuredTotal = pool.LEGACY_CONTRIBUTOR_POOL_AMOUNT();
        uint256 allocation = configuredTotal + 1;
        bytes32 root = pool.legacyContributorLeaf(alice, allocation);
        pool.setLegacyContributorRoot(root, configuredTotal);
        bytes32[] memory proof = new bytes32[](0);

        vm.prank(alice);
        vm.expectRevert(LaunchDistributionPool.InvalidAmount.selector);
        pool.claimLegacyContributorAllocation(allocation, proof);
    }

    function test_SetLegacyContributorRootCannotChangeAfterClaimsStart() public {
        uint256 allocation = 1_000e6;
        uint256 allocationTotal = pool.LEGACY_CONTRIBUTOR_POOL_AMOUNT();
        bytes32 root = pool.legacyContributorLeaf(alice, allocation);
        pool.setLegacyContributorRoot(root, allocationTotal);
        bytes32[] memory proof = new bytes32[](0);

        vm.prank(alice);
        pool.claimLegacyContributorAllocation(allocation, proof);

        bytes32 replacementRoot = pool.legacyContributorLeaf(bob, allocation);
        vm.expectRevert(LaunchDistributionPool.AlreadyClaimed.selector);
        pool.setLegacyContributorRoot(replacementRoot, allocationTotal);
    }

    function test_SetLegacyContributorRootCannotResetAfterExpiredWindowBeforeSweep() public {
        uint256 allocation = 1_000e6;
        uint256 allocationTotal = pool.LEGACY_CONTRIBUTOR_POOL_AMOUNT();
        bytes32 root = pool.legacyContributorLeaf(alice, allocation);
        pool.setLegacyContributorRoot(root, allocationTotal);

        vm.warp(uint256(pool.legacyContributorVestingStart()) + pool.LEGACY_CLAIM_DURATION());

        bytes32 replacementRoot = pool.legacyContributorLeaf(bob, allocation);
        vm.expectRevert(LaunchDistributionPool.AlreadyClaimed.selector);
        pool.setLegacyContributorRoot(replacementRoot, allocationTotal);
    }

    function test_SetLegacyContributorRootCannotResetAfterZeroClaimSweep() public {
        uint256 allocation = 1_000e6;
        uint256 allocationTotal = pool.LEGACY_CONTRIBUTOR_POOL_AMOUNT();
        bytes32 root = pool.legacyContributorLeaf(alice, allocation);
        pool.setLegacyContributorRoot(root, allocationTotal);

        vm.warp(uint256(pool.legacyContributorVestingStart()) + pool.LEGACY_CLAIM_DURATION());
        assertEq(pool.sweepExpiredLegacyContributorAllocationToTreasury(), allocationTotal);

        bytes32 replacementRoot = pool.legacyContributorLeaf(bob, allocation);
        vm.expectRevert(LaunchDistributionPool.AlreadyClaimed.selector);
        pool.setLegacyContributorRoot(replacementRoot, allocationTotal);
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
        assertEq(firstReward, FIRST_COHORT_UNVERIFIED_SLOT);
        assertEq(pool.raterLaunchPaid(alice), FIRST_COHORT_UNVERIFIED_SLOT);
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
        policy.minLaunchCreditStake = pool.MIN_LAUNCH_CREDIT_STAKE() - 1;
        vm.expectRevert(LaunchDistributionPool.InvalidPolicy.selector);
        pool.setLaunchRewardPolicy(policy);

        policy = _defaultPolicy();
        policy.maxDistinctRatersPerVerifiedAnchor = 0;
        vm.expectRevert(LaunchDistributionPool.InvalidPolicy.selector);
        pool.setLaunchRewardPolicy(policy);

        policy = _defaultPolicy();
        policy.maxDistinctRatersPerVerifiedAnchor = pool.MAX_DISTINCT_RATERS_PER_VERIFIED_ANCHOR() + 1;
        vm.expectRevert(LaunchDistributionPool.InvalidPolicy.selector);
        pool.setLaunchRewardPolicy(policy);

        policy = _defaultPolicy();
        policy.maxUnverifiedCreditsPerRound = pool.MAX_UNVERIFIED_LAUNCH_CREDITS_PER_ROUND() + 1;
        vm.expectRevert(LaunchDistributionPool.InvalidPolicy.selector);
        pool.setLaunchRewardPolicy(policy);

        policy = _defaultPolicy();
        policy.unverifiedEarnedRaterCapBps = pool.BPS_DENOMINATOR() + 1;
        vm.expectRevert(LaunchDistributionPool.InvalidPolicy.selector);
        pool.setLaunchRewardPolicy(policy);

        policy = _defaultPolicy();
        policy.minAnchorCredentialAgeSeconds = pool.MIN_ANCHOR_CREDENTIAL_AGE_SECONDS() - 1;
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
        assertEq(firstReward, FIRST_COHORT_UNVERIFIED_SLOT);
        assertEq(pool.raterLaunchCap(alice), FIRST_COHORT_UNVERIFIED_CAP);
        assertEq(pool.raterFullLaunchCap(alice), FIRST_COHORT_FULL_CAP);
        assertTrue(pool.raterLaunchCapAssigned(alice));
        assertFalse(pool.raterFullLaunchCapUnlocked(alice));
        assertEq(pool.eligibleRaterCount(), 1);
        assertEq(lrep.balanceOf(alice), firstReward);

        for (uint256 i = 0; i < 9; i++) {
            bytes32 anchorId = i % 2 == 0 ? bytes32("anchor-b") : bytes32("anchor-a");
            pool.recordEarnedRaterRewardWithSourceReady(
                alice,
                1,
                6 + i,
                _commitKey(6 + i),
                8_000,
                3,
                true,
                pool.MIN_LAUNCH_CREDIT_STAKE(),
                _singleAnchor(anchorId),
                uint64(block.timestamp)
            );
        }
        assertEq(pool.rewardedRatingCount(alice), 10);
        assertEq(pool.raterLaunchPaid(alice), FIRST_COHORT_UNVERIFIED_CAP);
        assertEq(lrep.balanceOf(alice), FIRST_COHORT_UNVERIFIED_CAP);

        assertEq(_recordLaunchReward(alice, 15, bytes32("anchor-a")), 0);
        assertEq(lrep.balanceOf(alice), FIRST_COHORT_UNVERIFIED_CAP);
    }

    function test_RecordEarnedRaterRewardPartialEarnedPoolDoesNotConsumeFullSlot() public {
        _recordLaunchRewardSlots(alice, 5);
        assertEq(pool.rewardedRatingCount(alice), 1);
        assertEq(pool.raterLaunchPaid(alice), FIRST_COHORT_UNVERIFIED_SLOT);

        _setEarnedRaterDistributed(pool.EARNED_RATER_POOL_AMOUNT() - 6_250_000);
        uint256 partialReward = _recordLaunchReward(alice, 6, bytes32("anchor-b"));

        assertEq(partialReward, 6_250_000);
        assertEq(pool.raterLaunchPaid(alice), 18_750_000);
        assertEq(pool.rewardedRatingCount(alice), 1);
        assertEq(lrep.balanceOf(alice), 18_750_000);
    }

    function test_RecordEarnedRaterRewardExactRemainingEarnedPoolConsumesSlot() public {
        _recordLaunchRewardSlots(alice, 5);
        assertEq(pool.rewardedRatingCount(alice), 1);
        assertEq(pool.raterLaunchPaid(alice), FIRST_COHORT_UNVERIFIED_SLOT);

        _setEarnedRaterDistributed(pool.EARNED_RATER_POOL_AMOUNT() - FIRST_COHORT_UNVERIFIED_SLOT);
        uint256 fullSlotReward = _recordLaunchReward(alice, 6, bytes32("anchor-b"));

        assertEq(fullSlotReward, FIRST_COHORT_UNVERIFIED_SLOT);
        assertEq(pool.raterLaunchPaid(alice), FIRST_COHORT_UNVERIFIED_SLOT * 2);
        assertEq(pool.rewardedRatingCount(alice), 2);
        assertEq(lrep.balanceOf(alice), FIRST_COHORT_UNVERIFIED_SLOT * 2);
    }

    function test_CorrelationOracleDelaysAndFractionalizesLaunchCredit() public {
        MockLaunchOracleFrontendRegistry frontendRegistry = new MockLaunchOracleFrontendRegistry();
        frontendRegistry.setEligible(address(this), true);
        ClusterPayoutOracle oracle = new ClusterPayoutOracle(address(this), address(frontendRegistry), address(lrep));
        oracle.setOracleConfig(1, oracle.MIN_CHALLENGE_BOND(), address(this));
        oracle.setRoundPayoutSnapshotConsumer(oracle.PAYOUT_DOMAIN_LAUNCH_CREDIT(), address(pool));
        pool.setRoundClusterReadyAtSource(address(new MockAlwaysReadyClusterSource()));
        pool.setClusterPayoutOracle(address(oracle));

        uint256 paidBeforeSnapshot = _recordLaunchReward(alice, 1, bytes32("anchor-a"));
        assertEq(paidBeforeSnapshot, 0);
        assertEq(pool.qualifyingCreditBps(alice), 0);
        assertEq(pool.qualifyingRatingCount(alice), 0);
        assertEq(pool.raterDistinctVerifiedAnchorCount(alice), 0);
        assertEq(pool.raterDistinctAnchorRoundCount(alice), 0);
        assertEq(pool.verifiedAnchorDistinctRaterCount(bytes32("anchor-a")), 1);
        // M-Funds-2: counter increments at record time for unverified raters even on the
        // cluster-oracle path, so the cap gates storage growth uniformly.
        assertEq(pool.roundUnverifiedLaunchCreditCount(1, 1), 1);

        oracle.proposeCorrelationEpoch(
            1,
            1,
            1,
            keccak256("cluster-root"),
            keccak256("params"),
            keccak256("epoch-artifact"),
            "ipfs://epoch",
            _launchEpochSources(1)
        );
        vm.warp(2);
        oracle.finalizeCorrelationEpoch(1);

        IClusterPayoutOracle.PayoutWeight memory payout = IClusterPayoutOracle.PayoutWeight({
            domain: pool.PAYOUT_DOMAIN_LAUNCH_CREDIT(),
            rewardPoolId: 0,
            contentId: 1,
            roundId: 1,
            commitKey: _commitKey(1),
            identityKey: bytes32(0),
            account: alice,
            baseWeight: pool.BPS_DENOMINATOR(),
            independenceBps: 2_500,
            effectiveWeight: 2_500,
            reasonHash: keccak256("clustered")
        });
        bytes32 leaf = oracle.payoutWeightLeaf(payout);
        oracle.proposeRoundPayoutSnapshot(
            IClusterPayoutOracle.RoundPayoutSnapshotInput({
                domain: pool.PAYOUT_DOMAIN_LAUNCH_CREDIT(),
                rewardPoolId: 0,
                contentId: 1,
                roundId: 1,
                correlationEpochId: 1,
                rawEligibleVoters: 1,
                effectiveParticipantUnits: 2_500,
                totalClaimWeight: 2_500,
                weightRoot: leaf,
                reasonRoot: keccak256("reason-root"),
                artifactHash: keccak256("epoch-artifact"),
                artifactURI: "ipfs://round"
            })
        );
        bytes32 snapshotKey = oracle.roundPayoutSnapshotKey(pool.PAYOUT_DOMAIN_LAUNCH_CREDIT(), 0, 1, 1);
        vm.warp(4);
        oracle.finalizeRoundPayoutSnapshot(snapshotKey);

        uint256 paidAfterSnapshot = pool.finalizeEarnedRaterRewardCredit(1, 1, _commitKey(1), payout, new bytes32[](0));
        assertEq(paidAfterSnapshot, 0);
        assertEq(pool.qualifyingCreditBps(alice), 2_500);
        assertEq(pool.qualifyingRatingCount(alice), 0);
        assertEq(pool.raterDistinctVerifiedAnchorCount(alice), 1);
        assertEq(pool.raterDistinctAnchorRoundCount(alice), 1);
        assertEq(pool.verifiedAnchorDistinctRaterCount(bytes32("anchor-a")), 1);
        assertEq(pool.roundUnverifiedLaunchCreditCount(1, 1), 1);
        assertTrue(pool.earnedRewardCreditFinalized(1, 1, _commitKey(1)));
        assertTrue(pool.isRoundPayoutSnapshotConsumed(pool.PAYOUT_DOMAIN_LAUNCH_CREDIT(), 0, 1, 1));
    }

    function test_LaunchCreditRejectsSnapshotForDifferentConsumer() public {
        MockLaunchOracleFrontendRegistry frontendRegistry = new MockLaunchOracleFrontendRegistry();
        frontendRegistry.setEligible(address(this), true);
        ClusterPayoutOracle oracle = new ClusterPayoutOracle(address(this), address(frontendRegistry), address(lrep));
        oracle.setOracleConfig(1, oracle.MIN_CHALLENGE_BOND(), address(this));
        // M-Oracle-1: `setClusterPayoutOracle` now requires the new oracle to pin the
        // launch-credit consumer back to this pool. Satisfy that gate first, then re-pin
        // to `address(this)` to recreate the "different consumer" scenario that the rest
        // of this test targets.
        oracle.setRoundPayoutSnapshotConsumer(oracle.PAYOUT_DOMAIN_LAUNCH_CREDIT(), address(pool));
        pool.setRoundClusterReadyAtSource(address(new MockAlwaysReadyClusterSource()));
        pool.setClusterPayoutOracle(address(oracle));
        oracle.setRoundPayoutSnapshotConsumer(oracle.PAYOUT_DOMAIN_LAUNCH_CREDIT(), address(this));

        assertEq(_recordLaunchReward(alice, 1, bytes32("anchor-a")), 0);

        oracle.proposeCorrelationEpoch(
            1,
            1,
            1,
            keccak256("cluster-root"),
            keccak256("params"),
            keccak256("epoch-artifact"),
            "ipfs://epoch",
            _launchEpochSources(1)
        );
        vm.warp(2);
        oracle.finalizeCorrelationEpoch(1);

        IClusterPayoutOracle.PayoutWeight memory payout =
            _launchPayoutWeight(1, _commitKey(1), alice, 2_500, keccak256("clustered"));
        _proposeAndFinalizeLaunchPayoutSnapshot(oracle, 1, payout, keccak256("epoch-artifact"));

        vm.expectRevert(LaunchDistributionPool.InvalidProof.selector);
        pool.finalizeEarnedRaterRewardCredit(1, 1, _commitKey(1), payout, new bytes32[](0));
    }

    function test_LaunchCreditUsesAuthoritativeSourceOverLaterCallerReadyAt() public {
        ClusterPayoutOracle oracle = _configureLaunchOracle(1);

        IClusterPayoutOracle.PayoutWeight memory payout =
            _launchPayoutWeight(1, _commitKey(1), alice, 2_500, keccak256("clustered"));
        _proposeAndFinalizeLaunchPayoutSnapshot(oracle, 1, payout, keccak256("epoch-artifact"));

        // The caller supplies a later sourceReadyAt, but the configured authoritative source
        // keeps the credit anchored to the round source timestamp used by the oracle gate.
        vm.warp(block.timestamp + 1);
        uint64 readyAt = uint64(block.timestamp);
        pool.recordEarnedRaterRewardWithSourceReady(
            alice,
            1,
            1,
            _commitKey(1),
            8_000,
            3,
            true,
            pool.MIN_LAUNCH_CREDIT_STAKE(),
            _singleAnchor(bytes32("anchor-a")),
            readyAt
        );
        assertGt(pool.pendingEarnedRaterCreditReadyAt(1, 1, _commitKey(1)), 0);

        assertEq(pool.finalizeEarnedRaterRewardCredit(1, 1, _commitKey(1), payout, new bytes32[](0)), 0);
        assertEq(pool.qualifyingCreditBps(alice), 2_500);
        assertTrue(pool.earnedRewardCreditFinalized(1, 1, _commitKey(1)));
    }

    function test_LaunchCreditAcceptsSourceReadySnapshotProposedBeforeRecord() public {
        ClusterPayoutOracle oracle = _configureLaunchOracle(1);
        uint64 sourceReadyAt = pool.roundPayoutSnapshotSourceReadyAt(pool.PAYOUT_DOMAIN_LAUNCH_CREDIT(), 0, 1, 1);
        assertGt(sourceReadyAt, 0);

        IClusterPayoutOracle.PayoutWeight memory payout =
            _launchPayoutWeight(1, _commitKey(1), alice, 2_500, keccak256("clustered"));
        _proposeAndFinalizeLaunchPayoutSnapshot(oracle, 1, payout, keccak256("epoch-artifact"));

        vm.warp(block.timestamp + 30);
        uint64 creditReadyAt = uint64(block.timestamp);
        assertEq(
            pool.recordEarnedRaterRewardWithSourceReady(
                alice,
                1,
                1,
                _commitKey(1),
                8_000,
                3,
                true,
                pool.MIN_LAUNCH_CREDIT_STAKE(),
                _singleAnchor(bytes32("anchor-a")),
                sourceReadyAt
            ),
            0
        );
        assertEq(creditReadyAt, uint64(block.timestamp));
        assertEq(pool.pendingEarnedRaterCreditReadyAt(1, 1, _commitKey(1)), sourceReadyAt);

        assertEq(pool.finalizeEarnedRaterRewardCredit(1, 1, _commitKey(1), payout, new bytes32[](0)), 0);
        assertEq(pool.qualifyingCreditBps(alice), 2_500);
        assertTrue(pool.earnedRewardCreditFinalized(1, 1, _commitKey(1)));
    }

    function test_LaunchSnapshotSourceWaitsForAdvisoryRevealGrace() public {
        ClusterPayoutOracle oracle = _configureLaunchOracle(1);
        uint48 settledAt = uint48(block.timestamp);
        uint256 revealGrace = 60 minutes;
        pool.setRoundClusterReadyAtSource(address(new MockGraceClusterSource(settledAt, revealGrace)));

        uint64 expectedReadyAt = uint64(uint256(settledAt) + revealGrace);
        assertEq(pool.roundPayoutSnapshotSourceReadyAt(pool.PAYOUT_DOMAIN_LAUNCH_CREDIT(), 0, 1, 1), expectedReadyAt);

        IClusterPayoutOracle.PayoutWeight memory payout =
            _launchPayoutWeight(1, _commitKey(1), alice, 2_500, keccak256("clustered"));
        uint8 launchDomain = pool.PAYOUT_DOMAIN_LAUNCH_CREDIT();
        bytes32 weightRoot = oracle.payoutWeightLeaf(payout);

        vm.warp(uint256(expectedReadyAt) - 1);
        vm.expectRevert(ClusterPayoutOracle.SourceNotReady.selector);
        oracle.proposeRoundPayoutSnapshot(
            IClusterPayoutOracle.RoundPayoutSnapshotInput({
                domain: launchDomain,
                rewardPoolId: 0,
                contentId: 1,
                roundId: 1,
                correlationEpochId: 1,
                rawEligibleVoters: 1,
                effectiveParticipantUnits: uint32(payout.effectiveWeight),
                totalClaimWeight: payout.effectiveWeight,
                weightRoot: weightRoot,
                reasonRoot: keccak256("reason-root"),
                artifactHash: keccak256("epoch-artifact"),
                artifactURI: "ipfs://round"
            })
        );

        vm.warp(expectedReadyAt);
        _proposeAndFinalizeLaunchPayoutSnapshot(oracle, 1, payout, keccak256("epoch-artifact"));
    }

    function test_LaunchSnapshotSourceFailsClosedWhenAdvisoryGraceUnavailable() public {
        uint48 settledAt = uint48(block.timestamp);
        uint256 revealGrace = 60 minutes;
        MockGraceClusterSource source = new MockGraceClusterSource(settledAt, revealGrace);
        pool.setRoundClusterReadyAtSource(address(source));

        uint64 expectedReadyAt = uint64(uint256(settledAt) + revealGrace);
        assertEq(pool.roundPayoutSnapshotSourceReadyAt(pool.PAYOUT_DOMAIN_LAUNCH_CREDIT(), 0, 1, 1), expectedReadyAt);

        stdstore.target(address(pool)).sig("launchRoundSourceReadyAt(uint256,uint256)").with_key(uint256(1))
            .with_key(uint256(1)).checked_write(uint256(settledAt));

        source.setRevealGraceReverts(true);
        assertEq(pool.roundPayoutSnapshotSourceReadyAt(pool.PAYOUT_DOMAIN_LAUNCH_CREDIT(), 0, 1, 1), 0);
    }

    function test_PendingLaunchOracleCreditsReserveUnverifiedRoundSlotsAtRecordTime() public {
        // M-Funds-2: the per-round unverified cap MUST gate pending credits at record time,
        // not at finalize. Previously, when a cluster oracle was configured the counter never
        // incremented at record and unbounded pendingEarnedRaterCredits entries could
        // accumulate before the cap re-engaged at finalize. The fix moves the increment to
        // record so the cap is the storage-growth gate uniformly.
        _configureLaunchOracle(1);
        bytes32 anchorId = bytes32("anchor-a");
        uint256 maxCredits = pool.MAX_UNVERIFIED_LAUNCH_CREDITS_PER_ROUND();

        for (uint256 i = 0; i < maxCredits; i++) {
            address rater = address(uint160(0x7000 + i));
            bytes32 commitKey = keccak256(abi.encode("pending", i));
            pool.recordEarnedRaterRewardWithSourceReady(
                rater,
                60,
                1,
                commitKey,
                8_000,
                3,
                true,
                pool.MIN_LAUNCH_CREDIT_STAKE(),
                _singleAnchor(anchorId),
                uint64(block.timestamp)
            );

            assertTrue(pool.earnedRewardCreditRecorded(60, 1, commitKey));
            assertEq(pool.roundUnverifiedLaunchCreditCount(60, 1), i + 1);
        }

        // The (maxCredits + 1)th call must short-circuit (return 0 without writing) because the
        // cap is already saturated.
        bytes32 extraCommitKey = keccak256("pending-extra");
        pool.recordEarnedRaterRewardWithSourceReady(
            address(0xBEEF),
            60,
            1,
            extraCommitKey,
            8_000,
            3,
            true,
            pool.MIN_LAUNCH_CREDIT_STAKE(),
            _singleAnchor(anchorId),
            uint64(block.timestamp)
        );

        assertFalse(pool.earnedRewardCreditRecorded(60, 1, extraCommitKey));
        assertEq(pool.roundUnverifiedLaunchCreditCount(60, 1), maxCredits);
    }

    function test_PendingLaunchCreditsReserveVerifiedAnchorFanoutAtRecordTime() public {
        _configureLaunchOracle(1);
        bytes32 anchorId = bytes32("anchor-a");
        uint256 maxFanout = pool.MAX_DISTINCT_RATERS_PER_VERIFIED_ANCHOR();

        for (uint256 i = 0; i < maxFanout; i++) {
            address rater = address(uint160(0x7100 + i));
            bytes32 commitKey = keccak256(abi.encode("pending-anchor", i));
            pool.recordEarnedRaterRewardWithSourceReady(
                rater,
                70 + i,
                1,
                commitKey,
                8_000,
                3,
                true,
                pool.MIN_LAUNCH_CREDIT_STAKE(),
                _singleAnchor(anchorId),
                uint64(block.timestamp)
            );

            assertTrue(pool.earnedRewardCreditRecorded(70 + i, 1, commitKey));
            assertEq(pool.raterDistinctVerifiedAnchorCount(rater), 0);
            assertEq(pool.verifiedAnchorDistinctRaterCount(anchorId), i + 1);
        }

        bytes32 extraCommitKey = keccak256("pending-anchor-extra");
        pool.recordEarnedRaterRewardWithSourceReady(
            address(0xCAFE),
            100,
            1,
            extraCommitKey,
            8_000,
            3,
            true,
            pool.MIN_LAUNCH_CREDIT_STAKE(),
            _singleAnchor(anchorId),
            uint64(block.timestamp)
        );

        assertFalse(pool.earnedRewardCreditRecorded(100, 1, extraCommitKey));
        assertEq(pool.verifiedAnchorDistinctRaterCount(anchorId), maxFanout);
    }

    function test_CancelStalePendingLaunchCreditReleasesVerifiedAnchorFanout() public {
        _configureLaunchOracle(1);
        bytes32 anchorId = bytes32("anchor-a");
        uint256 maxFanout = pool.MAX_DISTINCT_RATERS_PER_VERIFIED_ANCHOR();
        bytes32 firstCommitKey = keccak256("pending-anchor-cancel-first");
        address firstRater = address(0x7300);

        for (uint256 i = 0; i < maxFanout; i++) {
            address rater = i == 0 ? firstRater : address(uint160(0x7300 + i));
            bytes32 commitKey = i == 0 ? firstCommitKey : keccak256(abi.encode("pending-anchor-cancel", i));
            pool.recordEarnedRaterRewardWithSourceReady(
                rater,
                300 + i,
                1,
                commitKey,
                8_000,
                3,
                true,
                pool.MIN_LAUNCH_CREDIT_STAKE(),
                _singleAnchor(anchorId),
                uint64(block.timestamp)
            );
        }

        bytes32 blockedCommitKey = keccak256("pending-anchor-blocked-before-cancel");
        pool.recordEarnedRaterRewardWithSourceReady(
            address(0xCAFE),
            400,
            1,
            blockedCommitKey,
            8_000,
            3,
            true,
            pool.MIN_LAUNCH_CREDIT_STAKE(),
            _singleAnchor(anchorId),
            uint64(block.timestamp)
        );
        assertFalse(pool.earnedRewardCreditRecorded(400, 1, blockedCommitKey));
        assertEq(pool.verifiedAnchorDistinctRaterCount(anchorId), maxFanout);

        vm.prank(bob);
        vm.expectRevert(LaunchDistributionPool.PendingCreditNotStale.selector);
        pool.cancelStalePendingEarnedRaterCredit(300, 1, firstCommitKey);

        vm.warp(block.timestamp + pool.STALE_PENDING_EARNED_RATER_CREDIT_DELAY());
        vm.prank(bob);
        pool.cancelStalePendingEarnedRaterCredit(300, 1, firstCommitKey);
        assertEq(pool.pendingVerifiedAnchorReservationCount(anchorId, firstRater), 0);
        assertFalse(pool.verifiedAnchorRaterSeen(anchorId, firstRater));
        assertEq(pool.verifiedAnchorDistinctRaterCount(anchorId), maxFanout - 1);
        assertTrue(pool.earnedRewardCreditRecorded(300, 1, firstCommitKey));
        assertTrue(pool.raterRoundCreditRecorded(firstRater, 300, 1));

        bytes32 replacementCommitKey = keccak256("pending-anchor-replacement-after-cancel");
        pool.recordEarnedRaterRewardWithSourceReady(
            address(0xCAFE),
            401,
            1,
            replacementCommitKey,
            8_000,
            3,
            true,
            pool.MIN_LAUNCH_CREDIT_STAKE(),
            _singleAnchor(anchorId),
            uint64(block.timestamp)
        );
        assertTrue(pool.earnedRewardCreditRecorded(401, 1, replacementCommitKey));
        assertEq(pool.verifiedAnchorDistinctRaterCount(anchorId), maxFanout);

        IClusterPayoutOracle.PayoutWeight memory payout =
            _launchPayoutWeight(300, firstCommitKey, firstRater, 2_500, keccak256("cancelled"));
        vm.expectRevert(LaunchDistributionPool.InvalidAmount.selector);
        pool.finalizeEarnedRaterRewardCredit(300, 1, firstCommitKey, payout, new bytes32[](0));
        vm.expectRevert(LaunchDistributionPool.InvalidAmount.selector);
        pool.rescueStalePendingEarnedRaterCredit(300, 1, firstCommitKey, 0);
    }

    function test_CancelStalePendingLaunchCreditRespectsSharedAnchorReservations() public {
        _configureLaunchOracle(1);
        bytes32 anchorId = bytes32("anchor-shared");
        bytes32 firstCommitKey = keccak256("shared-pending-first");
        bytes32 secondCommitKey = keccak256("shared-pending-second");

        pool.recordEarnedRaterRewardWithSourceReady(
            alice,
            500,
            1,
            firstCommitKey,
            8_000,
            3,
            true,
            pool.MIN_LAUNCH_CREDIT_STAKE(),
            _singleAnchor(anchorId),
            uint64(block.timestamp)
        );
        pool.recordEarnedRaterRewardWithSourceReady(
            alice,
            501,
            1,
            secondCommitKey,
            8_000,
            3,
            true,
            pool.MIN_LAUNCH_CREDIT_STAKE(),
            _singleAnchor(anchorId),
            uint64(block.timestamp)
        );

        assertEq(pool.verifiedAnchorDistinctRaterCount(anchorId), 1);
        assertEq(pool.pendingVerifiedAnchorReservationCount(anchorId, alice), 2);

        vm.warp(block.timestamp + pool.STALE_PENDING_EARNED_RATER_CREDIT_DELAY());
        pool.cancelStalePendingEarnedRaterCredit(500, 1, firstCommitKey);
        assertTrue(pool.verifiedAnchorRaterSeen(anchorId, alice));
        assertEq(pool.verifiedAnchorDistinctRaterCount(anchorId), 1);
        assertEq(pool.pendingVerifiedAnchorReservationCount(anchorId, alice), 1);

        pool.cancelStalePendingEarnedRaterCredit(501, 1, secondCommitKey);
        assertFalse(pool.verifiedAnchorRaterSeen(anchorId, alice));
        assertEq(pool.verifiedAnchorDistinctRaterCount(anchorId), 0);
        assertEq(pool.pendingVerifiedAnchorReservationCount(anchorId, alice), 0);
    }

    function test_FinalizedPendingLaunchCreditKeepsAnchorFanoutAfterSiblingCancel() public {
        ClusterPayoutOracle oracle = _configureLaunchOracle(601, _launchEpochSourcesForRange(600, 601));
        bytes32 anchorId = bytes32("anchor-finalized");
        bytes32 firstCommitKey = keccak256("finalized-pending-first");
        bytes32 secondCommitKey = keccak256("finalized-pending-second");

        pool.recordEarnedRaterRewardWithSourceReady(
            alice,
            1,
            600,
            firstCommitKey,
            8_000,
            3,
            true,
            pool.MIN_LAUNCH_CREDIT_STAKE(),
            _singleAnchor(anchorId),
            uint64(block.timestamp)
        );
        pool.recordEarnedRaterRewardWithSourceReady(
            alice,
            1,
            601,
            secondCommitKey,
            8_000,
            3,
            true,
            pool.MIN_LAUNCH_CREDIT_STAKE(),
            _singleAnchor(anchorId),
            uint64(block.timestamp)
        );

        IClusterPayoutOracle.PayoutWeight memory payout =
            _launchPayoutWeight(600, firstCommitKey, alice, 2_500, keccak256("finalized"));
        _proposeAndFinalizeLaunchPayoutSnapshot(oracle, 600, payout, keccak256("epoch-artifact"));
        assertEq(pool.finalizeEarnedRaterRewardCredit(1, 600, firstCommitKey, payout, new bytes32[](0)), 0);
        assertTrue(pool.raterVerifiedAnchorSeen(alice, anchorId));
        assertTrue(pool.verifiedAnchorRaterSeen(anchorId, alice));
        assertEq(pool.verifiedAnchorDistinctRaterCount(anchorId), 1);
        assertEq(pool.pendingVerifiedAnchorReservationCount(anchorId, alice), 1);

        vm.warp(block.timestamp + pool.STALE_PENDING_EARNED_RATER_CREDIT_DELAY());
        pool.cancelStalePendingEarnedRaterCredit(1, 601, secondCommitKey);
        assertTrue(pool.raterVerifiedAnchorSeen(alice, anchorId));
        assertTrue(pool.verifiedAnchorRaterSeen(anchorId, alice));
        assertEq(pool.verifiedAnchorDistinctRaterCount(anchorId), 1);
        assertEq(pool.pendingVerifiedAnchorReservationCount(anchorId, alice), 0);
    }

    function test_PendingLaunchCreditFinalizationDoesNotDoubleCountReservedAnchorFanout() public {
        ClusterPayoutOracle oracle = _configureLaunchOracle(1);

        assertEq(_recordLaunchReward(alice, 1, bytes32("anchor-a")), 0);
        assertEq(pool.raterDistinctVerifiedAnchorCount(alice), 0);
        assertEq(pool.verifiedAnchorDistinctRaterCount(bytes32("anchor-a")), 1);

        IClusterPayoutOracle.PayoutWeight memory payout =
            _launchPayoutWeight(1, _commitKey(1), alice, 2_500, keccak256("clustered"));
        _proposeAndFinalizeLaunchPayoutSnapshot(oracle, 1, payout, keccak256("epoch-artifact"));
        assertEq(pool.finalizeEarnedRaterRewardCredit(1, 1, _commitKey(1), payout, new bytes32[](0)), 0);

        assertEq(pool.raterDistinctVerifiedAnchorCount(alice), 1);
        assertEq(pool.raterDistinctAnchorRoundCount(alice), 1);
        assertEq(pool.verifiedAnchorDistinctRaterCount(bytes32("anchor-a")), 1);
    }

    function test_PendingAdvisoryLaunchCreditsReserveVerifiedAnchorFanoutAtRecordTime() public {
        _configureLaunchOracle(1);
        bytes32 anchorId = bytes32("advisory-anchor");
        uint256 maxFanout = pool.MAX_DISTINCT_RATERS_PER_VERIFIED_ANCHOR();

        for (uint256 i = 0; i < maxFanout; i++) {
            address rater = address(uint160(0x7200 + i));
            bytes32 commitKey = keccak256(abi.encode("pending-advisory-anchor", i));
            (bool recorded,) = pool.recordAdvisoryRaterRewardWithSourceReady(
                rater, 170 + i, 1, commitKey, 8_000, 3, true, _singleAnchor(anchorId), uint64(block.timestamp)
            );

            assertTrue(recorded);
            assertEq(pool.verifiedAnchorDistinctRaterCount(anchorId), i + 1);
        }

        bytes32 extraCommitKey = keccak256("pending-advisory-anchor-extra");
        (bool extraRecorded,) = pool.recordAdvisoryRaterRewardWithSourceReady(
            address(0xBEEF), 200, 1, extraCommitKey, 8_000, 3, true, _singleAnchor(anchorId), uint64(block.timestamp)
        );

        assertFalse(extraRecorded);
        assertEq(pool.verifiedAnchorDistinctRaterCount(anchorId), maxFanout);
    }

    function test_PendingLaunchCreditUsesRecordedOracleAfterRotation() public {
        ClusterPayoutOracle recordedOracle = _configureLaunchOracle(1);

        assertEq(_recordLaunchReward(alice, 1, bytes32("anchor-a")), 0);

        IClusterPayoutOracle.PayoutWeight memory payout =
            _launchPayoutWeight(1, _commitKey(1), alice, 2_500, keccak256("clustered"));

        ClusterPayoutOracle currentOracle = _configureLaunchOracle(1);
        _proposeAndFinalizeLaunchPayoutSnapshot(currentOracle, 1, payout, keccak256("epoch-artifact"));

        vm.expectRevert(LaunchDistributionPool.InvalidProof.selector);
        pool.finalizeEarnedRaterRewardCredit(1, 1, _commitKey(1), payout, new bytes32[](0));
        assertEq(pool.raterDistinctVerifiedAnchorCount(alice), 0);
        assertEq(pool.raterDistinctAnchorRoundCount(alice), 0);
        assertEq(pool.verifiedAnchorDistinctRaterCount(bytes32("anchor-a")), 1);

        _proposeAndFinalizeLaunchPayoutSnapshot(recordedOracle, 1, payout, keccak256("epoch-artifact"));

        uint256 paidAfterSnapshot = pool.finalizeEarnedRaterRewardCredit(1, 1, _commitKey(1), payout, new bytes32[](0));

        assertEq(paidAfterSnapshot, 0);
        assertEq(pool.qualifyingCreditBps(alice), 2_500);
        assertEq(pool.qualifyingRatingCount(alice), 0);
        assertTrue(pool.earnedRewardCreditFinalized(1, 1, _commitKey(1)));
    }

    function test_RescueStalePendingLaunchCreditRepointsOracleAndDefersAnchors() public {
        _configureLaunchOracle(80, _launchEpochSourcesForRange(80, 80));
        bytes32 commitKey = _commitKey(80);

        pool.recordEarnedRaterRewardWithSourceReady(
            alice,
            1,
            80,
            commitKey,
            8_000,
            3,
            true,
            pool.MIN_LAUNCH_CREDIT_STAKE(),
            _singleAnchor(bytes32("anchor-a")),
            uint64(block.timestamp)
        );
        uint64 readyAt = pool.pendingEarnedRaterCreditReadyAt(1, 80, commitKey);

        assertTrue(pool.earnedRewardCreditRecorded(1, 80, commitKey));
        assertEq(pool.raterDistinctVerifiedAnchorCount(alice), 0);
        assertEq(pool.raterDistinctAnchorRoundCount(alice), 0);
        assertEq(pool.verifiedAnchorDistinctRaterCount(bytes32("anchor-a")), 1);

        ClusterPayoutOracle currentOracle = _configureLaunchOracle(80, _launchEpochSourcesForRange(80, 80));
        pool.rescueStalePendingEarnedRaterCredit(1, 80, commitKey, 0);

        assertTrue(pool.earnedRewardCreditRecorded(1, 80, commitKey));
        assertTrue(pool.raterRoundCreditRecorded(alice, 1, 80));
        assertEq(pool.pendingEarnedRaterCreditReadyAt(1, 80, commitKey), readyAt);
        assertEq(pool.roundUnverifiedLaunchCreditCount(1, 80), 1);
        assertEq(pool.raterDistinctVerifiedAnchorCount(alice), 0);
        assertEq(pool.raterDistinctAnchorRoundCount(alice), 0);
        assertEq(pool.verifiedAnchorDistinctRaterCount(bytes32("anchor-a")), 1);

        IClusterPayoutOracle.PayoutWeight memory payout =
            _launchPayoutWeight(80, commitKey, alice, 2_500, keccak256("clustered"));
        _proposeAndFinalizeLaunchPayoutSnapshot(currentOracle, 80, payout, keccak256("epoch-artifact"));
        assertEq(pool.finalizeEarnedRaterRewardCredit(1, 80, commitKey, payout, new bytes32[](0)), 0);
        assertEq(pool.raterDistinctVerifiedAnchorCount(alice), 1);
        assertEq(pool.raterDistinctAnchorRoundCount(alice), 1);
        assertEq(pool.verifiedAnchorDistinctRaterCount(bytes32("anchor-a")), 1);
    }

    function test_PartialLaunchCreditFinalizationBlocksRootReplacement() public {
        ClusterPayoutOracle oracle = _configureLaunchOracle(1);
        bytes32 aliceCommitKey = _commitKey(1);
        bytes32 bobCommitKey = keccak256(abi.encode("bob", uint256(1)));

        assertEq(
            pool.recordEarnedRaterRewardWithSourceReady(
                alice,
                1,
                1,
                aliceCommitKey,
                8_000,
                3,
                true,
                pool.MIN_LAUNCH_CREDIT_STAKE(),
                _singleAnchor(bytes32("anchor-a")),
                uint64(block.timestamp)
            ),
            0
        );
        assertEq(
            pool.recordEarnedRaterRewardWithSourceReady(
                bob,
                1,
                1,
                bobCommitKey,
                8_000,
                3,
                true,
                pool.MIN_LAUNCH_CREDIT_STAKE(),
                _singleAnchor(bytes32("anchor-b")),
                uint64(block.timestamp)
            ),
            0
        );

        IClusterPayoutOracle.PayoutWeight memory alicePayout =
            _launchPayoutWeight(1, aliceCommitKey, alice, 2_500, keccak256("alice-clustered"));
        _proposeAndFinalizeLaunchPayoutSnapshot(oracle, 1, alicePayout, keccak256("epoch-artifact"));

        assertEq(pool.finalizeEarnedRaterRewardCredit(1, 1, aliceCommitKey, alicePayout, new bytes32[](0)), 0);
        assertTrue(pool.earnedRewardCreditFinalized(1, 1, aliceCommitKey));
        assertTrue(pool.isRoundPayoutSnapshotConsumed(pool.PAYOUT_DOMAIN_LAUNCH_CREDIT(), 0, 1, 1));

        bytes32 snapshotKey = oracle.roundPayoutSnapshotKey(pool.PAYOUT_DOMAIN_LAUNCH_CREDIT(), 0, 1, 1);
        oracle.rejectFinalizedRoundPayoutSnapshot(snapshotKey, keccak256("replace-partial-root"));
        assertTrue(oracle.rejectedRoundPayoutSnapshotConsumed(snapshotKey));

        IClusterPayoutOracle.PayoutWeight memory bobPayout =
            _launchPayoutWeight(1, bobCommitKey, bob, 2_500, keccak256("bob-clustered"));
        uint8 launchDomain = pool.PAYOUT_DOMAIN_LAUNCH_CREDIT();
        bytes32 bobLeaf = oracle.payoutWeightLeaf(bobPayout);
        vm.expectRevert(ClusterPayoutOracle.SnapshotConsumed.selector);
        oracle.proposeRoundPayoutSnapshot(
            IClusterPayoutOracle.RoundPayoutSnapshotInput({
                domain: launchDomain,
                rewardPoolId: 0,
                contentId: 1,
                roundId: 1,
                correlationEpochId: 1,
                rawEligibleVoters: 1,
                effectiveParticipantUnits: uint32(bobPayout.effectiveWeight),
                totalClaimWeight: bobPayout.effectiveWeight,
                weightRoot: bobLeaf,
                reasonRoot: keccak256("reason-root"),
                artifactHash: keccak256("epoch-artifact"),
                artifactURI: "ipfs://round"
            })
        );

        // M-Funds-3: finalize clears `pendingEarnedRaterCredits`, so a re-finalize attempt
        // now hits the `!pending.pending` guard (InvalidAmount) before reaching the
        // earnedRewardCreditFinalized check (AlreadyClaimed). Both expressions prevent the
        // double-finalize; the new revert is semantically tighter (the pending IOU is gone).
        vm.expectRevert(LaunchDistributionPool.InvalidAmount.selector);
        pool.finalizeEarnedRaterRewardCredit(1, 1, aliceCommitKey, alicePayout, new bytes32[](0));
    }

    function test_PaidLaunchCreditFinalizationBlocksRootReplacement() public {
        ClusterPayoutOracle oracle = _configureLaunchOracle(5);

        uint256 paid;
        for (uint256 roundId = 1; roundId < 5; roundId++) {
            paid = _recordAndFinalizeLaunchOracleCredit(oracle, alice, roundId, pool.BPS_DENOMINATOR());
            assertEq(paid, 0);
            assertTrue(pool.isRoundPayoutSnapshotConsumed(pool.PAYOUT_DOMAIN_LAUNCH_CREDIT(), 0, 1, roundId));
        }

        paid = _recordAndFinalizeLaunchOracleCredit(oracle, alice, 5, pool.BPS_DENOMINATOR());
        assertEq(paid, FIRST_COHORT_UNVERIFIED_SLOT);
        assertTrue(pool.isRoundPayoutSnapshotConsumed(pool.PAYOUT_DOMAIN_LAUNCH_CREDIT(), 0, 1, 5));

        bytes32 snapshotKey = oracle.roundPayoutSnapshotKey(pool.PAYOUT_DOMAIN_LAUNCH_CREDIT(), 0, 1, 5);

        // Past the finalization veto window, a consumed snapshot cannot be rejected.
        vm.warp(block.timestamp + oracle.FINALIZATION_VETO_WINDOW() + 1);
        vm.expectRevert(ClusterPayoutOracle.SnapshotConsumed.selector);
        oracle.rejectFinalizedRoundPayoutSnapshot(snapshotKey, keccak256("paid-launch-root"));
    }

    function test_CorrelationOracleFractionalCreditsOnlyPayCompletedSlots() public {
        ClusterPayoutOracle oracle = _configureLaunchOracle(24);

        uint256 paid;
        for (uint256 roundId = 1; roundId < 20; roundId++) {
            paid = _recordAndFinalizeLaunchOracleCredit(oracle, alice, roundId, 2_500);
            assertEq(paid, 0);
        }

        paid = _recordAndFinalizeLaunchOracleCredit(oracle, alice, 20, 2_500);
        assertEq(paid, FIRST_COHORT_UNVERIFIED_SLOT);
        assertEq(pool.qualifyingCreditBps(alice), 50_000);
        assertEq(pool.qualifyingRatingCount(alice), 5);
        assertEq(pool.rewardedRatingCount(alice), 1);
        assertEq(pool.raterLaunchPaid(alice), FIRST_COHORT_UNVERIFIED_SLOT);
        assertEq(lrep.balanceOf(alice), FIRST_COHORT_UNVERIFIED_SLOT);

        for (uint256 roundId = 21; roundId < 24; roundId++) {
            paid = _recordAndFinalizeLaunchOracleCredit(oracle, alice, roundId, 2_500);
            assertEq(paid, 0);
        }

        assertEq(pool.qualifyingCreditBps(alice), 57_500);
        assertEq(pool.qualifyingRatingCount(alice), 5);
        assertEq(pool.rewardedRatingCount(alice), 1);
        assertEq(pool.raterLaunchPaid(alice), FIRST_COHORT_UNVERIFIED_SLOT);

        paid = _recordAndFinalizeLaunchOracleCredit(oracle, alice, 24, 2_500);
        assertEq(paid, FIRST_COHORT_UNVERIFIED_SLOT);
        assertEq(pool.qualifyingCreditBps(alice), 60_000);
        assertEq(pool.qualifyingRatingCount(alice), 6);
        assertEq(pool.rewardedRatingCount(alice), 2);
        assertEq(pool.raterLaunchPaid(alice), FIRST_COHORT_UNVERIFIED_SLOT * 2);
        assertEq(lrep.balanceOf(alice), FIRST_COHORT_UNVERIFIED_SLOT * 2);
    }

    function test_RecordEarnedRaterRewardAppliesLowerUnverifiedCapWhenGovernanceSetsBps() public {
        ILaunchDistributionPool.LaunchRewardPolicy memory policy = _defaultPolicy();
        policy.unverifiedEarnedRaterCapBps = 2_500;
        pool.setLaunchRewardPolicy(policy);

        uint256 firstReward = _recordFiveEligibleCredits(alice);

        assertEq(firstReward, FIRST_COHORT_UNVERIFIED_SLOT);
        assertEq(pool.raterLaunchCap(alice), FIRST_COHORT_UNVERIFIED_CAP);
        assertEq(pool.raterFullLaunchCap(alice), FIRST_COHORT_FULL_CAP);
        assertEq(pool.raterLaunchPaid(alice), FIRST_COHORT_UNVERIFIED_SLOT);
        assertFalse(pool.raterFullLaunchCapUnlocked(alice));

        for (uint256 i = 0; i < 9; i++) {
            bytes32 anchorId = i % 2 == 0 ? bytes32("anchor-b") : bytes32("anchor-a");
            pool.recordEarnedRaterRewardWithSourceReady(
                alice,
                1,
                i + 6,
                _commitKey(i + 6),
                8_000,
                3,
                true,
                pool.MIN_LAUNCH_CREDIT_STAKE(),
                _singleAnchor(anchorId),
                uint64(block.timestamp)
            );
        }

        assertEq(pool.rewardedRatingCount(alice), 10);
        assertEq(pool.raterLaunchPaid(alice), FIRST_COHORT_UNVERIFIED_CAP);
        assertEq(lrep.balanceOf(alice), FIRST_COHORT_UNVERIFIED_CAP);
    }

    function test_UnlockFullEarnedRaterCapPaysCatchUpAfterLaterHumanVerification() public {
        ILaunchDistributionPool.LaunchRewardPolicy memory policy = _defaultPolicy();
        policy.unverifiedEarnedRaterCapBps = 2_500;
        pool.setLaunchRewardPolicy(policy);

        _recordFiveEligibleCredits(alice);
        assertEq(pool.rewardedRatingCount(alice), 1);
        assertEq(pool.raterLaunchPaid(alice), FIRST_COHORT_UNVERIFIED_SLOT);

        _verify(alice, bytes32("alice-human"));

        vm.expectEmit(true, true, false, true);
        emit RaterLaunchCapUnlocked(
            alice,
            bytes32("alice-human"),
            FIRST_COHORT_UNVERIFIED_CAP,
            FIRST_COHORT_FULL_CAP,
            FIRST_COHORT_FULL_SLOT - FIRST_COHORT_UNVERIFIED_SLOT
        );
        uint256 catchUp = pool.unlockFullEarnedRaterCap(alice);

        assertEq(catchUp, FIRST_COHORT_FULL_SLOT - FIRST_COHORT_UNVERIFIED_SLOT);
        assertEq(pool.raterLaunchCap(alice), FIRST_COHORT_FULL_CAP);
        assertEq(pool.raterFullLaunchCap(alice), FIRST_COHORT_FULL_CAP);
        assertTrue(pool.raterFullLaunchCapUnlocked(alice));
        assertEq(pool.raterLaunchCapNullifier(alice), bytes32("alice-human"));
        assertEq(
            pool.launchFullCapNullifierRater(
                _credentialKey(RaterRegistry.HumanCredentialProvider.WorldId, bytes32("alice-human"))
            ),
            alice
        );
        assertEq(pool.raterLaunchPaid(alice), FIRST_COHORT_FULL_SLOT);
        assertEq(lrep.balanceOf(alice), FIRST_COHORT_FULL_SLOT);
    }

    function test_UnlockFullEarnedRaterCapPartialPoolDoesNotConsumeFullCatchUpSlot() public {
        ILaunchDistributionPool.LaunchRewardPolicy memory policy = _defaultPolicy();
        policy.unverifiedEarnedRaterCapBps = 2_500;
        pool.setLaunchRewardPolicy(policy);

        _recordFiveEligibleCredits(alice);
        assertEq(pool.rewardedRatingCount(alice), 1);
        assertEq(pool.raterLaunchPaid(alice), FIRST_COHORT_UNVERIFIED_SLOT);

        _verify(alice, bytes32("alice-human"));
        _setEarnedRaterDistributed(pool.EARNED_RATER_POOL_AMOUNT() - 6_250_000);
        uint256 catchUp = pool.unlockFullEarnedRaterCap(alice);

        assertEq(catchUp, 6_250_000);
        assertEq(pool.raterLaunchPaid(alice), 18_750_000);
        assertEq(pool.rewardedRatingCount(alice), 1);
        assertEq(lrep.balanceOf(alice), 18_750_000);
    }

    function test_UnlockFullEarnedRaterCapPaysCompletedUnverifiedSlots() public {
        ILaunchDistributionPool.LaunchRewardPolicy memory policy = _defaultPolicy();
        policy.unverifiedEarnedRaterCapBps = 2_500;
        pool.setLaunchRewardPolicy(policy);

        _recordFiveEligibleCredits(alice);
        for (uint256 i = 0; i < 9; i++) {
            bytes32 anchorId = i % 2 == 0 ? bytes32("anchor-b") : bytes32("anchor-a");
            pool.recordEarnedRaterRewardWithSourceReady(
                alice,
                1,
                i + 6,
                _commitKey(i + 6),
                8_000,
                3,
                true,
                pool.MIN_LAUNCH_CREDIT_STAKE(),
                _singleAnchor(anchorId),
                uint64(block.timestamp)
            );
        }
        assertEq(pool.rewardedRatingCount(alice), 10);
        assertEq(pool.raterLaunchPaid(alice), FIRST_COHORT_UNVERIFIED_CAP);

        _verify(alice, bytes32("alice-human"));
        uint256 catchUp = pool.unlockFullEarnedRaterCap(alice);

        assertEq(catchUp, FIRST_COHORT_FULL_CAP - FIRST_COHORT_UNVERIFIED_CAP);
        assertEq(pool.rewardedRatingCount(alice), 10);
        assertEq(pool.raterLaunchPaid(alice), FIRST_COHORT_FULL_CAP);
        assertEq(lrep.balanceOf(alice), FIRST_COHORT_FULL_CAP);
    }

    function test_VerifiedRaterReceivesFullCapAtEligibility() public {
        ILaunchDistributionPool.LaunchRewardPolicy memory policy = _defaultPolicy();
        policy.unverifiedEarnedRaterCapBps = 2_500;
        pool.setLaunchRewardPolicy(policy);
        _verify(alice, bytes32("alice-human"));

        uint256 firstReward = _recordFiveEligibleCredits(alice);

        assertEq(firstReward, FIRST_COHORT_FULL_SLOT);
        assertEq(pool.raterLaunchCap(alice), FIRST_COHORT_FULL_CAP);
        assertEq(pool.raterFullLaunchCap(alice), FIRST_COHORT_FULL_CAP);
        assertTrue(pool.raterFullLaunchCapUnlocked(alice));
        assertEq(pool.raterLaunchCapNullifier(alice), bytes32("alice-human"));
        assertEq(
            pool.launchFullCapNullifierRater(
                _credentialKey(RaterRegistry.HumanCredentialProvider.WorldId, bytes32("alice-human"))
            ),
            alice
        );
    }

    function test_OneNullifierCannotUnlockFullEarnedCapForTwoRaters() public {
        ILaunchDistributionPool.LaunchRewardPolicy memory policy = _defaultPolicy();
        policy.unverifiedEarnedRaterCapBps = 2_500;
        pool.setLaunchRewardPolicy(policy);

        _verify(alice, bytes32("shared-human"));
        _recordFiveEligibleCredits(alice);
        assertTrue(pool.raterFullLaunchCapUnlocked(alice));

        registry.revokeHumanCredential(alice);
        registry.clearRevokedHumanNullifier(RaterRegistry.HumanCredentialProvider.WorldId, bytes32("shared-human"));
        _verify(bob, bytes32("shared-human"));
        for (uint256 i = 0; i < 5; i++) {
            bytes32 anchorId = i % 2 == 0 ? bytes32("anchor-a") : bytes32("anchor-b");
            pool.recordEarnedRaterRewardWithSourceReady(
                bob,
                2,
                i + 1,
                _commitKey(100 + i),
                8_000,
                3,
                true,
                pool.MIN_LAUNCH_CREDIT_STAKE(),
                _singleAnchor(anchorId),
                uint64(block.timestamp)
            );
        }

        assertEq(pool.raterLaunchCap(bob), FIRST_COHORT_UNVERIFIED_CAP);
        assertFalse(pool.raterFullLaunchCapUnlocked(bob));
        vm.expectRevert(LaunchDistributionPool.AlreadyClaimed.selector);
        pool.unlockFullEarnedRaterCap(bob);
    }

    function test_ConfiguredWorldIdV4ClosesLegacyFullCapDoubleUsePath() public {
        ILaunchDistributionPool.LaunchRewardPolicy memory policy = _defaultPolicy();
        policy.unverifiedEarnedRaterCapBps = 2_500;
        pool.setLaunchRewardPolicy(policy);
        _configureWorldIdV4();
        registry.setWorldIdV4UnaliasedLaunchNullifiersAllowed(true);

        _verifyV4(alice, bytes32("alice-v4-human"));
        _recordFiveEligibleCredits(alice);
        assertTrue(pool.raterFullLaunchCapUnlocked(alice));

        uint256[8] memory legacyProof;
        vm.prank(bob);
        vm.expectRevert(RaterRegistry.LegacyWorldIdAttestationDisabled.selector);
        registry.attestHumanCredentialWithProof(1, uint256(bytes32("bob-legacy-human")), legacyProof);
    }

    function test_WorldIdV4FullCapAssignmentConsumesUnaliasedLaunchNullifier() public {
        ILaunchDistributionPool.LaunchRewardPolicy memory policy = _defaultPolicy();
        policy.unverifiedEarnedRaterCapBps = 2_500;
        pool.setLaunchRewardPolicy(policy);
        bytes32 v4Nullifier = bytes32("alice-v4-human");

        _configureWorldIdV4();
        registry.setWorldIdV4UnaliasedLaunchNullifiersAllowed(true);
        _verifyV4(alice, v4Nullifier);

        assertEq(_recordFiveEligibleCredits(alice), FIRST_COHORT_FULL_SLOT);

        assertTrue(pool.raterFullLaunchCapUnlocked(alice));
        assertTrue(registry.worldIdV4LaunchNullifierSeen(v4Nullifier));
        vm.expectRevert(RaterRegistry.InvalidCredential.selector);
        registry.setWorldIdV4LaunchNullifierAlias(v4Nullifier, bytes32("legacy-human"));
    }

    function test_WorldIdV4UnlockFullEarnedRaterCapConsumesUnaliasedLaunchNullifier() public {
        ILaunchDistributionPool.LaunchRewardPolicy memory policy = _defaultPolicy();
        policy.unverifiedEarnedRaterCapBps = 2_500;
        pool.setLaunchRewardPolicy(policy);
        bytes32 v4Nullifier = bytes32("alice-v4-human");

        _recordFiveEligibleCredits(alice);
        assertEq(pool.raterLaunchCap(alice), FIRST_COHORT_UNVERIFIED_CAP);

        _configureWorldIdV4();
        registry.setWorldIdV4UnaliasedLaunchNullifiersAllowed(true);
        _verifyV4(alice, v4Nullifier);
        uint256 catchUp = pool.unlockFullEarnedRaterCap(alice);

        assertEq(catchUp, FIRST_COHORT_FULL_SLOT - FIRST_COHORT_UNVERIFIED_SLOT);
        assertTrue(registry.worldIdV4LaunchNullifierSeen(v4Nullifier));
        vm.expectRevert(RaterRegistry.InvalidCredential.selector);
        registry.setWorldIdV4LaunchNullifierAlias(v4Nullifier, bytes32("legacy-human"));
    }

    function test_LegacyAndV4SharedNullifierCannotUnlockFullEarnedCapTwice() public {
        ILaunchDistributionPool.LaunchRewardPolicy memory policy = _defaultPolicy();
        policy.unverifiedEarnedRaterCapBps = 2_500;
        pool.setLaunchRewardPolicy(policy);

        _verify(alice, bytes32("shared-human"));
        _recordFiveEligibleCredits(alice);
        assertTrue(pool.raterFullLaunchCapUnlocked(alice));

        _configureWorldIdV4();
        vm.expectRevert(RaterRegistry.NullifierAlreadyAssigned.selector);
        _verifyV4(bob, bytes32("shared-human"));
    }

    function test_WorldIdV4DifferentNullifierCannotUnlockFullCapWithoutAlias() public {
        ILaunchDistributionPool.LaunchRewardPolicy memory policy = _defaultPolicy();
        policy.unverifiedEarnedRaterCapBps = 2_500;
        pool.setLaunchRewardPolicy(policy);
        bytes32 legacyNullifier = bytes32("legacy-human");
        bytes32 v4Nullifier = bytes32("v4-human");

        _verify(alice, legacyNullifier);
        _recordFiveEligibleCredits(alice);
        assertTrue(pool.raterFullLaunchCapUnlocked(alice));

        for (uint256 i = 0; i < 5; i++) {
            bytes32 anchorId = i % 2 == 0 ? bytes32("anchor-a") : bytes32("anchor-b");
            pool.recordEarnedRaterRewardWithSourceReady(
                bob,
                2,
                i + 1,
                _commitKey(100 + i),
                8_000,
                3,
                true,
                pool.MIN_LAUNCH_CREDIT_STAKE(),
                _singleAnchor(anchorId),
                uint64(block.timestamp)
            );
        }

        assertEq(pool.raterLaunchCap(bob), FIRST_COHORT_UNVERIFIED_CAP);
        assertFalse(pool.raterFullLaunchCapUnlocked(bob));

        _configureWorldIdV4();
        _verifyV4(bob, v4Nullifier);
        vm.expectRevert(RaterRegistry.InvalidCredential.selector);
        pool.unlockFullEarnedRaterCap(bob);
    }

    function test_WorldIdV4LaunchAliasPreventsDifferentNullifierFullCapDoubleUse() public {
        ILaunchDistributionPool.LaunchRewardPolicy memory policy = _defaultPolicy();
        policy.unverifiedEarnedRaterCapBps = 2_500;
        pool.setLaunchRewardPolicy(policy);
        bytes32 legacyNullifier = bytes32("legacy-human");
        bytes32 v4Nullifier = bytes32("v4-human");

        _verify(alice, legacyNullifier);
        _recordFiveEligibleCredits(alice);
        assertTrue(pool.raterFullLaunchCapUnlocked(alice));

        _configureWorldIdV4();
        registry.setWorldIdV4LaunchNullifierAlias(v4Nullifier, legacyNullifier);
        _verifyV4(bob, v4Nullifier);
        for (uint256 i = 0; i < 5; i++) {
            bytes32 anchorId = i % 2 == 0 ? bytes32("anchor-a") : bytes32("anchor-b");
            pool.recordEarnedRaterRewardWithSourceReady(
                bob,
                2,
                i + 1,
                _commitKey(100 + i),
                8_000,
                3,
                true,
                pool.MIN_LAUNCH_CREDIT_STAKE(),
                _singleAnchor(anchorId),
                uint64(block.timestamp)
            );
        }

        assertEq(pool.raterLaunchCap(bob), FIRST_COHORT_UNVERIFIED_CAP);
        assertFalse(pool.raterFullLaunchCapUnlocked(bob));
        vm.expectRevert(LaunchDistributionPool.AlreadyClaimed.selector);
        pool.unlockFullEarnedRaterCap(bob);
        assertFalse(registry.worldIdV4LaunchNullifierSeen(v4Nullifier));
    }

    function test_UnlockFullEarnedRaterCapRequiresActiveCredential() public {
        ILaunchDistributionPool.LaunchRewardPolicy memory policy = _defaultPolicy();
        policy.unverifiedEarnedRaterCapBps = 2_500;
        pool.setLaunchRewardPolicy(policy);
        _recordFiveEligibleCredits(alice);

        vm.expectRevert(LaunchDistributionPool.NotVerified.selector);
        pool.unlockFullEarnedRaterCap(alice);

        _verify(alice, bytes32("alice-human"));
        registry.revokeHumanCredential(alice);

        vm.expectRevert(LaunchDistributionPool.NotVerified.selector);
        pool.unlockFullEarnedRaterCap(alice);
    }

    function test_RecordEarnedRaterRewardEmitsCreditProgressBeforeAndAtEligibility() public {
        vm.expectEmit(true, true, true, true);
        emit EarnedRaterRewardCreditRecorded(alice, 1, 1, _commitKey(1), 8_000, 1, 10_000, 1, 1, false);
        assertEq(
            pool.recordEarnedRaterRewardWithSourceReady(
                alice,
                1,
                1,
                _commitKey(1),
                8_000,
                3,
                true,
                pool.MIN_LAUNCH_CREDIT_STAKE(),
                _singleAnchor(bytes32("anchor-a")),
                uint64(block.timestamp)
            ),
            0
        );

        for (uint256 i = 0; i < 3; i++) {
            bytes32 anchorId = i % 2 == 0 ? bytes32("anchor-b") : bytes32("anchor-a");
            pool.recordEarnedRaterRewardWithSourceReady(
                alice,
                1,
                2 + i,
                _commitKey(2 + i),
                8_000,
                3,
                true,
                pool.MIN_LAUNCH_CREDIT_STAKE(),
                _singleAnchor(anchorId),
                uint64(block.timestamp)
            );
        }

        vm.expectEmit(true, true, true, true);
        emit EarnedRaterRewardCreditRecorded(alice, 1, 5, _commitKey(5), 8_000, 5, 50_000, 2, 5, true);
        assertEq(
            pool.recordEarnedRaterRewardWithSourceReady(
                alice,
                1,
                5,
                _commitKey(5),
                8_000,
                3,
                true,
                pool.MIN_LAUNCH_CREDIT_STAKE(),
                _singleAnchor(bytes32("anchor-a")),
                uint64(block.timestamp)
            ),
            FIRST_COHORT_UNVERIFIED_SLOT
        );
    }

    function test_CurrentRaterLaunchCapUsesFrontLoadedCurve() public {
        _setEligibleRaterCount(0);
        assertEq(pool.currentRaterLaunchCap(), FIRST_COHORT_FULL_CAP);

        _setEligibleRaterCount(99);
        assertEq(pool.currentRaterLaunchCap(), FIRST_COHORT_FULL_CAP);

        _setEligibleRaterCount(100);
        assertEq(pool.currentRaterLaunchCap(), 250e6);

        _setEligibleRaterCount(999);
        assertEq(pool.currentRaterLaunchCap(), 250e6);

        _setEligibleRaterCount(1_000);
        assertEq(pool.currentRaterLaunchCap(), 100e6);

        _setEligibleRaterCount(9_999);
        assertEq(pool.currentRaterLaunchCap(), 100e6);

        _setEligibleRaterCount(10_000);
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

    function test_CurrentVerifiedBonusUsesFrontLoadedCurve() public {
        _setVerifiedClaimCount(0);
        assertEq(pool.currentVerifiedBonus(), 250e6);

        _setVerifiedClaimCount(99);
        assertEq(pool.currentVerifiedBonus(), 250e6);

        _setVerifiedClaimCount(100);
        assertEq(pool.currentVerifiedBonus(), 100e6);

        _setVerifiedClaimCount(999);
        assertEq(pool.currentVerifiedBonus(), 100e6);

        _setVerifiedClaimCount(1_000);
        assertEq(pool.currentVerifiedBonus(), 40e6);

        _setVerifiedClaimCount(9_999);
        assertEq(pool.currentVerifiedBonus(), 40e6);

        _setVerifiedClaimCount(10_000);
        assertEq(pool.currentVerifiedBonus(), 10e6);

        _setVerifiedClaimCount(49_999);
        assertEq(pool.currentVerifiedBonus(), 10e6);

        _setVerifiedClaimCount(50_000);
        assertEq(pool.currentVerifiedBonus(), 5e6);

        _setVerifiedClaimCount(199_999);
        assertEq(pool.currentVerifiedBonus(), 5e6);

        _setVerifiedClaimCount(200_000);
        assertEq(pool.currentVerifiedBonus(), 2_500_000);

        _setVerifiedClaimCount(999_999);
        assertEq(pool.currentVerifiedBonus(), 2_500_000);

        _setVerifiedClaimCount(1_000_000);
        assertEq(pool.currentVerifiedBonus(), 1e6);
    }

    function test_RecordEarnedRaterRewardIgnoresLowScoresAndUnauthorizedCallers() public {
        assertEq(_recordLaunchRewardWithScore(alice, 1, bytes32("anchor-a"), 6_999), 0);
        assertEq(pool.qualifyingRatingCount(alice), 0);

        bytes32[] memory anchors = _singleAnchor(bytes32("anchor-a"));
        vm.prank(bob);
        vm.expectRevert(LaunchDistributionPool.InvalidAddress.selector);
        pool.recordEarnedRaterRewardWithSourceReady(
            alice, 1, 1, _commitKey(1), 8_000, 3, true, 1e6, anchors, uint64(block.timestamp)
        );
    }

    function test_RecordEarnedRaterRewardRequiresRoundContext() public {
        assertEq(
            pool.recordEarnedRaterRewardWithSourceReady(
                alice,
                1,
                1,
                _commitKey(1),
                8_000,
                2,
                true,
                pool.MIN_LAUNCH_CREDIT_STAKE(),
                _singleAnchor(bytes32("anchor-a")),
                uint64(block.timestamp)
            ),
            0
        );
        assertEq(
            pool.recordEarnedRaterRewardWithSourceReady(
                alice,
                1,
                2,
                _commitKey(2),
                8_000,
                3,
                true,
                pool.MIN_LAUNCH_CREDIT_STAKE(),
                new bytes32[](0),
                uint64(block.timestamp)
            ),
            0
        );
        assertEq(
            pool.recordEarnedRaterRewardWithSourceReady(
                alice,
                1,
                3,
                _commitKey(3),
                8_000,
                3,
                false,
                pool.MIN_LAUNCH_CREDIT_STAKE(),
                _singleAnchor(bytes32("anchor-a")),
                uint64(block.timestamp)
            ),
            0
        );

        assertEq(pool.qualifyingRatingCount(alice), 0);
        assertEq(pool.raterDistinctVerifiedAnchorCount(alice), 0);
        assertEq(pool.raterDistinctAnchorRoundCount(alice), 0);
    }

    function test_RecordEarnedRaterRewardRequiresMinimumLaunchCreditStake() public {
        assertEq(
            pool.recordEarnedRaterRewardWithSourceReady(
                alice,
                1,
                1,
                _commitKey(1),
                8_000,
                3,
                true,
                pool.MIN_LAUNCH_CREDIT_STAKE() - 1,
                _singleAnchor(bytes32("anchor-a")),
                uint64(block.timestamp)
            ),
            0
        );
        assertFalse(pool.earnedRewardCreditRecorded(1, 1, _commitKey(1)));
        assertEq(pool.qualifyingRatingCount(alice), 0);

        assertEq(_recordLaunchReward(alice, 1, bytes32("anchor-a")), 0);
        assertTrue(pool.earnedRewardCreditRecorded(1, 1, _commitKey(1)));
        assertEq(pool.qualifyingRatingCount(alice), 1);
    }

    function test_RecordAdvisoryRaterRewardAllowsZeroStakeUnderUnverifiedCap() public {
        for (uint256 i = 0; i < 4; i++) {
            bytes32 anchorId = i % 2 == 0 ? bytes32("anchor-a") : bytes32("anchor-b");
            (bool recorded, uint256 intermediatePaid) = pool.recordAdvisoryRaterRewardWithSourceReady(
                alice,
                1,
                i + 1,
                keccak256(abi.encode("advisory", i)),
                8_000,
                3,
                true,
                _singleAnchor(anchorId),
                uint64(block.timestamp)
            );
            assertTrue(recorded);
            assertEq(intermediatePaid, 0);
        }

        (bool fifthRecorded, uint256 paid) = pool.recordAdvisoryRaterRewardWithSourceReady(
            alice,
            1,
            5,
            keccak256(abi.encode("advisory", uint256(5))),
            8_000,
            3,
            true,
            _singleAnchor(bytes32("anchor-a")),
            uint64(block.timestamp)
        );

        assertEq(pool.raterFullLaunchCap(alice), FIRST_COHORT_FULL_CAP);
        assertEq(pool.raterLaunchCap(alice), FIRST_COHORT_UNVERIFIED_CAP);
        assertTrue(fifthRecorded);
        assertEq(paid, FIRST_COHORT_UNVERIFIED_SLOT);
        assertEq(pool.qualifyingRatingCount(alice), 5);
    }

    function test_PendingAdvisoryLaunchCreditDefersAnchorsUntilFinalize() public {
        ClusterPayoutOracle oracle = _configureLaunchOracle(1);
        bytes32 advisoryCommitKey = bytes32("advisory-pending");

        (bool recorded, uint256 paidBeforeSnapshot) = pool.recordAdvisoryRaterRewardWithSourceReady(
            alice, 1, 1, advisoryCommitKey, 8_000, 3, true, _singleAnchor(bytes32("anchor-a")), uint64(block.timestamp)
        );

        assertTrue(recorded);
        assertEq(paidBeforeSnapshot, 0);
        assertEq(pool.raterDistinctVerifiedAnchorCount(alice), 0);
        assertEq(pool.raterDistinctAnchorRoundCount(alice), 0);
        assertEq(pool.verifiedAnchorDistinctRaterCount(bytes32("anchor-a")), 1);

        IClusterPayoutOracle.PayoutWeight memory payout =
            _launchPayoutWeight(1, advisoryCommitKey, alice, pool.BPS_DENOMINATOR(), keccak256("advisory"));
        _proposeAndFinalizeLaunchPayoutSnapshot(oracle, 1, payout, keccak256("epoch-artifact"));

        uint256 paidAfterSnapshot =
            pool.finalizeEarnedRaterRewardCredit(1, 1, advisoryCommitKey, payout, new bytes32[](0));

        assertEq(paidAfterSnapshot, 0);
        assertEq(pool.qualifyingRatingCount(alice), 1);
        assertEq(pool.raterDistinctVerifiedAnchorCount(alice), 1);
        assertEq(pool.raterDistinctAnchorRoundCount(alice), 1);
        assertEq(pool.verifiedAnchorDistinctRaterCount(bytes32("anchor-a")), 1);
    }

    function test_RecordAdvisoryRaterRewardDoesNotDoubleCreditSameRaterRound() public {
        bytes32 countedCommitKey = _commitKey(1);
        uint256 countedPaid = pool.recordEarnedRaterRewardWithSourceReady(
            alice,
            1,
            1,
            countedCommitKey,
            8_000,
            3,
            true,
            pool.MIN_LAUNCH_CREDIT_STAKE(),
            _singleAnchor(bytes32("anchor-a")),
            uint64(block.timestamp)
        );
        (bool advisoryRecorded, uint256 advisoryPaid) = pool.recordAdvisoryRaterRewardWithSourceReady(
            alice,
            1,
            1,
            bytes32("advisory-1"),
            8_000,
            3,
            true,
            _singleAnchor(bytes32("anchor-b")),
            uint64(block.timestamp)
        );

        assertEq(countedPaid, 0);
        assertFalse(advisoryRecorded);
        assertEq(advisoryPaid, 0);
        assertTrue(pool.earnedRewardCreditRecorded(1, 1, countedCommitKey));
        assertFalse(pool.earnedRewardCreditRecorded(1, 1, bytes32("advisory-1")));
        assertTrue(pool.raterRoundCreditRecorded(alice, 1, 1));
        assertEq(pool.qualifyingRatingCount(alice), 1);
        assertEq(pool.raterDistinctAnchorRoundCount(alice), 1);
    }

    function test_RecordAdvisoryRaterRewardCanRetryAfterUnverifiedRoundCapUntilVerified() public {
        bytes32 anchorId = bytes32("anchor-a");
        uint256 maxCredits = pool.MAX_UNVERIFIED_LAUNCH_CREDITS_PER_ROUND();

        for (uint256 i = 0; i < maxCredits; i++) {
            address rater = address(uint160(0x5000 + i));
            (bool recorded,) = pool.recordAdvisoryRaterRewardWithSourceReady(
                rater,
                50,
                1,
                keccak256(abi.encode("advisory", i)),
                8_000,
                3,
                true,
                _singleAnchor(anchorId),
                uint64(block.timestamp)
            );
            assertTrue(recorded);
        }

        bytes32 advisoryCommitKey = bytes32("advisory-blocked");
        (bool blockedRecorded,) = pool.recordAdvisoryRaterRewardWithSourceReady(
            alice, 50, 1, advisoryCommitKey, 8_000, 3, true, _singleAnchor(anchorId), uint64(block.timestamp)
        );
        assertFalse(blockedRecorded);
        assertFalse(pool.earnedRewardCreditRecorded(50, 1, advisoryCommitKey));
        assertFalse(pool.raterRoundCreditRecorded(alice, 50, 1));

        _verify(alice, bytes32("verified-advisory-alice"));
        (bool retryRecorded,) = pool.recordAdvisoryRaterRewardWithSourceReady(
            alice, 50, 1, advisoryCommitKey, 8_000, 3, true, _singleAnchor(anchorId), uint64(block.timestamp)
        );
        assertTrue(retryRecorded);
        assertTrue(pool.earnedRewardCreditRecorded(50, 1, advisoryCommitKey));
        assertTrue(pool.raterRoundCreditRecorded(alice, 50, 1));
        assertEq(pool.roundUnverifiedLaunchCreditCount(50, 1), maxCredits);
        assertEq(pool.qualifyingRatingCount(alice), 1);
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
        assertEq(firstReward, FIRST_COHORT_UNVERIFIED_SLOT);
        assertEq(pool.raterDistinctVerifiedAnchorCount(alice), 2);
        assertEq(lrep.balanceOf(alice), firstReward);
    }

    function test_RecordEarnedRaterRewardLimitsAnchorFanoutAcrossDistinctRaters() public {
        bytes32 anchorId = bytes32("anchor-a");
        uint256 maxFanout = pool.MAX_DISTINCT_RATERS_PER_VERIFIED_ANCHOR();

        for (uint256 i = 0; i < maxFanout; i++) {
            address rater = address(uint160(0x1000 + i));
            pool.recordEarnedRaterRewardWithSourceReady(
                rater,
                10 + i,
                1,
                _commitKey(10 + i),
                8_000,
                3,
                true,
                pool.MIN_LAUNCH_CREDIT_STAKE(),
                _singleAnchor(anchorId),
                uint64(block.timestamp)
            );
            assertEq(pool.qualifyingRatingCount(rater), 1);
            assertEq(pool.verifiedAnchorDistinctRaterCount(anchorId), i + 1);
        }

        address overLimitRater = address(0xCAFE);
        bytes32 blockedCommitKey = _commitKey(10_000);
        pool.recordEarnedRaterRewardWithSourceReady(
            overLimitRater,
            10_000,
            1,
            blockedCommitKey,
            8_000,
            3,
            true,
            pool.MIN_LAUNCH_CREDIT_STAKE(),
            _singleAnchor(anchorId),
            uint64(block.timestamp)
        );

        assertFalse(pool.earnedRewardCreditRecorded(10_000, 1, blockedCommitKey));
        assertEq(pool.qualifyingRatingCount(overLimitRater), 0);
        assertEq(pool.verifiedAnchorDistinctRaterCount(anchorId), maxFanout);
    }

    function test_RecordEarnedRaterRewardDoesNotBurnFanoutForSameRaterOrDuplicateAnchors() public {
        bytes32 anchorId = bytes32("anchor-a");
        bytes32[] memory duplicatedAnchors = new bytes32[](2);
        duplicatedAnchors[0] = anchorId;
        duplicatedAnchors[1] = anchorId;

        pool.recordEarnedRaterRewardWithSourceReady(
            alice,
            1,
            1,
            _commitKey(1),
            8_000,
            3,
            true,
            pool.MIN_LAUNCH_CREDIT_STAKE(),
            duplicatedAnchors,
            uint64(block.timestamp)
        );
        pool.recordEarnedRaterRewardWithSourceReady(
            alice,
            1,
            2,
            _commitKey(2),
            8_000,
            3,
            true,
            pool.MIN_LAUNCH_CREDIT_STAKE(),
            _singleAnchor(anchorId),
            uint64(block.timestamp)
        );

        assertEq(pool.qualifyingRatingCount(alice), 2);
        assertEq(pool.raterDistinctVerifiedAnchorCount(alice), 1);
        assertEq(pool.verifiedAnchorDistinctRaterCount(anchorId), 1);
    }

    function test_RecordEarnedRaterRewardUsesAvailableAnchorWhenAnotherAnchorIsOverFanout() public {
        bytes32 exhaustedAnchor = bytes32("anchor-a");
        bytes32 availableAnchor = bytes32("anchor-b");
        uint256 maxFanout = pool.MAX_DISTINCT_RATERS_PER_VERIFIED_ANCHOR();

        for (uint256 i = 0; i < maxFanout; i++) {
            address rater = address(uint160(0x2000 + i));
            pool.recordEarnedRaterRewardWithSourceReady(
                rater,
                20 + i,
                1,
                _commitKey(20 + i),
                8_000,
                3,
                true,
                pool.MIN_LAUNCH_CREDIT_STAKE(),
                _singleAnchor(exhaustedAnchor),
                uint64(block.timestamp)
            );
        }

        bytes32[] memory mixedAnchors = _twoAnchors(exhaustedAnchor, availableAnchor);
        pool.recordEarnedRaterRewardWithSourceReady(
            alice,
            2,
            1,
            _commitKey(2),
            8_000,
            3,
            true,
            pool.MIN_LAUNCH_CREDIT_STAKE(),
            mixedAnchors,
            uint64(block.timestamp)
        );

        assertEq(pool.qualifyingRatingCount(alice), 1);
        assertFalse(pool.raterVerifiedAnchorSeen(alice, exhaustedAnchor));
        assertTrue(pool.raterVerifiedAnchorSeen(alice, availableAnchor));
        assertEq(pool.verifiedAnchorDistinctRaterCount(exhaustedAnchor), maxFanout);
        assertEq(pool.verifiedAnchorDistinctRaterCount(availableAnchor), 1);
    }

    function test_RecordEarnedRaterRewardCapsUnverifiedCreditsPerRound() public {
        bytes32 anchorId = bytes32("anchor-a");
        uint256 maxCredits = pool.MAX_UNVERIFIED_LAUNCH_CREDITS_PER_ROUND();

        for (uint256 i = 0; i < maxCredits; i++) {
            address rater = address(uint160(0x3000 + i));
            bytes32 commitKey = _commitKey(30 + i);
            pool.recordEarnedRaterRewardWithSourceReady(
                rater,
                30,
                1,
                commitKey,
                8_000,
                3,
                true,
                pool.MIN_LAUNCH_CREDIT_STAKE(),
                _singleAnchor(anchorId),
                uint64(block.timestamp)
            );

            assertTrue(pool.earnedRewardCreditRecorded(30, 1, commitKey));
            assertEq(pool.roundUnverifiedLaunchCreditCount(30, 1), i + 1);
        }

        address blockedRater = address(0xBEEF);
        bytes32 blockedCommitKey = _commitKey(99);
        pool.recordEarnedRaterRewardWithSourceReady(
            blockedRater,
            30,
            1,
            blockedCommitKey,
            8_000,
            3,
            true,
            pool.MIN_LAUNCH_CREDIT_STAKE(),
            _singleAnchor(anchorId),
            uint64(block.timestamp)
        );

        assertFalse(pool.earnedRewardCreditRecorded(30, 1, blockedCommitKey));
        assertEq(pool.qualifyingRatingCount(blockedRater), 0);
        assertEq(pool.roundUnverifiedLaunchCreditCount(30, 1), maxCredits);
    }

    function test_RecordEarnedRaterRewardVerifiedRaterDoesNotConsumeRoundUnverifiedCap() public {
        bytes32 anchorId = bytes32("anchor-a");
        uint256 maxCredits = pool.MAX_UNVERIFIED_LAUNCH_CREDITS_PER_ROUND();

        for (uint256 i = 0; i < maxCredits; i++) {
            address rater = address(uint160(0x4000 + i));
            pool.recordEarnedRaterRewardWithSourceReady(
                rater,
                40,
                1,
                _commitKey(40 + i),
                8_000,
                3,
                true,
                pool.MIN_LAUNCH_CREDIT_STAKE(),
                _singleAnchor(anchorId),
                uint64(block.timestamp)
            );
        }

        _verify(alice, bytes32("verified-alice"));
        bytes32 verifiedCommitKey = _commitKey(400);
        pool.recordEarnedRaterRewardWithSourceReady(
            alice,
            40,
            1,
            verifiedCommitKey,
            8_000,
            3,
            true,
            pool.MIN_LAUNCH_CREDIT_STAKE(),
            _singleAnchor(anchorId),
            uint64(block.timestamp)
        );

        assertTrue(pool.earnedRewardCreditRecorded(40, 1, verifiedCommitKey));
        assertEq(pool.qualifyingRatingCount(alice), 1);
        assertEq(pool.roundUnverifiedLaunchCreditCount(40, 1), maxCredits);
    }

    function test_RecordEarnedRaterRewardDeduplicatesCommitKeysAndAnchors() public {
        bytes32[] memory anchors = new bytes32[](2);
        anchors[0] = bytes32("anchor-a");
        anchors[1] = bytes32("anchor-a");
        bytes32 commitKey = _commitKey(1);

        assertEq(
            pool.recordEarnedRaterRewardWithSourceReady(
                alice, 1, 1, commitKey, 8_000, 3, true, pool.MIN_LAUNCH_CREDIT_STAKE(), anchors, uint64(block.timestamp)
            ),
            0
        );
        assertEq(
            pool.recordEarnedRaterRewardWithSourceReady(
                alice, 1, 1, commitKey, 8_000, 3, true, pool.MIN_LAUNCH_CREDIT_STAKE(), anchors, uint64(block.timestamp)
            ),
            0
        );

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
        assertEq(referrerBase, 250e6);
        assertEq(lrep.balanceOf(referrer), 250e6);

        vm.prank(alice);
        uint256 alicePayout = pool.claimVerifiedBonus(referrer);
        assertEq(alicePayout, 375e6);
        assertEq(lrep.balanceOf(alice), 250e6);
        assertEq(lrep.balanceOf(referrer), 375e6);
        assertEq(pool.referralEarnings(referrer), 125e6);

        vm.prank(alice);
        vm.expectRevert(LaunchDistributionPool.AlreadyClaimed.selector);
        pool.claimVerifiedBonus(referrer);
    }

    function test_ClaimVerifiedBonusAcceptsRateLoopSeededHumanUnits() public {
        registry.seedHumanCredential(alice, uint64(block.timestamp + 30 days), bytes32("seeded-alice"), 0);

        vm.prank(alice);
        uint256 payout = pool.claimVerifiedBonus(address(0));

        assertEq(payout, 250e6);
        assertEq(lrep.balanceOf(alice), 250e6);
    }

    function test_ClaimVerifiedBonusNamespacesSeededHumanNullifiers() public {
        _verify(alice, bytes32("shared-human"));
        registry.seedHumanCredential(bob, uint64(block.timestamp + 30 days), bytes32("shared-human"), 0);

        vm.prank(alice);
        pool.claimVerifiedBonus(address(0));

        vm.prank(bob);
        uint256 bobPayout = pool.claimVerifiedBonus(address(0));

        assertEq(bobPayout, 250e6);
        assertTrue(
            pool.verifiedCredentialClaimed(
                _credentialKey(RaterRegistry.HumanCredentialProvider.WorldId, bytes32("shared-human"))
            )
        );
        assertTrue(
            pool.verifiedCredentialClaimed(
                _credentialKey(RaterRegistry.HumanCredentialProvider.SeededHuman, bytes32("shared-human"))
            )
        );
    }

    function test_ConfiguredWorldIdV4ClosesLegacyBonusDoubleClaimPath() public {
        _configureWorldIdV4();
        registry.setWorldIdV4UnaliasedLaunchNullifiersAllowed(true);
        _verifyV4(alice, bytes32("alice-v4-human"));

        vm.prank(alice);
        pool.claimVerifiedBonus(address(0));

        uint256[8] memory legacyProof;
        vm.prank(bob);
        vm.expectRevert(RaterRegistry.LegacyWorldIdAttestationDisabled.selector);
        registry.attestHumanCredentialWithProof(1, uint256(bytes32("bob-legacy-human")), legacyProof);
    }

    function test_WorldIdV4VerifiedBonusConsumesUnaliasedLaunchNullifier() public {
        bytes32 v4Nullifier = bytes32("alice-v4-human");

        _configureWorldIdV4();
        registry.setWorldIdV4UnaliasedLaunchNullifiersAllowed(true);
        _verifyV4(alice, v4Nullifier);

        vm.prank(alice);
        pool.claimVerifiedBonus(address(0));

        assertTrue(registry.worldIdV4LaunchNullifierSeen(v4Nullifier));
        vm.expectRevert(RaterRegistry.InvalidCredential.selector);
        registry.setWorldIdV4LaunchNullifierAlias(v4Nullifier, bytes32("legacy-human"));
    }

    function test_LegacyAndV4SharedNullifierCannotClaimVerifiedBonusTwice() public {
        _verify(alice, bytes32("shared-human"));

        vm.prank(alice);
        pool.claimVerifiedBonus(address(0));

        _configureWorldIdV4();
        vm.expectRevert(RaterRegistry.NullifierAlreadyAssigned.selector);
        _verifyV4(bob, bytes32("shared-human"));
    }

    function test_WorldIdV4DifferentNullifierCannotClaimVerifiedBonusWithoutAlias() public {
        bytes32 legacyNullifier = bytes32("legacy-human");
        bytes32 v4Nullifier = bytes32("v4-human");

        _verify(alice, legacyNullifier);
        vm.prank(alice);
        pool.claimVerifiedBonus(address(0));

        _configureWorldIdV4();
        _verifyV4(bob, v4Nullifier);

        vm.prank(bob);
        vm.expectRevert(RaterRegistry.InvalidCredential.selector);
        pool.claimVerifiedBonus(address(0));
        assertFalse(registry.worldIdV4LaunchNullifierSeen(v4Nullifier));
    }

    function test_WorldIdV4LaunchAliasPreventsDifferentNullifierVerifiedBonusDoubleClaim() public {
        bytes32 legacyNullifier = bytes32("legacy-human");
        bytes32 v4Nullifier = bytes32("v4-human");

        _verify(alice, legacyNullifier);
        vm.prank(alice);
        pool.claimVerifiedBonus(address(0));

        _configureWorldIdV4();
        registry.setWorldIdV4LaunchNullifierAlias(v4Nullifier, legacyNullifier);
        _verifyV4(bob, v4Nullifier);

        assertTrue(
            pool.verifiedCredentialClaimed(
                registry.launchHumanIdentityKey(RaterRegistry.HumanCredentialProvider.WorldId, legacyNullifier)
            )
        );
        vm.prank(bob);
        vm.expectRevert(LaunchDistributionPool.AlreadyClaimed.selector);
        pool.claimVerifiedBonus(address(0));
        assertFalse(registry.worldIdV4LaunchNullifierSeen(v4Nullifier));
    }

    function _recordLaunchReward(address rater, uint256 roundId, bytes32 anchorId) internal returns (uint256) {
        return _recordLaunchRewardWithScore(rater, roundId, anchorId, 8_000);
    }

    function _recordLaunchRewardWithScore(address rater, uint256 roundId, bytes32 anchorId, uint16 scoreBps)
        internal
        returns (uint256)
    {
        return pool.recordEarnedRaterRewardWithSourceReady(
            rater,
            1,
            roundId,
            _commitKey(roundId),
            scoreBps,
            3,
            true,
            pool.MIN_LAUNCH_CREDIT_STAKE(),
            _singleAnchor(anchorId),
            uint64(block.timestamp)
        );
    }

    function _recordLaunchRewardSlots(address rater, uint256 count) internal {
        for (uint256 i = 0; i < count; i++) {
            bytes32 anchorId = i % 2 == 0 ? bytes32("anchor-a") : bytes32("anchor-b");
            _recordLaunchReward(rater, i + 1, anchorId);
        }
    }

    function _singleAnchor(bytes32 anchorId) internal pure returns (bytes32[] memory anchors) {
        anchors = new bytes32[](1);
        anchors[0] = anchorId;
    }

    function _twoAnchors(bytes32 anchorA, bytes32 anchorB) internal pure returns (bytes32[] memory anchors) {
        anchors = new bytes32[](2);
        anchors[0] = anchorA;
        anchors[1] = anchorB;
    }

    function _defaultPolicy() internal view returns (ILaunchDistributionPool.LaunchRewardPolicy memory policy) {
        policy = ILaunchDistributionPool.LaunchRewardPolicy({
            minQualifyingScoreBps: pool.MIN_QUALIFYING_SCORE_BPS(),
            minVoters: pool.MIN_EARNED_REWARD_VOTERS(),
            minVerifiedHumans: pool.MIN_EARNED_REWARD_VERIFIED_HUMANS(),
            minDistinctVerifiedAnchors: pool.MIN_EARNED_REWARD_DISTINCT_VERIFIED_ANCHORS(),
            minDistinctAnchorRounds: pool.MIN_EARNED_REWARD_DISTINCT_ANCHOR_ROUNDS(),
            minLaunchCreditStake: pool.MIN_LAUNCH_CREDIT_STAKE(),
            maxDistinctRatersPerVerifiedAnchor: pool.MAX_DISTINCT_RATERS_PER_VERIFIED_ANCHOR(),
            maxUnverifiedCreditsPerRound: pool.MAX_UNVERIFIED_LAUNCH_CREDITS_PER_ROUND(),
            unverifiedEarnedRaterCapBps: pool.DEFAULT_UNVERIFIED_EARNED_RATER_CAP_BPS(),
            minAnchorCredentialAgeSeconds: pool.MIN_ANCHOR_CREDENTIAL_AGE_SECONDS(),
            eligibilityRatingCount: pool.ELIGIBILITY_RATING_COUNT(),
            rewardingRatingCount: pool.REWARDING_RATING_COUNT(),
            requireNoPendingCleanup: true
        });
    }

    function _commitKey(uint256 roundId) internal pure returns (bytes32) {
        return keccak256(abi.encode("commit", roundId));
    }

    function _recordFiveEligibleCredits(address rater) internal returns (uint256 fifthReward) {
        for (uint256 i = 0; i < 4; i++) {
            bytes32 anchorId = i % 2 == 0 ? bytes32("anchor-a") : bytes32("anchor-b");
            assertEq(_recordLaunchReward(rater, i + 1, anchorId), 0);
        }
        fifthReward = _recordLaunchReward(rater, 5, bytes32("anchor-a"));
    }

    function _configureLaunchOracle(uint64 toRoundId) internal returns (ClusterPayoutOracle oracle) {
        return _configureLaunchOracle(toRoundId, _launchEpochSources(toRoundId));
    }

    function _configureLaunchOracle(
        uint64 toRoundId,
        IClusterPayoutOracle.CorrelationEpochSourceRef[] memory sourceRefs
    ) internal returns (ClusterPayoutOracle oracle) {
        MockLaunchOracleFrontendRegistry frontendRegistry = new MockLaunchOracleFrontendRegistry();
        frontendRegistry.setEligible(address(this), true);
        oracle = new ClusterPayoutOracle(address(this), address(frontendRegistry), address(lrep));
        oracle.setOracleConfig(1, oracle.MIN_CHALLENGE_BOND(), address(this));
        oracle.setRoundPayoutSnapshotConsumer(oracle.PAYOUT_DOMAIN_LAUNCH_CREDIT(), address(pool));
        // M-Oracle-1: wire an always-ready cluster source so proposals can land before the first
        // pending credit record (the legitimate front-run case exercised by these tests).
        pool.setRoundClusterReadyAtSource(address(new MockAlwaysReadyClusterSource()));
        pool.setClusterPayoutOracle(address(oracle));

        oracle.proposeCorrelationEpoch(
            1,
            1,
            toRoundId,
            keccak256("cluster-root"),
            keccak256("params"),
            keccak256("epoch-artifact"),
            "ipfs://epoch",
            sourceRefs
        );
        ClusterPayoutOracle.CorrelationEpochSnapshot memory epoch = oracle.correlationEpochSnapshot(1);
        vm.warp(uint256(epoch.proposedAt) + 2);
        oracle.finalizeCorrelationEpoch(1);
    }

    function _recordAndFinalizeLaunchOracleCredit(
        ClusterPayoutOracle oracle,
        address rater,
        uint256 roundId,
        uint16 effectiveWeight
    ) internal returns (uint256 paidAmount) {
        bytes32 anchorId = roundId % 2 == 0 ? bytes32("anchor-b") : bytes32("anchor-a");
        assertEq(
            pool.recordEarnedRaterRewardWithSourceReady(
                rater,
                1,
                roundId,
                _commitKey(roundId),
                8_000,
                3,
                true,
                pool.MIN_LAUNCH_CREDIT_STAKE(),
                _singleAnchor(anchorId),
                uint64(block.timestamp)
            ),
            0
        );

        IClusterPayoutOracle.PayoutWeight memory payout =
            _launchPayoutWeight(roundId, _commitKey(roundId), rater, effectiveWeight, keccak256("clustered"));
        _proposeAndFinalizeLaunchPayoutSnapshot(oracle, roundId, payout, keccak256("epoch-artifact"));

        paidAmount = pool.finalizeEarnedRaterRewardCredit(1, roundId, _commitKey(roundId), payout, new bytes32[](0));
    }

    function _launchPayoutWeight(
        uint256 roundId,
        bytes32 commitKey,
        address rater,
        uint16 effectiveWeight,
        bytes32 reasonHash
    ) internal view returns (IClusterPayoutOracle.PayoutWeight memory payout) {
        payout = IClusterPayoutOracle.PayoutWeight({
            domain: pool.PAYOUT_DOMAIN_LAUNCH_CREDIT(),
            rewardPoolId: 0,
            contentId: 1,
            roundId: roundId,
            commitKey: commitKey,
            identityKey: bytes32(0),
            account: rater,
            baseWeight: pool.BPS_DENOMINATOR(),
            independenceBps: effectiveWeight,
            effectiveWeight: effectiveWeight,
            reasonHash: reasonHash
        });
    }

    function _proposeAndFinalizeLaunchPayoutSnapshot(
        ClusterPayoutOracle oracle,
        uint256 roundId,
        IClusterPayoutOracle.PayoutWeight memory payout,
        bytes32 artifactHash
    ) internal {
        bytes32 leaf = oracle.payoutWeightLeaf(payout);
        oracle.proposeRoundPayoutSnapshot(
            IClusterPayoutOracle.RoundPayoutSnapshotInput({
                domain: pool.PAYOUT_DOMAIN_LAUNCH_CREDIT(),
                rewardPoolId: 0,
                contentId: 1,
                roundId: roundId,
                correlationEpochId: 1,
                rawEligibleVoters: 1,
                effectiveParticipantUnits: uint32(payout.effectiveWeight),
                totalClaimWeight: payout.effectiveWeight,
                weightRoot: leaf,
                reasonRoot: keccak256("reason-root"),
                artifactHash: artifactHash,
                artifactURI: "ipfs://round"
            })
        );
        bytes32 snapshotKey = oracle.roundPayoutSnapshotKey(pool.PAYOUT_DOMAIN_LAUNCH_CREDIT(), 0, 1, roundId);
        ClusterPayoutOracle.RoundPayoutProposal memory proposal = oracle.roundPayoutProposal(snapshotKey);
        vm.warp(uint256(proposal.proposedAt) + 2);
        oracle.finalizeRoundPayoutSnapshot(snapshotKey);
    }

    function _verify(address account, bytes32 nullifier) internal {
        uint256[8] memory proof;
        vm.prank(account);
        registry.attestHumanCredentialWithProof(1, uint256(nullifier), proof);
    }

    function _configureWorldIdV4() internal {
        MockWorldIDVerifier verifier = new MockWorldIDVerifier();
        registry.setWorldIdV4VerifierConfig(
            address(verifier),
            WORLD_ID_V4_RP_ID,
            WORLD_ID_V4_ACTION,
            365 days,
            WORLD_ID_V4_ISSUER_SCHEMA_ID,
            WORLD_ID_V4_CREDENTIAL_GENESIS_ISSUED_AT_MIN
        );
    }

    function _verifyV4(address account, bytes32 nullifier) internal {
        uint256[5] memory proof;
        vm.prank(account);
        registry.attestHumanCredentialWithV4Proof(uint256(nullifier), 1, uint64(block.timestamp + 1 hours), proof);
    }

    function _credentialKey(RaterRegistry.HumanCredentialProvider provider, bytes32 nullifier)
        internal
        pure
        returns (bytes32)
    {
        if (
            provider == RaterRegistry.HumanCredentialProvider.WorldId
                || provider == RaterRegistry.HumanCredentialProvider.WorldIdV4
        ) {
            return keccak256(abi.encode("rateloop.launch-world-id-human-v1", nullifier));
        }
        return keccak256(abi.encode(provider, nullifier));
    }

    function _setEligibleRaterCount(uint256 count) internal {
        stdstore.target(address(pool)).sig("eligibleRaterCount()").checked_write(count);
    }

    function _setVerifiedClaimCount(uint256 count) internal {
        stdstore.target(address(pool)).sig("verifiedClaimCount()").checked_write(count);
    }

    function _setEarnedRaterDistributed(uint256 amount) internal {
        stdstore.target(address(pool)).sig("earnedRaterDistributed()").checked_write(amount);
    }
}

contract MockLaunchOracleFrontendRegistry {
    uint256 public constant STAKE_AMOUNT = 1_000e6;

    mapping(address => bool) internal eligible;

    function setEligible(address frontend, bool value) external {
        eligible[frontend] = value;
    }

    function isEligible(address frontend) external view returns (bool) {
        return eligible[frontend];
    }

    function authorizedSnapshotFrontend(address proposer) external view returns (address frontend) {
        return eligible[proposer] ? proposer : address(0);
    }
}

/// @dev Test source for M-Oracle-1 readiness checks. Always returns 1 (epoch-second 1) so that
///      any positive block.timestamp counts as ready.
contract MockAlwaysReadyClusterSource {
    function roundClusterPayoutReadyAt(uint256, uint256) external pure returns (uint48) {
        return 1;
    }

    function roundCore(uint256, uint256) external pure returns (uint48, uint8, uint16, uint16, uint64, uint48, uint48) {
        return (1, 1, 0, 0, 0, 0, 1);
    }

    function protocolConfig() external view returns (address) {
        return address(this);
    }

    function revealGracePeriod() external pure returns (uint256) {
        return 0;
    }
}

contract MockWeakClusterSource {
    function roundClusterPayoutReadyAt(uint256, uint256) external pure returns (uint48) {
        return 1;
    }
}

contract MockGraceClusterSource {
    uint48 internal immutable settledAt;
    uint256 internal immutable gracePeriod;
    bool internal revealGraceReverts;

    constructor(uint48 _settledAt, uint256 _gracePeriod) {
        settledAt = _settledAt;
        gracePeriod = _gracePeriod;
    }

    function roundClusterPayoutReadyAt(uint256, uint256) external view returns (uint48) {
        return settledAt;
    }

    function roundCore(uint256, uint256) external view returns (uint48, uint8, uint16, uint16, uint64, uint48, uint48) {
        return (1, 1, 0, 0, 0, 0, settledAt);
    }

    function protocolConfig() external view returns (address) {
        return address(this);
    }

    function revealGracePeriod() external view returns (uint256) {
        if (revealGraceReverts) revert("revealGracePeriod");
        return gracePeriod;
    }

    function setRevealGraceReverts(bool value) external {
        revealGraceReverts = value;
    }
}
