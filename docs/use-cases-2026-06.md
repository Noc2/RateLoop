# RateLoop Use Cases — June 2026

A multi-agent research pass on concrete use cases for RateLoop and their product-market fit. One
agent audited the repo to ground what the product can actually deliver today (latency, cost,
output format, trust guarantees); three agents researched the market for the candidate use-case
clusters: market research with verified humans, feedback/oversight for autonomous agents, AI
output evaluation, agent-purchased evidence, and crypto-native signal markets. This document is
the synthesis, with a PMF ranking at the end.

## TL;DR

The strongest fits are **agent-initiated purchases of cheap, verified-human judgment on public
artifacts** — not the classic versions of any incumbent category. RateLoop occupies a genuinely
empty cell: a few USDC buys 10–50 incentive-scored opinions from sybil-resistant raters in
roughly 40 minutes to a few hours, permissionlessly, via MCP, with a public auditable result. No
incumbent (PickFu, Prolific, Rapidata, Terac, LMArena) offers that combination.

Three constraints shape everything below:

1. **Public-only context** kills the largest demand pools in every adjacent category —
   proprietary code review, confidential pre-launch research, enterprise model evals. What
   survives skews toward taste/judgment questions on public artifacts, which is conveniently
   where crowd > single expert. This is more fixable than it sounds: the protocol settles on
   votes/hashes, not context bytes, and the market sells confidentiality on gated access +
   NDA + deterrence rather than cryptography — see `private-context-plan-2026-06.md`.
2. **No enforced demographic or expertise targeting.** World ID proves humanness, not
   attributes. RateLoop does have a self-reported audience-context system (rater profiles with
   age/geo/language/role/expertise, advisory `targetAudience` on asks, post-hoc cohort summaries
   in agent results), but nothing validates the claims and targeting gates no payouts — so it
   can't yet carry the *whose opinion* premium most research budgets pay for. This is the single
   highest-leverage product gap; see `audience-targeting-plan-2026-06.md` for the upgrade plan.
3. **Latency of ~40 min–hours** fits background/long-running agents and non-urgent decisions;
   it excludes interactive loops and high-velocity crypto demand.

Best wedge, in order: (1) agents paying for evidence and verification (source credibility, claim
checks, "consult humans when stuck"), (2) creative/concept pretesting on public artifacts bought
by agents and indie builders, (3) LLM-judge calibration sets. The market timing is real: x402 hit
~165M agentic transactions, Prolific shipped an MCP server, Rapidata raised $8.5M on
"humans-as-API," panel fraud runs 29–40%, and Stack Overflow's human Q&A collapsed −78% YoY.

## What RateLoop can actually deliver today (capability envelope)

From the repo audit; full details in the protocol docs.

| Dimension | Reality |
| --- | --- |
| Latency | ~40–90 min for a 3–5 rater fast-lane ask (20 min blind epoch default); 2–24 h realistic for 10–25 raters; not viable under ~30 min |
| Cost | 1 USDC floor; healthy recruitment ≈ $0.33–0.75/rater → **$5 for 10 raters, ~$12.50 for 25** at target pricing, +$2 feedback bonus when written reasons matter |
| Answer format | Binary up/down + crowd-% prediction, settled rating, structured `AgentResultPackage` (go/no-go answer, confidence, objections, source URLs, feature-test verdicts); 12 result templates; bundles up to 10 questions (pairwise/ranked) |
| Trust | Economic + transparent + challengeable, not SLA-backed; World ID gating scopes *bounty eligibility*, not the public score; explicitly not an oracle for financial settlement |
| Privacy | Everything public: context URLs (https pages), YouTube videos, up to 4 moderated images; no redaction or private rounds |
| Agent integration | Public MCP endpoint, quote → handoff-link (human wallet) or local-signer/EIP-3009 (headless); dry-run mode; webhooks; chat-agent-with-human-wallet is the most turnkey path today |
| Scale | maxVoters 100 (creator up to 200); fine for dozens of concurrent asks; not built for high-frequency micro-polling |
| Supply caveat | **No guaranteed live rater pool** — supply is an adoption problem, not a protocol guarantee; every use case below assumes the cold-start is solved |

