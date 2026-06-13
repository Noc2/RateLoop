# RateLoop Protocol Design Review — 2026-06

A multi-agent design review of the RateLoop protocol: five scoped reviewers (voting
& scoring mechanism, economics & attack-cost, identity & sybil resistance,
confidentiality architecture, and trust topology), one academic/ecosystem literature
researcher, and adversarial verification of every claimed weakness against the code
and public docs. HEAD `3d58264b`.

This is a **design** review — mechanism design, incentive compatibility, economic
security, trust assumptions, and architecture — not an implementation-bug hunt (those
are covered by the separate pass-2…5 code reviews). Each weakness is classified as a
genuine **flaw**, a **documented/intended tradeoff**, or **acceptable-for-testnet but
not for the mainnet claim**, and given a severity by design impact. 39 strengths and
32 verified weaknesses survived verification; 2 candidates were refuted.

> Follow-up update (2026-06-13): the asker-facing confidentiality copy issues called out
> in this review have been remediated after the reviewed HEAD. The whitepaper source,
> submit/agent private-context tooltips, landing FAQ, public docs, SDK/agent docs,
> `llms.txt`, and the agent/x402 gated-context defaults now state that private context
> is a serving-layer deterrence/redaction model, not cryptographic secrecy, and omitted
> gated disclosure policy defaults to `private_forever`. The evidentiary/log-root and
> breach-reporting governance issues remain open.
>
> Follow-up update (2026-06-13): the public-rating correlation gap called out in H1 and
> gate item 2 has been remediated after the reviewed HEAD. Settlement now records raw
> rating evidence as pending; the visible rating updates only after a finalized
> `PAYOUT_DOMAIN_PUBLIC_RATING` correlation root supplies per-rater effective weights.
> The keeper co-proposes the correlation epoch and the dependent public-rating root
> against the same 2-hour optimistic-oracle window, and the UI shows a small
> "Rating pending" notice while that root is pending. This does **not** make public-rating
> weights feed LREP payouts; LREP/USDC payout roots remain separate oracle domains.
> The remaining H1 concern is the small-round binary verdict itself, which still settles
> by epoch-weighted vote pools before any correlation root is applied.

> Coverage caveat: the trust-topology reviewer's _weakness_ candidates could not be
> individually re-verified (the verification stage hit a resource limit), so they are
> not counted in the 32. Their substance — governance/proxy power over escrows,
> operator dependency for liveness and gated serving, drand secrecy trust, World Chain
> sequencer trust, USDC freezability — is largely captured either by the trust-topology
> _strengths_ below (which describe the timelock/permissionless-backstop architecture
> honestly) or by confirmed findings from the economics and confidentiality reviewers.
> The trust-topology strengths themselves were verified by their own reviewer pass.

---

## Executive summary

RateLoop is, at the design level, **substantially more sophisticated and more honest
than the typical staking/rating protocol.** The core mechanism is a faithful
implementation of a real peer-prediction mechanism (Witkowski–Parkes Robust BTS for
small populations), not the naive "reward agreeing with the majority" design most
rating systems ship; the cryptographic commit layer (drand tlock) is well-audited and
solves a real problem (reveal-withholding) with correct graceful degradation; the
identity, confidentiality, and governance layers each show evidence of adversarial
self-review (in-code audit tags, a brutally honest internal design plan, a disciplined
no-EOA-backdoor deployment). The trust assumptions are disclosed in-repo to a standard
well above stage norm.

The weaknesses cluster into **four load-bearing seams**, three of which the external
literature independently predicts:

1. **Small rounds have no economic teeth, and their verdicts are near-free to flip.**
   The modal round (3–5 raters) settles below the 8-reveal threshold where forfeits
   activate, so the carefully-built RBTS scorer is economically inert and a sybil
   majority can flip the public verdict/rating for ~gas plus recoverable stake. This
   is the single most important issue to resolve before mainnet, and it is partly an
   intended tradeoff (forfeits at n=3 would _arm_ a colluding majority, not deter it)
   and partly an under-defended gap (no base reward pool, no concentration-aware
   forfeit cap). A post-review public-rating correlation root now prevents the same
   wallet cluster from moving the displayed rating by raw headcount, but it deliberately
   does not rewrite the settled binary verdict.

2. **Every on-chain economic deterrent is denominated in LREP, a token with no
   exogenous value source.** Vote stakes, forfeits, the frontend bond, slashing, and
   the challenger bounty are all LREP; LREP is not sold, has no fee-backed value
   accrual, and its only distribution is a free launch faucet. If LREP trades near
   zero every penalty is noise; if it becomes valuable the faucet funds attackers.

