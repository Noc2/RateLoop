# Gambit mutation testing

Mutation testing measures **spec strength**: a passing Certora spec only means "no
counterexample to the rules as written." It does *not* tell you whether the rules are
strong enough to catch a real bug. [Gambit](https://docs.certora.com/en/latest/docs/gambit/index.html)
(bundled with `certora-cli`) answers that — it injects small mutations into a contract
and `certoraMutate` re-runs the Prover against each mutant:

- a **killed** mutant = a rule failed on the broken code = the spec caught it (good);
- a **surviving** mutant = every rule still passed on broken code = the spec
  under-constrains that line (a weak-spec signal to investigate — *not* a contract bug).

## Running

Each mutant is a full Prover job, so this needs `CERTORAKEY` and is run **manually**, not
in CI. From `packages/foundry`:

```sh
export CERTORAKEY=<personal_access_key>

make certora-mutate                                            # default: FrontendRegistry
make certora-mutate MUTATION_CONF=certora/mutation/feedback-bonus-escrow.mutation.conf
make certora-mutate MUTATION_CONF=certora/mutation/reward-math.mutation.conf

# or directly:
certoraMutate certora/mutation/frontend-registry.mutation.conf
```

`certoraMutate` prints a dashboard link; the report lists each mutant and whether it was
killed or survived.

## Targets chosen first

The confs here are the cleanest starting points — all **harness-based and `via_ir`-free**,
so they dodge the internal-summary tooling limits that block the heavier contracts, and
their proofs are fast enough for a full mutant sweep:

| Mutation conf | Contract mutated | Spec under test |
|---|---|---|
| `frontend-registry.mutation.conf` | `FrontendRegistry.sol` | stake/slash conservation |
| `feedback-bonus-escrow.mutation.conf` | `FeedbackBonusEscrow.sol` | bonus conservation + single-award |
| `reward-math.mutation.conf` | `libraries/RewardMath.sol` | Math.spec conservation/bounds/monotonicity |

## Interpreting results

Record surviving-mutant counts per run. A survivor usually means one of:

1. the mutated line is not covered by any rule → add a rule, or
2. a rule is too weak (e.g. asserts `>= 0` where `<= cap` was intended) → tighten it, or
3. the mutation is equivalent (semantically identical code) → no action, note it.

Only wire a target into CI once its runtime is known and its survivor set is triaged to
"covered or equivalent". Heavy / `via_ir` contracts (engine, escrow) are intentionally not
listed yet — the same internal-summary constraints from the proof lane apply to the
Prover runs Gambit triggers.
