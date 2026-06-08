/*
 * LoopReputation.spec — Phase 8 (Track E).
 *
 * Verification target: contracts/LoopReputation.sol (verified directly).
 * Run with:           certoraRun certora/confs/loop-reputation.conf
 *
 * LREP is the capped governance token. Properties:
 *   1. Supply cap — totalSupply never exceeds MAX_SUPPLY. mint is the only supply
 *      increase and is guarded by `require(totalSupply()+amount <= MAX_SUPPLY)`, and
 *      there is no burn path, so the cap is self-inductive.
 *   2. mint is MINTER_ROLE-gated.
 *   3. Governance locking is governor-only.
 *   4. Transfers cannot move governance-locked tokens (a successful transfer never
 *      exceeds the sender's transferable balance).
 */

methods {
    function totalSupply() external returns (uint256) envfree;
    function MAX_SUPPLY() external returns (uint256) envfree;
    function MINTER_ROLE() external returns (bytes32) envfree;
    function hasRole(bytes32, address) external returns (bool) envfree;
    function governor() external returns (address) envfree;
    function getTransferableBalance(address) external returns (uint256);
}

// 1. Supply cap is never exceeded, in any reachable state.
invariant totalSupplyWithinCap()
    totalSupply() <= MAX_SUPPLY();

// 2. mint succeeds only for a caller holding MINTER_ROLE.
rule mintRequiresMinterRole(env e, address to, uint256 amount) {
    bool isMinter = hasRole(MINTER_ROLE(), e.msg.sender);
    mint@withrevert(e, to, amount);
    assert !lastReverted => isMinter;
}

// 3. Governance lock can only be engaged by the configured governor.
rule lockForGovernanceOnlyByGovernor(env e, address account, uint256 amount) {
    lockForGovernance@withrevert(e, account, amount);
    assert !lastReverted => e.msg.sender == governor();
}

// 4. A transfer never moves more than the sender's transferable (non-locked) balance.
rule transferCannotMoveLockedTokens(env e, address to, uint256 value) {
    require e.msg.sender != 0;
    mathint transferable = getTransferableBalance(e, e.msg.sender);
    transfer@withrevert(e, to, value);
    assert !lastReverted => to_mathint(value) <= transferable;
}
