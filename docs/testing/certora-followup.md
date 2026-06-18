# Certora Follow-Up

Some desired properties are intentionally deferred because the current harness or prover setup cannot model them without producing misleading results.

## Deferred Work

- Round lifecycle monotonicity and no-double-settle for `RoundVotingEngine`: direct settlement guards exist in Solidity, but the current `via_ir` build causes certora-cli auto-finder instrumentation gaps on the large engine.
- Single-use refund and refund-equals-stake: these need deterministic modeling of internal commit-resolution helpers that cannot currently be summarized under the required `via_ir` path.
- `QuestionRewardPoolEscrow` per-commit no-double-claim and per-snapshot claimed-less-than-allocation: these need deterministic modeling of `_resolveQuestionRewardClaim` and are too large for the current CI solver budget.
- Full `ClusterPayoutOracle` lifecycle monotonicity and timing-window proofs: these need richer state-transition modeling than the current local slices.

Treat these as formal-verification backlog items, not open contract findings by themselves.
