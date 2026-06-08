/*
 * QuestionRewardPoolEscrowClaim.spec — Phase 4a (Track D).
 *
 * Verification target: contracts/QuestionRewardPoolEscrow.sol (verified directly).
 * Run with:           certoraRun certora/confs/question-reward-escrow-claim.conf
 *
 * The no-double-claim backbone for question rewards: no function ever clears a recorded
 * per-commit claim flag. Combined with the up-front `require(!rewardClaimed[...])` guard
 * in the claim path, this is exactly what prevents a commit from being paid twice — the
 * same shape proved for the round-reward distributor in RoundRewardDistributor.spec.
 *
 * `rewardClaimed` is private, so a storage hook mirrors it into a ghost (hooks observe
 * storage regardless of Solidity visibility). The rule is resolution-free: it does not
 * depend on which commit a caller resolves to, only that a set flag is never unset. The
 * external votingEngine getters used during a claim are summarized NONDET (they cannot
 * write this contract's storage) — this also keeps the heavy claim path tractable.
 */

ghost mapping(uint256 => mapping(uint256 => mapping(bytes32 => bool))) claimedMirror;

hook Sstore rewardClaimed[KEY uint256 poolId][KEY uint256 roundId][KEY bytes32 commitKey] bool newValue (bool oldValue) {
    claimedMirror[poolId][roundId][commitKey] = newValue;
}

methods {
    // Engine / oracle / token externals: NONDET (no side effects on this contract's
    // storage; also cuts the SMT load on this 1,490-line + 11-library contract).
    function _.roundLifecycleState(uint256, uint256) external => NONDET;
    function _.commitCore(uint256, uint256, bytes32) external => NONDET;
    function _.commitIdentityState(uint256, uint256, bytes32) external => NONDET;
    function _.identityCommitState(uint256, uint256, bytes32, address) external => NONDET;
    function _.voterCommitKey(uint256, uint256, address) external => NONDET;
    function _.roundRaterRegistrySnapshot(uint256, uint256) external => NONDET;
    function _.roundFrontendRegistrySnapshot(uint256, uint256) external => NONDET;
    function _.transfer(address, uint256) external => NONDET;
    function _.transferFrom(address, address, uint256) external => NONDET;
    function _.safeTransfer(address, uint256) external => NONDET;
    function _.balanceOf(address) external => NONDET;
}

// No function ever clears a recorded per-commit claim flag.
rule rewardClaimedFlagNeverCleared(method f, env e, calldataarg args, uint256 poolId, uint256 roundId, bytes32 commitKey) {
    require claimedMirror[poolId][roundId][commitKey];
    f(e, args);
    assert claimedMirror[poolId][roundId][commitKey];
}
