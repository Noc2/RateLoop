# RateLoop Design Review — June 2026

A multi-agent review of the RateLoop protocol design, covering the smart contracts, the
incentive/tokenomics design, the off-chain services, the agent/SDK integration surface, and
relevant prior art (peer prediction literature, Kleros, UMA, Gitcoin COCM, the x402/agent-payments
landscape). Five independent review passes were run over the codebase and external sources; this
document is the synthesis. File references are to the repo at the time of review (commit
`2843dbaa`).

**Second pass:** after a wave of ~60 mitigation commits, five fresh independent review agents
re-ran the full review on 2026-06-10 against commit `418e4202`, verifying every claimed fix
against the code (not the commit messages) and adversarially reviewing the new code itself. The
per-finding *Status* blocks, the [second-pass update](#second-pass-update-2026-06-10-commit-418e4202),
and the [new findings](#new-findings-second-pass-2026-06-10) sections reflect that pass.

## TL;DR

The design is unusually thoughtful and candid: the Robust BTS scoring is a faithful implementation
of a real mechanism, the blind tlock commit-reveal phase is the correct anti-herding tool, the
per-round stake caps genuinely defuse "wealth buys rating influence", and the docs disclose their
own trust assumptions. Test coverage of the contracts is strong (~1,300 test functions, invariant
solvency, adversarial suites).

Three structural problems stand out above everything else:

1. **The ClusterPayoutOracle is the linchpin of every sybil defense, but its economic security
   (a single global 1,000 LREP frontend bond, zero per-snapshot proposer bond, 5 USDC challenge
   bond, 12h window) is far below the value it gates** (all USDC bounty weights plus the 24M LREP
   earned pool). Every other mitigation in the system ultimately routes through this oracle.
2. **Income is participation-shaped, not accuracy-shaped, which makes herding the rational
   strategy.** Bounties pay a flat per-rater weight; the only accuracy-linked money is peer
   forfeitures, which are zero in a conformist equilibrium. The peer-prediction literature says
   uninformative pooling equilibria are the default attractor, and RateLoop's payout structure
   makes them strictly safer than honest reporting.
3. **The keeper is the sole liveness agent for reveals, and its failure converts to honest-voter
   losses.** A keeper/Ponder/drand outage longer than the reveal grace period finalizes rounds as
   RevealFailed and forfeits unrevealed stakes to the treasury — a systemic failure billed to
   individual voters.

None of these are fatal, and all three have concrete fixes below. The agent integration surface is
genuinely good MCP design but is blocked on adoption basics: the SDK packages are unpublishable
(`"private": true`) while all docs depend on them, there is no public testnet/sandbox, and the
"x402" integration is not actually the x402 wire protocol.

## Second-pass update (2026-06-10, commit 418e4202)

The mitigation wave is real work, not status laundering: every claimed fix exists in code, the
test-fixture changes are justified rather than assertion-gaming, and two of the three structural
P0s are substantively closed. Updated statuses:

| # | Finding | Second-pass status |
| --- | --- | --- |
| 1 | Oracle security budget | **Partially mitigated** — fee escrow + challenger bounty verified in code; `ClusterPayoutOracle.sol` itself byte-identical (bonds still zero, 12h window); new gaps: challenger-slot capture, 14-day escrow vs ~10-day governance latency |
| 2 | Herding / participation-shaped income | **Partially mitigated** (downgraded from "mitigated") — surprise weights shipped and faithful to spec, but pooling is still a Nash equilibrium, the trailing base rate is gameable, and verification routes through finding 1's oracle |
| 3 | Keeper liveness forfeits stake | **Mitigated** — RevealFailed now refunds, 24x grace, drand failover, getLogs fallback, health-gated finalization, self-reveal UI; residual: garbage-commit stalling is now gas-only |
| 4 | Majority-stake collusion | **Partially mitigated** — 50% forfeit cap, 8-reveal forfeit floor, bounty-size participant floors, external-settlement disclaimer; no dispute/escalation re-run path |
| 5 | RBTS seed reroll | **Mitigated on-chain** — but the Ponder mirror fabricates scores for the new scoreless path (release blocker R1c) |
| 6 | Agent adoption blockers | **Partially mitigated** — packages publishable but 404 on npm, no publish CI; dry-run is real; Sepolia deployed but no hosted faucet; "x402" honestly renamed |
| 7 | Prompt injection | **Mitigated** — delimiters with escape-proof markers, warnings, sourceUrl validation |
| 8 | Launch distribution / token design | **Open** — zero diffs to launch/governor/token contracts since `2843dbaa` |
| 9 | Off-chain operational design | **Partially mitigated** — discovery, locking, hashing, artifact cache done; verifier checks self-consistency not chain truth; challenged snapshots still stall |
| 10 | Contract complexity | **Partially mitigated** — permit overload, permissionless reopen, 100/200-voter gas tests, recovery coverage; engine/bundle splits only staged |
| 11 | Agent UX polish | **Largely mitigated** — timeouts, structured errors, signed webhooks (strong SSRF defense), tool tiers |

The pass also found **three release blockers at HEAD** (stale storage-layout snapshots that fail
the CI gate, a stale `FrontendRegistry` ABI that breaks the new fee-withdrawal UI and gasless
path, and a Ponder handler that fabricates RBTS scores for scoreless settlements) plus a set of
new economic findings — see [New findings](#new-findings-second-pass-2026-06-10).

## What the design gets right

Worth stating explicitly, because several of these are under-credited even in the project's own
docs:

- **Per-round stake caps (1–10 LREP) + score-spread settlement + flat bounty weight** mean a fresh
  whale wallet has almost no purchasable rating influence. This is the right answer to the
  "transferable reputation" critique, and it's enforced in code, not just policy.
- **tlock/drand commit-reveal with epoch weighting** (blind epoch 100%, later epochs 25%) blocks
  reactive copying — the empirically documented beauty-contest herding channel.
- **Round-open snapshotting of config/registries** (`RoundVotingEngine.sol:827-849`) means
  mid-round governance changes can't affect open rounds.
- **Non-refundable bounties + asker-can't-vote + dormancy sweeps** kill refund-gaming and
  self-rating cleanly.
- **The X402QuestionSubmitter EIP-3009 flow is well built**: the nonce commits to the full
  question payload, reward terms, payer/payee/value/validity window; replay and substitution are
  covered; the operator never holds funds.
- **Honest documentation**: the optimistic (not per-snapshot-bonded) oracle model, fractional
  correlation credit, and the beta redeploy plan are all disclosed rather than hidden.
- **Contract test depth**: invariant solvency, selective-revelation and adversarial suites,
  fuzzing of the math libraries, upgrade-layout tests.

## Priority findings

### P0 — Structural

#### 1. ClusterPayoutOracle security budget vs. gated value (security/economic)

Per-snapshot proposals are unbonded (`ClusterPayoutOracle.sol:101-105`, "today always zero"), the
challenge bond defaults to 5 USDC capped at 100, the window is 12h, and the only standing economic
backing is the frontend's global 1,000 LREP bond (`FrontendRegistry.sol:42`). These roots gate all
USDC bounty distribution weights and the 24M LREP earned launch pool — first-100 earned caps alone
are worth up to 50,000 LREP. A malicious or compromised bonded frontend that wins one unwatched
12h window steals an entire pool's weight allocation; recovery then depends on a 7-day governance
ARBITER veto, i.e. trusted arbitration by a token vote the attacker can buy into. The UMA/Polymarket
attack of March 2025 (5M UMA falsely settling a $7M market) is the live demonstration of exactly
this failure shape.

**Recommendations:**
- Activate per-snapshot proposer bonds scaled to the value the root gates (bps of pool allocation).
- Cap the payout value claimable before the veto window expires.
- For high-value epochs, require k-of-n agreement from independent bonded proposers, and/or
  lengthen the challenge window with gated value.
- Reward successful challengers explicitly so the challenge path is economically live, not just
  theoretically present (the Kleros lesson: challenge machinery that's unprofitable goes unused).

**Status (2026-06-10):** partially mitigated, with a deliberate design revision. Value-scaled
per-snapshot proposer bonds were rejected: they tax the honest operator's capital (the scarce
resource) and force operators to track gated value per snapshot, so all stakes stay fixed.
Instead, accountability now scales through the fee stream and time:

- *Implemented — delayed slashable fee withdrawals:* `FrontendRegistry.claimFees()` is replaced by
  `requestFeeWithdrawal()` → 14-day review window → `completeFeeWithdrawal()`. Requested amounts
  stay fully slashable until release, and `slashFrontend` confiscates the pending bucket alongside
  accrued fees. The operator's undelivered earnings are now collateral that grows automatically
  with usage — no per-snapshot bonding, no extra capital.
- *Implemented — challenger bounty:* `slashFrontendWithBounty` routes a fixed 50%
  (`CHALLENGER_BOUNTY_BPS`) of everything confiscated (stake cut + accrued fees + pending
  withdrawals) to the recorded challenger of the rejected snapshot, making a correct challenge
  directly profitable. The share is deliberately below 100% so a proposer cannot rescue its own
  collateral by self-challenging through a fresh wallet.
- *Open:* value-tiered challenge windows (12h → 48-72h for high-value pools; `MAX_CHALLENGE_WINDOW`
  already allows 3 days) and a per-snapshot claim-rate ramp during the 7-day veto window, which
  bounds what an exit-scamming proposer can extract before detection — the one case reputation and
  fee escrow cannot deter.

**Second pass (418e4202): partially mitigated.** The implemented items check out exactly as
described: `requestFeeWithdrawal`/`completeFeeWithdrawal` with `FEE_WITHDRAWAL_DELAY = 14 days`
(`FrontendRegistry.sol:316-355`), pending buckets confiscated on slash (`:470-474`) and held
through the unbonding window, `CHALLENGER_BOUNTY_BPS = 5000` with exact-split accounting
(`:450-510`). But `ClusterPayoutOracle.sol` is byte-identical to `2843dbaa` — proposer bonds
still always zero, 12h default window, 5 USDC challenge bond — and three new gaps weaken the
escrow+bounty substitute (details in new findings E1/E2): the oracle records a single first-come
challenger that `slashFrontendWithBounty` never reads, so a fraudulent proposer can self-challenge
from a fresh wallet to capture 50% of its own slash *and* deny the honest watcher; the 14-day
escrow only out-runs the ~10-day minimum governance slash latency (1d delay + 7d vote + 2d
timelock) by ~4 days, with the attacker controlling when the clock starts; and the consent-free
`setSnapshotProposer` (audit M-2, still unfixed) lets a slashee bind the recorded challenger as
its "proposer" to make the bounty-routing slash revert. Value-tiered windows and the claim-rate
ramp remain open.

#### 2. Herding is the dominant strategy; bounties pay participation, not accuracy (economic)

`QuestionRewardPoolEscrowClaimLib.sol:610` returns a flat `BASE_CLAIM_WEIGHT_BPS` — bounty share
does not depend on score. RBTS makes honesty *a* Bayes-Nash equilibrium, but pooling equilibria
(everyone reports the same Schelling answer + matching prediction) are also equilibria, and here
they are strictly safer: all scores equal the mean, nobody forfeits, everyone recovers stake and
collects an equal bounty share. Honest idiosyncratic reporting adds forfeiture variance (the peer
is a single Bernoulli draw; quorum can be 3) with upside only from others' forfeitures — zero in
the conformist equilibrium. The launch-credit gate (`MIN_QUALIFYING_SCORE_BPS = 7000`) actively
reinforces this: agreeing with the expected majority maximizes qualification.

**Recommendations:**
- Make bounty shares increase with RBTS score or positive spread, so accuracy-linked income exists
  even when nobody forfeits.
- Dampen rewards in zero-entropy rounds (degenerate revealed distributions).
- Mix in occasional ground-truth/audit rounds.
- Consider restoring a "surprisingly common" information term (original BTS) to break
  predict-the-base-rate strategies.

**Status (2026-06-10):** bounty claim weights are now surprise-weighted (see
`docs/surprise-weighted-bounty-weights.md`): snapshot rounds pay a participation floor plus a
surprisingly-common bonus normalized by a trailing base rate, so conformist rounds pay flat while
informative reporting earns up to 2x. Ground-truth audit rounds remain open as the long-term
backstop.

**Second pass (418e4202): partially mitigated** (downgraded from "mitigated"). The implementation
is faithful to its spec — `clamp(agreement/baseRate, 1x, 3x)` surprise multiplier mapped to
`baseWeight ∈ [10000, 20000]` (`correlationScoring.ts:352-423`), trailing 100-round base rate
clamped to [500, 9500], contract-side range check and root-committed `totalClaimWeight`
normalization so 2x weights can't oversubscribe a pool. But:

- *Pooling is still a Nash equilibrium.* A unilateral honest deviator against a full herd gets
  agreement 0 → floored at 1x — no bounty gain, while (above 8 reveals) still bearing forfeiture
  variance. The mechanism makes the informative equilibrium payoff-dominant once a critical mass
  deviates; it does not make deviating from a pool individually profitable. Known PTS limitation,
  conceded by the spec's own citations.
- *The trailing base rate is gameable* — see new finding E3: a bloc alternating its pooled answer
  by round parity keeps the global base rate pinned near 5000 while harvesting ~2x surprise every
  round, and at low volume the 100-round window can be flooded with cheap self-asked rounds to
  drag the clamp.
- *The fix routes 100% through finding 1's oracle.* On-chain verification is only the
  [10000, 20000] range check + merkle proof against an optimistically finalized snapshot
  (`QuestionRewardPoolEscrowClaimLib.sol:638-647`); the surprise math, agreement pools, and base
  rate are all operator-computed. The accuracy-linked money now exists, but its integrity ceiling
  is the oracle's.
- *The launch rail is untouched*: `MIN_QUALIFYING_SCORE_BPS = 7000` and the required-flat launch
  domain mean the largest LREP flow (24M earned pool) still pays pure conformity.

Entropy dampening, ground-truth audit rounds, and on-chain score-linked shares remain open.

#### 3. Keeper liveness failure forfeits honest stake (liveness/economic)

Nothing reveals votes except the keeper (or voter self-reveal, which the frontend does not
surface). The keeper's reveal path chains three external dependencies — Ponder for ciphertexts
(`keeper.ts:490-556`, silently skips on failure), a single pinned drand relay per chain
(`keeper.ts:89-160`), and the RPC — and the default `revealGracePeriod` is 60 minutes
(`ProtocolConfig.sol:183`). If reveal halts past grace, rounds finalize RevealFailed and *all
unrevealed stakes are forfeited to the treasury* (`RoundVotingEngine.sol:1107-1146`), even though
the failure is systemic.

**Recommendations:**
- Treat RevealFailed — a protocol-liveness state — as fully refundable, or make the grace period
  adaptive to observed reveal activity.
- Add an `eth_getLogs` fallback for ciphertext retrieval (they are on-chain in `VoteCommitted`
  events) and multiple drand relay URLs per chain.
- Ship a standalone reveal-only fallback service anyone can run, surface self-reveal in the
  frontend, and alert on `keeper_rounds_reveal_failed_finalized_total`.

**Second pass (418e4202): mitigated.** The original failure shape — a systemic outage billed to
individual voters — is gone, with defense in depth at every link:

- *On-chain:* RevealFailed rounds now refund unrevealed stakes instead of forfeiting them
  (`RoundCleanupLib.sol:550-579`; forfeiture is `Settled`-only), with consistent accounting, and
  the reveal-failed finalization deadline got a 24x grace multiplier (60min → 24h,
  `RoundCleanupLib.sol:638`) that does not delay quorum-reached settlements.
- *Keeper:* 4-relay drand failover with preserved BLS verification (`drand.ts:37-153`),
  `eth_getLogs` ciphertext fallback hash-checked against on-chain commits (`keeper.ts:791-899`),
  reveal-failed finalization skipped while the reveal pipeline is provably unhealthy
  (`keeper.ts:1154-1169,1367-1378`) — and the health flag cannot be synthesized by an attacker,
  since garbage ciphertexts hit the permanent-failure path instead. Grace/liveness metrics with
  shipped Prometheus alert rules.
- *Frontend:* a dedicated self-reveal page with full validation before decrypt
  (`useManualRevealVotes.ts:556-599`), surfaced in vote-card copy and covered by e2e.

Residuals: the getLogs lookback defaults to ~7 days, unenforced against configured round
durations; the self-reveal hook fetches ciphertexts only from Ponder, so the human backstop fails
during exactly the Ponder outage it backstops; no documented community reveal-only service
(though the keeper now runs Ponder-free end to end, so a second keeper with just an RPC is
viable); and the refund makes garbage-commit stalling a gas-only attack (new finding E5). The
keeper README still says RevealFailed "forfeits unrevealed stake" — stale.

#### 4. Majority-stake collusion inverts the forfeiture penalty (economic)

Settlement scores against the stake-weighted mean over as few as 3 revealed voters
(`MIN_RBTS_PARTICIPANTS = 3`). A coordinated bloc holding >50% of revealed stake drags the mean to
itself; the honest minority lands below mean and forfeits up to 100% of stake (forfeit =
stake × 1.5 × spread, `RewardMath.sol:81-90`), with 96% of that recycled *to the attackers* — the
attack has negative cost. Human-credential gating limits sybils but not collusion; 2–3 colluding
verified humans suffice on low-traffic content. The public settled score is also readable by
anyone, making cheap rounds usable as oracles for external bets ("oracle extraction").

**Recommendations:** cap per-round forfeit fraction (e.g. ≤50%) and scale forfeit intensity down
at small revealed counts; tie minimum quorum and correlation-cap aggressiveness to bounty size;
add a dispute/escalation path that re-runs contested rounds with a larger independent rater set
(the Kleros appeal lesson); document explicitly that settled scores must not settle external
financial contracts.

**Second pass (418e4202): partially mitigated.** Three of four recommendations landed: forfeits
are capped at 50% (`MAX_SCORE_SPREAD_FORFEIT_BPS = 5_000`, `RewardMath.sol:18,98-99`), forfeits
are zeroed below 8 economic reveals (`SCORE_SPREAD_FORFEIT_MIN_REVEALS = 8`, `RewardMath.sol:17,94`,
correctly counting RBTS-weighted reveals), bounty-size participant floors require 5 voters at
≥1k USDC and 8 at ≥10k (`QuestionRewardParticipantFloorLib`), and the "not a settlement oracle"
disclaimer is documented across MCP/SDK/skill surfaces. The thin-round "drag the mean, harvest the
minority" attack now extracts zero forfeit, and worst-case confiscation at scale halved. Open: no
dispute/escalation path re-runs a contested round with a larger rater set, and >50% collusion at
≥8 reveals still recycles up to 50% of honest-minority stake to the attackers. New trade-off: the
hard 8-reveal cliff turns 3–7-reveal rounds into zero-stake-risk territory, which interacts badly
with the surprise bonus (new finding E4).

#### 5. RBTS seed reroll via blockhash expiry (economic) - mitigated

Original risk: if `settleRound` was not called within 256 blocks of seed capture, the old
expired-seed refresh path let the next caller move the seed to a fresh block, repeat that
unboundedly, and settle only on favorable reference/peer draws. Mitigation: expired captured
seeds are now terminal and scoreless. When the captured blockhash is unavailable, settlement
stores a zero RBTS score seed, returns revealed RBTS scoring stakes, pays no RBTS scoring
rewards or forfeits, and still finalizes the binary round outcome. The unused refresh helper and
refresh counter were removed. A bounded settlement caller rebate (1% of scored RBTS forfeits,
capped at 1 LREP) gives the first post-capture caller a small incentive to consume fresh seeds
without creating a payout on scoreless expiry.

**Second pass (418e4202): confirmed mitigated on-chain** — `refreshExpiredRbtsSeed` is deleted,
expired seeds settle terminal and scoreless with all RBTS stakes returned
(`RoundRevealLib.sol:222-227,305-308`), and the rebate pays only from scored forfeits via
try/catch (`RoundVotingEngine.sol:1077-1098`). Two follow-ons: (a) the Ponder mirror does not
handle the newly reachable `scoreSeed == 0` state and fabricates per-vote scores/forfeits that
never existed on-chain — release blocker R1c below; (b) low-severity griefing: since the rebate is
zero exactly when the seed expires, nothing economically pulls settlement forward when an attacker
*wants* expiry (256 blocks ≈ 8.5 min), so scoring can be suppressed round-by-round at gas cost —
no theft, just denial.

#### 6. Agent adoption blockers: unpublished SDK, no sandbox, "x402" naming (adoption)

- `@rateloop/sdk` and `@rateloop/agents` are `"private": true` v0.0.1 exporting raw `.ts`, yet
  the hosted MCP responses themselves point agents at `@rateloop/sdk/vote` for the only safe
  commit path (`lib/mcp/tools.ts:1351-1365`). A headless agent cannot install them.
- No public testnet, sandbox, or faucet (`app/api/dev-faucet/route.ts:5` is dev-only); an external
  developer's first end-to-end test costs real USDC on World Chain mainnet.
- No route returns HTTP 402 and there is no `PaymentRequirements`/`X-PAYMENT` flow anywhere —
  "x402" here is a bespoke EIP-3009 authorization scheme. Standard x402 client libraries cannot
  pay natively, and the docs overpromise.

**Recommendations:** publish built dual-format npm packages before anything else; deploy to a
testnet with a hosted faucet plus a no-payment dry-run mode for `rateloop_ask_humans`; either
implement the 402-challenge wire flow or rename the scheme honestly ("EIP-3009 USDC
authorization").

**Second pass (418e4202): partially mitigated.**

- *Packaging:* `private: true` removed, dual ESM/CJS build, full `exports` map, `prepack`,
  provenance config — every code prerequisite exists. But `npm view @rateloop/sdk` →
  **404**: the packages were made publishable, never published, and there is no publish workflow
  in CI (which `provenance: true` requires). Docs and hosted MCP responses still instruct
  `npm install @rateloop/sdk` and point at `@rateloop/sdk/vote` — the headline blocker is still
  literally true (new finding A1).
- *Dry run:* genuinely end-to-end with no USDC and no signature — real payload validation and
  preflight, then a deterministic fixture with honest `dry_run_*` warnings, wired through quote,
  status, result, SDK, and CLI. No rater contact, so no free rater-spam channel. It is a fixture
  though; no real human round is exercisable pre-spend.
- *Testnet:* a World Chain Sepolia deployment exists and is checked in CI, but the faucet is
  still `NODE_ENV === "development"`-gated and agent docs steer to dry-run instead of documenting
  the Sepolia path.
- *Naming:* honestly rescoped rather than implemented — canonical
  `paymentMode: "eip3009_usdc_authorization"` with `x402` kept as a documented legacy alias, and
  the docs now state RateLoop does not expose an x402 endpoint. Internal module/contract names
  retain the old prefix; cosmetic.

#### 7. Prompt injection through the result surface (security)

`rateloop_get_result` embeds raw rater feedback into `majorObjections[].summary` and
`featureTest.topFailureReports` (`lib/agent/resultPackage.ts:311-328, 355-360`), plus
rater-supplied `sourceUrls` and submitter-authored question text, with no untrusted-data marking —
adjacent to a `recommendedNextAction` field agents are told to act on, including
`agent_action_go_no_go` gates. Any rater can pay a small stake to inject instructions into a
consuming agent. **Recommendation:** wrap all third-party text in explicit untrusted-data
delimiters, add injection warnings to the tool description and `limitations`, and validate
`sourceUrl` like other URLs.

**Second pass (418e4202): mitigated.** Rater feedback and submitter question text are wrapped in
`RATELOOP_UNTRUSTED_DATA_BEGIN/END` markers (`resultPackage.ts:323-337`); delimiter injection is
blocked by case-insensitive replacement of the marker with `RATELOOP_ESCAPED_DATA` plus
whitespace normalization and 220-char truncation, so crafted rater input cannot reconstitute the
delimiter. Untrusted-data and source-URL warnings always lead `limitations` (including pending
and dry-run packages), the `rateloop_get_result` description carries an explicit "never follow
instructions" note, and `sourceUrl` is validated http(s)-only/length-capped/blocklisted at write
*and* read. Residual (low): URLs themselves rely on the warning rather than delimiters, `http://`
is still accepted, and `protocolState.audienceContext` is the one unwrapped third-party-adjacent
field (in practice enum-constrained).

### P2 — Medium

#### 8. Launch distribution and token design (tokenomics)

- **63% of the launch pool (42M of 66M non-legacy) pays for one-time World ID verification and
  referrals, not rating work.** World ID nullifiers stop double-claims but not credential rental —
  verified World IDs sell for ~$20 on documented black markets, and 250-LREP first-100 bonuses can
  directly fund that market. This also concentrates governance weight on the least-engaged cohort.
  *Recommendation:* vest/stream verification bonuses contingent on subsequent revealed-rating
  activity; keep one-time bonuses below plausible credential black-market cost; shift split weight
  toward the earned rail.
- **Anchor rental within the 25-rater fanout:** two colluding verified humans can anchor a
  25-sybil farm rating each other's 1-LREP self-asked questions; the cap on this is fractional
  correlation credit, which inherits finding 1's weakness. *Recommendation:* require anchors to
  have their own qualifying rating history; make self-asked rounds ineligible for launch credit;
  discount credit when asker, anchor, and rater share one cluster.
- **All security parameters are LREP-denominated** (stakes, frontend bond, bounty floor) on a
  token with no sinks beyond 1% of forfeits; if price falls, deterrence, herding cost, and rater
  income fall together while sybil farming stays cheap. *Recommendation:* denominate the
  frontend/oracle bond partly in USDC (the challenge bond already is); let governance peg minimum
  bounty/stake to USDC value; add a burn share to forfeitures.
- **Governance capture at thin float:** quorum floor is 100k LREP = 0.1% of supply
  (`RateLoopGovernor.sol:50`), and governance holds the oracle ARBITER_ROLE, slashing, launch
  policy, and the 25M treasury. *Recommendation:* scale the quorum floor with claimed supply;
  longer timelocks for ARBITER/slashing/address-book rotations than for numeric parameter tweaks;
  a time-limited guardian veto during beta.
- **"Reputation you can buy" framing:** LREP balance buys governance, frontend registration, and
  ask volume without any calibration record. The rating path is well-defended; the label isn't.
  *Recommendation:* maintain a separate non-transferable calibration record (per-rater score
  history already exists on-chain) and gate frontend registration/proposal rights on it in
  addition to the bond; re-scope "reputation" claims in docs.

**Second pass (418e4202): open.** Zero diffs to `LaunchDistributionPool.sol`,
`RateLoopGovernor.sol`, or the token contracts since `2843dbaa`: no verification-bonus vesting,
no anchor-history requirements or self-asked launch-credit exclusion, the frontend bond is still
LREP-only (the new fee escrow grows LREP collateral but inherits the price correlation), the
quorum floor is still a flat 100k, and no tiered timelocks or guardian veto. The only adjacent
movement is the whitepaper's new "not a settlement oracle" disclaimer. The "before significant
LREP distribution" gate has not moved.

#### 9. Off-chain operational design (ops/trust)

- **Keeper work discovery is an O(N) scan of every contentId ever created every 30s**
  (`keeper.ts:647`) despite the keeper already depending on Ponder. Tick duration degrades
  linearly and presses against grace deadlines at scale. *Recommendation:* drive discovery from
  Ponder with the chain scan as periodic reconciliation; export tick-duration metrics.
- **Keeper economics are altruistic** — reveals/settlements/cleanup earn nothing on-chain, and
  multi-keeper redundancy burns gas on harmless-but-paid duplicate reverts. *Recommendation:*
  small on-chain caller rebates (see finding 5); extend the Postgres advisory-lock pattern from
  correlation publishing to the main loop.
- **The correlation snapshot is challengeable but not mechanically verifiable:** the eligibility
  set comes from ~100 lines of Ponder SQL (`correlation-routes.ts:108-231`), `baseWeight` is
  hardcoded and features reduce to per-identity dedup — a challenger must reimplement Ponder
  semantics, and disputes resolve by governance judgment. Challenged snapshots are simply skipped,
  stalling payouts indefinitely. *Recommendation:* publish a versioned spec of the eligibility
  predicate pinned via `parameterHash`, ship a standalone CLI verifier that rebuilds artifacts
  from raw chain data, and define a timeout fallback when no operator publishes.
- **Payout-proof availability hinges on the keeper's artifact host** (files on a Railway volume
  served from the metrics server); if it dies after roots finalize, USDC claims silently become
  invisible (`data-routes.ts:1532-1535`). *Recommendation:* mirror artifacts to content-addressed
  storage (IPFS/Arweave — the resolver already supports those schemes) and cache fetched artifacts
  in Ponder keyed by `artifactHash`.
- **Hash-critical canonical-JSON code is duplicated** between keeper and Ponder; drift silently
  disables claims. *Recommendation:* move it to `@rateloop/node-utils` with a cross-package
  golden-vector test.

**Second pass (418e4202): partially mitigated.** Done: keeper work discovery is now Ponder-driven
via `/keeper/work` with the O(N) chain scan demoted to ~hourly reconciliation and outage
fallback, plus tick/discovery metrics; canonical JSON is a single implementation in
`@rateloop/node-utils` with a pinned-keccak golden vector (drift-by-duplication structurally
impossible); Postgres advisory locks now cover the main loop; the settlement rebate pays the
keeper in-band with zero keeper changes; and Ponder keeps a durable `payout_artifact_cache`
hash-verified against the on-chain `artifactHash` before storing and serving, which kills the
"keeper host dies → claims invisible" path *if* Ponder fetched the artifact while the host was
alive. Open: the correlation verifier (versioned spec + CLI both exist) re-scores from the
artifact's own embedded vote set rather than rebuilding from chain data, so a fabricated
eligibility set verifies `ok: true` — the challenger burden is unchanged (new finding O2);
challenged snapshots are still simply skipped, now as declared policy, stalling payouts until
governance; there is no artifact mirroring or fetch-retry when the host is dead at proposal time;
and no timeout fallback when no operator publishes. New ops issues: the keeper shares the public
120 req/min Ponder rate limit and can self-throttle into a synthetic "outage" (O1), and
`/keeper/work` has no urgency ordering plus an un-mirrored 1x grace predicate (O3). The
`/keeper/work` route itself is read-only, parameterized, and treated as hints the keeper
re-verifies on-chain — no poisoning vector.

#### 10. Contract complexity and untested edges (complexity/testing)

- `RoundVotingEngine` fights EIP-170 with hand-rolled assembly AccessControl at OZ storage slots,
  dual-purpose storage fields, an in-place uint256→uint48 slot retype, and a fragile
  appended-permit calldata convention that reads 128 bytes past the ABI tail and swallows reverts
  (`RoundVotingEngine.sol:582-619`). *Recommendation:* split the engine (commit/reveal vs.
  settlement/cleanup) into two contracts; replace the appended permit with an explicit
  `commitVoteWithPermit` overload.
- `QuestionRewardPoolEscrow` is 1,490 lines + 12 libraries (~6,000 lines) mixing pools, bundles,
  observer callbacks, and recovery; the bundle subsystem shares almost no state with simple pools.
  *Recommendation:* deploy bundles as a separate contract.
- Rejected-snapshot recovery requires DEFAULT_ADMIN to manually `recoverRejectedSnapshotRound` and
  `reopenRecoveredSnapshotRound`; nothing obligates the admin, so honest voters' payouts can sit
  in limbo and eventually flow back to the funder. *Recommendation:* permissionless reopen once
  the oracle holds a non-rejected finalized snapshot (the gating conditions are on-chain
  checkable).
- **Untested paths:** `flushPendingTreasuryForfeit`, `replayBundleObserverNotify`,
  and similar recovery edges still need direct branch coverage. `GasBudget.t.sol` only
  exercises 3-voter rounds while settlement is O(N) multi-pass with maxVoters up to 200.
  *Recommendation:* add direct tests for the recovery paths and gas tests at 3/100/200 voters
  against the World Chain block gas limit; batch scoring if it doesn't fit.
- Minor: the weighted-tie rule (smaller raw pool wins, `RoundVotingEngine.sol:996-1009`) creates
  a knife-edge where adding stake to your own side flips the outcome; document/test the boundary
  or use a conventional tie-break.

**Second pass (418e4202): partially mitigated.** Fixed: the appended-permit assembly is replaced
by an explicit `commitVoteWithPermit` overload with front-run-tolerant try/catch
(`RoundVotingEngine.sol:485-512`), and the replacement is complete across ABIs, app, and
sponsorship validator; rejected-snapshot recovery is permissionless with on-chain gating, and the
rework also fixed a strand-the-round bug (recovery flags now clear only after requalification
succeeds); `GasBudget.t.sol` asserts 100- and 200-voter settlement under the 30M block limit;
`flushPendingTreasuryForfeit`/`replayBundleObserverNotify` have direct branch tests; the
weighted-tie knife-edge is documented and boundary-tested (kept intentionally, not changed). Open:
the engine split exists only as two new interfaces on the same contract, and the bundle escrow
split is staged (an optional routing seam defaulting to the same escrow) — both structural splits
remain to be done. The permit try/catch swallows all permit reverts, so malformed permits surface
as opaque transfer failures (ergonomics only).

#### 11. Agent UX polish (integration)

- SDK `DEFAULT_TIMEOUT_MS = 10s` vs. server-side confirm waits up to 180s — confirm calls
  routinely abort client-side while the server proceeds. Raise the per-call timeout for
  confirm/ask or make confirm enqueue-and-poll; document idempotent retry via `operationKey`.
- Documented `mode: "sync"|"async"` and `quoteFetchImpl` are validated then discarded
  (`lib/mcp/tools.ts:2281, 2481`; `sdk/src/agent.ts:32`). Implement or remove.
- The SDK flattens the server's excellent structured errors (`code`, `retryable`, `recoverWith`)
  into `RateLoopApiError(message, 400)` — surface the structured object so agents can branch.
- Webhooks are managed-token-only and SSE is disabled on both MCP routes; public agents must
  poll 40min–2h settlements. Allow signature-gated webhook registration keyed to the paying
  wallet, or enable SSE status streams.
- The happy path is 5–7 sequential tool calls across an 18-tool surface; collapse the common case
  into a single `ask → signed-authorization → result` path and mark the rest advanced.

**Second pass (418e4202): largely mitigated.** `DEFAULT_CONFIRM_TIMEOUT_MS = 210s` now exceeds the
server's 180s on all confirm calls (configurable); `quoteFetchImpl` is implemented and `mode` is
narrowed to `"dry_run"` with a structured `mode_unsupported` rejection; `RateLoopApiError` carries
the full structured object (`code`/`retryable`/`recoverWith`/`details`) from both HTTP and MCP
paths; public webhooks are signature-gated to the paying wallet with single-use nonced challenges,
HMAC-signed deliveries, and a genuinely strong SSRF defense (https-only, private-range DNS
rejection with rebinding-pinned resolution, manual redirects, zero body read); browser-handoff
helpers shipped; and all 18 tools carry `primary|advanced` tiers with the chat happy path
collapsed to handoff → status → result. Residuals: `askHumans` itself still defaults to 10s,
the tier fields are nonstandard top-level tool fields spec-strict MCP clients may strip, SSE
remains disabled (webhooks are the sanctioned alternative), and the headless raw-wallet path is
still 5–7 calls, now marked advanced rather than collapsed.

## New findings (second pass, 2026-06-10)

Issues introduced by the mitigation wave itself or newly found in it, deduplicated across the
five review agents.

### Release blockers at HEAD (fix before anything ships)

- **R1a — Storage-layout snapshots not regenerated; the CI storage gate is red.** Deleting
  `_roundRbtsSeedRefreshCount` mid-layout shifted every subsequent `RoundVotingEngine` slot
  (`_pendingTreasuryForfeitLrep`, both commit-credential masks, the dormancy snapshot) without a
  `__gap` adjustment, and the pinned snapshots for `RoundVotingEngine` and `FrontendRegistry`
  (which gained two `pendingFeeWithdrawal*` mappings) were never regenerated —
  `check-storage-layouts.sh` does an exact diff in CI. Harmless under the documented
  fresh-redeploy assumption, but an upgrade across this delta would silently zero pending
  treasury forfeits and erase in-flight credential masks. Regenerate the snapshots and either
  restore a placeholder slot or annotate the intentional shift.
- **R1b — The fee-withdrawal feature shipped against a stale `FrontendRegistry` ABI.**
  `deployedContracts.ts` still exposes the deleted `claimFees` and lacks
  `requestFeeWithdrawal`/`completeFeeWithdrawal`/`pendingFeeWithdrawal*`; the app's ABI-override
  shim only patches `RoundVotingEngine`, so the new two-step withdrawal UI throws on every
  call/read; the sponsored-transaction allowlist still names `claimFees`
  (`freeTransactions.ts:959`) and omits both new functions, so even with a fresh ABI the gasless
  path rejects them; the fee-claim e2e spec still tests `claimFees()`. Keeper and Ponder were
  updated correctly — only the app layer was missed.
- **R1c — Ponder fabricates RBTS scores for scoreless expired-seed settlements.** The
  `RbtsRewardsScored` handler has no guard for the newly reachable `scoreSeed == 0` state and
  proceeds to draw reference/peer indices from the zero seed, computing per-vote scores,
  forfeits, and stake returns that never existed on-chain (`ponder/src/RoundVotingEngine.ts:902-1092`)
  — feeding claimable-amount displays and leaderboards. Mark scoring-set votes
  fully-returned/unscored when the seed is zero.

### Economic (E)

- **E1 (medium) — Challenger-slot capture and bounty veto.** The oracle records exactly one
  first-come challenger per snapshot and later challenges revert; `slashFrontendWithBounty` never
  reads it, taking a governance-supplied recipient checked only against the frontend and its
  *current* proposer. A fraudulent proposer can (a) self-challenge from a fresh wallet, occupying
  the only challenger slot — recovering 50% of its own confiscation and zeroing the honest
  watcher's expected bounty — or (b) bind the known watcher as its "proposer" via the
  consent-free `setSnapshotProposer` (audit M-2) so the bounty-routing slash reverts. Read the
  recorded challenger from the oracle on-chain, snapshot the proposer binding at challenge time,
  and land the M-2 consent fix.
- **E2 (medium) — 14-day fee escrow vs ~10-day governance latency.** Minimum
  proposal→execution latency for a slash is ~10 days (1d voting delay + 7d period + 2d
  timelock) before any detection time, and the attacker controls when the clock starts by timing
  `requestFeeWithdrawal` against its own fraudulent snapshot. ~4 days of slack is not collateral.
  Lengthen `FEE_WITHDRAWAL_DELAY` to 21–30 days or add a guardian freeze on pending withdrawals
  when a challenge is filed.
- **E3 (medium-high) — Alternating-vote coordination defeats the surprise mechanism.** The
  base-rate normalization only cancels pooling on a *constant* answer. A bloc using a round-parity
  signal (UP on even rounds, DOWN on odd) keeps the single global trailing base rate pinned near
  5000 while achieving ~100% intra-round agreement → ~2x weight every round, extracting share
  from honest dissenters; at low volume the 100-round window can also be dragged with cheap
  self-asked unanimous rounds and harvested on the rare side. Per-content/per-category base
  rates, entropy dampening on near-unanimous rounds, and ground-truth audits are the fixes.
- **E4 (medium) — Sub-8-reveal rounds are now zero-stake-risk convex lotteries.** Below
  `SCORE_SPREAD_FORFEIT_MIN_REVEALS = 8` both forfeits and the settlement rebate are identically
  zero, while the surprise bonus's 1x floor makes uninformed rare-side voting strictly positive-EV
  (Jensen), and participant floors only force 8 voters at ≥10k USDC. The surprise spec's "stake
  forfeiture already prices that risk" rationale is false exactly there, and finding 4's small-round
  collusion is *sweetened*: 2–3 colluders are simultaneously the majority, each other's agreement
  pool, and 2x weight earners. Align the bonus threshold with the forfeit floor or taper 3→8
  instead of a cliff.
- **E5 (low-medium) — Garbage-commit stalling is now gas-only.** The RevealFailed refund
  (correct call, trade-off acknowledged in-code) plus the 24x grace window means a credentialed
  attacker committing undecryptable ciphertext can cycle target content through ~day-long
  RevealFailed loops at gas-plus-stake-lock cost, with no forfeiture. If observed: restore
  forfeiture for provably undecryptable commits when other voters *did* reveal (targeted
  withholding vs systemic outage is distinguishable), or price commits with a small
  non-refundable fee.

### Operational (O)

- **O1 (medium) — The keeper self-throttles against Ponder's public rate limiter.** All keeper
  reads share the public 120 req/min per-IP limit (loopback exemption is dev-only); a busy tick
  429s into getLogs fallbacks and degraded discovery — a self-inflicted outage indistinguishable
  from a real one in alerts. Add a shared-secret/allowlist bypass or internal listener.
- **O2 (medium) — The correlation verifier proves self-consistency, not chain truth.** It
  re-scores from the artifact's own embedded `eligibleVotes`, so a proposer who fabricates the
  vote set (drops voters, invents commitKeys, flips `verifiedHuman`) still verifies `ok: true`;
  eligibility is still *defined* as "whatever the Ponder route returns". The challenger burden
  the first pass flagged is unchanged, and the oracle's economic backstop is doing all the work.
- **O3 (low-medium) — `/keeper/work` ordering and gauge blind spots.** Candidates are
  `contentId ASC` with a 500/2,000 cap, so >500 open rounds starve high-id rounds until hourly
  reconciliation, and the reveal-grace gauge only reflects visited rounds — the RevealFailed
  alert under-reports precisely under load. The route's deadline predicate also uses 1x grace
  while chain/keeper use 24x. Order by deadline, compute the gauge in SQL, mirror the multiplier.
- **O4 (low) — Hardening gaps:** the keeper parses `/keeper/work` responses with no byte/array
  caps (unlike the correlation fetcher); the Ponder artifact cache stays silently empty if the
  proposer host is dead at proposal time (no retry/alert); the frontend self-reveal hook has no
  getLogs fallback; the keeper's own artifact cache hash check defends against corruption, not a
  malicious DB writer.

### Agent surface (A)

- **A1 (medium) — Packages 404 on npm while every doc instructs installing them**, and
  `provenance: true` plus no publish workflow means a plain `npm publish` will fail — the
  publish gate hasn't actually been crossed. Add the CI publish workflow and ship 0.1.0.
- **A2 (low) — Pre-payment webhook registration is a free signed-POST reflection primitive**
  (subscription + `question.submitting` event enqueued before payment). Bounded by the SSRF gate
  and HMAC bodies; defer activation to payment confirmation.
- **A3 (low) — Polish:** unauthenticated dry-run/quote runs full chain-read preflight (free RPC
  amplification at 120 req/min/IP); dry-run sentinel values (`"dry_run_complete"`,
  `"integration_ready"`) aren't in the documented result enums; `http://` source URLs accepted
  while every other outbound surface is https-only.

### Documentation drift (D)

- **D1 — The same-day audit report describes the deleted seed-refresh mechanism as a verified
  control** (`audit-report-2026-06-10.md:106` praises `refreshExpiredRbtsSeed`, removed by the
  later merge); the keeper README still says RevealFailed forfeits stake. Add addenda.
- **D2 — Spec/implementation divergence on the consensus-critical path:** the correlation route
  coerces missing reveal weight to `0n` and scores the vote, while the surprise spec mandates
  "excluded, neutral" — a literal-spec challenger computes a different root and triggers a
  spurious dispute. Pass `null` through or amend the spec.

## Prior-art lessons applied

| Prior art | Lesson for RateLoop |
| --- | --- |
| Peer-prediction literature (Prelec BTS, Witkowski–Parkes RBTS, Kong–Schoenebeck) | Uninformative pooling equilibria are the default attractor; collusion has a profitability threshold above which it beats honesty. Design quorums and payout curves around it (findings 2, 4). |
| UMA / Polymarket attack (March 2025) | Token-vote arbitration over valuable settlements gets captured in practice; >50% of disputed votes came from 10 wallets. Don't let governance token votes be the last line for the oracle (finding 1). |
| Kleros (Doges on Trial p+ε bribery) | Survived because appeals made attacks expensive and uncertain. RateLoop's challenge window needs the same property: live economics, escalation, challenger rewards (findings 1, 4). |
| Augur dispute rounds | Challenge machinery that is slow/complex goes unused. Keep the challenge path simple and fast (finding 9). |
| TCRs (adChain) | Nobody curates for free; subjectivity without an incentive design collapses. RateLoop's peer-prediction core is actually the right tool for subjective signals — lean into "subjective aggregate" positioning and never market settled scores as objective truth. |
| Gitcoin COCM | Production-proven but operator-computed and trust-laden. Publish reproducible artifacts + verifier so anyone can recompute and challenge (finding 9). |
| Soulbound-token critique | Transferable reputation stops signaling earned trust. The rating path already resists this; the "reputation" branding and frontend/governance gating don't (finding 8). |
| World ID black market (~$20/credential) | Keep one-time verified bonuses below credential cost; apply correlation caps to verified wallets too (finding 8). |
| x402 adoption (100M+ tx, ~$50M volume) | Micro-ticket agent payments are real but tiny; the demand-side bet is plausible and unproven. Instrument early rounds to learn what bounty size clears useful human effort; don't anchor economics to RLHF-market comparables. |

Also worth noting: no prior public "RateLoop" protocol exists (the lineage is the internal
Curyo → RateMesh → RateLoop rename in this repo's history), but **rate-loop.com is an existing
French online-reputation-management firm** — a trademark/SEO collision to check before launch.

## Suggested sequencing

First-pass sequencing (historical):

1. **Before mainnet value flows:** finding 1 (oracle bonds), finding 3 (RevealFailed refunds +
   reveal fallbacks), finding 7 (prompt-injection delimiters — cheap).
2. **Before pushing agent adoption:** finding 6 (publish SDK, testnet+faucet, x402 naming),
   finding 11 (timeouts, structured errors).
3. **Before significant LREP distribution:** finding 8 (vesting verified bonuses, quorum floor,
   USDC-denominated bonds), finding 2 (accuracy-linked bounty shares).
4. **Ongoing hardening:** findings 4, 9, 10.

Updated after the second pass (2026-06-10):

1. **Immediately (red at HEAD):** R1a (regenerate storage-layout snapshots), R1b (regenerate
   FrontendRegistry ABI + gasless allowlist + e2e), R1c (guard `scoreSeed == 0` in Ponder),
   D1/D2 (audit addendum, spec/route reveal-weight divergence).
2. **Before mainnet value flows:** E1 (read the recorded challenger on-chain + M-2 consent fix),
   E2 (escrow delay vs governance latency), E4 (align the surprise bonus with the forfeit
   floor), plus finding 1's still-open value-tiered windows and claim-rate ramp.
3. **Before pushing agent adoption:** A1 (actually publish — CI workflow + 0.1.0; everything
   else is ready), hosted Sepolia faucet, A2/A3.
4. **Before significant LREP distribution:** finding 8 (untouched), E3 (per-content base rates /
   entropy dampening / audit rounds — the launch rail still pays conformity).
5. **Ongoing hardening:** O1–O4, E5 (watch item), finding 10's engine/bundle splits, the
   chain-truth correlation verifier (O2).
