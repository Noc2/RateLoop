# Landing Page & Docs Copy Updates — June 2026

Suggestions for aligning user-facing copy with the revised use-case analysis
(`use-cases-2026-06.md`). Based on a verbatim audit of the landing page, docs pages,
agent-facing files (llms.txt, skill.md, install snippets, MCP descriptions), and SEO metadata.

## What the copy should start saying (and what it must not claim yet)

The use-case research re-ranked the product around three stories, in this order of
copy-readiness:

1. **Confidential asks are live and differentiated** — gated hosted context, wallet-signed
   confidentiality terms, watermarked serving, optional slashable rater bond, and a
   protocol-wide World ID earning ban on proven breach. The research's strongest marketing
   line: an incumbent panel NDA binds an account (~30% of panel respondents are fraudulent);
   RateLoop's binds a verified human who can't re-enter with a new wallet. This is the #1
   PMF use case (confidential concept/creative pretesting) and it's nearly invisible in
   current copy — no landing mention, no FAQ entry, no dedicated docs page.
2. **Rounds are asker-configurable down to minutes.** Current copy says nothing concrete
   about speed, and the agent rules say "non-urgent", which actively undersells the fast
   tier. Safe claim today: "rounds settle in minutes when raters respond quickly; human
   panels typically take longer." 
3. **Audience targeting exists.** `targetAudience` is validated, reported against the
   revealed cohort, and affects bounty eligibility — zero landing/FAQ presence today.

**Do not claim yet** (not shipped):

- Enforced AI-only rounds or auto-escalation to human rounds (the "two-tier gate" is a
  roadmap story, not copy).
- AI raters on gated/confidential asks (gated rounds are human-credential-only).
- Verified/role-attested audience targeting (self-reported + consistency rules only).
- `npm install @rateloop/sdk` (packages still unpublished — gate any docs/sdk copy on the
  actual npm release).
- Legal-NDA strength: say "wallet-signed confidentiality terms", "collateralized
  confidentiality", "identity-level accountability" — not "NDA" as a legal instrument.

---

## 1. Landing page (`packages/nextjs/app/(public)/page.tsx`)

### Hero

Keep "Level Up Your Agent". The subheadline "Human and AI Raters Guide Decisions and Earn
USDC" is fine but generic; options that carry the new envelope:

- "Paid, independent judgment from verified humans and AI raters — public or confidential."
- "Verified humans and AI raters rate your work, predict the crowd, and earn USDC."
- Keep the current line and let the feature cards carry the news (lowest-risk option).

### "How It Works" steps

- Step 01 "AI Asks" — "Agent asks a question with context, bounty, duration, and voter
  count." → add the confidentiality option:
  "Agent asks a question with context — public or gated behind confidentiality terms — plus
  bounty, duration, and voter count."

### "Why It Works" feature cards

- Add a sixth card (or replace the weakest), **"Confidential When Needed"**:
  "Gated hosted context unlocks only after wallet-signed confidentiality terms. Watermarked
  serving, optional slashable rater bonds, and identity-level earning bans deter leaks in a
  way panel NDAs can't."
- "Honest and Quick" — currently only mechanism talk. Append a concrete speed claim:
  "...one blind round. Round length is asker-configured: fast rounds settle in minutes when
  raters respond quickly."

### FAQ (`lib/docs/landingFaq.ts`)

- **New Q: "Can I Keep My Question Confidential?"**
  "Yes. Private context mode hosts your images and details on RateLoop and serves them only
  to raters who sign wallet-bound confidentiality terms. Serving is watermarked and
  access-logged, askers can require a slashable LREP or USDC bond per rater, and a proven
  leak costs the rater their World ID identity's earning power across the whole protocol —
  not just one account. You choose whether context publishes after settlement or stays
  private."
- **New Q: "How Fast Do Rounds Settle?"**
  "Round length is set per question. Fast rounds can settle within minutes when raters
  respond quickly; rounds that recruit human panels typically run from about an hour to a
  day. Results are readable as soon as the round settles; USDC bounty claims unlock after
  the payout challenge window."
- **"What Can Agents Use RateLoop For?"** — current list is agent-eval centric. Add the
  top-ranked segment: "...feature tests, proposal reviews, and pre-launch concept or
  creative testing under confidentiality (names, landing pages, ad creative, game assets)."
- **"Can AI Agents Ask Questions on RateLoop?"** — "The result becomes a public rating
  signal the agent can use later." → "The settled rating signal stays auditable; gated
  context can remain private while the result is still verifiable."
- **"Why Should I Trust These Ratings?"** — optionally add the panel-fraud contrast:
  "Unlike survey panels, every verified-human rating is bound to a unique Orb-verified
  person with stake at risk."

---

## 2. Docs pages

### `/docs` intro (`docs/page.tsx`)

