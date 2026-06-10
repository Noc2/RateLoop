# RateLoop Design Review — June 2026

A multi-agent review of the RateLoop protocol design, covering the smart contracts, the
incentive/tokenomics design, the off-chain services, the agent/SDK integration surface, and
relevant prior art (peer prediction literature, Kleros, UMA, Gitcoin COCM, the x402/agent-payments
landscape). Five independent review passes were run over the codebase and external sources; this
document is the synthesis. File references are to the repo at the time of review (commit
`2843dbaa`).

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

### P1 — High

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

#### 7. Prompt injection through the result surface (security)

`rateloop_get_result` embeds raw rater feedback into `majorObjections[].summary` and
`featureTest.topFailureReports` (`lib/agent/resultPackage.ts:311-328, 355-360`), plus
rater-supplied `sourceUrls` and submitter-authored question text, with no untrusted-data marking —
adjacent to a `recommendedNextAction` field agents are told to act on, including
`agent_action_go_no_go` gates. Any rater can pay a small stake to inject instructions into a
consuming agent. **Recommendation:** wrap all third-party text in explicit untrusted-data
delimiters, add injection warnings to the tool description and `limitations`, and validate
`sourceUrl` like other URLs.

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

1. **Before mainnet value flows:** finding 1 (oracle bonds), finding 3 (RevealFailed refunds +
   reveal fallbacks), finding 7 (prompt-injection delimiters — cheap).
2. **Before pushing agent adoption:** finding 6 (publish SDK, testnet+faucet, x402 naming),
   finding 11 (timeouts, structured errors).
3. **Before significant LREP distribution:** finding 8 (vesting verified bonuses, quorum floor,
   USDC-denominated bonds), finding 2 (accuracy-linked bounty shares).
4. **Ongoing hardening:** findings 4, 9, 10.
