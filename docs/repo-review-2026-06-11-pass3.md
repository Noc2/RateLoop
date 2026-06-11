# Repository Review, Pass 3 — 2026-06-11

Third multi-agent review, covering the 25 commits between `adf75c93` (pass 2) and
`abc478de` (HEAD) — the fix wave responding to pass 2, plus the new World Chain
Sepolia deployment sync and readiness-script updates. Five scoped reviewers plus an
auditor for the 19 outstanding items from passes 1–2; every candidate adversarially
re-verified. 10 of 13 candidates confirmed; after merging duplicates, **9 distinct new
findings**: 1 high, 4 medium, 4 low.

**Headline: all 19 outstanding items from passes 1 and 2 are verified fixed** —
including the pass-1 carryovers (storage re-drift, fee-withdrawal bypass on chain,
stale comment). The 4801 deployment, artifacts, storage layouts, and CI gate are now
consistent. The new findings are mostly second-order: fixes that work on the path they
were tested on but miss a sibling path, and two deliberate fail-open trade-offs worth
a conscious decision.

## Summary

| # | Sev | Area | Finding |
|---|-----|------|---------|
| 1 | High | Gating | Pending-gated fail-closed fix never runs for direct UI submissions — pass-2's public window + 1-year cache persists on the human path |
| 2 | Medium | Gating | Transient RPC failure at confirm permanently strands gated images (404 for everyone, no retry) |
| 3 | Medium | Agents | Local signer hard-fails on env values the server silently accepts — documented dev env breaks every CLI command |
| 4 | Medium | Ponder | Fail-closed disclosure is a one-shot settlement trigger: late sync or any production reindex leaves `after_settlement` content permanently undisclosed |
| 5 | Medium | CI | ConfidentialityEscrow proxy excluded from the storage-layout snapshot gate |
| 6 | Low | Ponder | `2cbffb68` turns missing-artifact boot failure into silent zero-address indexing (fail-closed control became fail-open) |
| 7 | Low | Agents | Server-supplied metadata base silently overrides the operator-pinned env var, contradicting the new CLI docs |
| 8 | Low | Scripts | Readiness script lists ProtocolConfig as a proxy but never actually checks it |
| 9 | Low | Copy | Social alt text now says "Level Up Your Agent" while og-image.jpg still renders "Lever Up Your Agents" |

---

## 1. Gated attachments still publicly served on the browser path (HIGH)

`ba1ba89d` fixed pass-2 finding 3.2 by persisting `requires_gated_access` at prepare
time — but `markGatedHostedAttachmentsForSubmission` (`questionSubmission.ts:405`) is
invoked only from the agent/x402 prepare paths (lines 2966, 3078). The direct UI gated
flow (`ContentSubmissionSection.tsx`) never calls a prepare endpoint: it uploads via
`/api/attachments/details/upload` and the image uploader (neither sets
`requiresGatedAccess`), submits on-chain directly via `writeContract` (~2688) or
sponsored calls (2597), and only afterwards links via `POST
/api/attachments/details/attach` (1728). Between the transaction being mined — when
the `det_`/`att_` URLs become public via event data — and the attach call completing,
the details route serves the full confidential text with `Cache-Control: public,
max-age=31536000, immutable`, and images with `public, max-age=300`. The attach call
is a plain post-transaction fetch with no retry (throws at 1738-1740); if it fails or
the tab closes, the gated content is publicly served indefinitely (the orphan sweep
deletes only blocked/failed rows, not approved unattached ones). The commit's own
fail-closed test only covers attachments that went through agent prepare.

**Fix:** set `requiresGatedAccess` at upload time when the submission is flagged
gated (the upload routes already receive the question context), or require a prepare
step for gated UI submissions; and never emit the immutable public cache header before
content linkage exists.

## 2. One RPC blip at confirm strands gated images forever (MEDIUM)