3. **Peer prediction has no defense against a ≥50% coalition, and stake-weighting +
   voter apathy lower the effective threshold.** A weighted-majority cluster controls
   both the verdict and the stake-weighted score mean, so ≥8-voter collusion is
   _profitable_ (it extracts honest minority stake), not merely break-even. The
   literature is unambiguous here: UMA/Polymarket flipped at ~25% under apathy; peer
   prediction provably rewards coordinated deception past 50%; and tlock prevents
   reveal-withholding but **not** provable-commit bribery (a voter can prove their
   committed vote to a briber pre-reveal).

4. **Confidentiality is operator-trust by design, and the evidence chain is still not
   strong enough for mainnet gated-content marketing.** The hybrid (chain for
   bonds/bans, server for bytes) is coherent, and the post-review copy pass now tells
   askers that the operator can serve/read hosted bytes and that private context is
   deterrence/redaction rather than cryptographic secrecy. But the evidence chain
   (mutable, unanchored log roots) currently can't back a slash dispute.

None of these is fatal; all are addressable, and the team's own internal docs already
name most of them. But points 1–2 in particular mean that **the protocol's headline
"skin in the game / sybil-resistant credible rating" claim is not delivered for the
rounds that will dominate real usage at any real token value.** They should be the
gate items before a mainnet that markets agent-decision and acceptance-oracle use.

---

## Strengths

The design gets a remarkable amount right. Grouped by area; the most distinctive are
starred.

### Mechanism & scoring

- **★ Faithful RBTS for binary signals, valid at n≥3.** `RobustBtsMath.sol:31-58`
  implements the genuine Witkowski–Parkes 2012 mechanism: each rater reports a signal
  _and_ a real prediction of the revealed crowd's up-share, scored as an information
  score against a uniformly-drawn reference/peer plus a quadratic prediction score.
  The degenerate-endpoint attack (predicting exactly 0/100% to collapse the shadow
  posterior) is explicitly excluded by `MIN/MAX_USER_PREDICTION_BPS`. This is the
  correct mechanism for a no-ground-truth setting and far better than the majority-
  match scoring most rating protocols ship.
- **★ Verdict and reward scoring are decoupled.** The win condition is pure
  epoch-weighted stake pools (`RoundVotingEngine.sol:1022-1038`); RBTS scores
  _calibrate rewards only_ and never override the binary signal. So the Keynesian
  beauty-contest incentive ("vote what you expect others to vote") does not flow
  through the LREP reward channel — the correct way to bolt a peer-prediction scorer
  onto a majority-decision output.
- **★ Tlock solves reveal-withholding with correct trust-splitting.** drand is needed
  only for _secrecy_, not liveness: reveals verify plaintext+salt against the commit
  hash and gate only on timestamps, so if drand halts, voters self-reveal and the
  round proceeds; if nobody reveals, the round terminates as RevealFailed with full
  refunds, not forfeits. Honest-but-offline voters never lose stake to "forgot to
  reveal."
