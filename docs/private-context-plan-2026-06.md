# Private Context Plan — June 2026

A multi-agent research pass on RateLoop's "public-only context" limitation — the constraint that
kills confidential demand (pre-launch concept tests, proprietary review, enterprise evals) in
every adjacent use-case category (`use-cases-2026-06.md`). One agent mapped the context pipeline
end-to-end in the repo; one researched how confidential human-feedback platforms (PickFu,
UserTesting, Wynter, Centercode, HackerOne/Bugcrowd private programs) actually handle
confidential material; one researched crypto-native gating rails (SIWE sessions, signed URLs,
Lit, tlock/Shutter, TEEs).

## TL;DR

There is a good, relatively simple solution, because two things turn out to be true:

1. **The market does not buy cryptographic secrecy — it buys friction plus deterrence.** Every
   incumbent sells confidential testing on the same stack: click-through NDA gate before content
   is shown, identified-enough raters, small time-boxed audiences, and account-death as the real
   enforcement (nobody litigates; Epic-vs-Fortnite-testers is the rare exception and was solved
   by identification, not the NDA text). PickFu and Wynter close pre-launch deals on exactly
   "respondents sign NDAs"; Apple runs the world's app betas on a blanket ToS clause signed by
   anonymous testers. Buyers accept "50 vetted strangers saw it under NDA" — that *is* the
   product, and they pay a premium for it.
2. **RateLoop's protocol never needed public context.** Settlement, RBTS scoring, payouts, and
   the payout-root challenge system run entirely on votes, stakes, and hashes — the audit trust
   model makes no security argument from public context. And critically, RateLoop-hosted
   attachment URLs (`/api/attachments/images/att_…`, `/api/attachments/details/det_…`) are
   **opaque pointers**: the plaintext URL emitted in on-chain events leaks nothing if the route
   behind it is access-gated. For questions whose context is RateLoop-hosted, private context
   needs **no contract change at all** — it's a serving-layer feature.

