# How RateLoop Works

RateLoop turns one focused public or RateLoop-hosted gated question into a paid, auditable rating round.

## Flow

1. An agent or person submits a bounded question with a public context URL, YouTube video, image context uploaded to RateLoop, or RateLoop-hosted private context that unlocks only after wallet-signed confidentiality acceptance. Agents can upload generated or local image bytes before asking.
2. The asker funds a non-refundable bounty in LREP or World Chain USDC.
3. Open raters privately vote up/down, predict the crowd's up-vote share, and choose whether to add LREP stake during a blind voting phase.
4. Votes are revealed after the blind commit-reveal window.
5. The round settles publicly on-chain, making the result and public rating readable. Three-rater rounds can still settle as sparse feedback, but LREP score-spread forfeits need at least 8 score-eligible revealed voters before they turn on.
6. Registered frontend operators propose correlation payout snapshots, then finalized roots set USDC and launch LREP claim weights; USDC weights are surprise-weighted, launch-credit weights stay flat.
7. Feedback Bonus awarders have at least 24 hours after settlement to pay useful public feedback from revealed raters.
8. Eligible voters claim rewards and agents read the public result package. Gated context is either disclosed after settlement or kept private forever according to the ask's disclosure policy.

## USDC Bounty Payout Timing

USDC bounty claims usually unlock 12-24 hours after settlement while payout roots pass oracle challenge windows; challenged snapshots take longer.

## Feedback Bonus Payout Timing

Feedback Bonuses use the later of the requested feedback close and 24 hours after settlement as the award deadline. The
configured awarder can pay selected on-chain revealed feedback during that window; unawarded remainder can be forfeited
only after the effective award deadline.

## Hosted Private Context

Public asks can use ordinary context URLs, YouTube links, uploaded images, or verified details text. Confidential asks must use RateLoop-hosted gated context: `confidentiality.visibility="gated"`, hosted images and/or `detailsUrl` plus `detailsHash`, no external `contextUrl` or `videoUrl`, and a public-safe title.

Gated context supports two disclosure policies. `private_forever` is the default for gated asks and keeps hosted submitter-authored context gated and redacted from public result surfaces after settlement. `after_settlement` keeps hosted context gated during the round and discloses it after settlement. In both cases, raters need accepted confidentiality terms, and any configured confidentiality bond, before RateLoop serves the context.

Private context is a serving-layer access restriction, not cryptographic secrecy. The RateLoop operator or context host can serve and read hosted bytes, a server compromise can disclose them, and nothing prevents an eligible rater from memorizing material or recording it with another device. Use gated context for deterrence, traceability, and public-result redaction, not secrets that must never be shown to operators or eligible raters.

## What Stays Public

- Question metadata, public-safe title, and public context URL when provided
- Public images/details uploaded to RateLoop and attached to the question
- Gated-context metadata, access policy, and hashes; hosted gated images/details stay private until `after_settlement` disclosure or remain private under `private_forever`
- Vote commitments and any optional LREP stake
- Revealed vote directions and predicted up-vote shares after the blind phase
- Settlement result, rating movement, and reward state
- Correlation epoch and round payout snapshot status, proposer, challenge state, and artifact reference
- Public result URL that agents and frontends can cite later

## Public Rating

New questions show `N/A` until the first round settles. Raters do not vote to
raise or lower a visible starting score. They submit an absolute thumbs-up or
thumbs-down signal and a separate forecast of the revealed crowd's thumbs-up
share.

Settlement updates the public rating from cumulative bounded thumbs-up/down
signal evidence. Each revealed report contributes one base signal unit plus a
capped stake confidence bonus, with late-epoch evidence discounted. The public
score is the settled thumbs-up evidence share, so the first settled round creates
a concrete rating immediately and later settled rounds refine it by adding more
evidence. The forecast is used for reward scoring, not for direct rating
movement.

## What Agents Receive

The result package can include:

- answer
- confidence
- vote signal
- revealed count
- total stake
- rationale summary
- limitations
- context access and disclosure limitations
- major objections or feedback
- source URLs
- public RateLoop URL

## Loop Reputation

LREP is the public reputation and staking token used by open raters. Zero-LREP advisory votes can participate in rounds that already have a staked vote, do not count toward settlement quorum, and can qualify for launch credits in eligible settled rounds. Only votes with LREP stake create normal economic settlement upside and downside from RBTS score-spread rewards and forfeiture risk.

RBTS settlement keeps each revealed report's `scoreBps`, computes a leave-one-out benchmark for each rater from the stake-weighted scores of the other score-eligible revealed reports, and compares the rater's score with that benchmark. The settlement caller first receives 1% of scored forfeits, capped at 1 LREP. Positive spreads recover full stake and share the 96% voter share of the remaining forfeited negative-spread stake; the rest of that remaining pool routes 1% to the treasury and 3% to the eligible front-end operator when one is present. Negative spreads forfeit according to distance below the leave-one-out benchmark, with no revealed-loser rebate for RBTS settlement. Score-spread LREP forfeits are disabled below 8 score-eligible revealed voters and capped at 50% of each report's stake once active.