- **Two-step delayed RBTS seed is grind-proof.** The scoring set closes before the
  entropy (a later block's hash) exists; the seed binds chainid, engine, round, and
  the hashed scoring set; and crucially it only randomizes _which_ peer each rater is
  scored against — it cannot flip the verdict. The only residual manipulator is the
  sequencer, already trusted on an OP-stack L2.
- **Per-round snapshotting of config, drand params, registries, and reference rating.**
  Governance or registry rotation cannot retroactively change an in-flight round's
  rules — the commit hash itself binds the snapshotted reference rating. Excellent
  immunization for 20-minute economic games.
- **Post-review: public rating is now independence-adjusted before publication.**
  Settlement records raw up/down evidence as pending, then the visible rating consumes
  a finalized public-rating correlation root with per-rater effective weights. A single
  correlated cluster with many wallets is capped at roughly the strongest independent
  participant in that cluster, rather than moving the displayed rating by raw headcount.
  The previous capped-stake property remains: before correlation discounting, a
  10-LREP whale contributes at most 2× a 1-LREP voter (vs 10× reward exposure), and
  raters report an _absolute_ thumbs signal against a snapshotted prior rather than
  "raise/lower the visible number," avoiding reflexivity.
- **Advisory votes are a contained onboarding channel** that cannot reach quorum, skew
  pools, or double-participate.
- **Coherent refund-vs-forfeit taxonomy.** Cancelled/Tied/RevealFailed refund everyone
  (systemic failure isn't the voter's fault); only unrevealed votes in _settled_ rounds
  forfeit; refundable stakes have no claim deadline, explicitly to deny a governance
  extraction vector.

### Economics

- **EIP-3009 atomic bounty funding with parameter-bound nonces** — fund and
  parameterize a bounty in one tx, no approve race, no relayer tampering. The right
  primitive for agent-initiated asks.
- **★ Participant floors scale with bounty value AND are measured in independence-
  discounted effective units.** A $10k pool needs ≥8 _effectively independent_
  participants per the correlation scorer — 8 sybils in one cluster don't qualify the
  round. A real collusion-cost multiplier where the money is large.
- **Funder claim-grace + refund design resists griefing both directions** — raters
  always get a 7-day claim window; funders can recover unallocated/dormant funds;
  non-refundable submission pools route residue to treasury, closing the
  fund-then-self-refund loop.
- **Income-as-collateral for frontend operators** (21-day slashable fee escrow that
  grows with usage) is an elegant alternative to per-snapshot bonds; the 50% (not
  100%) challenger bounty deliberately prevents a proposer recovering its own collateral
  via a sock-puppet challenger.
- **Error paths bias toward users, not the protocol** — treasury-transfer failure
  reroutes fees into the voter pool rather than bricking settlement.
- **★ Launch emission faucet is unusually well-defended** — min score 70%, verified-
  human anchors, anchor fanout caps, 7-day-aged credentials, unverified 25% cap,
  finalized correlation snapshot before payout, declining cohort caps. World ID anchors
  bind where they matter (payouts), not where they'd gate participation.
- **The optimistic payout oracle is honest about its model** — the contract header
  states plainly it is _not_ per-snapshot economically secured and that challenge bonds
  are anti-spam only; within that model the hardening (source-readiness gating, replay
  blocking, post-finalization veto, recovery path) is thorough.

### Identity

- **★ Nullifier-keyed identity with ban propagation surviving address rotation.**
  Address = session, nullifier = identity. One Orb human = one concurrent verified
  earning identity; a banned human cannot launder the ban by re-attesting from a fresh
  wallet; reward consumers check bans against both the round-time snapshot and the
  current registry.
- **★ The credential→nexus→bond→ban confidentiality deterrence stack is coherent and
  genuinely novel.** Pricing confidentiality in _identity_ (a permanent ban destroys an
  Orb human's only possible verified identity) rather than only in collateral is an
  idea not seen elsewhere; `banIdentity` literally cannot touch an identity that never
  accessed gated content.
- **Intentionally non-gating identity keeps World ID a multiplier, not a single point
  of failure** — a World ID outage degrades the protocol to the unverified tier instead
  of halting it; credential value is expressed as earning multipliers, not a
  participation wall. The right call given World ID v4 on-chain verification is itself
  pre-production.
- **Layered, individually-bounded launch sybil policy**; **conservatively-scoped
  delegation** with full ban-surface coverage; **commit-time credential snapshots** that
  prevent vote-then-attest eligibility gaming; and a **15-minute presence/recheck flag**
  that lets funders demand "a human was present recently," the assurance that actually
  matters against credential rental.

### Confidentiality

- **★ Deterrence-not-cryptography is the right architecture for the market, and it is
  internally honest.** The internal plan grounds the design in researched incumbent
  practice (the market buys friction + deterrence), explicitly rejects TEE/DRM/FHE
  theater ("loses to a phone camera"), and the rater-facing terms state plainly that
  gated context "is a serving-layer access restriction, not a guarantee that disclosure
  is impossible."
- **The bond+ban+watermark stack is a real differentiator over incumbent NDA-with-fake-
  panelists** — an on-chain bond keyed to an Orb human (vs a panel account where 29–40%
  of respondents are fraudulent), plus a 50% reporter bounty incumbents lack entirely.
- **Bond lifecycle, per-view HMAC watermark tokens (defeating slash-bait forgery), and
  a thorough secondary-leak-surface closure** (Ponder search-vector redaction, cache
  headers, OG images, pre-anchor 404s) show the confidentiality surface was thought
  through as a _system_, not just a primary gate.
- **Ban power is constrained in code and scoped to surplus earnings only** — staked
  principal and refunds are never blocked, defusing the "governance confiscates stake
  under a confidentiality pretext" vector.

### Trust topology & governance

- **★ No EOA backdoor: every privileged role routes to a timelocked on-chain governor
  from genesis.** On live chains governance is a 2-day TimelockController whose only
  proposer is the LREP governor; the deployer renounces every bootstrap role before the
  script ends. A malicious-admin attack requires winning a public ~10-day governance
  pipeline, not compromising one key — materially better than the standard multisig-owned-
  proxies pattern.
- **Comprehensive permissionless backstops** — settle, finalize-reveal-failed, cancel,
  claim-refund, process-unrevealed, recover-rejected-snapshot are all permissionless, so
  if the operator disappears, stakes and unpaid bounties are recoverable purely on-chain.
- **The keeper is genuinely liveness-only and replaceable from public data**; **World ID
  is a bounded dependency, not an identity root for settlement** (its compromise costs
  the launch rails, not settlement/stakes/escrows); **selective non-upgradeability** of
  value-bearing-but-simple periphery (LREP, the oracle, the launch pool) shrinks the
  rewrite-history surface; **storage-layout gates + cross-contract shape validation**;
  and an unusually capture-and-grief-hardened governor (dynamic quorum over circulating
  supply, excluded-holder snapshots, proposal-front-run defense, self-delegation-only).
- **Trust assumptions are unusually well disclosed in-repo** — the whitepaper Limitations
  section names drand/keeper dependence, "not a truth oracle," and "not a settlement
  oracle"; MCP results carry untrusted-data markers.

---

## Weaknesses

### High severity

**H1 — Flipping a small round's verdict risks essentially nothing on-chain.**
_(Cost-of-attack; flaw)_
Verdict = epoch-weighted stake majority. For a 3-honest-voter round, 4 sybil wallets at
the 10-LREP cap (40 vs 30 weighted) flip it; total reveals (7) < the 8-reveal forfeit
threshold, so the attacker's stake is returned in full — at-risk cost is gas plus a few
hours' float. The per-identity stake cap doesn't help: an unverified identity is just
`keccak(address)`, so each fresh wallet is a fresh capped identity (verified end-to-end
across `RoundVotingEngine.sol:95`, `VotePreflightLib.sol:157-168`). For 5-voter rounds
forfeits arm, but they key off the stake-weighted _mean_ a majority controls, so the
mechanism _helps_ the attacker drain the honest minority. The ClusterPayoutOracle can
zero the attacker's _bounty_ weights but does not rewrite voting settlement, so the
flipped binary verdict is final. The "don't settle external financial contracts"
disclaimer covers the external-settlement angle, but the whitepaper's own "Signal
Integrity" section affirmatively claims sybil resistance from stake caps and
credentials that the code does not deliver for small rounds, and markets agent-action
gates whose value _is_ the verdict. **This remains the gating issue for mainnet.**
Post-review, the closely related public-rating issue is fixed differently: settlement
leaves the displayed rating pending until a finalized public-rating correlation root
applies independence-adjusted weights, so an asker can no longer mint an arbitrary
permanent public rating by filling the 3-voter floor with their own correlated wallets.

**H2 — LREP value circularity: every economic deterrent is denominated in a token with
no value source.** _(Economic security foundation; flaw)_
Vote stakes, score-spread forfeits, the 1,000-LREP frontend bond, slashing, the 50%
challenger bounty, and governance weight are all LREP. LREP is "not sold by the
protocol," has no fee burn or buy pressure, and its only distribution is the 75M launch
faucet + 25M treasury. The whitepaper claims "sybil resistance from LREP cost" while
the same document declines to describe LREP as a financial asset — an unresolved tension
the Limitations section never acknowledges. If LREP trades near zero, every on-chain
penalty approaches zero and sybil bounty-extraction is gated only by an off-chain
correlation scorer; if LREP becomes valuable, the free faucet hands attackers working
capital. Settlement-layer security needs at least one deterrent whose value is exogenous
(USDC bonds, fee-backed accrual, or identity), and the only exogenous elements (World ID,
the USDC challenge bond) are deliberately excluded from settlement weight. The
confidentiality lane (USDC bonds) and the frontend fee (USDC) are the exceptions, but all
settlement _penalties_ are LREP. Arguably testnet-acceptable today; a genuine flaw for the
mainnet the canary runbook is steering toward.

**H3 — Peer prediction without ground truth: a weighted-majority coalition controls
the verdict and most peer benchmarks, making ≥8-voter collusion profitable.** _(Collusion
economics; intended tradeoff with an under-defended edge)_
RBTS scores against randomly-drawn peers from the revealed set and now settles each report
against a leave-one-out stake-weighted benchmark. Leave-one-out fixes the single-rater
self-benchmark issue, but a coalition holding majority revealed stake-weight still
dominates the drawn peers and the benchmark seen by honest minority raters, so coalition
members can score at/above benchmark while the honest minority lands below benchmark and
forfeits up to 50% of stake — 96% of which flows to positive-spread reports. The attack
simultaneously flips the verdict and _extracts_ honest stake; it is profitable, not
break-even. The generic vulnerability of ground-truth-free peer prediction is documented
("not a truth oracle," public-auditability backstop), so this is classified an intended
tradeoff — but the _specific active wealth-extraction_ is unacknowledged and has no
concentration-aware backstop on the LREP rail (e.g. forfeit caps proportional to cluster
concentration, or routing forfeits to treasury rather than peers when concentration is
high). The literature makes this concrete: UMA/Polymarket flipped a disputed market at
~25% of votes under voter apathy.

### Medium severity

- **Resolved: the payment benchmark is now leave-one-out; the kinked payment transform
  still weakens strict RBTS properness.** _(partially fixed flaw)_ RBTS's
  incentive-compatibility proof needs payments affine in the score, while the
  implementation still pays `max(0, s−benchmark)` and penalizes
  `1.5×·max(0, benchmark−s)`, a kinked transform around each report's benchmark. The
  original self-benchmark bug is fixed: the benchmark now excludes the rater's own
  stake-weighted score, so a 10-LREP voter cannot compress its own per-token exposure by
  carrying most of the global mean. The remaining concern is the non-affine payoff
  transform, bounded by the 10:1 stake cap and 50% forfeit cap.
- **RBTS skin-in-the-game is inert in the modal round, and surprise weighting is too.**
  _(intended tradeoff)_ Below 8 score-eligible reveals, forfeits are zero (so the voter
  pool is empty — no LREP upside _or_ downside) AND surprise weighting is neutral (flat
  per-head bounty split). For every bounty under $10k the headline "stake-backed
  accountability" mechanism does nothing economically; honesty rests entirely on the
  off-chain oracle and launch subsidies. The 8-reveal gate is itself defensible (sparse
  RBTS scores are statistically meaningless, and forfeits at n=3 would arm a colluding
  majority — see H1/H3), and it's disclosed — but the _consequence_ (no truth-sensitive
  incentive at all in the 3–5 rater round) is never stated as a design property, and the
  marketing oversells it.
- **The protocol treasury has no recurring revenue.** _(flaw)_ There is zero protocol
  take on the USDC flow (0 bps). The core asker→rater loop is genuinely non-Ponzi, but
  everything the treasury must fund (arbiter ops, safety responses, verification
  acceleration, grants) is backed only by the finite, endogenously-valued 25M LREP
  allocation. No fee switch exists; the sustainability gap is undocumented. Addable later
  via governance, but currently a missing mechanism.
- **The identity rotation/ban-propagation state machine is imperative, multi-mapping, and
  demonstrably hard to keep correct.** _(flaw)_ Identity state spans ~six coupled mappings
  mutated across seven entry points; the contract's own comments are a changelog of
  invariant breaks (L-Identity-1, M-Identity-2, RR-1, RR-3, RR-6) and **two fixes landed
  the morning of HEAD** (`18f6de94`, `e4b039eb`). No currently-exploitable attack, but
  repeated emergency repair plus correctness that depends on off-chain indexers obeying
  event-driven re-mapping runbooks is real fragility in the deterrence layer's enforcement
  surface. An explicit lifecycle-state or append-only-history model would make these
  invariants structural rather than procedural.
- **Blind-phase secrecy hides votes from passive observers only; commit hashes make
  intra-epoch vote-proofs credible.** _(intended tradeoff)_ `commitHash = keccak(isUp,
predictedUpBps, salt, voter, …)` is public at commit time, so an epoch-1 voter can
  _prove_ their vote+prediction to a cartel (or a paid-vote market) during the blind
  phase — the recipient verifies against the on-chain hash. Tlock stops passive
  observation but not active coordination; the 4:1 epoch weighting is the only herding
  defense that survives. Compounding: drand secrecy is pure trust — a League-of-Entropy
  threshold compromise silently decrypts all epoch-1 ciphertexts (emitted in full
  on-chain) with no on-chain detection. The literature flags this as the sharpest
  composite attack (see below).
- **Tlock ciphertext-to-commitment binding is unproven: ~1 LREP buys a settlement delay,
  and in a thin round, a free 24-hour content stall.** _(intended tradeoff)_ The contract
  validates only the stanza shape, not that the ciphertext decrypts to the committed
  plaintext (explicitly accepted). A garbage ciphertext defeats the keeper reveal path and
  blocks settlement through the reveal-grace window. Worst case (the griefer is the 3rd of
  3 voters): only 2 reveals land, settlement is impossible, the round finalizes
  RevealFailed only after grace×24 (~24h), **all unrevealed stakes including the griefer's
  are refunded** (so the "stake is forfeited" framing oversells the backstop), and the
  content can open no new round meanwhile — a free, repeatable latency grief on any
  thin-market content. No fund loss, but a near-free erosion of the fast-results promise.
- **Money-lane sybil economics rest on an optimistic off-chain oracle with small bonds.**
  _(intended tradeoff)_ The independence multiplier that neutralizes sybil clusters in
  USDC claims is computed off-chain and lands as a challengeable merkle root from a
  1,000-LREP-bonded operator, challengeable for 5 USDC. The same optimistic root family
  now also gates the public rating, with a separate `PAYOUT_DOMAIN_PUBLIC_RATING` root
  and no reward-pool id. The single mechanism that makes 50 wallets unprofitable in the
  money lane and prevents raw-headcount rating movement is a social/optimistic process,
  not a cryptographic or fully collateralized one; behaviorally-decorrelated sybil farms
  on open-eligibility pools evade clustering and earn ~1× floor shares each. Documented
  model, but the scorer-evasion economics and the load-bearing honest-challenger
  assumption are unquantified.
- **Bounty volume-farming: the per-claimant weight band (1×–2×) can't outweigh headcount.**
  _(intended tradeoff)_ Adding one revealed sybil adds a full ~1× share; the funder
  exclusion is identity-keyed and fresh-wallet-bypassable; a $0.03 minimum pool means a
  fabricated, settled public rating costs ~3% fee + gas. The on-chain layer is accounting;
  the economics live in the off-chain scorer.
- **A competitor can read confidential material at near-zero cost.** _(intended tradeoff)_
  The shipped gate is: any Orb human + free terms signature + (refundable) bond. No asker
  allowlist, no reputation/stake threshold, no cohort cap. The entire deterrence stack
  targets _republication_; it cannot touch _absorption_. A games/hardware competitor buys
  legal terms-compliant viewing of a rival's pre-launch material for the time-value of a
  ≤100-USDC bond that is returned — they never leak, so nothing is slashable. For exactly
  the "under wraps" segment the use-case doc targets, this is the weakest point against the
  most motivated adversary; the absorption risk is omitted from the marketing caveats.
- **At reviewed HEAD, the whitepaper contradicted the shipped confidentiality design, and
  "operator reads everything" was not stated asker-facing.** _(flaw; copy remediated
  2026-06-13)_ The whitepaper build simultaneously said gated context exists and listed it
  under Future Directions / "the current design assumes public context URLs." The honest
  framing (server reads every byte; a server compromise discloses everything; nothing stops
  a phone camera) appeared only rater-side and in the internal plan — the submit-form
  tooltip told the _asker_ the context "stays private forever" with zero qualification.
  A follow-up copy pass now states the operator-trust model in the whitepaper, Ask and
  agent handoff tooltips, landing FAQ, public docs, SDK/agent docs, `llms.txt`, and the
  machine-readable RateLoop skill.
- **The attribution/evidence chain is operator-trust end-to-end; log roots are unanchored
  and mutable.** _(testnet-acceptable, with a flaw inside)_ Watermarks are croppable
  corner overlays; the access log, view tokens, and HMAC secret live in the operator's
  Postgres; the daily Merkle "log roots" are stored in the _same_ DB with `artifactUrl:
null`, never anchored on-chain, and `onConflictDoUpdate` lets past epochs be silently
  rewritten — including mid-dispute. So a slash dispute reduces to "trust the operator's
  screenshot," exactly what the team's own plan said it must never reduce to. The
  unanchored gap is acknowledged; the _mutable_ root table is an unacknowledged flaw even
  within the interim design, and the daily root job currently provides zero evidentiary
  value.
- **The breach governance loop: free public accusations, no reporter bond, unbound
  evidence hash.** _(testnet-acceptable)_ Filing a breach report needs only a gated-context
  session — no stake, no bond — and the accused identity-key is listed publicly as
  "reported"; compare the 5-USDC payout-challenge bond. On-chain `evidenceHash` is an
  arbitrary non-zero `bytes32` bound to nothing verifiable. Zero-cost reputational griefing
  of raters, with a 50% reporter bounty that also rewards speculative accusation volume.
  Bond caps keep extractable value small, but the accompanying ban destroys earning power
  worth far more to the victim.

### Low severity (selected)

- **Surprise weighting uses a global trailing base rate, not a per-question prior** —
  injecting a small systematic cross-question contrarian bias into the same ballot that
  sets the verdict; bounded 2:1 and confined to the off-chain layer.
- **Epoch-weighting and score-spread machinery are near-dormant at default settings**
  (single-epoch 20-min rounds, threshold-truncated, forfeit-free) — the 4:1 anti-herding
  dynamic the docs describe isn't the operative protection for typical rounds.
- **Challenging the payout/rating oracle is EV-negative for a third-party watcher** — a
  successful challenge returns only the 5-USDC bond; the only upside is a discretionary
  governance slash bounty in LREP. The realistic security model is "the operator watches
  itself plus the arbiter," which the contract header admits but `how-it-works.md`
  overstates ("catching a bad root pays").
- **Liveness is an unfunded mandate** — the settlement-caller incentive (1% of forfeits,
  zero below 8 reveals) pays the modal settler nothing; the operator subsidizes everything.
  Graceful degradation exists, but unshepherded rounds' payout latency degrades from 12–24h
  to indefinite. (Partly mitigated: the 3% frontend fee aligns the entity expected to run
  the keeper.)
- **Fixed 1,000-LREP frontend bond doesn't scale with the value a proposer gates**;
  **seed-expiry escape hatch** lets a finalize stall past 8191 blocks degrade a round's
  reward economics to a refund (losers prefer this); **verdict is stake-weighted majority
  opinion** with a no-decay cumulative rating (early evidence is permanent — good against
  late manipulation, bad for tracking genuine quality drift); **eligibility masks use OR
  semantics** (a multi-bit mask buys the _weakest_ selected tier; no AI-only mask is
  expressible); **"one human = one identity" is a SEEDER operator claim at launch** (9
  seeded legacy addresses persist into mainnet by design); **ban due process** has no
  bonded third-party challenge and the same DAO is the only appeal venue; **disclosure
  default** was remediated after review: agent/x402 gated-context requests now default to
  `private_forever` when the policy is omitted, while explicit `after_settlement` and the
  legacy `private_until_settlement` alias remain supported; and several **secondary
  confidentiality erosions** (permanent global ban-nexus, no access time-boxing, gated
  _text_ unattributable, AI raters excluded from gated rounds).

---

## External literature grounding

The literature researcher's survey independently predicts three of the four seams and
sharpens the collusion analysis:

- **RBTS guarantees are binary, common-prior, and expected-value.** Witkowski–Parkes is
  strictly incentive-compatible for n≥3 _for binary signals_ — which RateLoop uses, a good
  match. But the guarantees assume a shared common prior, require honest reporting of _both_
  a signal and a prediction, and are expected-value statements that weaken under
  stake-scaled (non-linear-utility) payouts — exactly the 1–10× band RateLoop uses. There
  is essentially **no established theory giving truthfulness guarantees for stake-weighted
  peer prediction** (this is a genuine open gap, cf. Stochastically-Dominant Peer Prediction,
  arXiv 2506.02259). And empirical results are cautionary: a 2025 registered report (n=877)
  found BTS incentives did _not_ improve truthful reporting — the second failed replication.
- **Tlock prevents withholding but not bribery.** drand/tlock is well-specified and
  Kudelski-audited with no public early-decryption incident, but security reduces to "fewer
  than threshold-t LoE nodes collude." Critically, a briber doesn't need the reveal: the
  voter hands over plaintext + encryption randomness and the briber re-encrypts to verify
  the on-chain ciphertext — **commitments are provable to third parties pre-reveal**, and
  TEE "Dark DAO" tooling (IC3 2018; Austgen et al. 2023) operationalizes trustless,
  deniable vote-buying. Combined with the ≥50%-coalition failure of peer prediction, **a
  bribery cartel that can verify member commits pre-reveal is the single most coherent
  composite attack on the design** — and it directly defeats H3's only backstop (the blind
  epoch).
