/*
 * ClusterPayoutOracle.spec — Phase 2 formal properties.
 *
 * Verification target: contracts/ClusterPayoutOracle.sol (verified directly).
 * Run with:           certoraRun certora/confs/cluster-payout-oracle.conf
 *
 * First slice: the safety guarantees of `verifyPayoutWeight`, the function the
 * escrow trusts to gate a cluster-backed payout claim. Each property is the
 * contrapositive of one of the function's early `return false` guards, so a `true`
 * result is proven to imply every gate held. These are pure view properties over
 * arbitrary contract state, so they hold for every reachable storage configuration.
 *
 * Deferred to later slices (need state-transition modeling or an ERC20 mock):
 *   - snapshot lifecycle monotonicity (Proposed/Challenged/Finalized/Rejected)
 *   - rejected root / digest non-reuse
 *   - challenge-window finalization timing
 *   - single-use bond-credit withdrawal (challengeBondToken.safeTransfer)
 * See docs/testing/certora.md (Phase 2).
 */

methods {
    function BPS_DENOMINATOR() external returns (uint16) envfree;
}

// A successful verification implies the per-claim independence factor is within the
// BPS cap — it can never wave through an out-of-range independence weighting.
rule verifyImpliesIndependenceWithinCap(env e, IClusterPayoutOracle.PayoutWeight payout, bytes32[] proof) {
    bool ok = verifyPayoutWeight(e, payout, proof);
    assert ok => payout.independenceBps <= BPS_DENOMINATOR();
}

// A successful verification implies the effective (independence-discounted) weight
// never exceeds the base weight — no claim can verify for more than its base.
rule verifyImpliesEffectiveAtMostBase(env e, IClusterPayoutOracle.PayoutWeight payout, bytes32[] proof) {
    bool ok = verifyPayoutWeight(e, payout, proof);
    assert ok => payout.effectiveWeight <= payout.baseWeight;
}

// A successful verification implies the underlying snapshot is currently finalized
// (status == Finalized AND its correlation epoch is still the current finalized one).
// isRoundPayoutSnapshotFinalized derives the same snapshotKey and reads the same
// storage, so this ties the two views together.
rule verifyImpliesSnapshotFinalized(env e, IClusterPayoutOracle.PayoutWeight payout, bytes32[] proof) {
    bool ok = verifyPayoutWeight(e, payout, proof);
    bool finalized =
        isRoundPayoutSnapshotFinalized(e, payout.domain, payout.rewardPoolId, payout.contentId, payout.roundId);
    assert ok => finalized;
}

// A successful verification implies the caller is exactly the snapshot's pinned
// consumer — no other address can get a true out of verifyPayoutWeight.
rule verifyImpliesConsumerCaller(env e, IClusterPayoutOracle.PayoutWeight payout, bytes32[] proof) {
    bool ok = verifyPayoutWeight(e, payout, proof);
    address consumer =
        roundPayoutSnapshotConsumerFor(e, payout.domain, payout.rewardPoolId, payout.contentId, payout.roundId);
    assert ok => e.msg.sender == consumer;
}
