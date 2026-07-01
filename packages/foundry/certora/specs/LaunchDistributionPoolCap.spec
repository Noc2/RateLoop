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
 * The previously-deferred lemma `raterLaunchCap <= raterFullLaunchCap` reduces at
 * assignment to `fullCap * bps / 10000 <= fullCap` given `bps <= 10000` — a nonlinear
 * multiply-then-divide the *linear* SMT backend cannot discharge. This conf now enables
 * the nonlinear-arithmetic backend (`-smt_useNIA`), under which the assignment clamp IS
 * dischargeable. `assignedCapWithinFullCap` below machine-checks exactly that clamp
 * through the same clamp expression, via the harness wrapper `assignLaunchCap_`.
 *
 * Still deferred (honest residual): the *global* invariant `raterLaunchPaid <= raterLaunchCap`
 * over every method. Per the findings doc, even with NIA the catch-up paths
 * (finalizeEarnedRaterRewardCredit / unlockFullEarnedRaterCap) — which contain further
 * cap * count / rewardingCount mul-div sites — still resist as a standalone inductive
 * invariant. So this slice proves the per-assignment clamp (the load-bearing step) rather
 * than the end-to-end invariant.
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

// The cap-assignment clamp: the active cap expression never exceeds the full cap. This is
// the load-bearing mul-div step (activeCap = (fullCap * bps) / 10000 when the full cap is
// locked, else fullCap), the real-contract instance of MulDivLemma.spec's
// `(a*b)/c <= a`. Requires the nonlinear SMT backend enabled in this conf. The bps
// precondition is `policyBpsBounded`, proved as an invariant above.
rule assignedCapWithinFullCap(env e, address rater, uint256 fullCap) {
    requireInvariant policyBpsBounded();
    uint256 activeCap = assignLaunchCap_(e, rater, fullCap);
    assert activeCap <= fullCap;
}