- **Every comparable token-weighted oracle has a documented sub-50% or bribery break.** UMA
  flipped a Polymarket market at ~25% of votes under apathy and then _abandoned open token
  voting_ (whitelisted ~37 voters). Augur's integrity holds only while REP cap exceeds open
  interest. Kleros juries are vulnerable to p+ε bribery. The empirical lesson: the _effective_
  attack threshold is far below 50% given voter apathy, and a bond securing a payout must
  scale with the value at stake.
- **An LLM rater crowd violates peer prediction's independence assumption.** Frontier-model
  errors are _correlated and converging_ (more correlated for more accurate models and
  shared architectures, arXiv 2506.07962), so adding LLM raters drives ensemble error to a
  non-zero floor, not zero — a monoculture can manufacture a confident wrong majority that
  BTS _rewards_. Peer prediction does partially separate honest from deceptive LLM reports
  (arXiv 2405.15077, 2601.20299) — **but only while deceivers stay a minority; past ~50% it
  provably rewards coordinated deception.** This is the direct theoretical statement of H3
  for the pure-AI fast tier, which has no on-chain way to distinguish 50 agents from one
  operator with 50 keys.
- **World ID raises but does not eliminate sybil cost.** A documented black market exists
  (iris scans ~$30, KYC accounts ~$0.50 in 2023); a current rental price for an active
  proof-of-personhood wasn't found (flagged uncertain). Treat World ID as a real but
  rentable scarcity, which is exactly how RateLoop's non-gating design uses it.

