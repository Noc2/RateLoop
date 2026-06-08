# Certora — next-steps recommendation (research-backed)

This is a second follow-up: a research-backed recommendation for what to do next with
the Certora work, written after Phases 3b–7 landed. It supersedes the "deferred"
framing in [`certora-security-findings.md`](./certora-security-findings.md) where new
evidence changes it. The plan in [`certora-followup.md`](./certora-followup.md) still
holds for *what* to prove; this doc is about *how* to unblock the parts that were parked
as "tooling-limited," plus the cheapest new wins.

## TL;DR recommendation

This round started from a research lead that the certora-cli flags
`--function_finder_mode relaxed` / `--use_memory_safe_autofinders` would unblock the
internal-function summaries that the highest-value proofs (single-use refund, no-double-
claim) depend on. **I validated that lead empirically against our 8.13.1 install, and it
does not hold for the engine** (see "Empirical validation" below). So the recommendation
is grounded in what actually works here, not what the docs imply:

1. **Strengthen the LaunchDistributionPool cap invariant** with auxiliary invariants +
   `requireInvariant` (Track B) — true, just not self-inductive. Tooling-independent;
   **do this first**.
2. **Add aggregate-conservation proofs** (sum-of-payouts ≤ pool) with the ghost+hook
   idiom / native ghost-map summation (Track C) — the headline solvency property still
   missing.
3. **Two cheap new high-value targets**: LoopReputation and ProtocolConfig (Track E).
4. **Land QuestionRewardPoolEscrow no-double-claim** — its resolver is an *external* call
   (summarizable), so unlike the engine it is reachable once the timeout is fixed by
   summarizing the heavy libraries + send-only mode (Track D).
5. **Port the existing Foundry solvency/rating invariants** to CVL (Track F).

The engine's *own* single-use-refund / internal-resolution properties stay **genuinely
blocked** in certora-cli 8.13.1 (Track A) — escalate to Certora rather than chase it.
Everything below cites the docs/changelog evidence and, where I tested it, the result.

## Empirical validation (what I actually ran)

