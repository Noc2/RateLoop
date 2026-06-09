# Certora — round-3 plan (research-backed)

This is the third follow-up. Rounds 1–2 ([`certora-followup.md`](./certora-followup.md),
[`certora-next-steps.md`](./certora-next-steps.md)) landed Phases 1–10 / Tracks B–G as
verified slices, with the blocked remainder recorded in
[`certora-security-findings.md`](./certora-security-findings.md). This round re-asks the
question **"is it worth continuing, and if so on what?"** after a fresh research pass, and
narrows the work to what is actually unblocked and high-value today.

## Should we continue? — yes, with a narrowed scope

The effort is mature and the docs are excellent. Two research findings reshape the plan:

1. **certora-cli 8.13.1 is already the latest release** (May 19, 2026 — confirmed on PyPI
   and the Prover changelog). There is no 8.14+/9.x. So the items parked as
   "tooling-blocked, revisit on a cli bump" — chiefly **Track A** (engine internal-resolution
   under `via_ir`), native solc-0.8.35 `via_ir` mapping, and the large-contract timeout — have
   **no upgrade path right now**. The existing "escalate, don't chase" call on Track A is
   correct and should be treated as final for this round. We are at the tooling ceiling; do
   not spend engineering time fighting it.

2. **The contracts have outrun the specs.** `ClusterPayoutOracle.sol` changed three times on
   2026-06-08 (`10ded66c` block replay of rejected correlation roots, `808570b3` reject
   same-frontend challenges, `969536f0` split oracle metadata vs root rejections) — all
   *after* `ClusterPayoutOracle.spec` was frozen on 2026-06-07. The spec still compiles (no
   signature/struct drift), so existing proofs are not invalidated, but the new
   security-relevant branches (correlation-epoch root/metadata rejection split, same-frontend
   challenge guard) are **uncovered**, and one inline line reference is now stale (385 → 429).
   This is verification debt accruing in real time, and it is the freshest, most concrete
   reason to keep the lane alive.

Net: continue, but spend the budget on **tooling-independent, fund-protecting work** —
refreshing drifted specs, the one headline solvency property that research showed is now
cheap, CI maturation, and a spec-strength check — not on the confirmed tooling dead-ends.

## What is genuinely left

| Item | Status after research | Verdict |
|---|---|---|
| Oracle spec drift (new uncovered branches) | NEW finding — contract changed after spec frozen | **Do first** — fresh debt |
| Track C: aggregate `claimed ≤ pool` (RoundRewardDistributor) | Feasible & cheaper than thought — the sum is already a scalar slot | **High value** |
| Track G: promote fast confs to required PR gate + freshness guard | CI still non-gating (`workflow_dispatch` + cron) | **High value, low effort** |
| Track B: machine-check `paid ≤ cap` end-to-end | Documented solver-completeness gap; correct by inspection | Low priority |
| Track D: QRPE no-double-claim without timeout | NONDET-lib fix not yet attempted; may be blocked by same via_ir/internal-summary limit | Attempt, time-boxed |
| Gambit mutation testing | `certoraMutate` actively maintained; runs against existing specs | Worthwhile assurance check |
| Track A: engine internal-resolution under via_ir | Confirmed hard limit in 8.13.1 (latest); no fix exists | **Escalate only** — file issue, stop |

## The plan (priority order)

### 1. Refresh the ClusterPayoutOracle spec to the current contract  ← do first

The contract grew new branches the spec doesn't see. Close the gap:

- Fix the stale line reference in `ClusterPayoutOracle.spec` (rejected-root guard moved from
  `:385` to `:429`).
- Add rules for the **new** rejection surface from `969536f0` / `10ded66c`:
  - correlation-epoch root rejection is permanent and blocks replay
    (`rejectedCorrelationEpochRoots`, new `rejectedCorrelationEpochSnapshotDigests`);
  - the metadata-vs-root split (`rejectCorrelationEpoch` / `rejectCorrelationEpochRoot` /
    `rejectFinalizedCorrelationEpoch` / `rejectFinalizedCorrelationEpochRoot`) — each path's
    guard fires and is single-use.
- Add a rule for the same-frontend challenge guard (`808570b3`): a challenge from the
  proposing frontend reverts.

**Effort:** low–medium. Reuses the existing full-contract oracle conf; these are
state-gate / single-use rules in the shape the spec already proves.

### 2. Track C — aggregate `claimed ≤ pool` (headline solvency)

The single most valuable unproven property: a round's total reward payouts never exceed its
voter pool. Research showed this is **easier than the original ghost+hook plan** because the
aggregate already lives in a scalar:

- `RoundRewardDistributor.roundVoterRewardClaimedAmount[contentId][roundId]` (`:78`) is the
  running sum, written at `:265` and `:597`; the analogous frontend sum is
  `roundFrontendClaimedAmount` (`:98`). No `hook Sstore` over a mapping range needed.
- The bound `voterPool` comes from the engine (`votingEngine.rbtsRoundState(...)`, `:248`),
  which the distributor specs currently summarize `NONDET`. **Missing piece:** expose
  `voterPool` deterministically — add a distributor-side harness getter (the
  `RoundVotingEngineHarness` does not expose it today) — then prove the scalar invariant
  `roundVoterRewardClaimedAmount[c][r] <= voterPool(c,r)`.
