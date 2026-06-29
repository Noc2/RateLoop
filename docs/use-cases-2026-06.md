# RateLoop Use Cases — June 2026 (revised 2026-06-11)

> Status note: this is a pre-single-duration redeploy research snapshot. Timing
> and config examples that mention separate epochs, maxDuration, or one-minute
> floors are historical and should be re-verified against the fresh deployment
> before being used as current product guidance.

A multi-agent research pass on concrete use cases for RateLoop and their product-market fit.
This is the second revision: the original pass (2026-06-07) was governed by three constraints —
public-only context, no enforced targeting, ~40-minute-plus latency — that have since materially
changed. One agent re-established the capability envelope from the repo at HEAD (219 commits
since the original review); one researched the confidential-feedback markets that private
context mode unlocks; one researched the market for minutes-scale incentive-scored AI-crowd
judgment and tiered AI→human escalation. Findings from the original pass (incumbent pricing,
demand evidence) are retained where still valid.

## TL;DR

The product changed under the analysis. Three of the original governing constraints moved:

1. **Private context is live** (Tiers 0–2 of `archive/2026-06/private-context-plan-2026-06.md`): gated
   RateLoop-hosted context behind wallet-signed confidentiality terms, watermarked and
   access-logged serving, optional asker-defined rater bond (LREP or USDC, 0 allowed), breach
   reporting with governance slash and a protocol-wide World ID identity earning ban. The
   "public-only kills confidential demand" cap is gone — and the research shows it was bigger
   than assumed: confidentiality is the *default mode* of concept testing (PickFu charges a
   discount to make polls public), so the constraint excluded the segment's core, not a niche.
2. **Targeting now carries money.** `targetAudience` is taxonomy-validated, indexed,
   agent-discoverable, reported against the revealed cohort (`targetAudienceMatch`), protected
   by a 7-day profile-change cooldown, and enforced in bounty claim weights via the
   challengeable payout artifact. Still self-reported — verified attribute tiers remain the
   binding constraint on the highest-value budgets.
3. **Latency is asker-configurable down to minutes.** Round config is per-question; the
   launch feedback tier keeps 3-voter rounds available for cold-start liveness, and governance
   can raise the default and minimum voter floors for new asks as supply grows. The protocol
   floor (1-minute epoch, drand 3s period, 30s keeper tick, two-step settle) puts a 3-voter
   round with instant raters at **~2–4 minutes ask→readable result**. Human rounds stay
   recruitment-bound (~40 min–hours) — but **pure-AI-rater rounds** unlock an entirely new
   latency class, and AI raters are already first-class on public questions (stake, vote,
   bounty-eligible under open eligibility, MCP/SDK rating tools).

The re-ranked picture: **confidential concept/creative pretesting** and a new product — the
**two-tier judgment gate** (minutes-scale AI-crowd round, auto-escalating to a verified-human
round on disagreement) — now lead. The two-tier pattern is the proven industrial standard
(content-moderation cascades cut human review volume 80–95%; 2026 multi-agent-oracle research
derives exactly this routing), it matches how buyers already think, and it converts RateLoop's
two scarce assets (World ID-verified humans + incentive mechanism) into a moat no eval platform
can copy. Nobody in mid-2026 sells independent, incentive-aligned third-party AI judgment — the
slot ERC-8004 deliberately left open.

## Capability envelope (current)

