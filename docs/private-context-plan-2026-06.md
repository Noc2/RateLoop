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

**Scope decision (2026-06-11):** Tiers 0–2 are adopted for implementation; Tier 3 and the
cryptographic upgrade path below are explicitly deferred. The concrete implementation plan
follows after the deferred sections. Since contracts are not yet deployed on mainnet, the
contract-level pieces (confidentiality snapshot, rater bond, identity ban) ship in the initial
deployment with governance-tunable parameters for later fine-tuning.

## Implementation plan (Tiers 0–2)

The plan below was built from two repo-mapping passes (contracts and app surface) and then
adversarially reviewed by independent security/design agents whose findings are folded in. The
review materially changed the original sketch; the changes are listed first because they define
the architecture.

### Design corrections from the adversarial review

1. **The bond must gate *access*, not just commit.** Leakage happens at viewing; a
   sign-terms → view → leak → never-commit attacker would otherwise post no bond at all. The
   serving layer checks bond-posted (when `bondAmount > 0`) before serving bytes; the engine
   commit gate is a consistency check, not the security boundary. Bond lifecycle therefore
   starts at access-grant, and a viewer who never votes still has their bond locked through the
   evidence window.
2. **The identity ban gates surplus earnings only — never staked principal or refunds.** A
   ban that blocks `claimReward`/`claimCancelledRoundRefund` wholesale would let a 100k-LREP
   quorum confiscate any rater's stake (the exact governance-extraction vector the I-7 audit
   note forbids). Banned scope: bounty claims, launch credits/caps, advisory credits, feedback
   bonuses, the voter-pool `reward` leg — never `stakeReturned`, never cancelled-round refunds.
   Confiscation is what the bond slash is for.
3. **Bans are keyed by `(provider, nullifierHash)`, not by any single identity key.** The
   three key derivations (`credentialIdentityKey`, `launchHumanIdentityKey`,
   `addressIdentityKey`) don't intersect, and a credential-key-only ban misses every launch-pool
   path while an address ban dies on wallet rotation. At ban time the registry derives and
   stores all three keys plus the raw nullifier record so re-attestation from a fresh wallet can
   never mint a clean key. Consumers get one view: `isIdentityKeyBanned(bytes32)` checked
   against the commit-time identity key each claim path already recovers.
4. **Gated questions require an active human credential to commit and to access.** Without
   it, bond-0 questions have zero enforcement against address-only raters (a new EOA costs
   nothing). The engine already computes `hasActiveHumanCredential` per commit, so the check is
   nearly free. Banned identities are also blocked from gated commits/access (but not from
   public questions — no confidentiality rationale, and the registry's non-gating doctrine
   stands).
5. **One new contract, not two.** The per-content confidentiality config is one packed word
   (`gated`, `bondAsset`, `bondAmount`, flags) embedded in the bond escrow contract
   (`ConfidentialityEscrow`), written once by `ContentRegistry` at submit. A separate registry
   buys nothing but an extra cross-contract read. The on-chain disclosure-policy field is
   dropped entirely — disclosure timing is serving-layer behavior already committed inside
   `questionMetadataHash`, and tying bond release to a disclosure event would strand
   `private_forever` bonds.
6. **Bond release is pull-based and pure-view — no engine→escrow callbacks.** The engine's
   bundle-observer replay machinery exists precisely because push-notify into escrows fails.
   Releasable when any of: content no longer `Active`, reward pool terminal, or
   `postedAt + maxBondLockDuration` elapsed — each **plus** a 21-day evidence window (sized to
   the governance path, mirroring `FEE_WITHDRAWAL_DELAY`), so a slash can always outrun release.
7. **Watermark forgery is cheap; the evidence artifact carries the proof.** An asker can leak
   their own content and Photoshop a victim's address onto it (slash-bait). Watermarks embed a
   per-view HMAC token (`identityKey`, `contentId`, `viewId`, server secret) recorded in the
   access log; forged marks fail server verification. Published evidence standard for any
   slash/ban: terms-acceptance record + access-log entry + verified view token. Acceptance and
   access logs are anchored as daily Merkle roots (the payout-root trust shape: public
   deterministic artifact, recomputable, governance-arbitrated) so slash cases never reduce to
   "trust the server screenshot".
