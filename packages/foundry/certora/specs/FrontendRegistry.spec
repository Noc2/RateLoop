/*
 * FrontendRegistry.spec — Phase 6.
 *
 * Verification target: certora/harnesses/FrontendRegistryHarness.sol
 * Run with:           certoraRun certora/confs/frontend-registry.conf
 *
 * Frontend operators lock a fixed STAKE_AMOUNT to register and earn fee credits. The
 * stake-conservation properties:
 *
 *   1. No overstaking — an operator's bonded stake never exceeds STAKE_AMOUNT. register
 *      sets it to exactly STAKE_AMOUNT, topUpStake is clamped to the missing remainder,
 *      slash only decreases it, and deregistration zeroes it.
 *   2. Single-use stake return — completeDeregister returns the stake (and fees) and
 *      zeroes the operator slot, so a second completeDeregister by the same operator
 *      always reverts (the stake cannot be withdrawn twice).
 *   3. Slash is bounded — slashFrontend reverts unless amount <= bonded stake, and
 *      reduces the stake by exactly that amount (it can never confiscate more than is
 *      bonded).
 *
 * July 2026 storage-layout review: appending access-recorder mappings after the
 * existing fee-accounting fields uses reserved gap slots only; these stake-conservation
 * properties and their public state accessors are unchanged.
 *
 * All proved over public state with NONDET token summaries; the single-use gate keys off
 * msg.sender, so no commit resolution is involved.
 */

methods {
    function stakedAmount_(address) external returns (uint256) envfree;
    function operator_(address) external returns (address) envfree;
    function STAKE_AMOUNT() external returns (uint256) envfree;

    function _.transfer(address, uint256) external => NONDET;
    function _.transferFrom(address, address, uint256) external => NONDET;
    function _.safeTransfer(address, uint256) external => NONDET;
    function _.safeTransferFrom(address, address, uint256) external => NONDET;
    function _.balanceOf(address) external => NONDET;
}

// No overstaking: bonded stake never exceeds the fixed requirement, for every operator
// and every reachable state.
invariant stakeNeverExceedsRequirement(address op)
    to_mathint(stakedAmount_(op)) <= to_mathint(STAKE_AMOUNT());

// Single-use stake return: a second completeDeregister by the same operator always
// reverts (no double withdrawal of stake).
rule completeDeregisterIsSingleUse(env e1, env e2) {
    require e1.msg.sender == e2.msg.sender;

    completeDeregister(e1);                  // first returns the stake
    completeDeregister@withrevert(e2);       // second by the same operator
    assert lastReverted;
}

// A successful deregistration clears the operator slot (the backbone of the single-use
// guarantee above).
rule completeDeregisterClearsOperator(env e) {
    completeDeregister(e);
    assert operator_(e.msg.sender) == 0;
}

// Slash is bounded and exact: it reduces bonded stake by exactly `amount`, and can only
// succeed when amount <= the stake bonded before the call (never over-confiscates).
rule slashReducesStakeByExactBoundedAmount(env e, address frontend, uint256 amount, string reason) {
    uint256 stakeBefore = stakedAmount_(frontend);

    slashFrontend(e, frontend, amount, reason);

    uint256 stakeAfter = stakedAmount_(frontend);
    assert amount <= stakeBefore;
    assert to_mathint(stakeBefore) - to_mathint(stakeAfter) == to_mathint(amount);
}