**Net:** the cryptographic layer is sound and the RBTS + capped-stake + proof-of-personhood
stack is thoughtful and literature-aware. The four under-defended seams the evidence
converges on are (1) binary/expected-value RBTS guarantees don't extend to stake-weighted
settlement; (2) tlock doesn't stop provable-commit bribery; (3) every comparable oracle
breaks below 50% under apathy; (4) an LLM crowd isn't the independent-signal crowd peer
prediction needs. RateLoop's safety rests on keeping any coordinated/bribed/monoculture
bloc below half of _effective stake-weighted_ power per round — a threshold that
stake-weighting, voter apathy, and credential rental all erode.

---

## Refuted candidates (for the record)

- **"The protocol-wide earning ban only excludes the verified lane / per-rater watermarking
  doesn't exist."** Refuted: per-view HMAC watermarks, the on-chain nexus, and the
  one-World-ID-per-human ban are all real; a value ceiling _is_ communicated ("do not use
  for private secrets"). Recalibrated to the low-severity residue (gated _text_ lacks an
  inline watermark; the landing FAQ omits the "not for secrets" caveat).
- **"The 'ban applies even at bond=0' promise has a dead link."** Refuted: governance holds
  `ACCESS_RECORDER_ROLE` and the test suite demonstrates the intended path (governance
  records the nexus at arbitration time, then bans) — so bond-0 view-only leakers _are_
  bannable. The residual is that `recordAccessNexus` requires no proof of access, making the
  "governance cannot ban arbitrary identities" constraint a soft procedural speed bump
  rather than a hard one.

