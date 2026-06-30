/*
 * RoundRewardDistributor.spec — Phase 3 (distributor slice).
 *
 * Verification target: contracts/RoundRewardDistributor.sol (verified directly).
 * Run with:           certoraRun certora/confs/round-reward-distributor.conf
 *
 * The distributor records a reward claim with two flags — by commit key and by
 * voter address — and checks both before paying out (claimReward, lines 223/229).
 * These rules prove claimReward only ever *adds* to those records: it never clears
 * a previously-set claim flag. Together with the up-front guard, a recorded claim
 * stays recorded, which is the backbone of the no-double-claim guarantee.
 *
 * Deferred: aggregate-claimed <= pool, and the exact single-use revert (the claimed
 * commit/voter are derived from engine state, so that needs a faithful engine model
 * rather than the NONDET summaries used here).
 */

methods {
    function rewardClaimed(uint256, uint256, address) external returns (bool) envfree;
    function rewardCommitClaimed(uint256, uint256, bytes32) external returns (bool) envfree;

    // The distributor never custodies rewards: payout is delegated to the engine's
    // transferReward, and all engine reads / launch-pool / registry calls are to
    // other contracts. Summarize the mutating engine call + token as NONDET; the
    // engine view calls fall back to side-effect-free via optimistic_fallback.
    function _.transferReward(address, uint256) external => NONDET;
    function _.transfer(address, uint256) external => NONDET;
}

// claimReward never clears a voter's recorded claim flag (it only sets flags true).
rule claimRewardPreservesVoterClaim(env e, uint256 contentId, uint256 roundId, address voter, uint256 c, uint256 r) {
    bool wasClaimed = rewardClaimed(contentId, roundId, voter);
    claimReward(e, c, r);
    assert wasClaimed => rewardClaimed(contentId, roundId, voter);
}

// claimReward never clears a commit's recorded claim flag.
rule claimRewardPreservesCommitClaim(env e, uint256 contentId, uint256 roundId, bytes32 commitKey, uint256 c, uint256 r) {
    bool wasClaimed = rewardCommitClaimed(contentId, roundId, commitKey);
    claimReward(e, c, r);
    assert wasClaimed => rewardCommitClaimed(contentId, roundId, commitKey);
}
