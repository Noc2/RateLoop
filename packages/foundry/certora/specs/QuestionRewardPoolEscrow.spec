/*
 * QuestionRewardPoolEscrow.spec — Phase 4.
 *
 * Verification target: certora/harnesses/QuestionRewardPoolEscrowHarness.sol
 * Run with:           certoraRun certora/confs/question-reward-escrow.conf
 *
 * QuestionRewardPoolEscrow custodies per-question bounties. Once a pool has been
 * refunded (its residual funds returned to the funder/treasury), no further claim may
 * pay out of it — otherwise the escrow would pay rewards it no longer holds. This proves
 * that gate directly:
 *
 *      a refunded reward pool rejects every claim.
 *
 * The `require(!rewardPool.refunded)` guard runs immediately after the pool is loaded and
 * before any external (engine / oracle / token) call, so this property needs no commit
 * resolution and no modeling of the qualification/claim-weight machinery — it is a pure
 * state gate over the pool's own `refunded` flag.
 *
 * Deferred: per-commit no-double-claim (rewardClaimed flag) and per-snapshot
 * claimed<=allocation. Both require deterministic
 * modeling of the escrow's INTERNAL _resolveQuestionRewardClaim, which is not
 * summarizable here because the escrow needs via_ir (under which certora-cli cannot
 * instrument internal-function summaries) — the same limitation hit in Phase 3b.
 */

methods {
    function poolRefunded_(uint256) external returns (bool) envfree;

    // External engine / oracle / token calls in the claim path: NONDET so they cannot
    // havoc this contract's storage. The refunded-pool gate fires before any of them.
    function _.transfer(address, uint256) external => NONDET;
    function _.transferFrom(address, address, uint256) external => NONDET;
    function _.safeTransfer(address, uint256) external => NONDET;
    function _.balanceOf(address) external => NONDET;
    function _.roundLifecycleState(uint256, uint256) external => NONDET;
}

// A refunded reward pool rejects the plain claim path. (The correlation-proof claim
// overload is gated by the identical `require(!rewardPool.refunded)` on the same line,
// but verifying it through CVL pulls the Merkle-proof array machinery into the SMT and
// times out on this 1,490-line + 11-library contract, so it is left to the no-proof
// variant, which exercises the same guard.)
rule refundedPoolRejectsClaim(env e, uint256 rewardPoolId, uint256 roundId) {
    require poolRefunded_(rewardPoolId);          // pool exists (getter reverts otherwise) and is refunded
    claimQuestionReward@withrevert(e, rewardPoolId, roundId);
    assert lastReverted;
}