---

## Recommendations, prioritized for mainnet

**Gate items (resolve before a mainnet that markets agent-decision / acceptance-oracle use):**

1. **Give small rounds economic teeth without arming majorities (H1/H3, RBTS-inert).**
   Options: a small protocol-funded base reward pool so honest reporting pays even below 8
   reveals; a minimum verdict-flip cost that scales with the rating's claimed authority; or
   raising the default quorum for rounds whose result is marketed as decision-grade.
   Crucially, add a **concentration-aware backstop on the LREP forfeit rail** (cap forfeits
   or route them to treasury when revealed stake-weight is concentrated) so the ≥8-voter
   collusion path stops being profitable.
2. **Done after reviewed HEAD: add an independence/correlation defense to the public
   rating itself.** The cluster oracle now publishes a separate public-rating root with
   per-rater effective weights, and `ContentRegistry` keeps the rating pending until that
   root finalizes. Normal latency is one shared 2-hour optimistic window plus keeper/tx
   time because the epoch and rating root can be co-proposed; the UI marks the rating as
   pending during that interval. This closes the raw-headcount public-rating issue, but
   not the separate small-round verdict issue in item 1.
3. **Give at least one settlement-layer deterrent exogenous value (H2).** A USDC component
   in vote stakes or forfeits, a fee switch that backs LREP, or explicitly scoping the
   security claim to "while LREP has market value" — but the claim and the mechanism must agree.