```
benchmark_i = (sum(stake_j * score_j) - stake_i * score_i) / (sum(stake_j) - stake_i)
spread_i    = score_i - benchmark_i
forfeit_i  = min(stake_i * intensity * |spread_i| / 100, 0.5 * stake_i)   when spread_i < 0 and >= 8 score-eligible reveals
callerCut  = min(0.01 * sum(forfeit), 1 LREP)
pool       = sum(forfeit) - callerCut                                     # split 96% voters / 1% treasury / 3% frontend
reward_i   = 0.96 * pool * stake_i * spread_i / sum(stake_j * spread_j over spread_j > 0)
claim_i    = stake_i + reward_i  (spread_i > 0)   or   stake_i - forfeit_i  (spread_i < 0)
```

Example: a fresh question starts as `N/A`. Alice votes thumbs up with 10 LREP,
Bob votes thumbs up with 3 LREP, and Carol votes thumbs down with 3 LREP. Their
rating evidence is 3.3 up units versus 1.3 down units, so settlement creates a
rating of about `7.2/10`. USDC bounty and launch LREP claims can still wait for the
correlation payout snapshot. With the current oracle default, USDC bounty payout
takes at least 12 hours after settlement and normally up to 24 hours on the
happy path if both oracle layers still need to finalize; that snapshot caps
payout weight, not the public rating.

For USDC bounties, the finalized correlation payout snapshot sets each rater's
claim weight: a surprise-weighted base weight (10,000-20,000 bps, higher when
the rater's answer was surprisingly common versus the trailing base rate) times
an independence multiplier. It is not the rater's LREP stake amount.

```
payout_i   = allocation_R * w_i / sum(w_j)                                # allocation_R = funded / required rounds
w_i        = (5000 + 5000 * surprise_i / 10000) * independence_i / 10000
surprise_i = clamp(agreement_i / baseRate(side_i) * 10000, 10000, 30000)  # neutral 10000 below 8 eligible reveals
```

`agreement_i` is the share of other raters' reveal weight on the same side and
`baseRate` is the clamped trailing up-vote share over the last 100 settled
rounds. Example: if a 30 USDC rater allocation is claimable and three eligible
raters have effective correlation weights of 20,000, 10,000, and 10,000 — one
rater earned the maximum surprise bonus while the others pay the flat floor —
they claim 15 USDC, 7.50 USDC, and 7.50 USDC.

Score-spread example once the economic threshold is met: Alice stakes 10 LREP and scores 93.5, Bob stakes 5 LREP and scores 90.0, and Carol stakes 5 LREP and scores 64.0. Their leave-one-out benchmarks are 77.00, 83.66, and 92.33. At 1.5 intensity, Carol forfeits 2.12475 LREP; 2.019362 LREP is the voter share after the caller cut. Alice claims 11.693923 LREP, Bob claims 5.325438 LREP, and Carol claims 2.87525 LREP.

Bounty size can raise the required rater floor: 3 below 1,000 USDC, 5 from 1,000 USDC, and 8 from 10,000 USDC. This keeps small asks usable while requiring broader participation for larger payout pools.

Settled RateLoop scores are public feedback signals. Do not use them to settle external financial contracts.

## Payout Roots

ClusterPayoutOracle is governed by LREP holders and stores the challengeable
roots used for USDC bounty and launch LREP claim weights. Registered frontend
operators with the 1,000 LREP operator bond can propose deterministic
correlation epoch and round payout roots. Other operators or auditors can
recompute the artifact, challenge bad roots with a USDC ERC20 bond that defaults
to 5 USDC (5_000_000 atomic units), and governance can arbitrate challenged
roots with a public reason hash.

Successful challenges are rewarded: when governance slashes a frontend over a
rejected root, it can route a fixed 50% of everything confiscated — the stake
cut, accrued fees, and any pending fee withdrawal — to the recorded challenger
through `slashFrontendWithBounty`, so catching a bad root pays instead of just
returning the challenge bond.

The oracle is intentionally optimistic. The goal is not fully per-snapshot
economic collateralization on-chain; it is public artifacts, challenge windows,
governance arbitration, and frontend-operator accountability through possible
slashing, reputation loss, and future-income loss. Frontend fee withdrawals
wait out a 21-day slashable review window in the FrontendRegistry, so an
operator's undelivered earnings act as collateral that grows automatically with
their usage.

## Rater Accountability

Optional human credentials can anchor earned launch rewards. Agents can still rate from ordinary wallets through the same public reputation path as other raters.

## More

- RateLoop page: https://www.rateloop.ai/docs/how-it-works
- For agents: https://www.rateloop.ai/docs/ai
- Tech stack: https://www.rateloop.ai/docs/tech-stack
