# RateLoop Tagline Research — June 2026

Research and proposals for replacing the hero tagline "Level Up Your Agent",
informed by a competitor-positioning sweep (2026-06-12) and the re-ranked use cases in
[`use-cases-2026-06.md`](use-cases-2026-06.md).

## Why change the current line

"Level Up Your Agent" (hero H1, header, page metadata, manifest, OG image, whitepaper subtitle):

- Frames RateLoop as an *agent-improvement* tool, but the top-ranked use cases are about
  *buying judgment*: confidential pretesting (#1), AI→human judgment gates (#2),
  agent-purchased evidence (#3). The agent is often the **customer**, not the thing being
  leveled up — and use case #1's buyers are often humans (indie builders, game studios),
  not agents at all.
- Says nothing about the two moat assets: World ID-verified humans and incentive-aligned
  independent judgment (stakes, commit-reveal, slashing).
- "Level up" is gaming-flavored growth language that doesn't signal trust/confidentiality,
  which the use-case research identifies as where the dollars sit.
- It sits in the agent-improvement frame that eval platforms (Braintrust, LangSmith,
  Galileo) already own.

## Competitor positioning sweep

Hero headlines / title tags of ~20 adjacent products, as indexed in mid-2026.
**Caveat:** gathered from search-indexed titles and snippets, not screen-verified live
pages — verify before quoting any line verbatim. Braintrust, Prolific, and Stack Overflow
in particular appeared to be A/B-testing or recently changed heroes.

### Pretesting / consumer research

| Product | Hero / title (approx) | Angle |
| --- | --- | --- |
| PickFu | "Make confident decisions backed by real consumer insights" / "…in minutes" | Speed-to-confidence |
| Wynter | "On-demand insights from verified B2B professionals … in under 48 hours" | Verified niche audience + SLA |
| Zappi | "The consumer insights platform that helps brands win" | Enterprise outcome, AI+data fusion |
| Prolific | "Easily collect high-quality data from real people" / "benchmarks you can defend" | Data quality + defensibility |
| Rapidata | "Human feedback at GPU scale" / "Humans in the loop, with a simple API call" | Humans-as-API, speed; closest analogue to minutes-scale rounds |

### AI eval / LLM-judge platforms

| Product | Hero / title (approx) | Angle |
| --- | --- | --- |
| Braintrust | "The evals and observability platform for building reliable AI agents" | Dev workflow; "reliable agents" |
| LangSmith | "Observe, Evaluate, and Deploy Reliable AI Agents" | Verb-triplet lifecycle |
| Patronus AI | "Simulating the World's Intelligence" (pivoted away from eval tooling) | Fled the eval-platform frame upmarket |
| Galileo | "Observe, evaluate, guardrail, and improve agent behavior in minutes" | Verb-stack + invented category ("Agent Reliability") |
| LMArena → Arena | "Chat, compare, vote for the world's best AI models" (rebranded Jan 2026) | Community/crowd legitimacy |

### Decentralized truth / dispute / oracle

| Product | Hero / title (approx) | Angle |
| --- | --- | --- |
| Kleros | "The arbitration protocol for the internet economy"; "Integrate Kleros. Send disputes. Receive decisions." | Protocol noun-claim + imperative integration triplet |
| UMA | "An optimistic oracle built for web3" | Minimal category-noun-first |
| Chaos Labs (Edge) | "Industry Leading Risk Management…"; Edge as "a truth-seeking Oracle" | Enterprise-risk vocabulary; "truth-seeking" standout |

### Human data / labor for AI

| Product | Hero / title (approx) | Angle |
| --- | --- | --- |
| Surge AI | "Human Intelligence for AGI" | Literary mission register |
| Scale AI | "Reliable AI Systems for the World's Most Important Decisions" | Gravitas + reliability; "decisions" overlaps RateLoop |
| Mercor | "Organizing human intelligence to power the AI economy" | Labor marketplace as infrastructure |

### Knowledge / agent economy / payments / identity

| Product | Hero / title (approx) | Angle |
| --- | --- | --- |
| Stack Overflow | "trusted human intelligence layer in the age of AI" (strategic framing) | Human-verified knowledge as AI input |
| Virtuals Protocol | "Society of AI Agents"; ACP as "the trustless commerce layer for the agent-to-agent economy" | World-building; agents as protagonists |
| x402 | "An open, neutral standard for internet-native payments. Built on HTTP." | Standards rhetoric, fragment style |
| World | "The real human network" / "a new standard of trust for the internet" | Trust standard; "real human" as scarce asset |

## Saturated language — avoid leading with

- **"Reliable AI agents" / "reliability"** — Braintrust, LangSmith, Galileo, Scale all
  converged on it in 2025–26. The new "quality."
- **"Human data" / "real people" / "human-in-the-loop"** — Prolific, Rapidata, Scale,
  Surge, Stack Overflow, World. "Human" as adjective is commoditized; World owns
  "real human."
- **"Observability and evaluation platform"** — three near-identical title tags; Patronus's
  exit suggests the category is commoditizing.
- **"Insights" + "in minutes"** — PickFu, Zappi, Wynter, Galileo. "Minutes" alone is table
  stakes, not a differentiator.
- **Bare "trust / trusted"** — claimed everywhere, rarely mechanized in the headline.

## Unclaimed angles (mapped to use cases)

1. **"Judgment" as the product noun.** Everyone sells data, insights, evals, or dispute
   resolution; nobody sells judgment per se. "Buy a judgment" / "verdicts on demand" is
   open — and it's exactly the category use cases #2 and #3 require RateLoop to create.
2. **Skin in the game in the headline.** No one says "raters who stake" or "answers backed
   by money," even though Kleros/UMA have the mechanism. RateLoop's stake-and-earn-USDC
   mechanic is a hero-grade trust proof nobody else can claim.
3. **The escalation ladder.** "AI in minutes, verified humans when it matters" is claimed
   by nobody — Rapidata is human-only-fast; eval platforms are AI-only. This is use case
   #2's exact shape.
4. **Agent-as-buyer.** Virtuals and x402 describe agent commerce abstractly, but no one
   addresses the operator whose agent spends money. "Your agent buys a second opinion" is
   an open voice.
5. **"Verified" applied to the answer** (not just the audience): "verified answers" /
   "verdicts you can defend" (echoing Prolific) is barely claimed.

**Headline phrasing patterns:** dev tools use imperative verb-stacks addressed to the
developer ("Observe, evaluate, deploy…"); protocols use definitional noun-claims with no
verb ("The arbitration protocol for the internet economy", "An optimistic oracle built for
web3"). Kleros's three-imperative integration line ("Integrate Kleros. Send disputes.
Receive decisions.") maps almost 1:1 to RateLoop's API story.

## Ranked tagline proposals

Layout constraint: the hero renders as two stacked lines (~14ch each) with a gradient
punch word (currently "Level Up Your" / "**Agent**"). The current subtitle ("Human and AI
Raters Guide Decisions and Earn USDC") speaks to raters (supply side), not askers — worth
replacing in the same pass.

### Preferred direction (2026-06-12): the "Judgment Layer" family

"The Judgment Layer for the Agent Economy" is the strongest protocol-register line —
definitional noun-claim in the Kleros/UMA mold ("The arbitration protocol for the internet
economy"), with the unclaimed product noun ("judgment") in front and the agent-economy
positioning kept. Its only defect is length: at 38 characters it can't fit the hero's
two-line ~14ch layout. Resolutions, in preference order:

**a. Short hero + full line in the metadata (recommended).** The hero takes the short
form; the title tag, OG image, and meta description carry the full definitional claim —
which is where definitional lines do their work anyway (search results, link unfurls).

> Hero: `The Judgment` / `Layer` (gradient on `Judgment`; "The Judgment" = 12ch)
> Subtitle: *Staked human and AI raters deliver independent verdicts for the agent economy — in minutes.*
> Title tag / OG / manifest: `RateLoop — The Judgment Layer for the Agent Economy`
> Header sub-brand (12px): `The Judgment Layer` or the full line (it fits at that size)

The subtitle reattaches "for the agent economy" so the hero loses no meaning, and carries
the two unclaimed proofs (stakes, human+AI escalation).

**b. "Judgment for the Agent Economy."** Drops "layer" instead of the qualifier.

> Hero: `Judgment for` / `the Agent Economy` (gradient on `Agent Economy`; second line
> 17ch — slightly over budget, needs a size check)
> Subtitle: *Independent verdicts from staked human and AI raters, in minutes.*

Keeps the full positioning in the hero itself at the cost of a tight second line and a
weaker noun-claim (no "layer" = less protocol-register).

**c. "The Agent Economy's Judgment Layer."** Same content, possessive form — still too
long for the hero (34ch), but a good alternate for the whitepaper subtitle or docs lead,
where line length is free.

**Why this family wins over "trustless" phrasing considered en route:** "trustless"
contradicts the actual moat (trust *mechanized* via stakes, slashing, Orb-verified
identity — and the gated-context path is hosted, so the strict claim is attackable),
reads as "can't be trusted" to the non-crypto buyers of use case #1, and sits one word
from Virtuals' "trustless commerce layer." "Judgment Layer" keeps the layer/infra register
while putting the category-defining noun in front.

Residual weakness of the whole family (accepted): "agent economy" centers agents, so the
human pretesting buyer of use case #1 is addressed by the subtitle, not the headline.

### 1. "Judgment on Demand" — recommended for breadth

> Hero: `Judgment` (gradient) / `on Demand`
> Subtitle: *Staked human and AI raters answer in minutes. Verified humans when it matters.*

Claims the open category noun, covers all four top use cases, works whether the buyer is a
human builder or an agent, and the subtitle carries both unclaimed proofs (stakes +
escalation). Definitional protocol-style phrasing, kept short.

### 2. "Your Agent's Second Opinion"

> Hero: `Your Agent's` / `Second Opinion` (gradient)
> Subtitle: *Independent judgment from staked AI and verified-human raters — in minutes, paid in USDC.*

Keeps continuity with the agent-centric brand but flips the agent from
thing-being-improved to customer — the unclaimed voice. Weakness: like the current line,
it undersells use case #1, where the buyer is often a human studio testing confidential
assets.

### 3. "Answers With Skin in the Game"

> Hero: `Answers With` / `Skin in the Game` (gradient; 16ch — "Real Stakes" fits if needed)
> Subtitle: *Human and AI raters stake to answer. Wrong answers cost them. Right ones earn USDC.*

Leads with the mechanism nobody else can claim. Most differentiated and memorable;
slightly insider-flavored for a first-time visitor.

### 4. "Verdicts in Minutes. Humans When It Matters."

> Hero: `Verdicts in` / `Minutes` (gradient)
> Subtitle: *Fast AI-rater rounds that escalate to World ID-verified humans on disagreement.*

Purest expression of use case #2 (the two-tier judgment gate). Best if the site should
lead with that product specifically. "Verdicts you can defend" is a strong variant.

### 5. Imperative triplet (sub-line / section header, not the hero)

> *Ask once. Raters stake. Verdict in minutes.*

Pairs well under any of the above; Kleros-style integration rhythm.

## Implementation footprint

Changing the tagline touches (main tree, as of 2026-06-12):

- `packages/nextjs/app/(public)/page.tsx:273` — hero H1 (two-line split + gradient span)
- `packages/nextjs/components/Header.tsx:241` — header sub-brand line
- `packages/nextjs/app/layout.tsx:8` — page title (`RateLoop - Level Up Your Agent`)
- `packages/nextjs/public/manifest.json` — description
- `packages/nextjs/utils/scaffold-eth/getMetadata.ts:19` (+ test) — OG image alt text
- `packages/nextjs/public/og-image.jpg` — **asset has the subtitle baked in; needs regen**
- `packages/nextjs/scripts/whitepaper/summary.ts` — whitepaper subtitle + design narrative
  (+ `lib/docs/whitepaperContent.test.ts`)
- `packages/nextjs/e2e/tests/smoke.spec.ts`, `pages-smoke.spec.ts`, `mobile.spec.ts` —
  assertions on the tagline
- `README.md` — OG image alt text
- Hero subtitle at `app/(public)/page.tsx:279` and docs lead at
  `app/(public)/docs/page.tsx:36` if the subtitle changes too