8. **Ban power is constrained in code, not just process.** `banIdentity` requires a nexus (the
   identity has a bond, gated commit, or recorded acceptance anchor — governance cannot ban
   arbitrary identities), a reason ≤280 bytes + `evidenceHash`, and a default expiry
   (permanent = explicit flag); `unbanIdentity` always available.
9. **Advisory votes are disallowed on gated content** (one check in `AdvisoryVoteRecorder`
   against the confidentiality snapshot) — otherwise unbonded, possibly uncredentialed
   participation with a launch-credit earning path routes around the gate. Bundles require
   uniform confidentiality terms across members (bundle atomicity makes mixed bundles stall).
10. **EIP-1271/6492 signature verification is a hard prerequisite.** The entire signed-action
    stack verifies with viem's offline EOA-only `verifyMessage`; World App users are Safe-based
    smart accounts and would be locked out of terms acceptance and every gated flow. Fixing
    this (client-based `verifyMessage` against the chain) lands first.

### Decided product parameters

- **Bond:** asker-defined per question, LREP or USDC, `0` allowed. `bondAmount == 0` means no
  escrow entry at all — the gate is then flag + credential + ban only (zero extra tx for
  raters). Non-zero bonds are bounded `minBond ≤ amount ≤ maxBond` (governance-tunable).
- **Identity penalty applies in every case:** proven breach → World ID identity loses earning
  power protocol-wide (and gated access), regardless of bond size, including bond = 0.
- **Defaults for the open questions from the research phase:** disclosure-after-settlement is
  the default policy (`private_forever` allowed); platform confidentiality clause accepted once
  per wallet + per-question signed acknowledgment for gated asks; gated mode ships unpriced
  (bond friction is enough for v1); gated rating requires an active human credential.

| Parameter | Default | Bounds (governance) | Precedent |
| --- | --- | --- | --- |
| `minBond` (when nonzero) | 1e6 | fixed | `MIN_CHALLENGE_BOND` |
| `maxBond` | 100e6 | ≤1,000e6 | `MAX_CHALLENGE_BOND` (anti-spam scale, not coverage) |
| Reporter share of slashed bond | 5,000 bps | fixed | `CHALLENGER_BOUNTY_BPS` |
| Evidence window (bond locked past terminal trigger) | 21 days | 7–30 days | `FEE_WITHDRAWAL_DELAY` rationale |
| `maxBondLockDuration` (hard stop from `postedAt`) | 120 days | 30–180 days | Covers worst-case round sets; no stranding |
| Ban duration | 365 days | permanent = explicit flag | Person-targeted sanctions decay by default |
| Slash/ban reason | ≤280 bytes + `evidenceHash` | fixed | `MAX_SLASH_REASON_LENGTH` |
| Advisory votes on gated content | disallowed | governance-flippable | Closes the bypass |
| Acceptance/access log roots | daily epoch | — | Payout-root artifact shape |

### Workstream A — Contracts (pre-mainnet; ~1.5–2 weeks)

New contract **`ConfidentialityEscrow`** (transparent proxy + `__gap`, matching repo
convention), with library `ConfidentialityLib` for size discipline:

- Per-content config, write-once by `ContentRegistry` at submit: packed
  `{bool gated, uint8 bondAsset, uint64 bondAmount, uint8 flags}`.