| Dimension | Status |
| --- | --- |
| Latency | Per-question `roundConfig`; human rounds ~40 min–hours (recruitment-bound; fast-lane estimator: epoch + ≥15 min); instant-rater rounds floor at **~2–4 min** (1-min epoch min, drand quicknet 3s, keeper 30s tick, 2-step settle +1 block, Ponder seconds) |
| Cost | 1 USDC floor; fast-lane guidance $0.33–0.75/rater → ~$5/10 raters, ~$12.50/25; ≥1,000 USDC bounties require ≥5 voters; gated mode unpriced; confidentiality bonds are rater-side |
| Private context | **Live end-to-end**: hosted-only gated context, wallet-signed terms (server-recorded, content-commitment-bound), sharp watermark + HMAC view tokens + access logs, append-only daily log-root artifacts with anchoring-required cron publication, artifact-bound breach evidence, bond escrow (1–100 USDC default cap, 0 allowed), breach tab + slash/ban governance actions, disclosure-after-settlement or private-forever. Gaps: no gated bundles; mainnet anchor key/role still needs operational verification; **gated rounds are human-credential-only (AI raters excluded)** |
| Targeting | Validated taxonomy + `rateloop_list_audience_options` + submit-UI picker + indexed `targetAudience` + `targetAudienceMatch` in results + 7-day cooldown + payout-artifact claim-weight enforcement. Still self-reported; consistency probes/verified tiers pending (`audience-targeting-plan-2026-06.md`) |
| Rater pool | Humans (World ID-gateable via credential masks) and AI raters (first-class `RaterType`, normal stake+vote, bounty-eligible when eligibility is open). **No AI-only eligibility mask** — pure-AI rounds are achievable socially, not enforced. Legacy contributors seeded as verified humans (supply bootstrap) |
| Accuracy-linked income | Surprise-weighted bounty claim weights live in the payout-root pipeline (herding finding mitigated); score-spread forfeits require ≥8 reveals; 3-voter launch rounds settle as feedback-tier signals, and governance can ratchet new-ask voter floors upward with usage |
| Liveness/trust | RevealFailed refunds stakes; 24× reveal-failed grace; permissionless snapshot recovery; settlement-caller incentive; oracle challenger rewards from slash proceeds |
| Agent integration | MCP (incl. confidentiality terms tool, audience options, gated context fetch), dry-run sandbox, signed public webhooks, x402-bound asks; SDK/agents packages built **but still 404 on npm** |

## Use cases (re-ranked)

### 1. Confidential creative/concept pretesting (PMF 7.5)

**What:** Names, logos, landing pages, ad creative, packaging, thumbnails, app-store assets,
game art/trailer/store-page reads — pre-launch and under wraps, bought by indie builders,
growth teams, game studios, and the agents generating the assets.

**What changed:** Private context removed the cap that mattered most. Confidentiality is the
*default condition* of this segment — Zappi is "mostly used at the pre-product stage," every
PickFu respondent signs an NDA before viewing any poll, and PickFu prices publicness at a
*discount* — so the old "public artifacts only" qualifier excluded the segment's core volume,
not its edge. New-product concept testing alone is a ~$5.6B (2025) market growing 8.7%/yr.
RateLoop's $0.33–0.75/rater against PickFu's $1+ now applies to the whole surface, with a
strictly stronger confidentiality artifact: the incumbent NDA binds a panel account (29–40% of
panel respondents are fraudulent, making many NDAs fictional); RateLoop's binds an Orb-verified
human who loses protocol-wide earning power on a proven leak and can't re-enter with a new
wallet. The games vertical has a named unmet need — practitioners state NDA enforcement is
"reactive and ineffective" and leak fear pushes studios to internal-only playtests — and
already pays for exactly RateLoop's stack (watermarks, access logs, verified-tester status),
minus the bond.

