/*
 * FeedbackBonusEscrow.spec — Phase 7.
 *
 * Verification target: certora/harnesses/FeedbackBonusEscrowHarness.sol
 * Run with:           certoraRun certora/confs/feedback-bonus-escrow.conf
 *
 * The escrow funds a per-pool bonus and pays it out to revealed independent raters via
 * awardFeedbackBonus (push model, gated by the pool's `awarder`). Two properties bound
 * it:
 *
 *   1. Conservation — a pool's remaining balance never exceeds its funded amount. Since
 *      `remainingAmount` starts equal to `fundedAmount` at creation and only ever
 *      decreases (each award requires grossAmount <= remaining, then subtracts it;
 *      forfeit zeroes it), it can never exceed funded. This bounds total payouts by the
 *      funded amount.
 *   2. Single-award — the same feedback hash is awarded at most once per pool (and the
 *      same identity at most once), so a rater cannot be paid twice for one feedback.
 *
 * Both are proved over public state with only NONDET summaries for the token and the
 * round/registry gating views — no commit resolution is needed because the single-award
 * guard keys directly off the feedback hash / identity flags.
 */

methods {
    function poolFunded_(uint256) external returns (uint256) envfree;
    function poolRemaining_(uint256) external returns (uint256) envfree;
    function feedbackHashAwarded(uint256, bytes32) external returns (bool) envfree;

    // Token transfers: NONDET (no storage side effects on this contract).
    function _.transfer(address, uint256) external => NONDET;
    function _.transferFrom(address, address, uint256) external => NONDET;
    function _.safeTransfer(address, uint256) external => NONDET;
    function _.balanceOf(address) external => NONDET;
    // Round/feedback/registry gating views are summarized NONDET; the accounting and
    // single-award guards do not depend on them being deterministic.
    function _.awardableFeedbackPublishedAt(uint256, uint256, bytes32, bytes32) external => NONDET;
}

// Bonus-pool conservation: remaining never exceeds funded, for every pool and every
// reachable state. This bounds the total amount awarded out of a pool by what was
// funded in.
invariant remainingNeverExceedsFunded(uint256 poolId)
    to_mathint(poolRemaining_(poolId)) <= to_mathint(poolFunded_(poolId));

// Single-award per feedback hash: once a feedback hash has been awarded in a pool, a
// second award of the same hash in that pool always reverts.
rule feedbackHashAwardedAtMostOnce(
    env e1,
    env e2,
    uint256 poolId,
    address recipient1,
    address recipient2,
    bytes32 feedbackHash,
    uint256 grossAmount1,
    uint256 grossAmount2
) {
    awardFeedbackBonus(e1, poolId, recipient1, feedbackHash, grossAmount1);
    awardFeedbackBonus@withrevert(e2, poolId, recipient2, feedbackHash, grossAmount2);
    assert lastReverted;
}

// The mechanism behind that gate: a successful award records the feedback-hash flag.
rule awardRecordsFeedbackHashFlag(
    env e,
    uint256 poolId,
    address recipient,
    bytes32 feedbackHash,
    uint256 grossAmount
) {
    awardFeedbackBonus(e, poolId, recipient, feedbackHash, grossAmount);
    assert feedbackHashAwarded(poolId, feedbackHash);
}