`099610c5` links images at confirm based on `resolveSubmissionMediaValidator`
(`questionSubmission.ts:1077-1090`), a single best-effort `eth_call` with
`.catch(() => null)` — on failure, zero `QuestionContentAnchored` events are collected
and nothing is linked, silently. Confirm then marks the record `submitted` and every
later confirm returns early (3126-3131), so linking is never retried, and nothing in
the agent flow calls the permissionless attach route to repair it. Combined with the
fail-closed rule, a sustained RPC blip (past viem's 3 retries) during one confirm
leaves the images at `requiresGatedAccess=true / contentId=null` permanently: the
image route 404s for **everyone** — including raters who accepted terms and posted
bonds — and the authorized URL list returns zero images. Details link via a different
event source and survive, making the half-linked state easy to hit and confusing to
debug. **Fix:** let the read failure propagate (fail the confirm so it retries),
or make linking re-runnable after `submitted`.

## 3. Local signer crashes on env the server accepts (MEDIUM)

`3bd7c47b` aligns the agent's metadata base with the server by reading
`NEXT_PUBLIC_PONDER_URL`/`NEXT_PUBLIC_APP_URL` in `loadLocalSignerConfig` — but routes
it through `parseQuestionMetadataBaseUrl`, which **throws** on non-HTTPS, unparseable,
or credential/query/hash-bearing URLs (`localSigner.ts:3519`, parse at 443-449). The
server counterpart silently falls back to the default base for the same values
(`normalizeQuestionMetadataBaseUrl`). The repo's own `.env.example:109` documents
`NEXT_PUBLIC_PONDER_URL=http://localhost:42069`, so any dotenv/docker/CI environment
with the documented dev value makes the agent CLI throw — including
`rateloop-agent wallet --generate`, which has nothing to do with metadata. The error
message blames `RATELOOP_LOCAL_SIGNER_QUESTION_METADATA_BASE_URL`, a variable the user
may never have set. **Fix:** apply the server's normalize-with-fallback semantics (or
at minimum skip validation for commands that don't hash payloads, and name the actual
offending variable).

## 4. Disclosure is now one-shot with no recovery (MEDIUM)

`521186e1` correctly flipped settlement disclosure to fail-closed
(`policy === "after_settlement"`), but the decision runs only inside the
RoundSettled/Tied/RevealFailed handlers — the sole writer of
`confidentialityPublishedAt` — while `confidentialityDisclosurePolicy` remains an
off-chain column written only by the best-effort metadata push. Two stuck states:
(1) if the sync lands after settlement, a later successful re-push sets the policy but
nothing ever publishes — the content stays redacted on the public API forever;
(2) every production Ponder redeploy reindexes a fresh deployment-scoped schema with
the synced columns wiped, so settlement events replay with `policy=null` and **all
previously disclosed after_settlement content is permanently re-redacted** after each
deploy. The on-chain event has a `uint8 flags` field that could carry the policy, but
submission hardcodes `flags=0` and no indexer decodes it — the policy is unrecoverable
from chain data today. **Fix shape:** encode the disclosure policy in the on-chain
flags (verifiable, reindex-proof), or add a reconcile path that publishes
late-synced/late-replayed after_settlement content.

## 5. ConfidentialityEscrow missing from the layout snapshot gate (MEDIUM)

ConfidentialityEscrow is now a live TransparentUpgradeableProxy on 4801 (proxy
`0xaE67…987A`, with its own ProxyAdmin), but the `CONTRACTS` lists in
`check-storage-layouts.sh:33` and `snapshot-storage-layouts.sh:15` omit it, and no
`expected-storage-layouts/ConfidentialityEscrow.json` exists — despite the script's
header promising coverage of "every TransparentUpgradeableProxy-backed contract"
(M-Crosscutting-1). The same fix wave added the escrow to every other pipeline
(broadcast export, generateTsAbis, readiness script), so this is the one missed list.
Given that storage drift on proxied contracts has now bitten this repo twice (pass-1
2.1, pass-2 section 2), the gap is worth closing immediately: add it to both scripts
and snapshot.

## 6. Missing-artifact boot failure became silent zero-address indexing (LOW)

`2cbffb68` removed the production throw in `resolveOptionalAddress`
(`ponder.config.ts:273`): a missing ConfidentialityEscrow/ClusterPayoutOracle artifact
now yields one `console.warn` and indexes the zero address from block 0 — asserted as
intended by the new test. With a stale artifact (the exact state this repo entered in
both prior passes, and the live state for 12 minutes between `2cbffb68` and the
`abc478de` artifact sync), gated questions index `gated=false` on the chain-derived
leg and the public API's redaction rests solely on the best-effort metadata push
(attachment bytes stay protected by the Next.js layer; bond/disclosure indexing is
silently absent). It also contradicts the invariant still documented in the same file
("frontend, keeper, and indexer must agree on the same shared deployment artifacts",
lines 221-223). Partial mitigation: the CI readiness script now requires both
contracts on 4801 — but it is advisory, 4801-only, and won't exist for mainnet on day
one. Recommend: keep the warn for local/dev, restore the throw when
`PONDER_NETWORK` is a live chain.

## 7. Server-supplied metadata base overrides the operator's pin (LOW)

