# Certora Security Findings

This file tracks security-relevant formal-verification status that is not obvious from a green or red workflow.

## Verified Slices

- `ClusterPayoutOracle`: payout weight gates, rejected-root non-reuse, correlation-epoch root non-reuse, and single-use bond-credit withdrawal.
- `RoundRewardDistributor` / `NoDoubleClaim`: reward claim flags are not cleared and repeat claims revert.
- `FeedbackBonusEscrow`: funded-pool payout bounds and per-pool feedback hash single-use.
- `LoopReputation`: capped supply, role-gated minting, governor-only lock control, and transfer-lock behavior.
- `ProtocolConfig`: address-book setters are role-gated.

## Deferred Slices

- `QuestionRewardPoolEscrow`: large-contract claim-weight and allocation conservation proofs remain typecheck-only or manual-run candidates.
- `LaunchDistributionPool`: paid-less-than-cap headline proof is true in design but not self-inductive in the current SMT model; lemma slices are tracked separately.
- Aggregate cross-round pool conservation requires additional ghost-state modeling before it should be treated as proof evidence.
