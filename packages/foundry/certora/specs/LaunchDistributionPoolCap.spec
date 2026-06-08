/*
 * LaunchDistributionPoolCap.spec — Phase 5b (Track B).
 *
 * Verification target: certora/harnesses/LaunchDistributionPoolHarness.sol
 * Run with:           certoraRun certora/confs/launch-distribution-pool-cap.conf
 *
 * Track B set out to make the Phase-5-deferred per-rater bound
 * `raterLaunchPaid[r] <= raterLaunchCap[r]` inductive. Two of the supporting invariants
 * are proved here:
 *
 *   policyBpsBounded    — the unverified-cap bps never exceeds 10000 (the policy setter
 *                         reverts otherwise; the default policy and zero-state satisfy it).
 *   capAssignedWhenPaid — any rater with a non-zero paid-out amount has an assigned cap
 *                         (every payout path assigns the cap before paying).
 *
 * The headline `raterLaunchPaid <= raterLaunchCap` itself remains deferred. Its last
 * missing lemma is `raterLaunchCap <= raterFullLaunchCap`, which at assignment reduces to
 * `fullCap * bps / 10000 <= fullCap` given `bps <= 10000`. That is a nonlinear
 * multiply-then-divide inequality, which the SMT backend cannot discharge precisely (a
 * solver-completeness limit, not a contract defect — by inspection the clamp is correct).
 * Proving it would need a manual nonlinear lemma or a mul-div abstraction. The two
 * invariants below are the sound, machine-checked part of the chain.
 */

methods {
    function raterLaunchPaid(address) external returns (uint256) envfree;
    function raterLaunchCapAssigned(address) external returns (bool) envfree;
    function unverifiedCapBps_() external returns (uint256) envfree;

    function _.transfer(address, uint256) external => NONDET;
    function _.transferFrom(address, address, uint256) external => NONDET;
    function _.safeTransfer(address, uint256) external => NONDET;
    function _.balanceOf(address) external => NONDET;
    function _.getHumanCredential(address) external => NONDET;
    function _.launchHumanIdentityKey(uint8, bytes32) external => NONDET;
    function _.verifyPayoutWeight(IClusterPayoutOracle.PayoutWeight, bytes32[]) external => NONDET;
}

// The unverified-cap bps is bounded by 10000 (BPS_DENOMINATOR): _validateLaunchRewardPolicy
// reverts otherwise, and the default policy and zero-state both satisfy it.
invariant policyBpsBounded()
    unverifiedCapBps_() <= 10000;

// Any rater that has been paid has an assigned cap (every payout path assigns first).
invariant capAssignedWhenPaid(address r)
    raterLaunchPaid(r) > 0 => raterLaunchCapAssigned(r);
