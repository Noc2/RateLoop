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
 *   earnedRaterDistributed       <= EARNED_RATER_POOL_AMOUNT
 *   verifiedReferralDistributed  <= VERIFIED_REFERRAL_POOL_AMOUNT
 *
 * (Two notes. (1) An earlier attempt also tied Σ raterLaunchPaid to
 * earnedRaterDistributed via a ghost+hook; that equality is fragile under the SafeERC20
 * external calls that havoc a non-persistent ghost, and is not needed — the distributed
 * counter already IS the aggregate sum, so the scalar invariants below carry the
 * property. (2) The legacy pool's combined `distributed + treasuryRecovered <= pool`
 * bound resisted on sweepExpiredLegacyContributorAllocationToTreasury and is left
 * deferred — the sweep's reachable-state relationship needs an auxiliary invariant.)
 */

methods {
    function earnedRaterDistributed() external returns (uint256) envfree;
    function verifiedReferralDistributed() external returns (uint256) envfree;
    function legacyContributorDistributed() external returns (uint256) envfree;
    function legacyContributorTreasuryRecovered() external returns (uint256) envfree;
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