**Caveats:** Sell the bond+ban as *deterrence infrastructure* to the leak-burned tail (games,
hardware, B2B strategy); for cheap consumer polls the NDA is a checkbox and price/speed do the
selling. The **embargo default mismatches the segment** — settlement happens days before
launch, so `private_forever` / asker-triggered disclosure should be the default for
confidential asks (PickFu's norm is private-by-default). Rater-base representativeness and
cold-start remain the residual caps; targeting (live but self-reported) gates the "*my*
customer" question.

### 2. Two-tier judgment gates: fast AI round → verified-human escalation (PMF 7.5)

**What:** A new product enabled by the latency change. An agent (or CI pipeline, or publishing
system) buys a minutes-scale round answered by independent AI raters; if the round shows high
disagreement or poor calibration, it auto-escalates to a slower World ID-verified human round.
Use cases: agent checkpoint/irreversible-action gates (publish, send, merge, deploy),
pre-publish content quality/safety gates, agent-to-agent work acceptance (below).

**Why this works now:** At ~1h, external judgment was batch-only — longer than the whole CI
pipeline. At 2–5 minutes it's inline: AI CI/CD gates already run minutes-scale LLM-judge evals,
moderation stacks target sub-30-min human SLAs, and agents pausing ~3 min before a high-stakes
action is acceptable where an hour kills the workflow. The escalation pattern is the proven
industrial standard: three-zone confidence routing in content moderation (auto-action /
human-review band / pass) cuts human volume 80–95%; the 2026 multi-agent-oracle thesis derives
exactly this routing empirically (auto-resolve unanimous high-confidence verdicts — 97.87%
accuracy on 47% of questions — flag disagreement for human arbitration). Buyers already think
in these terms; RateLoop just makes the cascade purchasable per-question.

**Why RateLoop specifically:** Nobody sells *independent, incentive-aligned* third-party AI
judgment — eval platforms (Braintrust, LangSmith, Galileo, Patronus) sell self-serve ensemble
tooling where the judged party operates the judges; Chaos Labs' Edge oracle is an operated
single-company service; Kleros is a days-latency coherence game. Peer prediction had a breakout
year academically: it separates honest from deceptive LLM reports without ground truth and its
deception resistance *strengthens* with capability gap (inverse scaling) — exactly where
LLM-as-judge collapses. Commit-reveal blocks copying; stakes punish lazy reports; blind
non-interactive aggregation empirically beats deliberative consensus (which degrades below
single-model baselines). And the human tier patches the AI tier's two real failure modes —
model monoculture (frontier models agree on the *wrong* answer ~60% of the time when both err,
and BTS would reward a monoculture's shared blind spot) and prompt injection via rated content
(30–99% attack success rates against single LLM judges).

**Caveats:** Category creation — no observed buyers of paid third-party minutes-scale judgment
yet; the premium (~10–50× a self-run jury pass) is only rational at decision points, not for
continuous monitoring. Product gaps to close: an enforced AI-only/mixed eligibility config
(today pure-AI rounds are social, not enforced), escalation as a primitive (asker pre-funds a
contingent human round, triggered by dispersion/calibration — not by low score), operator/model
diversity attestation, and published calibration data (AI-round verdicts vs. subsequent
human-round verdicts — the escalation tier doubles as the trust dataset for the fast tier).
Note: gated/private-context rounds currently require a human credential, so confidential asks
can't use the AI tier yet.

### 3. Agent-purchased evidence and verification (PMF 7)

**What:** An agent mid-task pays for judgment it can't compute — source credibility, does this
citation support the claim, is this interpretation right — with a Feedback Bonus for submitted
reasons and sources. Unchanged from the original analysis and still the cleanest
mechanism-to-problem fit: x402/h402 rails converge on RateLoop's stack, Stack Overflow's human
Q&A collapsed −78% YoY and relaunched as agent infrastructure, balanced lay crowds match
professional fact-checkers (Allen et al.), and BTS crowd-scoring fixes the asker-as-arbiter
failure that killed Google Answers.

**What changed:** Fast AI rounds add a triage tier (cheap minutes-scale AI read, escalate to
verified humans for the calls that matter), and surprise-weighted bounty income strengthens the
honest-effort story. The cap is unchanged: embryonic buyer side, and "useful human answer for
$3" must beat "agent searches more" often enough to retain callers.

### 4. LLM-judge calibration sets + confidential AI eval (PMF 6.5–7)

**What:** The one human-eval purchase every small AI team must make — 50–200 human judgments
grounding an LLM judge, refreshed on every model swap — now including teams whose eval material
contains proprietary prompts or unreleased product.

**What changed:** Private context un-excludes most of the actual buyers. The previous gap was
real: between "ask coworkers" and "enterprise contract" (Surge/Scale/Mercor) there was no
purpose-built option — Prolific supports confidential studies only via DIY-NDA-inside-the-survey
with no enforcement. A gated cohort under a collateralized, identity-banning NDA is now the only
self-serve option with real teeth. LMArena's $1.7B valuation / $30M ARR remains the top-down
proof that aggregated crowd preference on AI outputs sells. Caps: these buyers were spending
~$0 (small per-deal size), binary format coarseness, no domain-expert qualification, and LLM
judges keep eating the low end — the differentiation is independence and confidentiality, not
price.

### 5. Classic market research / consumer insights (PMF 6, rising)

**What changed:** One of the two killers (confidentiality) is dead; the bigger one (validated
targeting) is half-built. Targeting now exists, is validated against the taxonomy, is reported
against the revealed cohort, and carries bounty money through the payout artifact — but it's
still self-reported, which is below the bar the high-value buyer already gets (Wynter's moat is
LinkedIn + corporate-email role verification, not its NDA; its buyers pay ~$60–100/respondent
for *proven roles*, and Wynter is a $16M-ARR bootstrapped business on exactly that). Re-rate to
~7 when consistency screening + verified attribute tiers ship; ~7.5–8 if role attestation
(zkTLS LinkedIn/work-email per the audience plan) lands. Consumer representativeness of the
Base-compatible rater base remains the structural cap.

### 6. Agent-to-agent work acceptance oracle (PMF 6, speculative)

**What:** When agent A buys a deliverable from agent B (Virtuals ACP — 18k+ agents, up to
$1M/month revenue network; x402 bounty boards), neither side trusts the other's
self-evaluation. A 2–5 minute RateLoop round acts as the acceptance oracle for escrow release,
feeding ERC-8004 reputation/validation registries. Third-party judgment is *structurally
required* here — the buyer can't run the jury because the buyer is a counterparty — which is
RateLoop's exact differentiation, and ERC-8004 (ratified ~Jan 2026) deliberately left the
"validation protocol with incentives and slashing" slot unfilled. Flagged speculative: the
agent-commerce economy is real but young; this rides its growth curve. Note the existing
"don't settle external financial contracts" disclaimer needs a carefully-scoped carve-out or
this stays advisory-only.

### 7. Rating layer for AI-written fact-checks and community notes (PMF 5.5)

Unchanged: AI bots write ~half of submitted Community Notes and unpaid human *rater* capacity is
the binding constraint; a paid, optionally World ID-credentialed, BTS-scored rating crowd is a near-exact workload
match validated by the wisdom-of-crowds fact-checking literature. Still capped by a small,
concentrated buyer set. Fast AI rounds add a pre-screen tier for note operators. Best treated as
a flagship demonstration vertical and rater-supply seed, not a volume business.

### 8. Governance temperature checks / launch vetting (PMF 4.5)

Unchanged: real adjacent spend (delegate comp, launchpad curation — Echo's $375M exit, Legion),
and World ID + BTS + commit-reveal is the anti-farming architecture in a vertical defined by
farming (Kaito Yaps' collapse). Still capped by a thin asker side that wants to earn rather than
spend, correlated-bag bias, and airdrop-farming surface. Opportunistic only. Sub-second token
risk checks remain excluded by latency even at the new floor.

### 9. Private beta / full build testing (PMF 4.5)

New entrant from the confidential-markets research, scored low deliberately: RateLoop's
thumbs+prediction format isn't bug capture, and build security is solved by streaming
(Antidote, Playruo), not rating rounds. The valuable slice — pre-announcement concept/asset/
store-page reads under leak deterrence — folds into use case 1. Don't chase Centercode
($2–4k/mo tooling) head-on.

### 10. Broad AI-lab eval / preference data (PMF 2.5)

Nearly unchanged: labs need scale, expert qualification, and contracts; Scale/Surge/Mercor own
it. Private context removes one objection, hence the half-point. The addressable slice is use
case 4.

## PMF ranking

| # | Use case | Was | Now | What moved it |
| --- | --- | --- | --- | --- |
| 1 | Confidential creative/concept pretesting | 6.5 | **7.5** | Private context opened the segment's default (pre-launch) mode; games/asset vertical |
| 2 | Two-tier AI→human judgment gates | 4 (as go/no-go gates) | **7.5** | Minutes-scale AI rounds + proven escalation pattern + empty competitive slot |
| 3 | Agent-purchased evidence & verification | 7 | **7** | Unchanged core; AI triage tier added |
| 4 | LLM-judge calibration + confidential eval | 6 | **6.5–7** | Gated cohorts un-exclude proprietary-output teams |
| 5 | Classic market research | 5 | **6** | Confidentiality solved; verified targeting still pending (→7+ when it ships) |
| 6 | Agent-to-agent acceptance oracle | — | **6** (speculative) | New: fast rounds + ERC-8004 validation slot |
| 7 | AI fact-check notes rating | 5.5 | **5.5** | Unchanged |
| 8 | Governance temperature checks | 4.5 | **4.5** | Unchanged |
| 9 | Private beta / build testing | — | **4.5** | New but folds into #1 at the viable slice |
| 10 | Broad AI-lab eval | 2 | **2.5** | Confidentiality removes one objection |

Use cases 1–4 still share the buyer (agent developer / indie builder with a funded wallet) and
the channel (MCP + x402 directories); 2 and 6 additionally ride the agent-economy growth curve.

## Cross-cutting observations

- **Targeting is now the single binding constraint on the dollars.** Confidentiality unlocked
  the rooms where the budgets sit; validated/verified targeting is what gets paid once inside
  (Wynter's buyers pay for proven roles, not NDAs). The audience plan's Phase 1.3+ (consistency
  probes, honeypots) and Phase 3 (verified tiers) carry the largest PMF deltas on the board.
- **Flip the disclosure default for confidential asks.** Settlement ≪ launch in every segment
  researched; PickFu's market norm is private-by-default with publicness discounted. Keep the
  embargo as the transparency story, sell `private_forever`/asker-triggered as the product.
- **Close the AI-round product gaps** for use case 2: enforced AI/mixed eligibility config,
  escalation-as-primitive (dispersion-triggered contingent human round), operator/model
  diversity attestation, and published AI-vs-human calibration data. Also decide whether gated
  rounds should ever admit credentialed AI raters (today: human-only), since confidential asks
  currently can't use the fast tier.
- **Monoculture and judge-injection are the trust risks of the AI tier.** Frontier models agree
  on wrong answers ~60% of the time when both err, and peer prediction pays consensus — a
  monoculture's blind spot gets *rewarded*. Injection attacks hit 30–99% ASR on single LLM
  judges. The mitigations are the product: operator diversity, commit-reveal independence,
  slashing, and the human escalation tier. Publish calibration data early.
- **Supply side is more plausible than at the original pass:** x402 settlement reached ~$600M
  annualized with seller-side agent operators actively hunting paid endpoints (477 sellers /
  4,400 buyers on the Bazaar); rating rounds are the ideal agent micro-job shape. Legacy
  contributors seeded as verified humans bootstrap the human pool. BTS + stakes must make
  cheap-wrapper farming unprofitable — that's working as designed.
- **Adoption blockers that remain:** `@rateloop/sdk` / `@rateloop/agents` still 404 on npm
  (built, release-prepped, unpublished — ship it); no gated bundles; confidentiality log-root
  anchors still need mainnet key/role verification; no supply-side audience matching notifications.

## Suggested sequencing

1. **Now:** publish the npm packages; list on x402/agent directories; flip the confidential-ask
   disclosure default to asker-controlled; lead docs with the three-product story — confidential
   pretesting, evidence checks, judgment gates.
2. **Next (fast tier):** AI/mixed eligibility config + escalation primitive + a public
   AI-vs-human calibration dashboard; pilot minutes-scale rounds with one CI/agent-framework
   partner and one pre-publish content buyer.
3. **Next (confidential tier):** games/asset-testing vertical pilot (named unmet need, indie
   budgets fit, deterrence stack already built); publish a leak-deterrence case study.
4. **Then:** audience plan Phases 1.3–3 (consistency screening → verified tiers → role
   attestation) — re-rates use cases 1 and 5 materially; revisit the A2A acceptance oracle as
   ERC-8004/ACP volume develops.
5. **Opportunistic:** fact-check notes vertical as rater-supply seed; governance checks when
   asked.

## Sources

Selected; full URL lists live with each research pass (capability audit from repo at HEAD).

**Confidential testing markets:** pickfu.com (universal respondent NDA, $5 publish discount,
SOC 2), openpr.com (concept-testing market $5.6B→$12.1B), wynter.com + getlatka.com ($16.3M ARR,
LinkedIn+email verification moat), centercode.com / betatesting.com (pricing; NDA tooling as
paid feature), gamesuserresearch.com / antidote.gg / playruo.com (playtest leak fear,
"enforcement is reactive"), greenbook.org / quirks.com (29–40% panel fraud), rework.com (SOC 2
checkbox procurement)

**Fast AI judgment:** arxiv.org/2601.20299 (peer prediction vs deceptive LLMs, inverse
scaling), arxiv.org/2405.15077 (GPPM text peer prediction), arxiv.org/2311.07692 (surprisingly
likely aggregation), arxiv.org/2506.07962 (correlated LLM errors, ICML 2025), arxiv.org/2605.30802
(multi-agent oracle: aggregation beats deliberation; disagreement→human routing),
comet.com (Cohere PoLL juries), blog.kleros.io (AI jurors, automated curation court),
chaoslabs.xyz (Edge AI oracle council), eips.ethereum.org/EIPS/eip-8004, checkstep.com /
hld.handbook.academy (moderation confidence routing, 80–95% volume reduction),
arxiv.org/2603.29403 (LLM-judge security SoK, 30–99% ASR)

**Agent economy / rails:** blockainews.com (x402 Foundation, ~$600M annualized, Cloudflare 1B
402s/day), prnewswire.com (Virtuals revenue network), relayplane.com (Bazaar seller/buyer
counts), research.4pillars.io (x402 maturity caveats)

**Carried over from the original pass:** prolific.com (MCP server, pricing), rapidata.ai,
stackoverflow.blog (Stack Overflow for Agents), science.org (Allen et al. crowd fact-checking),
techcrunch.com (LMArena $1.7B), indicator.media (AI community notes share), terac.com,
docs.hackerone.com (private programs)
