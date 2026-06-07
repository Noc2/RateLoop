/*
 * NoDoubleClaim.spec — Phase 3 cross-contract no-double-claim.
 *
 * Verification target: contracts/RoundRewardDistributor.sol (verified directly;
 *   it pulls in RoundVotingEngine via import).
 * Run with:           certoraRun certora/confs/no-double-claim.conf
 *
 * Proves the headline solvency-adjacent property that spans the distributor and the
 * engine: the same caller cannot claim a settled round's reward twice. The reward
 * payout itself happens in the engine (votingEngine.transferReward), but the
 * single-use gate lives in the distributor's claim flags — so this is genuinely a
 * cross-contract guarantee.
 *
 * Modeling: claimReward resolves the caller's commit via
 * votingEngine.resolveClaimCommit(contentId, roundId, account). We summarize that
 * resolution as a DETERMINISTIC function of its arguments. This is faithful, not a
 * convenience: claimReward never writes the engine/registry storage that
 * resolveClaimCommit reads (only distributor claim flags and the engine's LREP
 * accounting), so for a fixed (contentId, roundId, account) it genuinely returns
 * the same commit on every call. Every other engine view (roundCore, commitCore,
 * roundLifecycleState, rbts*), transferReward, and the token are left NONDET — the
 * proof does not lean on them, because the first claim sets
 * rewardCommitClaimed[contentId][roundId][commitKey] and the second claim's guard
 * reverts on exactly that flag regardless of what the NONDET views return.
 */

// Deterministic abstraction of commit resolution (uninterpreted => same args, same
// result). Must be `persistent`: a plain ghost is havoc'd by the external calls
// inside claimReward, which would let the second call resolve a different commit
// key and spuriously bypass the double-claim guard. persistent ghosts survive
// havoc, so resolution stays a fixed function across both calls.
persistent ghost resolvedCommitKey(uint256, uint256, address) returns bytes32;
persistent ghost resolvedRecipient(uint256, uint256, address) returns address;

function resolveClaimSummary(uint256 contentId, uint256 roundId, address account) returns (bytes32, address) {
    return (resolvedCommitKey(contentId, roundId, account), resolvedRecipient(contentId, roundId, account));
}

methods {
    function rewardCommitClaimed(uint256, uint256, bytes32) external returns (bool) envfree;

    function _.resolveClaimCommit(uint256 contentId, uint256 roundId, address account) external =>
        resolveClaimSummary(contentId, roundId, account) expect (bytes32, address);

    // Every other engine view / config call is summarized NONDET: that returns an
    // arbitrary value with NO storage side effects, so it cannot havoc the
    // distributor's claim-flag mappings. (Without explicit NONDET, an unresolved
    // call is havoc-all and would wipe the flag set by the first claim, masking the
    // double-claim guard.) The proof needs none of these to be deterministic.
    function _.roundCore(uint256, uint256) external => NONDET;
    function _.commitCore(uint256, uint256, bytes32) external => NONDET;
    function _.roundLifecycleState(uint256, uint256) external => NONDET;
    function _.rbtsRoundState(uint256, uint256) external => NONDET;
    function _.rbtsCommitState(uint256, uint256, bytes32) external => NONDET;
    function _.voterCommitKey(uint256, uint256, address) external => NONDET;
    function _.frontendFeeState(uint256, uint256, address) external => NONDET;
    function _.roundFrontendRegistrySnapshot(uint256, uint256) external => NONDET;
    function _.protocolConfig() external => NONDET;
    function _.launchDistributionPool() external => NONDET;
    function _.treasury() external => NONDET;

    // The distributor never custodies rewards; payout is delegated to the engine.
    function _.transferReward(address, uint256) external => NONDET;
    function _.transfer(address, uint256) external => NONDET;
}

// No double claim: if a caller successfully claims a round's reward, an immediately
// following claim by the same caller for the same round always reverts.
rule noDoubleClaimSameCaller(env e1, env e2, uint256 contentId, uint256 roundId) {
    require e1.msg.sender == e2.msg.sender;

    claimReward(e1, contentId, roundId);                    // first claim succeeds
    claimReward@withrevert(e2, contentId, roundId);         // second claim by same caller
    assert lastReverted;
}

// And the underlying mechanism: after a successful claim, the resolved commit's
// claim flag is recorded (so the guard above has something to catch on).
rule successfulClaimRecordsCommitFlag(env e, uint256 contentId, uint256 roundId) {
    bytes32 key = resolvedCommitKey(contentId, roundId, e.msg.sender);
    claimReward(e, contentId, roundId);
    assert rewardCommitClaimed(contentId, roundId, key);
}