4. **Finish the confidentiality evidence work.** The copy portion is fixed: the
   whitepaper contradiction is gone, askers now see "the operator can read gated bytes;
   this is deterrence, not secrecy" framing, and agent/x402 defaults now align with
   `private_forever`. The remaining gate item is to make the log-root table
   **append-only and anchored** before any mainnet gated-content marketing — without it,
   no slash dispute is defensible.

**Strongly recommended:**

5. **Done:** use a **leave-one-out mean** in the RBTS payment benchmark. This fixes the
   whale self-benchmark issue; the separate non-affine payoff-shape caveat remains.
6. Reprice or rate-limit the **tlock garbage-ciphertext grief** (scale the grace-triggering
   stake, or forfeit even on reveal-failed when the round otherwise had quorum) so a thin
   content can't be stalled 24h for ~free.
7. Add a **reporter bond** to breach filing and **bind `evidenceHash`** to a published,
   precommitted artifact.
8. Replace the imperative multi-mapping identity state with an **explicit lifecycle-state or
   append-only history** model, given it has needed repeated emergency repair.
9. Fund **third-party keeper/challenger incentives** for rounds outside the operator's own
   frontend, or state plainly that operator liveness is a trusted service.

**Worth doing, lower urgency:** per-question/per-category surprise priors; value-proportional
or fee-funded frontend bonds; the SDK disclosure default flip; AI-only eligibility mask;
documenting the no-decay rating's drift limitation and the small-round "feedback signal"
property in user-facing copy.