- `postBond(contentId)` — resolves `identityKey` via `RaterRegistry.resolveRater` (delegate-safe:
  keyed to the holder's identity, not `msg.sender`), pulls LREP via EIP-2612 permit or USDC via
  EIP-3009 (`commitVoteWithPermit` / `FeedbackBonusEscrow` patterns); CEI ordering.
- `hasActiveBond(contentId, identityKey)` view for the engine gate and the serving layer.
- `releaseBond(contentId, identityKey)` — permissionless pull paying the recorded poster;
  pure-view release predicate (content inactive / pool terminal / max lock elapsed, each +
  evidence window); per-item failure isolation so a USDC-blocklisted poster can't strand others.
- `slashBond(contentId, identityKey, reason, evidenceHash, reporterRecipient)` —
  `GOVERNANCE_ROLE` (timelock); 50% reporter share from the slashed bond only, remainder to
  `confiscationRecipient`; recipient sanity checks mirroring `slashFrontendWithBounty`.
- Events: `ConfidentialityConfigured`, `BondPosted`, `BondReleased`, `BondSlashed`.

**`RaterRegistry`** (upgradeable, gap available):

- `banIdentity(provider, nullifierHash, expiry, reason, evidenceHash)` /
  `unbanIdentity(provider, nullifierHash)` — `GOVERNANCE_ROLE`; derives and stores all three
  identity keys + raw nullifier record; nexus check against `ConfidentialityEscrow`; hooks in
  `_attestHumanCredential`/rotation paths propagate bans to newly derived keys.
- `isIdentityKeyBanned(bytes32)` view; integrated into `credentialStatusBits` where appropriate
  so credential-gated paths in non-upgradeable consumers get coverage through the registry choke
  point.

**Earning-path gating** (surplus legs only): `QuestionRewardPoolEscrowClaimLib` (bounty claims),
`RoundRewardDistributor.claimReward` `reward` leg (never `stakeReturned`),
`LaunchRaterRewardLib.launchRewardAnchorId` (return zero for banned launch keys),
`LaunchDistributionPool` verified bonus/cap unlock, `AdvisoryVoteRecorder` launch credits,
`FeedbackBonusEscrow` awards. Documented consciously-accepted leaks: settlement-caller 1%
incentive, frontend fee path (mitigated by checking bans at `FrontendRegistry.register`),
legacy merkle claims.

**Commit gate:** extend `VotePreflightLib.validateVoterAndContent` (external library — engine
bytecode stays flat) with: gated flag → require active human credential, not banned, and
`hasActiveBond` when `bondAmount > 0`. **Fail-closed** on escrow revert (a broken gate blocks
gated commits; rounds then expire to full refunds). Escrow address snapshotted per round at
creation (`RoundCreationLib`), consistent with existing registry snapshots.
`AdvisoryVoteRecorder.commitAdvisoryVote` rejects gated content.

**Submission plumbing:** confidentiality params passed as a separate struct argument on the
submit entrypoints (`submitQuestion`, `submitQuestionWithRewardAndRoundConfig`, bundle variant,
`submitQuestionFromX402Gateway`) — not folded into `SubmissionRewardTerms`. The x402 payment
nonce domain (`X402QuestionSubmitter._hashRewardTerms`) extends to cover the confidentiality
struct so authorizations bind to it (safe now; the submitter is not yet deployed). Bundles:
one confidentiality struct applied uniformly to all members. `ContentRegistry` calls
`confidentialityEscrow.configure(contentId, params)` once per content; wiring via
`ProtocolConfig` setter + `Deploy.s.sol` (proxy deploy, role grants to timelock, deployer
renounce, `deployments.push`).

### Workstream B — Backend (nextjs; ~2 weeks, parallel to A)

1. **Signature prerequisite:** swap offline `verifyMessage` in `lib/auth/signedActions.ts` for
   chain-backed verification (EIP-1271/6492-aware) across signed actions/read sessions.
2. **DB (drizzle migration `0005_*`):** `confidentiality_terms_acceptances` (wallet,
   identityKey, contentId, termsVersion, termsDocHash, signature, nonce, acceptedAt),
   `confidential_context_access_logs` (identityKey, contentId, resourceId, viewToken HMAC,
   viewedAt, ipHash with bounded retention), `confidentiality_breach_reports` (reporter,
   accused identityKey, contentId, evidenceUrl/hash, status), `question_confidentiality`
   mirror (contentId, gated, bondAsset, bondAmount, disclosurePolicy, publishedAt),
   `confidentiality_log_roots` (epoch, merkleRoot, publishedAt).
3. **Terms acceptance flow:** challenge + acceptance routes following the image-upload-challenge
   pattern; the signed message embeds contentId, the content commitment (`contentHash` /
   `detailsHash` / media-tuple hash — binding the bytes, not just the id), terms URI hash,
   nonce, timestamp. New signed-read-session scope `gated_context`.
4. **Gated serving:** `/api/attachments/images/[id]` and `details/[id]` check the
   confidentiality mirror → session → acceptance → credential/ban → bond (if nonzero) →
   stream with `Cache-Control: private, no-store` + `X-Robots-Tag` (replacing today's
   `public, max-age=31536000, immutable` on details — and dropping the wildcard ACAO for gated
   resources); sharp watermark overlay with the per-view HMAC token; access logged. Gated
   status must remain distinct from moderation `status` so sweep routes and the approved-check
   don't 404 where the breach UI needs a 403.
5. **Leak closures found in review:** generic OG metadata for gated questions — title and
   description currently leak into the CDN-cached OG image (`og/vote/route.tsx`) and meta title
   (`contentShare.server.ts`); gated titles must be non-sensitive by guidance *and* withheld
   from `followed_submission` / settling-soon email bodies (`emailDelivery.ts`); MCP
   quote/result surfaces (`tools.ts` submission keys, `resultPackage.ts` submitter-authored
   text) gated the same way; dictionary-attack note: details hashes are unsalted sha256 — salt
   the normalized text for gated details before hashing.
6. **Disclosure flip:** settlement-event handler (plus cron reconciliation) sets `publishedAt`
   when policy is `after_settlement`; routes stop gating; notification `context_now_public`.
7. **Evidence artifacts:** daily job Merkle-roots acceptance + access logs into
   `confidentiality_log_roots` and publishes the root (artifact host + on-chain anchor via the
   existing artifact pattern); breach reports reference epoch root + proofs.
8. **Notifications:** `context_now_public`, `breach_reported`, cohort breach announcement
   (Centercode playbook), with preference columns.

### Workstream C — Ponder (~3–4 days)

- Index `ConfidentialityConfigured`/`BondPosted`/`BondSlashed` + ban events into new tables;
  `content.gated` column from the on-chain event (no metadata decode needed anymore).
- Redaction in `content-routes.ts` modeled on `formatContentTargetAudience`: strip
  `description`, `media[]`, `detailsUrl` for gated-undisclosed content; **exclude gated
  descriptions from the search tsvector** (the search endpoint is otherwise a
  gated-description oracle); `by-url` unaffected (pointer equality).
- Settlement handler exposes disclosure state for the app flip.

### Workstream D — MCP / SDK / agents (~1 week)

- Payload: `confidentiality {visibility, disclosurePolicy, bond {asset, amount}}` in
  `X402QuestionItemPayload` + top-level allowlist + validation (`questionPayload.ts`), mirrored
  in `buildQuestionMetadata` (`packages/agents/src/questionSpecs.ts`, schema bump to
  `rateloop.question.v3`) and agent lint; quote warnings: bonded questions recruit thinner.
- New tools: `rateloop_accept_confidentiality_terms` (wallet-signed challenge) and gated
  context delivery via `rateloop_get_rating_context` returning authenticated fetch URLs +
  `contextAccess: "gated"`; `rateloop_get_result` redacts submitter-authored text until
  disclosure and notes private context in `limitations`.
- SDK: acceptance helper + gated-fetch support in read paths; agent docs (`public/docs/ai.md`,
  `skill.md`, `user-testing.md`, examples) updated, including Tier-0 blinding guidance.

### Workstream E — UI (~1.5–2 weeks)

- **Submit (`ContentSubmissionSection.tsx`):** "Private context" toggle on the question step —
  when on: forces RateLoop-hosted context only (no external URL/video), disclosure policy
  picker, non-sensitive-title hint; bond config (asset + amount, 0 default) on the bounty step;
  bundle drafts carry one uniform confidentiality config; agent handoff page parity.
- **Vote feed:** new `ConfidentialContextGate` component wrapping `ContentEmbed` /
  `QuestionDescription` in `VoteFeedCards.tsx` — locked state → terms modal (server-recorded
  acceptance) → bond posting tx when required → watermarked content; `useRoundVote` requires
  acceptance + bond before commit; "private context" badge in feed cards and stake modal.
- **Governance page:** new `breaches` tab (`GovernanceTab` union + hash route):
  `BreachReportForm` (accused identity, content, evidence URL + hash, view-token reference),
  `BreachReportList` (status: reported / under arbitration / slashed / dismissed),
  `BreachArbitrationPanel` wired to `GovernanceActionComposer` templates for
  `slashBond` + `banIdentity` timelock proposals (and `unbanIdentity`); slash/ban history
  rendered from Ponder-indexed events.
- **Profile:** sanction status (active ban + expiry) surfaced on `PublicProfileView`.

### Workstream F — Tests

- **Foundry:** `ConfidentialityEscrow.t.sol` (config write-once, bond post/release/slash,
  permit/3009 paths, release predicate matrix incl. dormant/cancelled/bundle/`maxBondLock`,
  evidence window, blocklisted-poster isolation); `RaterRegistrySanctions.t.sol` (ban derives
  all three keys, survives wallet rotation and credential re-attestation, nexus check, expiry,
  surplus-only scope); `RoundVotingEngineBranches.t.sol` additions (gated commit reverts
  without credential/bond/ban-clear; fail-closed on escrow revert; advisory rejection);
  `QuestionRewardPoolEscrow.t.sol` + `LaunchDistributionPool.t.sol` + `FeedbackBonusEscrow.t.sol`
  banned-claim cases (and `stakeReturned`/refund **not** blocked); `RoundIntegration.t.sol`
  end-to-end gated round; `InvariantSolvency` extended to bond escrow balances;
  `Governance.t.sol` slash+ban proposal calldata; `UpgradeTest.t.sol` layout; gas + size checks
  (`check-contract-sizes` must stay green — gate lives in `VotePreflightLib`).
- **nextjs (node tests):** terms challenge/acceptance routes; gated attachment routes (403
  without acceptance/bond, no-store headers, watermark token present); 1271/6492 verification;
  Merkle root job; OG redaction; email title withholding; MCP tool tests; payload validation.
- **Ponder (vitest):** redaction + search-vector exclusion; confidentiality event indexing.
- **agents (vitest):** metadata v3 build/lint; example specs.
- **e2e (Playwright):** `confidential-context.spec.ts` (submit gated → locked card → accept →
  bond → view watermarked → vote → settle → disclosure flip); `governance.spec.ts` breaches
  tab; smart-account session flow.

### Sequencing

1. EIP-1271/6492 verification fix (B-1) — unblocks everything wallet-signed.
2. Contracts (A) + deploy-script wiring; in parallel DB + terms acceptance + gated serving
   (B-2..5) behind a feature flag with bond UI limited to 0.
3. Ponder indexing/redaction (C); UI gate + submit toggle (E); MCP/SDK (D).
4. Bond UI + governance breaches tab + evidence artifacts (B-7, E-governance).
5. Docs/marketing language pass; enable the flag; Tier-0 blinding guidance ships with docs at
   any point.

## Cryptographic upgrade path (deferred — revisit only if server-trust becomes a real objection)

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

## Decisions (resolved 2026-06-11)

1. **Scope:** Tiers 0–2 implemented; Tier 3 and the cryptographic upgrade path deferred.
2. **Default disclosure policy:** disclosure-after-settlement; `private_forever` allowed.
3. **Who can rate gated questions:** any wallet with an active human credential that accepted
   the terms (and posted the bond when nonzero); banned identities excluded from gated
   commits/access.
4. **Bond:** asker-defined per question in LREP or USDC, `0` allowed (then no escrow entry —
   gate is flag + credential + ban only); bounded by governance-tunable `minBond`/`maxBond`.
   **The identity earning ban applies on proven breach in every case, including bond = 0.**
5. **Terms scope:** platform confidentiality clause accepted once per wallet + per-question
   signed acknowledgment for gated asks (server-recorded, content-commitment-bound).
6. **Pricing:** gated mode unpriced in v1; revisit with usage data.

Remaining open: exact governance proposal templates for breach arbitration wording, and whether
the `reward` leg of public-question voter-pool payouts is ban-gated or documented as an accepted
leak (recommended: gate it, since the claim path already resolves the identity key).

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
