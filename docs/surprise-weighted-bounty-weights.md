# Surprise-Weighted Bounty Claim Weights

Status: implemented (scorer `rateloop-correlation-epoch-v2`)
Domain: question reward (USDC bounty) payouts only. Launch-credit payout weights are unchanged
and remain flat (`baseWeight = 10_000`).

This document is the normative spec for how correlation payout snapshots compute per-rater
bounty claim weights. Challengers of a `ClusterPayoutOracle` round payout snapshot can rebuild
every value below from on-chain events plus this spec; any mismatch with a proposed
`weightRoot`/`totalClaimWeight` is grounds for a challenge.

## Motivation

Design review June 2026, finding 2 ("Herding is the dominant strategy; bounties pay
participation, not accuracy"): bounty shares used a flat per-rater weight, so the conformist
("Schelling") strategy collected the same bounty as informative reporting while carrying zero
forfeiture risk. Robust BTS makes honesty *an* equilibrium, but uninformative pooling equilibria
are also equilibria and were strictly safer.

The fix follows the peer-prediction literature (Prelec's Bayesian Truth Serum, the Peer Truth
Serum for Crowdsourcing, and the Correlated Agreement mechanism): reward answers that are
**surprisingly common** — more common among peers than a cross-round prior predicts. A pooled
strategy cannot manufacture surprise against its own prior: if everyone always herds, the prior
converges to the herd and the multiplier collapses to neutral. Only reports that predict peers
better than the base rate earn extra share.

## Mechanism

All arithmetic is integer math in basis points (bps, denominator 10_000) with floor division,
evaluated in the order written. Weights are computed per settled round over the round's
**bounty-eligible revealed votes** (the eligibility predicate served by Ponder's
`/correlation/round-votes`, unchanged by this spec).

### Inputs

Per eligible vote `i` in round `R`:

- `side_i` — the revealed vote direction (`isUp`), from the `RbtsVoteRevealed` event.
- `w_i` — the epoch-weighted reveal weight (`effectiveWeight` in `RbtsVoteRevealed`,
  indexed by Ponder as `vote.rbtsWeight`). Blind-epoch votes carry 100% of stake, later epochs
  25%, exactly as used in RBTS settlement.

Per round `R`:

- `trailingBaseRateUpBps` — see below.

### Trailing base rate

Let the **base-rate window** be the `baseRateWindowRounds` (default **100**) most recent settled
rounds that strictly precede round `R`, across all content, ordered by the tuple
`(settledAt, contentId, roundId)` in lexicographic order (a round `S` precedes `R` iff
`tuple(S) < tuple(R)`; the window takes the largest preceding tuples). `settledAt` is the block
timestamp of the `RoundSettled` event; only rounds in state `Settled` count (not Tied,
Cancelled, or RevealFailed).

Using each window round's raw revealed stake pools (`upPool`, `downPool`, as accumulated from
revealed votes and reflected in Ponder's `round` table):

```
rawUpBps            = sum(upPool) * 10_000 / sum(upPool + downPool)
trailingBaseRateUpBps = clamp(rawUpBps, baseRateMinBps, baseRateMaxBps)
```

with `baseRateMinBps = 500` and `baseRateMaxBps = 9_500` (defaults). If the window is empty or
the pool sum is zero, `trailingBaseRateUpBps = 5_000`.

The base rate for a side is:

```
baseRate(UP)   = trailingBaseRateUpBps
baseRate(DOWN) = 10_000 - trailingBaseRateUpBps
```

### Agreement

For voter `i`, agreement is the share of *other* eligible reveal weight on the voter's side:

```
W_total     = sum(w_j) over all eligible votes j in R
W_side(s)   = sum(w_j) over eligible votes j with side_j == s
agreementBps_i = (W_side(side_i) - w_i) * 10_000 / (W_total - w_i)
```

If `W_total - w_i == 0` (sole eligible voter) or `w_i` is unavailable, the voter's surprise
multiplier is neutral (`surpriseBps_i = 10_000`).

### Surprise multiplier

```
surpriseBps_i = clamp(agreementBps_i * 10_000 / baseRate(side_i),
                      10_000, surpriseCapBps)
```

with `surpriseCapBps = 30_000` (3.0x cap, default). The floor of `10_000` means no voter is ever
paid *less* than a flat share for an answer that merely matches (or undershoots) the prior —
the bounty side never punishes deviation; stake forfeiture already prices that risk.

### Claim weight

```
baseWeight_i      = baseWeightFloorBps + baseWeightBonusBps * surpriseBps_i / 10_000
effectiveWeight_i = baseWeight_i * independenceBps_i / 10_000
totalClaimWeight  = sum(effectiveWeight_i)
```

with `baseWeightFloorBps = 5_000` and `baseWeightBonusBps = 5_000` (defaults). `baseWeight_i`
therefore lies in `[10_000, 20_000]`. The independence discount (cluster, maturity, floors) is
unchanged from `rateloop-correlation-epoch-v1` and composes multiplicatively on top.

A rater's USDC claim for a qualified round remains
`allocation * effectiveWeight_i / totalClaimWeight`.

### Parameters

All parameters are committed via the snapshot `parameterHash` (alphabetical-key JSON, keccak256)
and the scorer version string:

| Parameter | Default | Meaning |
| --- | --- | --- |
| `baseRateWindowRounds` | 100 | Settled rounds in the trailing base-rate window |
| `baseRateMinBps` / `baseRateMaxBps` | 500 / 9_500 | Base-rate clamp |
| `surpriseCapBps` | 30_000 | Maximum surprise multiplier (3.0x) |
| `baseWeightFloorBps` | 5_000 | Flat participation component |
| `baseWeightBonusBps` | 5_000 | Surprise-scaled component |
| `scorerVersion` | `rateloop-correlation-epoch-v2` | Versions this spec |

## Contract surface

- `QuestionRewardPoolEscrowClaimLib` accepts leaf `baseWeight` in
  `[BASE_CLAIM_WEIGHT_BPS, MAX_CLAIM_WEIGHT_BPS] = [10_000, 20_000]` for cluster-snapshot claims
  (previously exactly `10_000`). Rounds without a finalized snapshot keep the flat equal-share
  path.
- `ClusterPayoutOracle.verifyPayoutWeight` is unchanged (`effectiveWeight <= baseWeight`,
  `independenceBps <= 10_000` still hold).
- `LaunchDistributionPool` is unchanged and still requires flat `baseWeight == 10_000` for the
  launch-credit domain; the scorer only applies surprise weighting to the question-reward
  domain.

## Incentive properties

- **Herding pays the floor.** If raters pool on one answer, the trailing base rate converges
  toward that answer; `agreement / baseRate -> 1` and every weight collapses to the same value,
  so shares are flat — identical to pre-change payouts. There is no longer any payout in which
  conformity earns *more* than today, and all upside is reserved for reports that beat the
  prior. Because shares normalize within a round, a uniform multiplier cancels: only
  *differences* in surprise within a round move money.
- **Contrarian spam is neutral in expectation.** Voting the rare side earns the high multiplier
  only when other raters agree; for an uninformed contrarian the expected agreement is the base
  rate itself, so the expected multiplier is ~1x — while stake forfeiture still prices the
  downside. Only a signal that genuinely predicts peers beats the floor.
- **Manufactured surprise is bounded.** A coordinated cluster voting the rare side on a
  low-traffic round can hit the cap, which is why the cap is conservative (3x on half the
  weight, i.e. at most 2x total claim weight) and why the independence discount applies *after*
  the surprise term: identity-clustered wallets have the bonus shrunk by `1/sqrt(N)` with
  floors. Collusion across distinct humans remains in scope for design-review finding 4
  (quorum/forfeit-cap measures), not this mechanism.
- **Unanimous rounds are not punished.** A genuinely obvious question still pays the full
  allocation; everyone simply gets the same multiplier, so the split is flat.

## Determinism and challenge procedure

Every input is reconstructible from chain data: vote sides and reveal weights from
`RbtsVoteRevealed`, round pools and settlement order from `RoundSettled` and reveal events,
eligibility from the round-snapshot registries. To verify a proposed round payout snapshot:

1. Rebuild the eligible vote set and the trailing base-rate window per this spec.
2. Recompute `surpriseBps_i`, `baseWeight_i`, `effectiveWeight_i`, `totalClaimWeight`.
3. Rebuild the leaf hashes (leaf encoding is unchanged from v1; `baseWeight` now varies) and the
   sorted-pair merkle root.
4. Compare against the proposed `weightRoot` and `totalClaimWeight`, and the artifact's recorded
   `surpriseBps`/`trailingBaseRateUpBps` values.

The published artifact (`rateloop-correlation-artifact-v2`) records per-leaf `surpriseBps` and
per-round `trailingBaseRateUpBps` so challengers can localize a disagreement without rebuilding
everything.

## References

- Prelec, *A Bayesian Truth Serum for Subjective Data* (Science, 2004) — the "surprisingly
  common" criterion.
- Radanovic & Faltings, *Incentives for Effort in Crowdsourcing Using the Peer Truth Serum*
  (2016) — payment inversely proportional to answer frequency; uninformed equilibria pay less
  than truth-telling.
- Shnayder, Agarwal, Frongillo, Parkes, *Informed Truthfulness in Multi-Task Peer Prediction*
  (EC 2016) — normalizing agreement by cross-task base rates defeats pooling.
- Gao, Wright, Leyton-Brown, *Incentivizing Evaluation via Limited Access to Ground Truth*
  (2016) — peer prediction alone cannot make truthfulness Pareto-dominant under cheap
  coordination signals; sparse ground-truth audits remain the long-term backstop.
- `docs/design-review-2026-06.md`, finding 2.