The fix for pass-2 5.1 made `readAskQuestionMetadataBaseUrl(ask) ??
config.questionMetadataBaseUrl` (`localSigner.ts:3216-3218`, 3847-3849) — and the
server now always emits the field, so the documented
`RATELOOP_LOCAL_SIGNER_QUESTION_METADATA_BASE_URL` ("Metadata base used for local
canonical ask hashes", per the new CLI help) is dead in practice: any HTTPS base the
server chooses is folded into the salt/operationKey the agent signs. Deliberate (a
test asserts server precedence), and impact is bounded since the URI never reaches the
chain — but the docs contradict the behavior and the pin gives a false sense of
control. Suggested: warn or fail when an operator-pinned base differs from the
server-supplied one.

## 8. Readiness script never checks ProtocolConfig (LOW)

`check-worldchain-sepolia-readiness.mjs` lists ProtocolConfig in `PROXY_CONTRACTS`
(line 56), but it is absent from `REQUIRED_DEPLOYED_CONTRACTS` and the selector loops,
so no check ever runs for it — its 4801.json/deployedContracts.ts address sync and
bytecode are unverified, even though the gated-context flow depends on
`ProtocolConfig.confidentialityEscrow()`. The set is inconsistent the other way too:
RaterRegistry, FeedbackRegistry, and ConfidentialityEscrow are real proxies on 4801
but not in `PROXY_CONTRACTS`, so a future selector check for them would grep proxy
bytecode instead of the implementation.

## 9. Alt text fixed, image not regenerated (LOW)

`d8484d38` changed the social alt text to "Level Up Your Agent" (per
`copy-update-ideas-2026-06.md:181`, which classed the old text as a typo) — but
`public/og-image.jpg` (and `twitter-image.jpg`, same artwork) still visibly render
"Lever Up Your Agents". The alt now describes text that isn't in the image; the typo
users actually see is in the rendered asset. Re-export both images or revert the alt
until then.

---

## Status of prior findings

**All 19 outstanding items are fixed** — verified against code, the storage-layout
gate (now green), the new `deployments/4801.json`, and live World Chain Sepolia
bytecode where applicable:

- **Pass-2 1.1–1.3** (deploy drift): resolved by the coordinated redeploy + artifact
  sync (`abc478de`); the 13-arg `submitQuestionWithX402Payment`, 12-input
  `submitQuestionWithRewardAndRoundConfig`, and ConfidentialityEscrow are live and
  consistent across artifacts.
- **Pass-2 2.1–2.3** (storage drift): `71cf5665` appends the ProtocolConfig slot,
  `404c6fd8` restores the RaterRegistry follow slots as placeholders, `549c4953`
  re-snapshots the rest; `check-storage-layouts.sh` passes at HEAD.
- **Pass-2 3.1–3.4** (leaks): image linking added (`099610c5`), pending-gated
  fail-closed (`ba1ba89d`), disclosure fail-closed (`521186e1`), targetAudience
  visibility docs corrected (`1c9d4446`) — with the path gaps noted in findings 1, 2
  and 4 above.
- **Pass-2 4.1/4.2**: pre-insert update removed (`190b0f92`); targetAudience removed
  from payout artifacts entirely (`7b25b575`).
- **Pass-2 5.1/5.2, 6.1, 7.1**: metadata base aligned (`3bd7c47b`), dry-run
  `targetAudienceMatch` added (`3f054651`), claimed refunds hidden via Ponder claim
  records (`280aa7da`), failed lock sessions destroyed (`73faf129`).
- **Pass-1 carryovers 2.1/2.2/5.4**: all resolved (layout consistent with the new
  deployment; the fee-withdrawal-delay revert is in the deployed bytecode; comment
  corrected in `7c9e5e32`).

## Refuted candidates (for the record)

- **One-way `requiresGatedAccess` lets a free prepare permanently gate attachments** —
  structural observations accurate, but no exploitable harm in current flows.
- **Production mainnet Ponder silently indexing zero address** (stronger variant of
  finding 6) — the headline trigger doesn't occur with current artifacts; the
  narrower fail-open-direction concern survived as finding 6.
- **Keeper lock fix missing the acquire path** — the claimed failure cannot occur
  given the actual call dependencies.

## Suggested order of attack

1. **Finding 1** — same severity class as the pass-2 leak it was meant to close; the
   browser path needs the same prepare-time (or upload-time) gating.
2. **Finding 2** — make confirm-time linking fail loud or be retryable; cheap fix,
   ugly stuck state.
3. **Findings 3 and 5** — one-line-ish: normalize instead of throw; add the escrow to
   the two layout scripts.
4. **Finding 4** needs a small design decision (on-chain flags vs reconcile job)
   before gated content ships to real users.
5. **6–9** are quick, independent cleanups.