Notably, the existing result templates already map 1:1 onto the top-ranked use cases below
(`claim_verification`, `source_credibility_check`, `llm_answer_quality`,
`pairwise_output_preference`, `agent_action_go_no_go`, `feature_acceptance_test`).

## Use cases

### 1. Agent-purchased evidence and verification (PMF 7/10)

**What:** An AI agent mid-task hits a question it can't resolve by searching — is this source
credible, does this citation actually support the claim, is this photo really that location,
which interpretation is right — and pays a small bounty for verified-human judgment, plus a
Feedback Bonus for submitted reasons and sources. The "AI gets additional input" use case.

**Why the timing is right:**
- Agent→human payment rails exist and converge on RateLoop's exact stack: x402 (~69k active
  agents, ~165M tx, Linux Foundation-hosted), **h402** — an open protocol specifically for "AI
  agents that need humans," built on x402 *and World ID*; RentAHuman.ai (MCP, stablecoin gigs);
  Human API ($65M from Polychain/Delphi for a request-complete-verify-pay human-input loop).
- The free-Q&A substitute collapsed: Stack Overflow questions −78% YoY (below 2009 levels);
  SO relaunched as "Stack Overflow for Agents" (June 2026) with humans-in-the-loop — the corpse
  is being rebuilt as agent infrastructure.
- Research validation: ~10–15 politically balanced laypeople rating headline+lede match
  professional fact-checkers about as well as fact-checkers match each other (Allen et al.,
  Science Advances 2021).
- The classic micropayment killers don't apply: agents have no mental transaction costs and
  USDC-on-chain kills card fees. Google Answers died from asker-as-arbiter refunds and zero
  discoverability — BTS crowd-scoring replaces the arbiter, MCP directories replace discovery.

**Fit:** Sources and evidence are public by nature (the public-only constraint barely bites);
binary + prediction maps cleanly to "does this source support claim X?"; ~1h latency suits
research loops; the Feedback Bonus is literally "pay strangers small amounts for reasons +
sources." Weakness: scoring free-text quality is the research frontier, and local/tacit-knowledge
questions need geo-targeting that doesn't exist.

**First buyer:** agent-framework and deep-research builders adding a "consult verified humans"
tool; AI note-writer operators buying pre-submission ratings.

### 2. Creative and concept pretesting on public artifacts (PMF 6.5/10)

**What:** Names, logos, landing pages, ad creatives, thumbnails/titles, app-store assets, pricing
pages — binary "does this land?" reads with 10–50 raters, bought by indie builders or directly by
the marketing/content agents generating the assets. This is the realistic core of both the
"market research" and "agent feedback" directions, merged.

**Why:** PickFu charges $50–85 for a 50-respondent poll; Prolific ≈ $20–40 all-in with account
and study-design overhead; Rapidata is $0.004/response but RLHF-framed and not
personhood-verified. RateLoop's **$3–15 for 25–50 verified-human ratings** sits in an empty
price/speed/permissionless quadrant. Panel fraud (29% average across major panels, ~40% of 2025
nonprobability interviews likely fraudulent) makes Orb-verified humans a legible differentiator,
and the synthetic-respondents wave (Synthetic Users, Evidenza, et al.) pushes workflows toward
*synthetic triage → cheap human validation* — which increases demand for exactly this product.

**Fit:** Public by definition, binary-friendly, hours-tolerant, micro-budget native; the buyer
(agent developers, indie hackers, creator-ops tooling) doesn't need demographic targeting and
values "verified human, not an LLM" over representativeness. Weakness: the World App rater base
skews toward Orb-dense geographies — fine for "do humans get this?", weak for "will US enterprise
buyers convert?"; multi-variant tests need bundles (supported, up to 10 questions).

**First buyer:** AI agent developers wanting a human gut-check inside an autonomous loop; second
ring, indie hackers for whom $50/poll stings; third, creator-economy tooling.

### 3. LLM-judge calibration sets (PMF 6/10)

