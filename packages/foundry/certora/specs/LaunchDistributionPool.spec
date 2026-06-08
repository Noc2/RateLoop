/*
 * LaunchDistributionPool.spec — Phase 5.
 *
 * Verification target: contracts/LaunchDistributionPool.sol (verified directly).
 * Run with:           certoraRun certora/confs/launch-distribution-pool.conf
 *
 * The launch pool pays a one-time "verified bonus" per account. This proves that bonus
 * is single-use: an account can never claim it twice. The claim flag is keyed directly
 * by msg.sender, so the property holds over public state with only NONDET token/registry
 * summaries — no commit resolution needed.
 *
 * Deferred (documented in docs/testing/certora-followup.md): the per-rater
 * raterLaunchPaid[r] <= raterLaunchCap[r] conservation invariant. It is TRUE — every
 * payment clamps the target to the cap and pays only the positive delta — but it is not
 * self-inductive over the four record/unlock entry points (it needs auxiliary invariants
 * tying raterLaunchCapAssigned / cap-monotonicity together before the prover accepts the
 * preservation step). Strengthening it is the natural next slice.
 */

methods {
    function verifiedBonusClaimedByAccount(address) external returns (bool) envfree;

    // External token + registry calls in the reward/claim paths: NONDET so they cannot
    // havoc this contract's accounting storage. The single-use property holds regardless
    // of what these return.
    function _.transfer(address, uint256) external => NONDET;
    function _.transferFrom(address, address, uint256) external => NONDET;
    function _.safeTransfer(address, uint256) external => NONDET;
    function _.balanceOf(address) external => NONDET;
    function _.getHumanCredential(address) external => NONDET;
    function _.launchHumanIdentityKey(uint8, bytes32) external => NONDET;
}

// The verified bonus is single-use per account: once claimed, a second claim by the
// same account always reverts. The claim flag is keyed by msg.sender, so this needs no
// commit resolution.
rule verifiedBonusSingleUsePerAccount(env e1, env e2, address referrer1, address referrer2) {
    require e1.msg.sender == e2.msg.sender;

    claimVerifiedBonus(e1, referrer1);                       // first claim succeeds
    claimVerifiedBonus@withrevert(e2, referrer2);            // second by same account
    assert lastReverted;
}

// And the mechanism behind that gate: a successful claim records the account flag.
rule verifiedBonusRecordsFlag(env e, address referrer) {
    claimVerifiedBonus(e, referrer);
    assert verifiedBonusClaimedByAccount(e.msg.sender);
}