- "RateLoop gives agents a narrow public fallback: ask open raters, pay for the work, and
  keep the answer visible." → "RateLoop gives agents a narrow outside-judgment fallback:
  ask open raters publicly — or behind wallet-signed confidentiality terms — pay for the
  work, and keep the settled result auditable."
- "What RateLoop Does" — "attaches context" → "attaches public or gated context".

### New page: `/docs/private-context` ("Confidential Asks")

The single highest-leverage docs addition. Buyer-facing walkthrough:

1. What gating does (hosted-only context, no external URLs, public-safe title required).
2. What raters sign (wallet-bound terms, content-commitment bound, server-recorded).
3. What deters leaks (watermark + view tokens + access logs; optional bond 0–100+ USDC in
   LREP/USDC; breach → governance slash + protocol-wide identity earning ban; reporter
   bounty).
4. Disclosure policy (`after_settlement` vs `private_forever`) — and per the use-case
   research, document `private_forever` as the recommended choice for pre-launch material,
   since settlement usually lands long before launch.
5. Limits, stated honestly: raters must hold a human credential (no AI raters on gated
   asks yet), no gated bundles, terms are an economic/identity deterrent rather than a
   courtroom instrument.

### New page or section: `/docs/use-cases` ("What People Use RateLoop For")

Public-facing distillation of the ranked list — one short block each: confidential concept
& creative pretesting; agent evidence and verification mid-task; LLM-judge calibration
(incl. proprietary outputs via gated context); fast quality gates for agent pipelines
(flagged as emerging); market research with verified humans. Each block: who asks, what a
round costs, what comes back. This also gives the landing page somewhere to link beyond
the FAQ.

### `/docs/ai` and `/docs/ai/user-testing`

- Add a "Confidential pre-launch testing" subsection to user-testing: unreleased names,
  screenshots, store-page assets — gated context + bond + `private_forever`.
- Latency guidance: both pages currently only warn toward *longer* rounds (Tier-0
  blinding). Add the other direction: "For low-sensitivity checks where raters respond
  quickly, `epochDuration` can be set as low as protocol bounds allow; expect
  minutes-scale settlement when enough raters commit early."

### `/docs/how-it-works`

Already the best-aligned page (private context paragraph is accurate). Minor: the "Ask"
step could name the disclosure-policy choice in one clause.

---

## 3. Agent-facing copy

### Consistency fix (do this regardless of anything else)

`lib/agent/installSnippets.ts` standing-rule body (line ~14) and the Cursor rule
description (line ~64) still say only "public", while llms.txt, skill.md, and the one-time
prompt were already updated to "public or explicitly gated hosted-context". Align all to
the gated phrasing — agents reading the standing rule today will wrongly skip confidential
material RateLoop can now handle.

### "Non-urgent" phrasing

All agent rules gate on "non-urgent ... the user can wait for a paid review round."
Suggest: "non-urgent (results take minutes for fast rounds up to a day for human panels)".
This keeps the honest exclusion of sub-minute decisions while no longer implying
hours-by-default.

### Use-case lists (llms.txt line 5, skill.md "Good Fits", install snippets)

Add: "pre-launch concept, creative, or asset testing using gated hosted context" — the #1
PMF use case is absent from every agent-facing list.

### MCP tool descriptions (`lib/mcp/tools.ts`)

- The quote/ask tool descriptions could mention confidentiality support in one clause so
  agent runtimes surface it ("supports gated RateLoop-hosted private context").

---

## 4. SEO metadata

- Root description ("Human and AI raters guide decisions and earn USDC...") → option:
  "Paid ratings from verified humans and AI raters — public or confidential — on the
  RateLoop rating protocol."
- New `/docs/private-context` page gets its own metadata: title "Confidential Asks",
  description around "gated context, wallet-signed confidentiality terms, watermarked
  serving, slashable bonds, identity-level breach bans".
- Typo: social image alt says "Lever Up Your Agents" (`utils/scaffold-eth/getMetadata.ts`
  and `README.md` line 1 image alt) — should be "Level Up".

---

## 5. Suggested priority

1. **Consistency + typo fixes** (standing rule "gated" parity, Cursor rule description,
   "Lever Up") — trivial, prevents agents skipping confidential asks.
2. **FAQ additions** (confidentiality Q, speed Q, use-case list update) — cheapest way to
   get the new story onto the landing page.
3. **`/docs/private-context` page** — the buyer-facing artifact for the #1 use case;
   everything else can link to it.
4. **Agent-rule latency + use-case phrasing** (llms.txt, skill.md, install snippets).
5. **Feature card + hero tweaks, `/docs/use-cases` page, SEO** — nice-to-have polish.

Roadmap-dependent copy (hold until shipped): two-tier AI→human gates, enforced AI-only
rounds, verified audience tiers, npm install instructions.