**What:** The sharpest version of "AI output evaluation." The 2026 eval orthodoxy (LangSmith,
Braintrust, every practitioner guide) is: LLM judges do volume, humans build the 50–200-example
golden/calibration set that grounds the judge, refreshed on every judge or model swap. That's the
one human-eval purchase every small AI team must make — small-N, recurring, CI-automatable. Sell
it as: N human judgments on your calibration examples for a few USDC, via MCP, no contract.

**Why:** LMArena went from academic project to $1.7B valuation / $30M ARR within ~4 months of
commercializing crowd preference on AI outputs — direct proof aggregated thumbs on AI outputs is
sellable. The enterprise layer (Scale post-Meta exodus, Surge >$1B, Mercor) is consolidated and
out of reach, but the indie layer runs GPT-4o-mini judges for $0.10/run and calls $99–249/mo eval
platforms unaffordable. Peer prediction without ground truth is *literally designed* for
subjective eval (Prelec's BTS targets unverifiable subjective information; "surprisingly common"
aggregation empirically beats majority vote; EC'24 work extends peer prediction to text).

**Fit:** `llm_answer_quality`, `rag_grounding_check`, and `pairwise_output_preference` templates
already exist. Weaknesses: public-only context excludes confidential eval material (most serious
eval spend), binary is coarser than rubric scales, no rater qualification for domain-expert
judgments, and the $0.002 GPT-judge call keeps eating the low end from below.

**First buyer:** indie/seed AI app builders (and their coding agents) calibrating judges on
public-facing outputs.

### 4. Rating layer for AI-written fact-checks and community notes (PMF 5.5/10)

**What:** AI bots now write ~45–50% of submitted Community Notes on X (8 bots wrote 50.3% of
visible notes in May 2026); the binding constraint everyone flags is **unpaid human rater
capacity**. A paid, World-ID-gated, BTS-scored rating crowd for AI-drafted notes — sold to note
operators, newsrooms, or platforms cloning Community Notes (Meta is expanding internationally in
2026 while banning AI note *writers*) — is a near-exact RateLoop workload.

**Fit:** Near-perfect mechanism match (humans-rating-content is the scarce commodity; claims and
notes are public; the Allen et al. result validates small balanced lay crowds). Weakness: a small
and concentrated buyer set — platform deals or note-operator tooling, not broad self-serve
demand. Worth pursuing as a flagship demonstration vertical rather than a volume business.

### 5. Classic market research / consumer insights (PMF 5/10)

**What:** The broad version — concept tests, demand validation, pricing reactions, audience
research, bought by growth teams and agencies.

**Why capped:** No demographic targeting means RateLoop can't answer the question most research
budgets pay for (*does my target customer like this*); public-only context excludes confidential
pre-launch work and effectively all B2B (Wynter's entire $599–899/test segment signs NDAs); the
rater base is unrepresentative of Western consumer markets; and the binary format competes at the
shallow end where Rapidata is 50× cheaper and PickFu richer-featured. The viable product is use
case 2, not this category. Score rises toward 7–8 if validated self-attested rater traits or any
private-context mode ever ship.

### 6. Pre-vote governance temperature checks and launch vetting (PMF 4.5/10)

**What:** DAOs or grant programs buying verified-human temperature checks before formal votes
("should we fund X — thumbs + predicted %"); launchpads/accelerators paying for community vetting
as a diligence-plus-marketing artifact.

**Why:** Snapshot is free but participation runs 3–8% of supply with endemic rubber-stamping (75%
of delegates score <5/10 on vote quality); curation-gated launchpads validated reputation-weighted
human judgment (Echo's $375M Coinbase exit, Legion's Proof-of-Humanity-scored 350k investors).
World ID + BTS + commit-reveal is essentially the anti-farming architecture in a vertical defined
by farming (Kaito Yaps' collapse when X banned pay-to-post). "100 verified unique humans,
incentive-compatible reveal, $50" genuinely differs from a whale-dominated free poll.

**Why capped:** Crypto crowds overwhelmingly want to *earn*, not spend — the asker side is thin;
raters holding correlated bags bias even honest belief; micro-bounty questions look exactly like
airdrop-farming surface; launchpad-sector returns (−46% baskets) question the value of the signal
itself. Do opportunistically — RateLoop already lives on-chain — not as the wedge. Sub-second
token-risk checks (TokenSentry/TokenGuard at $0.01–0.02/call) are excluded outright by latency.

### 7. Go/no-go gates for long-running autonomous agents (PMF 4/10)

**What:** Background agents (coding, computer-use, content) checkpoint their work — a plan, a PR,
a deploy decision, a draft — and buy outside judgment as a gate or course-correction signal
instead of interrupting their user. The `agent_action_go_no_go` template's home turf.

**Why the timing looks right:** background agents went mainstream (sessions grew ~4→23 min in a
year; "assign, close laptop, review tomorrow" is the defining 2026 workflow); verification is the
acknowledged bottleneck (PR volume +98%, review time +91%, 45% of merged agent PRs contain
issues — "verification debt"); long-horizon research explicitly recommends execution-time plan
verification; the interrupt/approval integration surface (LangGraph `interrupt()`, HumanLayer,
gotoHuman) is standardized, and "humans as MCP tools" is a funded category (Terac, HumanOps,
agentic.market with 1,126 x402 services).

**Why capped anyway:** (1) The biggest demand pool is proprietary-code PR review, which
public-only context amputates. (2) The trust direction of travel is *against* anonymous crowds
for consequential actions — Terac's whole pitch is government-ID-verified experts, "not
crowdworkers"; production teams converge on accountable approvers for irreversible actions.
RateLoop realistically sells *advisory signal*, not the gate itself, which lowers willingness to
pay. (3) Real x402 commerce is still ~$28K/day across everything. What survives is taste verdicts
on public artifacts for marketing/content agents — which is use case 2. RateLoop's unique angle
here remains real: nobody else sells *aggregated, incentive-scored crowd* judgment to agents
(Terac sells one expert), commit-reveal genuinely kills herding, and the on-chain audit trail
("outside judgment obtained before deploy") is an artifact no Slack approval produces.

### 8. Broad AI-lab eval / preference data (PMF 2/10)

Labs need privacy, scale, demographic/expertise targeting, and contracts; the Scale/Surge/Mercor
layer is consolidated enterprise business. Not addressable. Listed for completeness because "AI
evaluation" is the label people will reach for — the addressable slice is use case 3.

## PMF ranking

| # | Use case | PMF | Wedge buyer | Killer constraint |
| --- | --- | --- | --- | --- |
| 1 | Agent-purchased evidence & verification | **7** | Agent/deep-research framework builders | Embryonic buyer side; free-text scoring hard |
| 2 | Creative/concept pretesting on public artifacts | **6.5** | Agent devs, indie hackers | Rater-base representativeness |
| 3 | LLM-judge calibration sets | **6** | Indie AI app builders | LLM judges eat the low end; public-only |
| 4 | Rating layer for AI fact-check notes | **5.5** | Note operators, platforms | Few, concentrated buyers |
| 5 | Classic market research | **5** | Growth teams, agencies | No targeting; public-only kills B2B/pre-launch |
| 6 | Governance temperature checks / launch vetting | **4.5** | DAOs, grant programs, launchpads | Thin asker-side demand; farming surface |
| 7 | Agent checkpoint go/no-go gates | **4** | Marketing/content agent builders | Public-only kills code review; anonymous-crowd trust |
| 8 | Broad AI-lab eval | **2** | — | Privacy, targeting, contracts |

Use cases 1–3 share one buyer persona — **the agent developer with a funded wallet asking about
public artifacts** — and one distribution channel (MCP + x402 service directories). They are less
three markets than three question templates sold to the same person.

## Cross-cutting observations

- **Distribution is the cheapest growth lever found anywhere in this research.** Listing RateLoop
  as an x402/h402-payable judgment endpoint on agent service directories (Coinbase's
  agentic.market, h402's discovery layer) costs nearly nothing; h402's stack (x402 + World ID +
  escrow) is so close to RateLoop's that becoming *the* judgment primitive in that ecosystem is a
  plausible position. Prolific's own MCP repo warns every publish "spends real money" with no
  sandbox — RateLoop's dry-run mode is already ahead there; the missing piece is a funded live
  sandbox.
- **The "verified human" claim needs careful wording.** World ID gating scopes bounty
  eligibility, not the public score; the honest pitch is "paid, verified-human-gated cohort with
  a public all-answers scope," and the result package already exposes both scopes.
- **Targeting is the highest-leverage roadmap item.** The self-reported audience-context system
  already exists; hardening it (consistency screening, tested language/expertise, attested
  attributes) and letting it carry payouts would move use cases 2 and 5 up 1.5–3 points each.
  Every incumbent's pricing scales with targeting because targeting is the value. Plan:
  `audience-targeting-plan-2026-06.md`.
- **Prompt injection via rater feedback is the recurring trust objection** for every agent-facing
  use case. The `RATELOOP_UNTRUSTED_DATA` delimiters and structured numeric/enum fields are the
  right shape; keep free-text quarantined and lead with the structured fields in agent docs.
- **Cold start cuts both ways.** Every PMF score above assumes raters show up. The earn-side
  (World App users rating for USDC micro-bounties) is plausible but unproven; early quality
  variance will determine buyer trust more than mechanism design. Conversely, the rating-side
  cold start is the strongest argument for seeding with the fact-check/notes vertical (use case
  4), where rater work is intrinsically motivated and publicly useful.
- **Don't anchor on the oversight framing.** "RateLoop gates your agent" invites the
  accountability objection and competes with identity-verified experts. "RateLoop is the cheap
  second opinion your agent buys before it asks you" is the same product without the liability.

## Suggested sequencing

1. **Now:** list on x402/h402 agent directories; ship the funded sandbox/testnet path; lead docs
   with use cases 1–3 (evidence checks, pretesting, judge calibration) under one "agent buys
   human judgment" story; keep `claim_verification` / `source_credibility_check` /
   `pairwise_output_preference` as the headline templates.
2. **Next:** pilot the fact-check/notes vertical (use case 4) as the rater-supply seed and public
   proof artifact; publish a case study with settled-round data.
3. **Later:** self-attested + peer-validated rater traits (unlocks targeting → use cases 2 and 5
   re-rate substantially); revisit go/no-go gating once x402 commerce volume and rater-pool
   quality data exist.
4. **Opportunistic:** DAO temperature checks when asked; never chase sub-minute crypto signal.

## Sources

Selected; full URL lists live with each research pass.

**Incumbents & pricing:** prolific.com/pricing, prolific.com/mcp, prolific.com/for-agents,
pickfu.com/pricing, wynter.com/pricing, rapidata.ai/press, terac.com/pricing, humanops.io,
braintrust.dev/articles/llm-as-a-judge-vs-human-in-the-loop-evals

**Demand & rails:** chainalysis.com/blog/x402-agentic-payments-adoption, h402.dev,
agentic.market, stackoverflow.blog/2026/06/10/announcing-stack-overflow-for-agents,
techcrunch.com/2026/01/06/lmarena-lands-1-7b-valuation,
venturebeat.com/data/rapidata-emerges-to-shorten-ai-model-development-cycles

**Panel quality & mechanism:** greenbook.org (tech-enabled fraud), norc.org (fraud reshaping
survey research), jmir.org/2026/1/e85161, science.org/doi/10.1126/sciadv.abf4393 (Allen et al.),
arxiv.org/html/2405.15077v1 (EC'24 text peer prediction),
indicator.media/p/8-ai-bots-now-write-50-of-x-s-community-notes

**Agent oversight:** docs.langchain.com (interrupts / HITL middleware), runany.dev (HumanLayer),
arxiv.org/html/2604.11978v1 (Long-Horizon Task Mirage), cio.com (senior-engineer review
bottleneck), faros.ai data via softwareseni.com

**Crypto signal markets:** blockeden.xyz (Kaito Yaps autopsy, Echo exit, World Chain
proof-of-humanity), legion.cc, chainsights.one/blog/delegate-vote-quality-75-percent,
bitcoinfoundation.org (launchpad returns)