- Mirror the `LaunchDistributionPoolConservation.spec` idiom (counter already *is* the sum)
  rather than the hook-heavy `sumOfBalances` pattern.

**Effort:** medium. Main cost is the harness getter + getting the invariant inductive
(likely needs the `claimedAmount > voterPool` revert at `:256` as an auxiliary fact).

### 3. Track G — CI maturation: required gate + spec-freshness guard

`certora.yaml` is still `workflow_dispatch` + weekly cron, non-gating; the run step warns
(not fails) when `CERTORAKEY` is unset. Two steps:

- Promote the fast, stable confs (`math`, `cluster-payout-oracle`, `loop-reputation`,
  `protocol-config`) to a **required, path-filtered PR check**. Keep heavy confs (engine,
  escrow, the two excluded QRPE confs) on the weekly schedule + send-only so a slow solver
  never blocks a PR. Keep `fail-fast: false`.
- Add a lightweight **spec-freshness guard**: a CI check (or `make` target) that fails when a
  contract with a matching spec is changed in a PR without the spec being touched — this is
  exactly the drift that produced item 1, and a guard makes it visible instead of silent.

**Effort:** low. Mostly workflow YAML + a small diff-checking script.

### 4. Gambit mutation testing (spec-strength check)

Run `certoraMutate` against the verified confs to measure whether the specs actually catch
injected bugs (a passing spec over a weak property is false assurance). Start with the
cleanest harness-based confs (`frontend-registry`, `feedback-bonus-escrow`,
`loop-reputation`, `math`). Run manually first, record surviving-mutant counts, and only
wire into CI if runtimes are acceptable. Note: the same via_ir/internal-summary constraints
apply to the Prover runs Gambit triggers, so prefer the harness-based (non-via_ir) confs.

**Effort:** medium. New tooling surface; value is diagnostic, not a new proof.

### 5. Track B — machine-check `paid ≤ cap` end-to-end (low priority)

`raterLaunchPaid[r] <= raterLaunchCap[r]` is correct by inspection and covered by two proved
lemmas; only the end-to-end machine proof is missing (nonlinear mul-div the SMT backend won't
discharge). If wanted: add a small pure CVL lemma proving `a*b/c <= a` for `b <= c` once and
apply it to the assignment + the `finalizeEarnedRaterRewardCredit` / `unlockFullEarnedRaterCap`
catch-up paths. Low priority — assurance is already adequate.

### 6. Track D — QRPE no-double-claim without timeout (attempt, time-boxed)

The suggested NONDET-summary of the heavy libraries
(`QuestionRewardPoolEscrowQualificationLib/ClaimLib/VoterLib/TransferLib`) is **not yet
applied** — the current specs only NONDET external contract calls. Try it with send-only mode
(`wait_for_results: NONE`, `global_timeout: 7200`). **Risk:** the escrow needs `via_ir`, under
which 8.13.1 cannot instrument internal-function summaries — the same wall as Track A may
apply to internal libraries. Time-box it; if the via_ir/internal-summary error appears, fold
it into the Track A escalation rather than chasing.

### 7. Track A — escalate, then stop

Confirmed dead-end in 8.13.1 (the latest). File a Certora forum/support issue with the
already-reduced `_ProbeInternalSummary` repro asking for internal-summary support under
`solc_optimize + via_ir`, link it from `certora-security-findings.md`, and re-test only when
8.14+ ships. No further engineering this round.

## Suggested sequencing

```
1. Oracle spec refresh         ← fresh verification debt, do first
2. Track C (aggregate ≤ pool)  ← headline solvency, now cheap
3. Track G (CI gate + freshness guard)  ← lock in the gains, prevent future drift
   ── then, as budget allows ──
4. Gambit (spec-strength check)
5. Track B (paid ≤ cap lemma)  ← low priority
6. Track D (QRPE, time-boxed)  ← may hit the via_ir wall
7. Track A (file issue, stop)  ← no engineering
```

Items 1–3 are the core of this round: they are all tooling-independent, fund- or
correctness-protecting, and prevent the spec base from rotting against an active contract
codebase. Items 4–7 are opportunistic.

## Non-goals (unchanged)

Still no whole-protocol proof, no off-chain scorer correctness, no economic-game properties,
and no fighting the via_ir/internal-summary tooling limit until a new certora-cli ships. This
round only widens on-chain accounting coverage and keeps the existing proofs honest against a
moving contract base.

## Sources

- certora-cli releases (8.13.1 is latest, May 19 2026): https://pypi.org/project/certora-cli/ ,
  https://docs.certora.com/en/latest/docs/prover/changelog/prover_changelog.html
- CLI options (`function_finder_mode`, `wait_for_results`, `global_timeout`, `nondet_difficult_funcs`):
  https://docs.certora.com/en/latest/docs/prover/cli/options.html
- Timeouts guide: https://docs.certora.com/en/latest/docs/user-guide/out-of-resources/timeout.html
- Ghosts/hooks + native ghost-map summation: https://docs.certora.com/en/latest/docs/cvl/ghosts.html
- Require-invariants (inductive strengthening): https://docs.certora.com/en/latest/docs/user-guide/patterns/require-invariants.html
- Gambit / certoraMutate: https://docs.certora.com/en/latest/docs/gambit/index.html , https://github.com/Certora/gambit
