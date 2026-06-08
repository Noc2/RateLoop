/*
 * LaunchDistributionPoolConservation.spec — Phase 5c (Track C).
 *
 * Verification target: contracts/LaunchDistributionPool.sol (verified directly).
 * Run with:           certoraRun certora/confs/launch-distribution-pool-conservation.conf
 *
 * Aggregate conservation across the three launch sub-pools: the total LREP paid out of
 * each pool never exceeds that pool's funded size. Each `*Distributed` counter is the
 * running sum of all payouts from its pool, incremented only by amounts that the code
 * clamps to (or reverts above) the remaining pool, so each bound is a self-inductive
 * invariant:
 *
 *   earnedRaterDistributed                  <= EARNED_RATER_POOL_AMOUNT
 *   verifiedReferralDistributed             <= VERIFIED_REFERRAL_POOL_AMOUNT
 *   legacyContributorDistributed            <= LEGACY_CONTRIBUTOR_POOL_AMOUNT
 *   legacyContributorTreasuryRecovered      <= legacyContributorAllocationTotal (<= pool)
 *
 * (An earlier attempt also tied Σ raterLaunchPaid to earnedRaterDistributed via a
 * ghost+hook; that equality is fragile under the SafeERC20 external calls that havoc a
 * non-persistent ghost, and is not needed — the distributed counter already IS the
 * aggregate sum, so the scalar invariants below carry the property.)
 */

methods {
    function earnedRaterDistributed() external returns (uint256) envfree;
    function verifiedReferralDistributed() external returns (uint256) envfree;
    function legacyContributorDistributed() external returns (uint256) envfree;
    function legacyContributorTreasuryRecovered() external returns (uint256) envfree;
    function legacyContributorAllocationTotal() external returns (uint256) envfree;
    function EARNED_RATER_POOL_AMOUNT() external returns (uint256) envfree;
    function VERIFIED_REFERRAL_POOL_AMOUNT() external returns (uint256) envfree;
    function LEGACY_CONTRIBUTOR_POOL_AMOUNT() external returns (uint256) envfree;

    function _.transfer(address, uint256) external => NONDET;
    function _.transferFrom(address, address, uint256) external => NONDET;
    function _.safeTransfer(address, uint256) external => NONDET;
    function _.safeTransferFrom(address, address, uint256) external => NONDET;
    function _.balanceOf(address) external => NONDET;
    function _.getHumanCredential(address) external => NONDET;
    function _.launchHumanIdentityKey(uint8, bytes32) external => NONDET;
    function _.verifyPayoutWeight(IClusterPayoutOracle.PayoutWeight, bytes32[]) external => NONDET;
}

// Earned-rater pool: total paid never exceeds the funded pool.
invariant earnedRaterPoolConserved()
    to_mathint(earnedRaterDistributed()) <= to_mathint(EARNED_RATER_POOL_AMOUNT());

// Verified-referral pool: total paid never exceeds the funded pool.
invariant verifiedReferralPoolConserved()
    to_mathint(verifiedReferralDistributed()) <= to_mathint(VERIFIED_REFERRAL_POOL_AMOUNT());

// Legacy pool (revisited). The claim and sweep paths bound against
// legacyContributorAllocationTotal, which setLegacyContributorRoot pins to exactly
// LEGACY_CONTRIBUTOR_POOL_AMOUNT (it reverts otherwise and is write-once). So the legacy
// conservation splits cleanly into three self-inductive invariants:
invariant legacyAllocationTotalBounded()
    to_mathint(legacyContributorAllocationTotal()) <= to_mathint(LEGACY_CONTRIBUTOR_POOL_AMOUNT());

invariant legacyDistributedWithinAllocation()
    to_mathint(legacyContributorDistributed()) <= to_mathint(legacyContributorAllocationTotal());

invariant legacyRecoveredWithinAllocation()
    to_mathint(legacyContributorTreasuryRecovered()) <= to_mathint(legacyContributorAllocationTotal());

// Combined, neither the distributed total nor the swept-to-treasury total individually
// exceeds the 9M legacy pool. (The TIGHT bound `distributed + recovered <= pool` holds in
// the contract — claims require an open window and the sweep a closed one, so they never
// overlap — but is not a storage-only invariant: it needs the temporal claim/sweep
// exclusivity, which CVL cannot express without multi-tx/time modeling. Left deferred.)
invariant legacyDistributedWithinPool()
    to_mathint(legacyContributorDistributed()) <= to_mathint(LEGACY_CONTRIBUTOR_POOL_AMOUNT())
    {
        preserved {
            requireInvariant legacyAllocationTotalBounded();
            requireInvariant legacyDistributedWithinAllocation();
        }
    }
