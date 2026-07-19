# Tokenless Surprisingly Popular bounty v1

**Status:** Current mechanism specification. Production funding remains gated by the production-readiness register.

## Purpose and boundary

`tokenless-sp-bounty-v1` rewards reports on an answer that is more popular than the current panel predicted. It is a
centralized, platform-funded USDC top-up. The raw majority remains the verdict input. The immutable fund core remains
the source of fixed base, RBTS, compensation, fee, and refunds; this mechanism cannot change any of them.

This is not the legacy cross-question surprise formula and is not a truth oracle.

## Frozen policy

- Binary and head-to-head rounds only.
- Prediction grid: 1% increments from 1% through 99%.
- Minimum valid reveal sample: 10.
- Aggregate qualification margin: 500 basis points.
- Full-score saturation margin: 2,500 basis points.
- Formula cap per report: 12.5% of that round's guaranteed fixed base per report.
- Fee-backed cap per report: the round fee divided by `maximumCommits`, rounded down.
- Maximum top-up per report: the lower of the formula cap and fee-backed cap.
- Maximum top-up is positive, no greater than the guaranteed base, and never redistributed from another reviewer.

For each side, subtract mean predicted share from actual share. If the absolute aggregate margin is below 500 basis
points there is no qualifying outcome. Otherwise the sign selects the Surprisingly Popular side. The majority result
is neither replaced nor modified.

For a report on the selected side, recompute actual and predicted side shares after removing that report. The report
qualifies only when this leave-one-out margin is at least 500 basis points. Its score is:

`min(10,000, floor(leaveOneOutMarginBps * 10,000 / 2,500))`

The top-up is:

`floor(maximumTopUpAtomic * scoreBps / 10,000)`

A unanimous panel never earns a top-up, even when its aggregate result exceeds the predicted share. This exclusion
prevents a panel from manufacturing surprise merely by coordinating every report on the same side.

Canonical commit-key sorting, integer arithmetic, allocation hashing, and evidence hashing make the result independent
of input order and recomputable from the validated finalized reveal set.

## Funding and payment

For a round with a positive fee, RateLoop freezes the policy before preparing the customer-funded chain round. The
per-report cap is:

`min(floor(guaranteedFixedBasePerReport * 1,250 / 10,000), floor(roundFee / maximumCommits))`

RateLoop then reserves:

`maximumTopUpPerReport * maximumCommits`

against the on-chain USDC balance of a dedicated bonus funder. Outstanding reservations are serialized by deployment.
Insufficient capacity prevents round preparation; a reviewer cannot first earn a top-up and then discover that no pool
was reserved. The frozen policy records the exact fee, report capacity, per-report cap, and maximum aggregate
liability, which can never exceed the fee. A zero-fee round has no centralized surprise-bounty reservation or
entitlement; it proceeds with the immutable base-round economics unchanged.

After finalization, positive allocations become durable entitlements. The payout worker waits until Ponder indexes the
reviewer's immutable base claim, verifies the deployment, round, commit key, payout address, amount, and transaction
hash, then transfers the central top-up to that same payout address.

The dedicated bonus funder is distinct from the credential signer, gas relayer, and prepaid funder. Its transfer nonce
is allocated transactionally. An exact USDC `Transfer` event is required before an entitlement becomes paid. Normal
failures retry with a bounded backoff; a persisted nonce without a safely recorded transaction hash enters
`reconciliation_required` and is never blindly replayed.

## Evidence and limitations

Persisted evidence includes the version, frozen policy, sample, actual and predicted shares, selected outcome,
leave-one-out allocations, total top-up, allocation hash, evidence hash, transfer transaction hash, and paid total.

The executable attack fixture tests both the unanimity exclusion and a near-unanimous bypass under the frozen fee
cap. With 15 seats, an 80% guaranteed base, a 7.5% round fee, and reports predicting 30% for the coordinated up side:

- a 15-of-15 panel receives no surprise top-up because unanimity is disqualified; and
- a 14-of-15 coalition receives 750 bps of seat pay per coalition member. Its mean RBTS sacrifice is 626 bps of seat
  pay relative to the unanimous high-prediction constant-report baseline, leaving a positive 124-bps diagnostic
  delta. Aggregate surprise outlay is 1,050,000 atomic units against a 1,125,000-atomic round fee.

The fee-backed cap therefore bounds platform outlay and prevents this scenario from exceeding fee revenue; it does
not make manufactured surprise incentive-safe. The benchmark is diagnostic, depends on its seeded report model, and
does not close the production economics acceptance gate.

Required limitation codes include centralized platform liability, binary-panel-only, and not-a-truth-oracle. Future
changes to sample size, thresholds, saturation, cap, funding, or formula require a new mechanism version and cannot
alter an already reserved or finalized round.
