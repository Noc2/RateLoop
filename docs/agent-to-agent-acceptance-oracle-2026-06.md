# Agent-to-Agent Work Acceptance Oracle — Deep Dive (2026-06)

> Status note: this is a pre-single-duration redeploy research snapshot. Timing and
> config examples that mention separate epochs, maxDuration, or 20-second fast
> floors are historical and should be re-verified against the fresh deployment
> before being used as current product guidance.

Expansion of use case 6 from `use-cases-2026-06.md` (PMF 6, speculative). Three
research passes inform this doc: a code-level trace of the actual round latency
budget and integration surfaces at HEAD, a trace of the x402 ask flow and results
path, and external research on ERC-8004/ERC-8183, Virtuals ACP, the x402 escrow
ecosystem, and competing acceptance-verification approaches (June 2026). All
contract references are code-verified; external figures carry sources and
uncertainty flags noted inline.

## TL;DR

The slot is real and still empty: every standardized agent-commerce mechanism —
ERC-8004's Validation Registry, ERC-8183's Job evaluator, ACP's evaluation phase —
**deliberately externalizes the incentive/slashing layer and ships counterparty
self-evaluation as the default**. RateLoop's commit-reveal, stake-weighted,
peer-prediction-scored round is the right shape for that socket, and it sits in a
latency band nobody occupies (minutes-scale independent judgment, between "instant
but trust-me" and UMA's 2-hour optimistic window). Code-verified at HEAD: for
first mainnet deployment, the codebase supports a **20s configurable epoch
floor**, putting a keeper-driven 3-rater round around **~90–150 seconds
ask→readable result** and the self-finalized fast lane around **~40–55 seconds**
once standing AI raters exist. That 3-rater path is the launch feedback tier,
not the decision-grade target. Below that, the commit-reveal mechanism itself is
the bound — and the right answer is not to shrink it further but to pair it with
an optimistic-acceptance pattern (instant release, RateLoop round only on
dispute).

The cheapest remaining unlocks are not latency at all: **the binary verdict
(`upWins`) is now exposed on-chain as the trailing `roundCore` verdict flag**.
The canonical tuple is `(startTime, state, voteCount, revealedCount, totalStake,
thresholdReachedAt, settledAt, upWins)`, so trustless escrow adapters can read
the settled direction without relying on events; and the
"don't settle external financial contracts" disclaimer ships in every result
package, so the product is advisory-only until a scoped carve-out exists.

---

## 1. The use case

Agent A buys a deliverable from agent B (code, research, content, a trade
execution, an API integration). Neither side trusts the other's self-evaluation:
the buyer judging its own purchase has a refund incentive, the seller grading its
own work has a release incentive, and both are agents whose judgment can be
prompt-injected by the artifact under review. A neutral, fast, incentive-aligned
third party must decide "did B deliver what A specified?" — and that verdict
should (a) release or refund escrow and (b) accrete into B's portable reputation.

This is structurally different from RateLoop's other use cases: third-party
judgment is not a quality upgrade here, it is **required by the trust topology** —
the buyer cannot run the jury because the buyer is a counterparty.

### Why the slot is empty (external research, June 2026)

- **ERC-8004 (Trustless Agents).** Live reference contracts since ~Jan 2026
  (~45k agents in month one; ~86k across 18+ chains by March — secondary sources).
  The Validation Registry is the integration point: an agent calls
  `validationRequest(validatorAddress, agentId, requestURI, requestHash)`; **only
  the designated validator** can answer via
  `validationResponse(requestHash, response 0–100, responseURI, responseHash, tag)`,
  with multiple responses per request explicitly supporting **soft → hard
  finality**. The spec states verbatim: *"Incentives and slashing related to
  validation are managed by the specific validation protocol and are outside the
  scope of this registry."* No shipped stake-and-slash validation protocol was
  found live on the registry as of June 2026 (absence-of-evidence flag). Note the
  Validation Registry itself is still "under active update" per the contracts
  repo — track the revision before building against it.
- **ERC-8183 (Agentic Commerce, draft Feb 2026)** standardizes exactly the
  missing escrow: a Job (Open → Funded → Submitted → Completed/Rejected/Expired)
  with single ERC-20 escrow and **a single evaluator address fixed at job
  creation** that exclusively calls `complete()`/`reject()`. The evaluator may be
  "an AI agent, a ZK verifier contract, a DAO, or the client itself"; the spec
  has **no evaluator compensation and no anti-collusion mechanism** ("application-
  layer solutions include staking requirements, reputation systems, and
  multi-evaluator governance"). A RateLoop adapter contract is a textbook fill
  for that evaluator address.
- **Virtuals ACP** (18k+ agents; Ethy alone 2M+ processed transactions; Revenue
  Network paying up to $1M/month to selling agents): the evaluation phase exists,
  but *"an Evaluator is an optional, neutral Agent… if not specified, the Buyer
  Agent assumes this role"* — counterparty self-evaluation is the default, and
  evaluator selection/compensation is undocumented. Virtuals' own docs concede
  evaluators "might struggle to confidently validate" natural-language
  deliverables. No third-party staked evaluator marketplace found on ACP.
- **x402 escrow wave**: x402 itself is atomic pay-per-request (~$0.27 avg
  transaction per KPMG's 161M-txn/$43.6M figures — sources conflict up to 10×,
  treat scale claims cautiously). The "hold funds until verified" gap is being
  filled by escrow wrappers (Kustodia — "the missing escrow layer for AI agents
  and x402", PayCrow, Settle, dealwork.ai), but **all resolve via buyer approval
  or a single designated arbiter** — none provide independent multi-party
  judgment.
- **The competition by latency band**: x402 atomic (instant, no recourse) → ACP
  buyer/evaluator approval (minutes, weak independence) → UMA optimistic (2-hour
  default challenge window, DVM escalation ~48h) → Kleros (days, dozens of
  dollars per case, 508 total curation disputes ever — a dispute layer, not an
  acceptance layer). **A minutes-scale independent rating round is an empty
  band.** Adjacent threats: EigenCloud's verifiable-agents stack (strongest
  infra-level competitor, but aimed at objective re-execution/policy enforcement,
  not subjective deliverable quality) and the "insure it instead of verifying it"
  framing (Agentic Risk Standard paper, whose co-author also authored ERC-8183).
- **Why a single LLM judge doesn't fill it**: prompt-injection attacks on judge
  LLMs reach up to 73.8% success with 50–63% cross-model transfer; the
  literature's own recommended mitigation is diverse multi-model committees —
  i.e., the panel-of-raters design RateLoop already is, with stakes and
  commit-reveal independence on top.

## 2. What RateLoop offers today (code-verified)

**Works now, no changes:**

- Per-question round config down to **epoch = maxDuration = 20s, minVoters = 3**
  (`ProtocolConfig.sol`; defaults are 20 min but config is per-question
  at submission).
- AI raters are first-class on public questions: `RaterType.AI`, normal
  stake+vote, no human credential required (`VotePreflightLib.sol:127-139`),
  bounty-eligible under open eligibility.
- x402 ask flow: 3 HTTP round trips + 2 txs (reserve ≥1s aging + EIP-3009 atomic
  pay-and-submit) ≈ **~5s ask-side**; the round opens lazily with the first
  rater's `openRound`.
- **Reveal and settlement are permissionless** (`RoundVotingEngine.sol:981,996`),
  and the reveal is keyed by the drand tlock ciphertext — anyone holding the
  decryption key (public at epoch end + ≤6s) can reveal any commit.
- Results: on-chain `roundCore` state flips to Settled in the settle tx; agents
  read the full result package (verdict classification, distributions,
  `pollAfterMs: 5000`) via MCP/x402 from Ponder (5s polling); HMAC-signed
  webhooks exist (`question.settled` etc.) but delivery is operator-cron-driven,
  not push.

**Latency budget for a 3-AI-rater round (epoch 20s), decomposed:**

| Component | Keeper-driven today | Self-driving agents today | Bound |
|---|---|---|---|
| Ask (reserve + EIP-3009 submit) | ~5-10s | ~3-5s | `RESERVED_SUBMISSION_MIN_AGE = 1s`; ~2s blocks |
| Open round + 3 commits | ~4-8s | ~4-8s | rater arrival + block time |
| Blind epoch | **20s** | **20s** | configurable floor (`ProtocolConfig.sol`) |
| drand key available | +0-6s | +0-6s | quicknet 3s period × ≤2-period target tolerance (`TlockVoteLib.sol:166-182`) |
| 3 reveals | ≤30s tick + txs | ~6s | keeper tick vs self-reveal |
| Settle step 1 (RBTS seed capture) | same tick | ~2s | — |
| Settle step 2 (score + distribute) | **+30s** (next tick) | **~2s** | hard: `block.number > seedBlock` (+1 block); soft: keeper tick |
| Verdict readable | +5-10s (Ponder) | 0 (chain) / +5-10s (API) | Ponder 5s polling |
| **Total** | **~90-150s** | **~40-55s** | keeper ticks vs self-finalization dominate |

**What's missing (the build list):**

1. **No verdict-keyed escrow.** `QuestionRewardPoolEscrow` is voter-bounty escrow
   only — qualification checks `Settled`, never the side; nothing releases
   third-party funds on an outcome. The engine now exposes the canonical
   direction through `roundCore(contentId, roundId)`, whose tuple is
   `(startTime, state, voteCount, revealedCount, totalStake, thresholdReachedAt,
   settledAt, upWins)`. The trailing `uint8 upWins` flag is `1` for UP and `0`
   for DOWN. A future escrow can trustlessly gate release/refund on
   `state == Settled` plus that flag instead of proving or trusting
   `RoundSettled` logs. Pools/counts remain internal/event/indexer surface,
   which is fine for this use case because the escrow only needs the settled
   side.
2. **The disclaimer.** "Settled RateLoop scores must not be used to settle
   external financial contracts" ships in every agent result package
   (`resultPackage.ts:543`), MCP outputs, install snippets, docs, and the
   whitepaper ("not a settlement oracle"). Until a scoped carve-out exists, the
   product is advisory-only — which is also the correct first posture (see §5).
3. **No AI-only eligibility mask** — bounty eligibility bits are human-credential
   bits only (`QuestionRewardPoolEscrowTypes.sol:4-10`); pure-AI fast rounds are
   social convention, not enforced. Gated (confidential) rounds exclude AI raters
   entirely — relevant because A2A deliverables are usually confidential.
4. **Small-round economics are deliberately soft**: 3-voter rounds are the
   launch feedback tier, not the permanent security target. Score-spread LREP
   forfeits require ≥8 reveals (`RewardMath.sol:17,95`), pools ≥1,000 USDC
   require ≥5 voters on-chain, and governance can raise default and minimum
   voter floors for new asks as rater supply grows. A binding acceptance verdict
   with real money should not ride a 3-voter feedback-signal round.

## 3. Optimizations: reducing voting time

The user-visible question is "how fast can a round answer?" — broken into tiers
by what they cost.

### Tier 0 — Product work on the 20s floor (~40-55s self-finalized)

The keeper's two 30s-tick waits are the bulk of the gap between keeper-driven
~90-150s and self-finalized ~40-55s.
Since reveal and both settle steps are permissionless, **the asking agent (or the
RateLoop SDK on its behalf) should self-drive the endgame**: fetch the drand key
at epoch end (+≤6s), submit the three reveals (~6s), call `settleRound` twice
(+1 block between). Ship this as an SDK "fast finalize" option —
`awaitVerdict({selfFinalize: true})` — rather than asking integrators to
reimplement keeper logic. Cheap supporting tweaks: lower `KEEPER_INTERVAL_MS`
(env-only) for a dedicated fast-lane keeper, and run the webhook
deliver/sweep cron at a few seconds for `question.settled` push.

### Tier 1 — Config + product, no further contract changes (standing rater fix)

- **Standing AI-rater pool with push notification.** The 20s epoch clock starts
  at `openRound` (first rater), so *rater arrival* is the hidden variable today —
  there are no supply-side notifications. A registry of standing fast-lane AI
  raters that receive a push (webhook/queue) on `question.open` and commit within
  ~5s makes the latency table real. Without it, every other optimization is
  irrelevant.
- **Single-epoch rounds** (`maxDuration == epochDuration`) are already optimal —
  settlement doesn't wait for `maxDuration` once `revealedCount ≥ minVoters`.
- **Batch reveals** in one multicall (keeper currently sends sequential confirmed
  txs per commit) — shaves a few blocks.

### Tier 2 — Mainnet-ready contract floor: 20s epochs (~40-55s total)

`minEpochDuration ≥ 20 seconds` is now the code-level floor. Because nothing is
deployed in production yet, mainnet can launch with this bound instead of doing a
later proxy upgrade. The real physics under it:

- drand quicknet period 3s, and the config already enforces
  `drandPeriod ≤ minEpochDuration`; the tlock target lands at epoch end + ≤2
  periods (≤6s).
- Base-compatible ~2s blocks; commits must land inside the epoch, so the epoch must
  comfortably exceed (rater arrival + commit tx inclusion) — with a push-notified
  standing pool, ~10s of margin suffices.
- Frontend fallback constants now advertise the 20s floor, while human-facing
  controls can still choose minute-scale defaults for normal public questions.

A **20s epoch** is the conservative fast-lane floor: 20s blind window + ≤6s
drand + ~8s reveals/settle/+1-block + ~5s ask-side ≈ **~40-55s ask→verdict**
with self-finalization. This is ~6.7× the 3s drand period and leaves real
commit-inclusion slack; below ~20s, chain congestion starts
turning latency wins into liveness failures (RevealFailed refunds).

What is **not** worth doing at this tier: per-question keeper priority (the
self-finalize SDK path makes the keeper a fallback, not the critical path).

### Tier 3 — Structural changes (evaluate before building)

- **Quorum-based early close is structurally impossible** in the current design,
  and this is worth stating clearly in any roadmap discussion: reveals are
  timestamp-gated on-chain to epoch end (`RoundRevealLib.sol:99-103`) **and** the
  tlock decryption key physically does not exist before the target drand round —
  even a voter who knows their own plaintext cannot reveal early. "Settle as soon
  as all N commits are in" would require commits to re-bind to an earlier drand
  round once the quorum lands — incompatible with current target-round validation
  and with the anti-copying rationale of the blind epoch. Treat the epoch as the
  irreducible cost of independence.
- **An instant advisory lane** (sub-10s): signed off-chain votes from a standing
  panel, aggregated and posted as a batch attestation. Note
  `AdvisoryVoteRecorder` is *not* this — it uses the same tlock blind-epoch
  structure (zero-stake, but commits close at epoch end and reveals open after
  it), so it's a free parallel signal, not a faster one. A true instant lane is
  new construction and gives up commit-reveal independence (a fast LLM-judge
  ensemble with RateLoop branding). Only worth it as the "soft finality" leg of
  the ERC-8004 adapter (instant advisory score → `validationResponse` update →
  hard finality from the settled round), never as a standalone product — the
  independence mechanism *is* the product.
- **Optimistic acceptance + RateLoop dispute round (recommended pattern instead
  of chasing sub-30s).** For high-volume/low-value A2A jobs, even 40s inline is
  worse than: release escrow optimistically at delivery; either party can
  dispute within a window by funding a RateLoop round (20s-epoch fast round or
  8-voter human round by value tier); verdict routes the escrow + a
  loser-pays-the-round fee. This matches the UMA pattern but replaces the 2-hour
  liveness window + token-holder vote with a minutes-scale independent round —
  and it means RateLoop only needs to be *fast enough for disputes*, which Tier
  0-2 already delivers. It also sidesteps per-job round costs at scale (rounds
  only on the ~1-5% disputed tail).

### Latency summary

| Configuration | Ask→verdict | Requires |
|---|---|---|
| 20s floor, keeper-driven | ~90-150s | deployed fast config + existing keeper |
| 20s floor, SDK self-finalize | ~40-55s | SDK work + standing rater pool |
| Optimistic + dispute round | ~0s happy path; dispute = above | adapter/escrow contract |
| Instant advisory lane | ~5-10s, non-binding | new construction; weaker guarantees |

## 4. Integration architecture (what to build, in order)

1. **ERC-8004 Validation Registry adapter.** A `RateLoopValidator` contract that
   (a) accepts `validationRequest`s where `requestURI` carries the question spec
   + acceptance rubric and `requestHash` binds the deliverable hash, (b) opens a
   RateLoop question (or verifies one opened off-chain matches the requestHash),
   (c) posts `validationResponse` with `response = ratingBps/100` — optionally an
   early advisory soft-finality response followed by the settled hard-finality
   response, which the registry explicitly supports. This is the cheapest
   credible market entry: the registry is live, indexed by reputation layers
   (RNWY etc.), and nobody staked-and-slashing occupies it. Caveat: the registry
   is still being revised — build behind a thin interface.
2. **ERC-8183 evaluator contract.** The Job standard fixes a single evaluator
   address at creation; a RateLoop evaluator contract maps Job →
   question → settled verdict → `complete()`/`reject()`. Watch the draft's
   adoption before investing past a prototype; the same contract core serves
   both this and a Kustodia/PayCrow-style escrow partnership (those wrappers
   need exactly an independent arbiter API).
3. **ACP evaluator agent.** Software-only (no contracts): register a RateLoop
   evaluator agent on Virtuals ACP that accepts evaluation phases and answers
   them by buying a RateLoop round. Rides ACP's existing volume; also the
   fastest way to learn real acceptance-rubric shapes and price points.
4. **Verdict-keyed escrow of our own** — only after 1-3 show demand. The
   optimistic-acceptance contract (§3 Tier 3) is the version worth building.

## 5. Product decisions the use case forces

- **The disclaimer needs a scoped carve-out, staged.** Phase 1: keep
  advisory-only — the ERC-8004 adapter posts scores into reputation, ACP
  evaluator returns recommendations, escrow release stays the counterparties'
  contract reading a public signal (their decision, not RateLoop "settling" the
  contract). Phase 2: an explicit "binding acceptance" question class with its
  own terms: value caps, minimum round economics (below), and both parties'
  pre-signed agreement to abide. Don't silently delete the disclaimer — it
  encodes a real distinction between feedback signals and payout instructions
  that the small-round economics justify.
- **Tier round economics to escrow value.** A 3-voter launch feedback-tier round
  (no score-spread forfeits below 8 reveals) is fine for advisory and for
  optimistic-dispute triage; binding release above meaningful value should
  require the 8-reveal economic threshold (where forfeits activate). The
  existing on-chain participant floors (≥5 voters at ≥1,000 USDC, ≥8 at
  ≥10,000) point the same direction. Publish this as an acceptance-tier table.
- **AI-only eligibility mask + operator diversity attestation.** A2A acceptance
  at minutes-scale means AI raters — but AI raters have no World ID. The sybil
  story for the fast tier is stake + identity-key bans + (to build) operator
  attestation and model-diversity disclosure, and the human tier as escalation.
  Without the mask, a "fast AI round" can be quietly stacked by the seller's own
  wallets; with stake floors and ban enforcement it's costly but not impossible.
  Be honest about this in docs: fast tier = economic security, human tier =
  identity security.
- **Confidential deliverables collide with the human-only gate.** Gated rounds
  require a human credential (`VotePreflightLib.sol:118-119`), so confidential
  A2A acceptance currently can't use AI raters at all. Decide whether
  credentialed/attested AI operators may enter gated rounds, or position
  confidential acceptance as human-tier-only (slower, premium).
- **Prompt-injection defense is a selling point — say so.** The deliverable under
  review is attacker-controlled input to every rater. Commit-reveal independence,
  rater diversity, and stake/slash are the mitigations the LLM-judge literature
  recommends; publish an injection red-team result for the fast tier.
- **The counterparty-can't-vote check exists but is thin for A2A**: the submitter
  can't vote on their own question, but the *seller* is not the submitter — the
  buyer is. Nothing stops the seller's operator wallets from voting. For
  acceptance questions, add an excluded-addresses list (both counterparties +
  declared operator wallets) to the question config — small contract/product
  change, large credibility gain.

## 6. What makes sense vs. what doesn't

**Do:**
1. SDK self-finalize (Tier 0) — ~80s rounds this quarter, no protocol risk.
2. ERC-8004 validator adapter + ACP evaluator agent as the two market probes;
   advisory-only, disclaimer intact.
3. Standing fast-lane rater pool with push notifications (this is also the
   missing piece for use case 2's judgment gates — shared investment).
4. Ship 20s fast-lane presets, gated on the standing pool existing.
5. Design the binding-acceptance tier (carve-out terms, economics table,
   counterparty exclusion) but ship it only when a probe shows pull.

**Don't:**
- Chase sub-20s binding rounds — the blind epoch is the product, not overhead;
  below ~20s, liveness failures replace latency. The instant lane belongs inside
  the optimistic-dispute pattern, not as a standalone oracle.
- Build a proprietary A2A escrow before the adapters prove demand — ERC-8183 and
  the x402 escrow wrappers want to own that layer; being their evaluator is
  higher-leverage than competing with them.
- Quorum-based early settlement — structurally incompatible with tlock; any
  design that re-binds commits to earlier drand rounds reopens the copying
  attack the epoch exists to prevent.

**Honest caveats on the PMF 6 (speculative) rating:** evaluator pricing is
genuinely unset (no market rate exists for agent-work evaluation as of June
2026); ACP evaluation volume is undocumented; most A2A jobs today are
cents-to-low-dollars where a per-round fee only pays for itself on the disputed
tail (hence the optimistic pattern); and the Validation Registry spec is still
moving. The probes in §4 are deliberately cheap for that reason — the expensive
investments (escrow, binding tier, sub-20s work) all wait for observed pull.

## Sources

Repo: all file:line references are code-verified against the repository HEAD at
the time of writing (ProtocolConfig.sol,
RoundVotingEngine.sol, TlockVoteLib.sol, RoundRevealLib.sol, RoundLib.sol,
VotePreflightLib.sol, QuestionRewardPoolEscrow*.sol, RewardMath.sol,
ConfidentialityEscrow.sol, keeper/src/{keeper,config,drand}.ts,
lib/x402/questionSubmission.ts, lib/mcp/tools.ts, lib/agent/resultPackage.ts,
lib/agent-callbacks/*, ponder.config.ts, docs/use-cases-2026-06.md).

External (selected): EIP-8004 (eips.ethereum.org/EIPS/eip-8004) + erc-8004-contracts
repo; EIP-8183 (eips.ethereum.org/EIPS/eip-8183); Virtuals ACP whitepaper
(whitepaper.virtuals.io) + Revenue Network PR (Feb 2026); Coinbase x402 Bazaar
docs; KPMG x402 figures via VaaSBlock (conflicting with Dwellir's $600M claim —
flagged); Kustodia/PayCrow/Settle launch posts; Kleros 2026 project update; UMA
docs (liveness/bond params); EigenCloud verifiable-agents posts; Maloyan & Namiot
arXiv:2504.18333 and arXiv:2505.13348 (judge injection); Agentic Risk Standard
arXiv:2604.03976; awesome-erc8004 list (community-curated, individual claims
unverified).