I reconstructed the single-use refund rule that failed in Phase 3b (it summarizes the
engine's internal `_resolveClaimCommit` deterministically) and re-ran it with the flags
the research surfaced:

| Test | Result |
|---|---|
| `function_finder_mode: relaxed` (valid conf key in 8.13.1) + full proof | `noDoubleRefundSameCaller` **FAILS** — the internal summary is still not applied |
| `use_memory_safe_autofinders` conf key | **rejected** — not a valid key in 8.13.1 |
| Drop via_ir for the engine via `solc_via_ir: false` (so internal summaries would work) | **compile error: "Stack too deep. Try compiling with --via-ir"** — the engine genuinely requires via_ir |

Conclusion: for a contract that *must* use via_ir, certora-cli 8.13.1 has **no working
path** to apply an internal-function summary. The flags exist but do not cover this case,
and via_ir cannot be dropped. This confirms the original Phase 3b "deferred" call was
correct, and it sharpens the plan: pursue the properties whose resolver is *external*
(QRPE no-double-claim) or that need no resolution at all (Tracks B/C/E/F), and treat the
engine's internal-resolution properties as a tooling escalation, not a quick win.

## Why this updates the picture

When Phases 3b/4 were implemented, several blockers were recorded. Research surfaced
candidate workarounds; testing them sorts the blockers into "actually fixable" vs.
"confirmed hard limit":

| Blocker (as recorded) | Tested outcome | Action |
|---|---|---|
| Internal-function summaries not applied under `solc_optimize + via_ir` (engine resolver) | `function_finder_mode: relaxed` **does not** fix it; via_ir **cannot** be dropped (stack-too-deep). Confirmed hard limit in 8.13.1. | **Track A** — escalate to Certora; do not chase |
| QuestionRewardPoolEscrow no-double-claim (resolver is *external*) | Not blocked by the above — external resolvers are summarizable (NoDoubleClaim.spec already does this). Only the contract-size timeout is in the way. | **Track D** — summarize libs + send-only |
| QuestionRewardPoolEscrow solver exceeds the 15-min client window | Send-only mode (`wait_for_results: NONE`, default outside CI) avoids the client timeout; `global_timeout` caps at 2 h; heavy libraries summarizable `NONDET` | **Track D** |
| LaunchDistributionPool cap invariant not self-inductive | Tooling-independent — solvable with auxiliary invariants + `requireInvariant` | **Track B** |
| `yul_optimizer_steps` 0.8.34 workaround for 0.8.35 via_ir | No documented native 0.8.35 mapping even on latest (8.13.1) | keep the workaround; re-test on each cli bump |

## The plan

### Track A — engine internal-resolution properties: escalate, don't chase (BLOCKED)

The engine properties parked in Phase 3b (single-use refund, refund==stake) hinge on
**deterministic commit resolution** via the engine's *internal* `_resolveClaimCommit`,
which needs an internal-function summary. As validated above, certora-cli 8.13.1 cannot
apply that summary: `function_finder_mode: relaxed` does not help, and via_ir (required to
compile the engine) blocks internal summarization. The harness-wrapper trick does **not**
rescue this case either — the call inside `claimCancelledRoundRefund` is to the *internal*
function directly, so re-exposing it as external on the harness doesn't intercept it.

Recommended action: **do not invest engineering time here yet.** Instead:
- File a Certora forum/support issue with the minimal repro (it's already reduced — the
  `_ProbeInternalSummary` rule used for validation), asking for internal-summary support
  under via_ir, and re-test on each certora-cli bump.
- Treat the property as covered indirectly: the cross-contract no-double-claim (Phase 3)
  and the refund *state gates* (Phase 3b) already bound the most important misuse; the
  remaining single-use refund is defense-in-depth on a flag-guarded path that the existing
  Foundry tests already exercise.

This is the only genuinely blocked track. Everything below is actionable today.

### Track B — make the LaunchDistributionPool cap invariant inductive

`raterLaunchPaid[r] <= raterLaunchCap[r]` is true but not self-inductive. Strengthen it
with auxiliary invariants conjoined via `requireInvariant` (sound, unlike a raw `require`):

```cvl
// (1) cap monotonicity — a two-state relation, so a rule not an invariant
rule capNeverDecreases(method f, env e, calldataarg args, address r) {
    mathint capBefore = raterLaunchCap(r);
    f(e, args);
    assert raterLaunchCap(r) >= capBefore;
}

// (2) auxiliary consistency: paid>0 implies a cap was assigned
invariant capAssignedWhenPaid(address r)
    raterLaunchPaid(r) > 0 => raterLaunchCap(r) > 0;

// (3) the target, strengthened in the preserved block
invariant paidWithinCap(address r)
    raterLaunchPaid(r) <= raterLaunchCap(r)
    {
        preserved with (env e) {
            requireInvariant capAssignedWhenPaid(r);
            requireInvariant paidWithinCap(e.msg.sender); // the key a record path touches
        }
    }
```

The `requireInvariant paidWithinCap(e.msg.sender)` move is exactly the docs' cap-style
example (`collateralCoversBalance` requiring itself for `msg.sender`).

### Track C — aggregate conservation (the headline solvency property)

"Sum of all per-round reward payouts ≤ the round's pool" and "sum of `raterLaunchPaid` ≤
`poolBalance`" are the strongest solvency statements and still unproven. Use the canonical
ghost+hook idiom (the OpenZeppelin `sumOfBalances` pattern):

```cvl
ghost mathint sumRaterLaunchPaid { init_state axiom sumRaterLaunchPaid == 0; }

hook Sload uint256 paid raterLaunchPaid[KEY address r] STORAGE {
    require sumRaterLaunchPaid >= to_mathint(paid);   // no single entry exceeds the sum
}
hook Sstore raterLaunchPaid[KEY address r] uint256 newValue (uint256 oldValue) STORAGE {
    sumRaterLaunchPaid = sumRaterLaunchPaid - oldValue + newValue;
}
invariant sumPaidWithinPool() sumRaterLaunchPaid <= to_mathint(poolBalance());
```

For per-round sums use a `ghost mapping(uint256 => mathint)` accumulator (the Comet
`sumBalancePerAsset` pattern). certora-cli 7.25.2+ also offers **native summation over
ghost maps**, which removes most of the hook boilerplate — worth using on our 8.13.1.

Note for parametric rules (e.g. the lifecycle-monotonicity rule that produced spurious
counterexamples): constrain them to reachable states with `requireInvariant`, not raw
`require` or `filtered` — this is Certora's documented guidance and is sound because the
required invariants are separately proved.

### Track D — verify QuestionRewardPoolEscrow without timing out

The contract is 1,490 lines + 11 libraries; even the one revert-gate rule blew the 15-min
client window. Two independent fixes:

1. **Avoid the client timeout**: run with `wait_for_results: NONE` (send-only is already
   the default outside CI) and read results from the dashboard, and/or raise
   `global_timeout` toward its 2 h cap. In CI, prefer send-only + a follow-up status check
   over a blocking `--wait_for_results all` that can hit the client window.
2. **Cut the SMT load**: summarize the heavy claim-path libraries as `NONDET` so the prover
   doesn't analyze them (the refunded-pool / no-double-claim guards fire before they
   matter):
   ```cvl
   methods {
       function QuestionRewardPoolEscrowQualificationLib._ internal => NONDET;
       function QuestionRewardPoolEscrowClaimLib._        internal => NONDET;
       function QuestionRewardPoolEscrowVoterLib._        internal => NONDET;
       function QuestionRewardPoolEscrowTransferLib._     internal => NONDET;
   }
   ```
   Also consider `--nondet_difficult_funcs`, `--split_rules`, and `--prover_args
   '-mediumTimeout 30 -depth 5'`.

