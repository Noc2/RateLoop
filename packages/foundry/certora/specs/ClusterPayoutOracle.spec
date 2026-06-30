/*
 * ClusterPayoutOracle.spec — Phase 2 formal properties.
 *
 * Verification target: contracts/ClusterPayoutOracle.sol (verified directly).
 * Run with:           certoraRun certora/confs/cluster-payout-oracle.conf
 *
 * Covered here:
 *   - verifyPayoutWeight safety guarantees: each rule is the contrapositive of one
 *     of the function's early `return false` guards, so a `true` result is proven
 *     to imply every gate held (pure view properties over arbitrary state).
 *   - rejected-root non-reuse: a blacklisted (snapshotKey, weightRoot) can never be
 *     re-proposed (proposeRoundPayoutSnapshot reverts).
 *   - rejected correlation-epoch root non-reuse (L-Oracle-4, commit 10ded66c): once an
 *     epoch's clusterRoot is on the rejected-root blacklist, proposeCorrelationEpoch for
 *     that exact (epochId, clusterRoot) always reverts. This covers the explicit-root
 *     rejection path added by rejectCorrelationEpochRoot / rejectFinalizedCorrelationEpochRoot.
 *   - single-use bond-credit withdrawal: a withdrawal zeroes the caller's credit and
 *     an empty withdrawal reverts, so a credit is drawable at most once.
 *
 * Deferred to later slices (need richer state-transition modeling):
 *   - full snapshot lifecycle monotonicity (Proposed/Challenged/Finalized/Rejected)
 *   - rejected digest non-reuse and the consumed-slot permanent-death guard
 *   - challenge-window finalization timing
 *   - parent correlation-epoch rejection cascade
 *   - the metadata-vs-root rejection split (rejectCorrelationEpoch keeps the deterministic
 *     root re-proposable; only the *Root variants blacklist it) — proving the metadata path
 *     does NOT blacklist needs a getter for the snapshot's stored clusterRoot (private struct)
 *   - the disinterested-challenger guard (a proposer/frontend-operator cannot self-challenge,
 *     commit 808570b3) — reads the private snapshot struct's proposer/frontendOperator fields
 */

methods {
    function BPS_DENOMINATOR() external returns (uint16) envfree;
    function roundPayoutSnapshotKey(uint8, uint256, uint256, uint256) external returns (bytes32) envfree;

    // Public-mapping getters used by the lifecycle / bond rules.
    function pendingBondWithdrawals(address) external returns (uint256) envfree;
    function rejectedRoundPayoutSnapshotRoots(bytes32, bytes32) external returns (bool) envfree;
    function rejectedRoundPayoutSnapshotDigests(bytes32, bytes32) external returns (bool) envfree;
    function rejectedRoundPayoutSnapshotConsumed(bytes32) external returns (bool) envfree;
    function rejectedCorrelationEpochRoots(uint256, bytes32) external returns (bool) envfree;
    function rejectedCorrelationEpochRootKeys(bytes32) external returns (bool) envfree;
    function rejectedCorrelationEpochSnapshotDigests(uint256, bytes32) external returns (bool) envfree;

    // Summarize the external dependencies (frontend registry, snapshot consumer,
    // bond ERC20) as NONDET so a call to them cannot havoc THIS contract's storage.
    // All of these are pure/view or try/catch on the call sites, so NONDET is sound
    // for the accounting/lifecycle properties below.
    function _.authorizedSnapshotFrontend(address) external => NONDET;
    function _.isEligible(address) external => NONDET;
    function _.STAKE_AMOUNT() external => NONDET;
    function _.isRoundPayoutSnapshotConsumed(uint8, uint256, uint256, uint256) external => NONDET;
    function _.roundPayoutSnapshotSourceReadyAt(uint8, uint256, uint256, uint256) external => NONDET;
    function _.transfer(address, uint256) external => NONDET;
    function _.transferFrom(address, address, uint256) external => NONDET;
}

// ---------------------------------------------------------------------------
// Rejected roots cannot be reused: once a (snapshotKey, weightRoot) pair is on
// the rejected-root blacklist, proposeRoundPayoutSnapshot for that exact root
// always reverts (guard at ClusterPayoutOracle.sol:429). The blacklists are only
// ever written `true` and never cleared, so a rejected root stays unproposable.
// ---------------------------------------------------------------------------

rule cannotReproposeRejectedRoot(env e, IClusterPayoutOracle.RoundPayoutSnapshotInput input) {
    bytes32 key = roundPayoutSnapshotKey(input.domain, input.rewardPoolId, input.contentId, input.roundId);
    require rejectedRoundPayoutSnapshotRoots(key, input.weightRoot);
    proposeRoundPayoutSnapshot@withrevert(e, input);
    assert lastReverted;
}

// ---------------------------------------------------------------------------
// Same guarantee one level up, for correlation epochs (L-Oracle-4, commit
// 10ded66c "Block replay of rejected correlation roots"): once an epoch's
// clusterRoot is blacklisted via rejectCorrelationEpochRoot /
// rejectFinalizedCorrelationEpochRoot, proposeCorrelationEpoch for that exact
// (epochId, clusterRoot) always reverts at the guard on
// ClusterPayoutOracle.sol:267-272. This is the contrapositive of that guard's
// first disjunct; the blacklist is only ever written `true`, so the block is
// permanent. (The second disjunct — the source-set-keyed rootKeys mapping — is
// not asserted here because its key derives from the internally-computed
// sourceSetDigest, which cannot be matched from calldata.)
// ---------------------------------------------------------------------------

rule cannotReproposeRejectedCorrelationEpochRoot(
    env e,
    uint64 epochId,
    uint64 fromRoundId,
    uint64 toRoundId,
    bytes32 clusterRoot,
    bytes32 parameterHash,
    bytes32 artifactHash,
    string artifactURI,
    IClusterPayoutOracle.CorrelationEpochSourceRef[] sourceRefs
) {
    require rejectedCorrelationEpochRoots(require_uint256(epochId), clusterRoot);
    proposeCorrelationEpoch@withrevert(
        e, epochId, fromRoundId, toRoundId, clusterRoot, parameterHash, artifactHash, artifactURI, sourceRefs
    );
    assert lastReverted;
}

// ---------------------------------------------------------------------------
// Bond-credit withdrawal is single-use: a successful withdrawal zeroes the
// caller's credit, and a withdrawal with no credit reverts. Together these mean a
// credit can be drawn at most once and never over-withdrawn.
// ---------------------------------------------------------------------------

rule bondWithdrawalZeroesCallerCredit(env e) {
    withdrawBondCredit(e);
    assert pendingBondWithdrawals(e.msg.sender) == 0;
}

rule bondWithdrawalToZeroesCallerCredit(env e, address recipient) {
    withdrawBondCreditTo(e, recipient);
    assert pendingBondWithdrawals(e.msg.sender) == 0;
}

rule bondWithdrawalRevertsWithoutCredit(env e) {
    require pendingBondWithdrawals(e.msg.sender) == 0;
    withdrawBondCredit@withrevert(e);
    assert lastReverted;
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
