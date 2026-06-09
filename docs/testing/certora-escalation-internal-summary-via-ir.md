# Certora escalation — internal-function summaries under solc_optimize + solc_via_ir

This is a ready-to-file support/forum write-up for the one genuinely tooling-blocked item
in the RateLoop Certora lane (Track A). It is parked here, not chased, because — as
verified below — there is no working path in certora-cli 8.13.1, which is the latest
release. File it upstream and re-test on each certora-cli bump.

## Summary

Several high-value properties (single-use refund on `RoundVotingEngine`, per-commit
no-double-claim on `QuestionRewardPoolEscrow`) require summarizing an **internal**
commit-resolution function deterministically. certora-cli 8.13.1 cannot apply
internal-function summaries when the contract is compiled with `solc_optimize` +
`solc_via_ir`, emitting:

```
Cannot apply summaries for internal functions ... when compiling using solc_optimize and solc_via_ir
```

and (relatedly, for the auto-finder):

```
Failed to generate auto finder for <fn> ...
WARNING: Cannot apply summaries for internal functions with unnamed argument when compiling using solc_optimize and solc_via_ir
```

These contracts genuinely require `via_ir`: building them on the legacy pipeline fails with
`Stack too deep. Try compiling with --via-ir`. So `via_ir` cannot be dropped, and the
internal summary cannot be applied — there is no intersection.

## Environment

- certora-cli: 8.13.1 (latest as of 2026-05-19; confirmed on PyPI / Prover changelog)
- solc: 0.8.35 + `via_ir`, optimizer runs = 100, evm = cancun
- `yul_optimizer_steps` set to solc 0.8.34's step string (certora-cli does not natively map
  0.8.35's via_ir Yul steps — a separate, minor gap)

## Real-world repro cases in this repo

Both are committed and reproduce the warning under `make certora-check`
(`certoraRun <conf> --compilation_steps_only`):

- `packages/foundry/certora/confs/round-voting-engine-lifecycle.conf` — the single-use
  refund property routes through the engine's internal `_resolveClaimCommit`.
- `packages/foundry/certora/confs/question-reward-escrow-claim.conf` — the per-commit
  no-double-claim routes through `QuestionRewardPoolEscrow._resolveQuestionRewardClaim`
  (QuestionRewardPoolEscrow.sol:1460, called from the claim path at :733), which is
  internal — not an external call summarizable the way `NoDoubleClaim.spec` summarizes the
  distributor→engine external `resolveClaimCommit`.

## What was already tried (and did not work)

Recorded from the round-2 empirical validation (docs/testing/certora-next-steps.md):

| Attempt | Result |
|---|---|
| `function_finder_mode: relaxed` (valid key in 8.13.1) | internal summary still not applied |
| `use_memory_safe_autofinders` conf key | rejected — not a valid key in 8.13.1 |
| Drop via_ir (`solc_via_ir: false`) so internal summaries work | compile error: `Stack too deep. Try compiling with --via-ir` |
| Re-expose the internal fn as external on a harness | does not intercept — the call inside the contract is to the internal function directly |

## The ask

Add support for applying CVL internal-function summaries (or a sound equivalent) when a
contract is compiled with `solc_optimize` + `solc_via_ir`. Failing that, guidance on a
supported pattern for deterministically modeling an internal resolver in a via_ir-required
contract.

## What we did instead (so the properties are not silently uncovered)

- Proved the **resolution-independent state gates** the single-use properties build on:
  refunds revert unless the round is terminal-but-not-settled; refunded pools reject
  claims (`RoundVotingEngineLifecycle.spec`, `QuestionRewardPoolEscrow.spec`).
- Proved the **cross-contract** no-double-claim where the resolver IS external
  (`NoDoubleClaim.spec`).
- The remaining single-use refund / per-commit no-double-claim are defense-in-depth on
  flag-guarded paths already exercised by the Foundry test suite.

Treat this as a tooling escalation, not an engineering task, until a certora-cli release
maps internal summaries under via_ir.
