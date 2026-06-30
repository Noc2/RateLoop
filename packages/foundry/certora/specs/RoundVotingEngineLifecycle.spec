/*
 * RoundVotingEngineLifecycle.spec — Phase 3b.
 *
 * Verification target: certora/harnesses/RoundVotingEngineHarness.sol
 * Run with:           certoraRun certora/confs/round-voting-engine-lifecycle.conf
 *
 * Proves the round-lifecycle refund *state gates* that the Phase 3 transferReward slice
 * left deferred. Each is a pure state-gate evaluated before any external call, so it
 * needs no commit resolution and no reachability modeling:
 *
 *   - A refund is claimable only from a terminal-but-not-settled state: it reverts on an
 *     Open round (no draining a live round) and on a Settled round (settled rounds pay
 *     rewards, not refunds).
 *
 * Deferred:
 *   - Lifecycle monotonicity / no-double-settle. The natural rule ("a successful
 *     settleRound implies the round was Open") could not be proved in this setup: under
 *     solc_optimize + via_ir, certora-cli's auto-finder fails to instrument parts of the
 *     1,811-line engine (it emits "Failed to generate auto finder for …"), and the
 *     settleRound model that results admits a spurious counterexample despite the
 *     contract's unconditional `if (state != Open) revert` guard. This is a tooling
 *     limitation, not a contract defect.
 *   - Single-use refund and refund==stake, which need deterministic modeling of the
 *     engine's INTERNAL _resolveClaimCommit — not summarizable here because the engine
 *     needs via_ir, under which certora-cli cannot instrument internal-function
 *     summaries.
 *   - The cross-round aggregate-claimed<=pool ghost sum.
 */

methods {
    function roundStateU_(uint256, uint256) external returns (uint8) envfree;

    // Token + config externals: NONDET so they cannot havoc engine storage.
    function _.transfer(address, uint256) external => NONDET;
    function _.transferFrom(address, address, uint256) external => NONDET;
    function _.balanceOf(address) external => NONDET;
    function _.isRewardDistributorForEngine(address, address) external => NONDET;
}

// RoundLib.RoundState mirror: Open=0, Settled=1, Cancelled=2, Tied=3, RevealFailed=4.
definition OPEN() returns uint8 = 0;
definition SETTLED() returns uint8 = 1;

// ---------------------------------------------------------------------------
// Refund gating: only terminal-but-not-settled rounds are refundable
// ---------------------------------------------------------------------------

// A refund cannot be claimed against a live (Open) round — stake stays locked while the
// round can still settle.
rule refundRejectsOpenRound(env e, uint256 contentId, uint256 roundId) {
    require roundStateU_(contentId, roundId) == OPEN();
    claimCancelledRoundRefund@withrevert(e, contentId, roundId);
    assert lastReverted;
}

// A refund cannot be claimed against a Settled round — settled rounds distribute rewards
// via the claim path, never stake refunds.
rule refundRejectsSettledRound(env e, uint256 contentId, uint256 roundId) {
    require roundStateU_(contentId, roundId) == SETTLED();
    claimCancelledRoundRefund@withrevert(e, contentId, roundId);
    assert lastReverted;
}