## Sources

Repo: file:line references throughout at HEAD `3d58264b` (RoundVotingEngine, RoundRevealLib,
RobustBtsMath, RewardMath, TlockVoteLib, RatingMath, VotePreflightLib, QuestionRewardPoolEscrow\*,
ConfidentialityEscrow, RaterRegistry, ClusterPayoutOracle, FrontendRegistry, LaunchDistributionPool,
RateLoopGovernor, ProtocolConfig, Deploy.s.sol; public docs `how-it-works.md`, `ai.md`, `sdk.md`,
whitepaper `sections.ts`; internal `private-context-plan-2026-06.md`, `use-cases-2026-06.md`,
`agent-to-agent-acceptance-oracle-2026-06.md`).

External (selected): Witkowski & Parkes, _A Robust BTS for Small Populations_ (AAAI 2012);
Radanovic & Faltings, _RBTS for Non-Binary Signals_ (AAAI 2013); Gao, Wright & Leyton-Brown,
_Trick or Treat_ (EC'14); Neville & Williams, BTS registered report (AMPPS 2025);
_Stochastically Dominant Peer Prediction_ (arXiv 2506.02259); Gailly, Melissaris & Romailler,
_tlock_ (ePrint 2023/189) + Kudelski audit; IC3 _On-Chain Vote Buying / Dark DAOs_ (2018) and
Austgen et al. (arXiv 2311.03530); UMA/Polymarket March-2025 governance-attack reporting and
UMIP-189; Augur v2 (arXiv 1501.01042); Kleros p+ε analyses; MTurk quality-crisis literature;
Worldcoin black-market reporting (CoinDesk/Gizmodo/The Block 2023); Verga et al. _Replacing
Judges with Juries_ (arXiv 2404.18796); Wu, Hashimoto et al. _Correlated Errors in LLMs_
(arXiv 2506.07962); Lu et al. (arXiv 2405.15077); Qiu, Carroll & Allen (arXiv 2601.20299).
Scale/rental figures carry uncertainty flags in the underlying research.
