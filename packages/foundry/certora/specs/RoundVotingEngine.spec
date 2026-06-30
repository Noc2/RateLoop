/*
 * RoundVotingEngine.spec — Phase 3 formal properties.
 *
 * Verification target: certora/harnesses/RoundVotingEngineHarness.sol
 * Run with:           certoraRun certora/confs/round-voting-engine.conf
 *
 * First slice: `transferReward`, the single function a reward distributor uses to
 * draw LREP out of the engine. Its exact-accounting and zero-recipient guarantees
 * underpin engine solvency (no distributor can pull more than it accounts for, and
 * no rewards are burned to address(0)).
 *
 * Deferred (need lifecycle / multi-tx settle modeling): round-state terminal
 * absorption, single-use refunds, refund <= stake, rating bounds.
 */

methods {
    function accountedLrepBalance_() external returns (uint256) envfree;

    // Summarize external dependencies (ProtocolConfig auth check, LREP ERC20) as
    // NONDET so they cannot havoc engine storage. Auth returning NONDET means the
    // success path is explored under "authorized"; the accounting then must hold.
    function _.isRewardDistributorForEngine(address, address) external => NONDET;
    function _.transfer(address, uint256) external => NONDET;
    function _.balanceOf(address) external => NONDET;
}

// transferReward draws down the engine's accounted LREP inventory by EXACTLY the
// transferred amount — never more, never less.
rule transferRewardDecreasesAccountingExactly(env e, address recipient, uint256 amount) {
    uint256 balanceBefore = accountedLrepBalance_();
    transferReward(e, recipient, amount);
    uint256 balanceAfter = accountedLrepBalance_();
    assert to_mathint(balanceBefore) - to_mathint(balanceAfter) == to_mathint(amount);
}

// A successful transferReward can never overdraw: the post-state accounting is at
// most the pre-state (the subtraction reverts on underflow in 0.8).
rule transferRewardNeverIncreasesAccounting(env e, address recipient, uint256 amount) {
    uint256 balanceBefore = accountedLrepBalance_();
    transferReward(e, recipient, amount);
    assert accountedLrepBalance_() <= balanceBefore;
}

// transferReward refuses the zero recipient — rewards are never sent to address(0).
rule transferRewardRejectsZeroRecipient(env e, uint256 amount) {
    transferReward@withrevert(e, 0, amount);
    assert lastReverted;
}