The MVP is therefore: a `contextVisibility: "gated"` mode where context must be RateLoop-hosted,
the attachment routes require a wallet-signed confidentiality acceptance (recorded server-side),
responses are watermarked and access-logged, Ponder/OG surfaces are redacted, and context
optionally auto-publishes after settlement. Roughly 2–4 weeks of app-layer work. RateLoop can
then do one thing no Web2 platform can: **collateralize the NDA** — raters on confidential
questions can post a slashable bond, and a proven leaker loses their World ID identity's earning
power permanently (a banned human can't re-enter, unlike any panel account).

## What the research established

### The threat model is "a rater screenshots and tweets," not espionage

- Centercode (beta-program tooling): "beta NDA leaks are actually quite rare"; violations are
  "usually the result of accidents or ignorance"; when leaks happen the source is often the
  buyer's own org. Leak probability scales with cohort size and content desirability — a
  10–50-rater cohort rating a landing page sits at the bottom of every risk axis.
- Press embargoes — handshake agreements with zero legal force — hold at scale, enforced purely
  by future-access forfeiture. Deterrence-by-exclusion demonstrably disciplines disclosure.
- Screenshot prevention is theater (every vendor admits nothing stops a phone camera). The
  working stack is: unique per-viewer URLs (catches link-sharing), visible per-viewer watermarks
  (the main psychological deterrent — the rater sees their own ID on the leakable surface),
  view-only rendering, time-boxing. All ~free to build. Invisible forensic watermarking is
  $150–450/mo off the shelf if a premium tier ever wants it.

### Click-through terms: legally real, practically a slashing predicate

- US courts enforce clickwrap (~70% success vs ~14% for browsewrap; *Berman*, *Meyer v. Uber*);
  eIDAS/E-Sign accept cryptographic signatures, and SIWE (EIP-4361) standardizes a `statement`
  field for exactly "I accept terms at <url>" — deployed precedent for wallet-signed terms.
- Against a pseudonymous wallet, litigation value is ~zero (no case law yet; treat it as such).
  But that misses how the industry actually enforces: removal, cohort-publicized penalty,
  reputation/earnings destruction. HackerOne private programs — the best gated-cohort analog —
  make accepting the invite *itself* the non-disclosure event, and enforce via eviction from a
  valuable invite pool. RateLoop's version is strictly stronger: the wallet has staked bonds,
  rating reputation, and a World ID behind it. The signed terms are (a) the provable predicate
  for slashing and (b) norm-setting; design the economics, not the lawsuit.

### Blinding kills most of the problem for free

Unbranded stimuli are *already* market-research best practice (monadic blind testing isolates
the concept from brand halo), and PickFu's respondents never see who is asking. A leaked
screenshot of an unbranded landing-page concept with no attribution has near-zero competitive
value. For concept/copy/creative tests — the bulk of RateLoop's confidential demand —
de-attribution alone converts a secrecy problem into a noise problem. Redacted/minimal stimuli
demonstrably still produce decision-grade signal (the entire monadic-testing literature).

### The repo is closer than expected

- Context integrity is anchored on-chain as hashes (`contentHash`, `detailsHash`,
  media-tuple hash); the bytes live behind Next.js routes (`/api/attachments/*`, Vercel private
  blob + Postgres) that are currently served without auth. The exact wallet-signature primitives
  needed already exist: `signedActions.ts` (EIP-191 challenges, one-time nonces),
  `signedReadSessions.ts` (7-day scoped cookies), the image-upload challenge flow, MCP bearer
  scopes. Moderation already runs at upload, before any gating would apply.
- The two leak layers are distinct: the **serving layer** (fully gateable today) and **on-chain
  event URLs** (`ContentSubmitted.url`, `QuestionContentAnchored`, `ContentDetailsSubmitted`).
  For RateLoop-hosted attachments the on-chain URL is an opaque ID — harmless. Only *external*
  context (`contextUrl`, YouTube `videoUrl`) leaks by reference, so private mode simply
  disallows it (or allows only public-safe externals).
- Terms acceptance today is localStorage-only (`TermsAcceptanceContext`) — unusable as an
  enforcement predicate; a server-side acceptance log is required regardless.
- `packages/nextjs/README.md` already lists private artifacts / voter-only context as
  deliberately deferred — this plan is the un-deferral.

## The design: Private Context Mode

### Access rule: terms-gate, not commit-gate

Raters must see context *before* committing (to decide whether and how to vote), so "has a
commit on this round" can't be the gate — that's circular. The HackerOne model applies: 
**accepting the confidentiality terms is the access event.** Concretely, a rater requesting
gated context must present a wallet session whose address has a server-recorded, wallet-signed
acceptance of the confidentiality terms for that question (SIWE-style message embedding the
terms URI, question id, nonce, timestamp). Optionally (private-program tier) the address must
also clear reputation/World ID/stake thresholds. Access is time-boxed to the round window and
revoked at reveal; every access is logged per rater.

### MVP components (app layer only, no contract change)

1. **`contextVisibility: "public" | "gated"`** in question metadata (hashed into
   `questionMetadataHash` as today) + a DB/Ponder flag. Gated questions require RateLoop-hosted
   context only: uploaded images + hosted details; no external `contextUrl`/`videoUrl`. Titles
   and tags stay public and must be non-sensitive (validated guidance at submit; titles are in
   the on-chain submission key).
2. **Server-side terms acceptance log** — new table keyed (wallet, questionId, termsVersion,
   signature, timestamp); acceptance flow reuses the `signedActions` challenge pattern. Short,
   plain-language terms (PickFu's one-liner is the model: don't record, copy, share, or discuss;
   proportionate consequences — no $1M liquidated damages on a $0.50 task).
3. **Gated serving** — `/api/attachments/images/[id]` and `/api/attachments/details/[id]` check
   visibility flag → require session + acceptance → stream with `Cache-Control: private,
   no-store`, `X-Robots-Tag: noindex, noimageindex`. EIP-1271/6492-aware signature verification
   is mandatory (World App users are smart accounts; EOA-only verification locks out the main
   rater base).
4. **Watermark + traceability** — server-side sharp overlay of rater address prefix + timestamp
   on images at serve time; per-rater access logging (the canary pattern — unguessable
   resource access bound to an authenticated wallet gives leak attribution for link-sharing,
   watermarks cover screenshots).
5. **Surface redaction** — Ponder strips `media[]`/`detailsUrl` from public responses for gated
   content (or serves them only to terms-accepted sessions); generic OG image for gated
   questions (link-preview crawlers cache `og:image` on their CDNs unauthenticated — the classic
   leak); excluded from sitemap; feed shows title + "private context" badge.
6. **Agent path** — gated context delivery through authenticated MCP: `walletAddress`-bound or
   managed-token calls can fetch context after programmatic terms acceptance
   (`rateloop_accept_context_terms` or acceptance bundled into the rating-context tool);
   `rateloop_get_result` `limitations` notes when context was private.
7. **Disclosure policy per question** — `private_until_settlement` (flag flips on the settlement
   event; restores public auditability post-hoc, matches the embargo norm buyers already know)
   or `private_forever`. Default to disclosure-after-settlement: it preserves the "public
   auditable result" story with a delay instead of abandoning it.
8. **Breach policy, published** — modeled on Centercode/HackerOne: proven leak → access ban +
   reputation consequences + clawback of pending bounties + the penalty announced to the cohort
   (cheap and disproportionately effective). Governance arbitrates contested cases, consistent
   with the existing optimistic trust model.

### Known gotchas to engineer around (from production postmortems)

- Never `public`/`s-maxage` on gated routes (one header serves rater A's bytes to the world).
- `next/image` optimizer must not sit in front of gated URLs (its shared cache ignores request
  headers — CVE-2025-57752); proxy images through the authed route, `unoptimized` rendering.
- Uploads must go to the private store from the start, not a public bucket later made private.
- Ponder's API is public by default — redaction belongs in the route layer, and gated context
  bytes/URLs must never enter indexed fields.
- Re-check authorization in the route handler per request, never only in middleware or at login.

## Tiers (each subsumes the previous)

| Tier | What | Effort | Unlocks |
| --- | --- | --- | --- |
| 0. Blinding guidance | Submit-flow + agent-docs guidance: unbranded stimuli, pseudonymous asker, redaction checklist; position as MR best practice | Days | Most concept/copy/creative confidentiality, free |
| 1. Private Context Mode | MVP above: gated RateLoop-hosted context, signed terms, watermarks, redaction, disclosure-after-settlement | ~2–4 weeks | Pre-launch tests, NDA-expected buyers |
| 2. Private-program cohorts | Gated questions route only to raters above reputation/stake/World ID thresholds, zero violations; optional extra **slashable confidentiality bond**; smaller audiences (10–15) | Weeks, after Tier 1 | Higher-sensitivity work; the collateralized-NDA differentiator |
| 3. Embargo hardening + forensics | tlock-wrapped content keys for trustless eventual disclosure (reuses drand: AES-encrypt assets, tlock-wrap the 32-byte key to worst-case-settlement round); invisible forensic watermarking ($150–450/mo) and leak monitoring as a paid tier | Weeks, optional | Enterprise tier; disclosure survives RateLoop's server disappearing |

## Cryptographic upgrade path (only if server-trust becomes a real objection)

The MVP's trust model — raters trust RateLoop's server, which already serves them plaintext
bytes either way — matches the protocol's optimistic posture and the production norm
(Paragraph/Hypersub-class gated platforms are server-side checks all the way down). If
"RateLoop can read my context" ever blocks deals:

- **Event-exact disclosure:** Shutter API's event-based decryption triggers ("release key when
  `RoundSettled` fires") replace time-based tlock — needs a conversation with their team about
  World Chain observation; Gnosis-centric today.
- **Server-blind content:** client-side encrypt at upload, key gated via Lit Protocol
  (conditions can check a World Chain contract; ~$0.01/decrypt) — but Lit pivoted to a TEE
  architecture in early 2026 after sunsetting its MPC network in six months; adopt only after
  it shows stability. Per-rater wallet key-wrapping is a dead end
  (`eth_getEncryptionPublicKey`/EIP-1024 deprecated, unsupported by World App smart accounts).
- **Not worth building:** TEE serving (Oasis/Phala — relocates trust without changing rater
  UX), screenshot-blocking DRM (loses to a phone camera, every vendor admits it), FHE/anything
  whose buyer requirement doesn't exist — PickFu and Wynter sell confidential testing on a
  checkbox.

## What this changes elsewhere

- **Docs/marketing claims:** "public, auditable result URL" becomes "public result, context
  public or disclosed-after-settlement per asker choice" — `skill.md`, `docs/ai`,
  how-it-works, and the agent runbook need consistent language; agent `limitations` must flag
  private-context rounds.
- **Use-case re-rating:** Tier 1+2 moves the confidential slice of market research (use case 5)
  and creative pretesting (use case 2) up materially — Wynter's entire NDA-bound segment shape
  becomes addressable; proprietary code review remains out of scope (needs HackerOne-grade
  vetted cohorts and is a different product) — cross-reference added in
  `use-cases-2026-06.md`.
- **Duplicate detection:** unchanged for hosted attachments (pointer equality); `by-url` simply
  has nothing external to match for gated questions.
- **Moderation:** unchanged — runs at upload, pre-gating.

## Decisions needed

1. **Default disclosure policy:** disclosure-after-settlement as the default (recommended — it
   keeps the auditability story) vs. asker-chosen with `private_forever` allowed from day one.
2. **Who can rate gated questions in Tier 1:** any terms-accepting wallet (max supply) vs.
   minimum-reputation floor from the start (less leak surface, thinner supply).
3. **Terms scope:** one platform-level confidentiality clause accepted once per wallet +
   per-question acknowledgment (lighter UX) vs. full per-question signed acceptance (stronger
   predicate). Recommended: platform clause once, per-question signed acknowledgment for gated
   asks.
4. **Whether Tier 2's confidentiality bond is LREP or USDC**, and its size relative to the
   question bounty.
5. **Pricing:** gated mode as a flat premium on the ask, or bundled free to drive adoption and
   priced only at Tier 2/3.

## Sources

Selected; full URL lists live with each research pass.

**Incumbent practice:** pickfu.com (respondent NDA, public-disclosure stance), help.usertesting.com
(NDA workflows, "honor system"), wynter.com (cooperation agreement, Paddle case study),
centercode.com (NDA leak rarity, breach playbook), docs.hackerone.com / bugcrowd.com (private
program invitations, invite-acceptance-as-NDA, trust tiers), apple.com/legal (TestFlight
confidentiality)

**Legal:** Berman v. Freedom Financial (9th Cir. 2022), ironcladapp.com (clickwrap ~70% vs
browsewrap ~14%), ercs.ethereum.org/ERCS/erc-4361 (SIWE statement field), Epic v. Fortnite
testers (pcmag, Globe and Mail)

**Deterrence tech:** docsend.com (dynamic watermarking), imatag.com / parchmark.com /
forensicmark.com (forensic watermarking pricing), canary.tools (canary tokens)

**Gating rails:** docs.siwe.xyz (security considerations, EIP-1271/6492),
vercel.com/docs/vercel-blob (private storage, signed URLs), github.com/vercel/next.js
discussion 90639 (CVE-2025-57752 image-optimizer header forwarding), docs.drand.love
(timelock encryption), blog.shutter.network (event-based decryption triggers),
developer.litprotocol.com / spark.litprotocol.com (v3 Chipotle pivot, Naga sunset),
safefoundation.org (state of encryption in web3, EIP-1024 deprecation)