With the load cut, the refunded-pool gate should complete, and the **no-double-claim**
slice becomes reachable (its resolver, `votingEngine.resolveClaimCommit`, is an *external*
call — summarizable deterministically with the `persistent ghost` idiom exactly as
NoDoubleClaim.spec already does for the round reward).

### Track E — two cheap new high-value targets

- **LoopReputation (Phase 8)** — ~168 lines, no external deps. `totalSupply() <=
  MAX_SUPPLY` is self-inductive (mint is the only supply increase and is guarded). Also
  prove `lockedBalance(a) <= balanceOf(a)` and that governance-lock functions are
  governor-only. Highest ROI of any remaining target; ~1 day.
- **ProtocolConfig (Phase 10)** — small address-book; prove the single-active-distributor
  -per-engine relation (`rewardDistributorForVotingEngine` is a function, not multi-valued)
  and that config setters are role-gated. ~1 day; underpins governance confidence.

### Track F — port the existing Foundry invariants to CVL

`test/InvariantSolvency.t.sol` and `test/InvariantRating.t.sol` already assert strong
properties under fuzzing; porting them to CVL upgrades them from "no counterexample found
in N runs" to "proved":
- `totalClaimed <= round.totalStake + voterPool` (C-01 solvency) — pairs with Track C.
- `rating <= 100` and `weightedUpPool > weightedDownPool => rating >= 50` (rating bounds).

### Track G — CI maturation

Once Tracks A–C are green, the fast confs (`math`, `cluster-payout-oracle`,
`loop-reputation`, `protocol-config`) are stable enough to make a **required** PR check.
Keep the heavy confs (engine, escrow) on the weekly schedule + send-only mode so a slow
solver run never blocks a PR. Add `function_finder_mode: relaxed` to `base.conf` if Track A
confirms it helps broadly.

## Suggested sequencing

```
Track B  (cap invariant inductive)        ┐ small, tooling-independent
Track E  (LoopReputation, ProtocolConfig) ┘ cheapest wins, parallelizable   ← do first
Track C  (aggregate conservation ghosts)   ← the headline solvency property
Track D  (QRPE no-double-claim: lib summaries + send-only)  ← unblocks the largest contract
Track F  (port Foundry invariants)         ← rolls into Track C
Track G  (CI gate)                         ← after B–D are stable
Track A  (engine internal-resolution)      ← BLOCKED in 8.13.1; escalate to Certora, revisit on cli bump
```

## Sources

- certora-cli changelog (flags & versions): https://docs.certora.com/en/latest/docs/prover/changelog/prover_changelog.html
- CLI options (`function_finder_mode`, `solc_via_ir_map`, `smt_timeout` 300s, `global_timeout` 2 h cap, `wait_for_results`): https://docs.certora.com/en/latest/docs/prover/cli/options.html
- Timeouts guide (splitting, summarization, `nondet_difficult_funcs`): https://docs.certora.com/en/latest/docs/user-guide/out-of-resources/timeout.html
- Invariants & preserved blocks: https://docs.certora.com/en/latest/docs/cvl/invariants.html
- Require-invariants pattern (inductive strengthening): https://docs.certora.com/en/latest/docs/user-guide/patterns/require-invariants.html
- Ghosts & hooks (aggregate conservation): https://docs.certora.com/en/latest/docs/cvl/ghosts.html , https://docs.certora.com/en/latest/docs/cvl/hooks.html
- Canonical sum-of-balances spec: https://github.com/OpenZeppelin/openzeppelin-contracts/blob/release-v5.0/certora/specs/ERC20.spec
- methods/summaries & DISPATCHER: https://docs.certora.com/en/latest/docs/cvl/methods.html
