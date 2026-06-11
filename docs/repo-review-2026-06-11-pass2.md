# Repository Review, Pass 2 — 2026-06-11

Second multi-agent review, covering the 73 commits between `c8f63b0e` (pass 1) and
`c56131d9` (HEAD) — primarily the confidentiality/private-context feature
(ConfidentialityEscrow, gated context serving, terms acceptance, breach governance),
legacy-contributor human seeding, the keeper-state rework, and the refreshed 4801
deployment. Seven scoped reviewers plus a dedicated auditor for the 27 pass-1 findings;
every candidate was adversarially re-verified against code, git history, and live
World Chain Sepolia bytecode. 19 of 21 candidates confirmed; after merging duplicates,
**16 distinct new findings**: 3 critical, 5 high, 4 medium, 4 low.

**Pass-1 status: 24 of 27 findings fixed, 3 partially fixed, 0 open** (details in the
last section). The team's fix pass included a full 4801 redeploy (`dfd909e2`) — but
that redeploy happened **before** the confidentiality feature landed, recreating the
exact deploy-drift pattern pass 1 documented, this time worse: the broken selectors are
in non-upgradeable contracts, and the storage-layout CI gate is now red at HEAD.

## Summary

| # | Sev | Area | Finding |
|---|-----|------|---------|
| 1.1 | Critical | Deploy drift | 4801 redeploy predates confidentiality — every x402 paid ask and single-question UI submission reverts |
| 1.2 | High | Deploy drift | ConfidentialityEscrow missing from all deployment artifacts; production Ponder for 4801 cannot boot |
| 1.3 | Low | Docs | Ponder README documents `PONDER_CONFIDENTIALITY_ESCROW_ADDRESS` semantics backwards |
| 2.1 | High | Storage | ProtocolConfig inserts `confidentialityEscrow` before live mappings — upgrade wipes advisory state |
| 2.2 | High | Storage | RaterRegistry mid-layout deletion shifts ~17 labels by two slots — upgrade corrupts delegation/World ID/replay state |
| 2.3 | Medium | Storage/CI | `make check-storage-layouts` red at HEAD for 4 contracts; RoundVotingEngine + ContentRegistry also drifted |
| 3.1 | Critical | Leak | Gated hosted images are never gated: nothing ever writes `question_image_attachments.content_id` |
| 3.2 | High | Leak | Gated details served publicly (1-year immutable cache) between submission and confirm |
| 3.3 | Low | Leak | Ponder auto-discloses gated metadata at settlement when disclosure policy was never synced |
| 3.4 | Low | Leak | `targetAudience` publicly served via `/question-metadata/:hash` despite "raters do not see" docs |
| 4.1 | Critical | Indexer | ConfidentialityConfigured handler updates the content row before it exists — first gated submission halts indexing |
| 4.2 | Medium | Payouts | Target-audience payout exclusions fail open and make artifacts non-reproducible |
| 5.1 | High | Agents | `questionMetadataUri` base-URL divergence hard-fails every local-signer ask in production |
| 5.2 | Medium | MCP | Dry-run result package missing required `targetAudienceMatch` — violates declared outputSchema |
| 6.1 | Medium | App | Claimed cancelled/tied/reveal-failed refunds permanently shown as claimable; "Claim all" re-sends reverting txs |
| 7.1 | Low | Keeper | `releaseAdvisoryLock` can return a still-locked session to the pool, permanently locking out standby keepers |

---

## 1. Deployment drift — the redeploy landed before the feature

The 4801 artifacts were refreshed at `dfd909e2` (block 30305167), which fixed all five
pass-1 drift findings — but every confidentiality contract change (`b8db32a7`,
`0091fa27`, `6d566fb1`, `3ac491b3`, `ecfce34e`, `2ed0420c`) landed **after** the
refresh, and `deployedContracts.ts` was regenerated from current source. The published
4801 ABIs again advertise functions the chain does not have.

### 1.1 Every x402 paid ask and single-question submission reverts on 4801 (CRITICAL)

The server unconditionally calls the new confidentiality-bearing overloads:
`computeX402QuestionPaymentNonce` with a 14th ConfidentialityConfig tuple arg
(selector `0x1c2fa657`, `questionSubmission.ts:1601-1617`) and the 13-arg
`submitQuestionWithX402Payment` (`0x61b030bc`, lines 1670-1699). The deployed
X402QuestionSubmitter (`0x4D5d…4Ff4`) dispatches only the legacy selectors (verified
via `cast code` grep: `0x1c2fa657`/`0x61b030bc` count 0) — and it is deployed via
`new`, **not upgradeable**, so this needs a redeploy + artifact refresh, not a proxy
upgrade. The direct UI path is equally broken: the app selects the 12-input
`submitQuestionWithRewardAndRoundConfig` (`0x774922ea`,
`questionSubmissionSelectorSupport.ts:24-27`), absent from the deployed ContentRegistry
implementation, so `assertContentRegistryQuestionSubmissionSelector` throws
`UNSUPPORTED_QUESTION_SUBMISSION_DEPLOYMENT_ERROR` for every single-question
submission. Additionally, gated-context auth reads `ProtocolConfig.confidentialityEscrow()`,
which the deployed implementation lacks (the code fails closed with 503).

### 1.2 ConfidentialityEscrow missing from every shared artifact (HIGH)

`Deploy.s.sol` deploys and registers the escrow (lines 137, 276-292, 483-485) and
`ponder.config.ts:387-390` requires its address — but no artifact contains a
`ConfidentialityEscrow` entry: not `deployments/4801.json` (refreshed pre-feature), not
`31337.json`, not `deployedContracts.ts`. Consequences: a production Ponder for
worldchainSepolia throws at config load (`resolveOptionalAddress`,
`ponder.config.ts:273-278`) and there is no correct address to put in the env var
because no escrow exists on 4801 at all; the bond UI
(`useConfidentialityBond.ts:47-50`) resolves `undefined` for every chain, so
`postBond` can never execute. (Local hardhat self-heals on `yarn deploy` via
generateTsAbis; only the committed snapshots are stale.)

### 1.3 Ponder README env-var semantics backwards (LOW)

`packages/ponder/README.md:46` says `PONDER_CONFIDENTIALITY_ESCROW_ADDRESS` is
"optional before deployments are refreshed, required in production once shared
artifacts include it". The code implements the opposite: production **throws when the
artifact is missing** (today's state) and ignores the env var once the artifact exists
(except for an equality check). An operator following the README gets a hard boot
failure.

## 2. Storage-layout drift — CI gate is red at HEAD

`make check-storage-layouts` (run by `.github/workflows/unit-tests.yaml:30` on every
push to main) fails at `c56131d9` with **4 mismatches**: ProtocolConfig, RaterRegistry,
ContentRegistry, RoundVotingEngine. The snapshots match the implementations actually
deployed at the 4801 refresh, so these diffs document real hot-upgrade hazards — which
also block the obvious fix path for finding 1.1. Unlike pass-1's finding 2.1, the
control was not silenced this time — it is correctly failing; the drift just landed
unanswered, violating the script's own rule ("fix the snapshot in the same commit that
intentionally changes the layout").

### 2.1 ProtocolConfig: escrow address inserted before live mappings (HIGH)

`0091fa27` inserted `address public confidentialityEscrow;` (`ProtocolConfig.sol:64`)
between `advisoryVoteRecorder` and the advisory mappings deployed at the refresh.
Verified layout shift: `confidentialityEscrow`=31, the three advisory mappings move
31/32/33 → 32/33/34, `__gap` 20→19. Upgrading the live 4801 proxy would zero all
recorder authorizations, reset advisory cooldowns, and make `confidentialityEscrow`
read slot 31 (a mapping base slot — always zero). Fix: append after the mappings (or
take a slot from the gap end) and re-snapshot.

### 2.2 RaterRegistry: mid-layout deletion shifts everything after slot 13 (HIGH)

`2ed0420c` deleted `followingCount`/`followerCount` (deployed slots 14/15) from the
middle of the layout, shrinking the gap 29→25. Gap shrinkage cannot compensate a
mid-layout deletion: ~17 labels from `delegateTo` onward shift up two slots —
delegation state, World ID v4 verifier config, the proof-replay maps
(`_usedWorldCredentialProof`/`_usedWorldPresenceProof` now at 26/27), frozen flags.
Upgrading the new 4801 proxy (`0xD365…3c84`) with HEAD source would corrupt all of it.
This is a fresh, post-refresh break — distinct from pass-1's 2.1, which the redeploy
resolved. Fix: restore the two variables as deprecated placeholders (or re-deploy).

### 2.3 RoundVotingEngine and ContentRegistry also drifted (MEDIUM)

RoundVotingEngine: `roundConfidentialityEscrowSnapshot` was inserted at
`RoundVotingEngine.sol:201`, **before** the deployed
`roundAdvisoryVoteRecorderSnapshot`, shifting slots ~47-68 by +1 — corrupting live
round state on upgrade (same class as 2.1). ContentRegistry: `2ed0420c` removed the
trailing bundle-escrow variables and grew the gap; remaining variables keep their
slots, so this one mostly needs a snapshot decision (the freed slots were likely never
written on chain, per pass-1 finding 1.4). All four snapshots need regeneration in a
commit that consciously answers the upgrade-vs-redeploy question per contract.

## 3. Confidentiality gating leaks

### 3.1 Gated hosted images are never actually gated (CRITICAL)

The image route gates only when the row has a contentId:
`attachment.contentId ? await getQuestionConfidentiality(...) : null`
(`app/api/attachments/images/[attachmentId]/route.ts:68`) — but **no code path ever
writes `question_image_attachments.content_id`**. Details get linked via
`attachQuestionDetailsToContent`; the analogous image linker does not exist
(`attachImagesToOperation` sets only operationKey/clientRequestId,
`imageAttachments.ts:998+`; the x402 confirm path links only details). So `gated` is
always false: every gated question's hosted images are served to anyone with the
`att_` URL — no signed read session, no terms acceptance, no bond check, no watermark,
no access logging — with `Cache-Control: public, max-age=300`. The `att_` URLs are
public on-chain (plaintext in submitQuestion calldata/events), so this is a full leak
of Tier-2 private images, contradicting the gated-serving spec
(`docs/private-context-plan-2026-06.md:119-126, 330`). It also breaks the authorized
path: `listAuthenticatedGatedContextUrls` (`mcp/tools.ts:1466-1473`) filters images by
contentId, so authorized raters receive **zero** gated image URLs. Fix: link images to
the contentId wherever details are linked (x402 confirm + details/attach route).

### 3.2 Gated details publicly served until the confirm step, then CDN-cached (HIGH)

Details gating depends on two DB writes that only happen at the agent-driven confirm
step (`attachQuestionDetailsToContent` + `syncSubmittedQuestionMetadata`,
`questionSubmission.ts:3051-3057`, or the permissionless attach route). Between the
transaction being mined — at which point the `det_` URL is public via the
`ContentDetailsSubmitted` event — and the confirm call, the details route takes the
ungated branch (`details/[detailsId]/route.ts:48`) and serves the full confidential
text to anyone, with `Cache-Control: public, max-age=31536000, immutable`
(lines 14-18). If the agent crashes before confirming, the window is unbounded; one
fetch during the window plants the text in shared caches for a year even after gating
activates. Fix: persist the gating decision at **prepare** time (the server already
knows `visibility === 'gated'` and the detailsUrl when building the plan), and never
send the immutable public cache header before the contentId link exists.

### 3.3 Settlement auto-disclosure fails open for unsynced disclosure policy (LOW)

`shouldPublishConfidentiality` (`ponder/src/RoundVotingEngine.ts:207-213`) publishes
gated content at settlement unless `confidentialityDisclosurePolicy === "private_forever"`.
The column is NULL until the best-effort off-chain metadata sync runs, while `gated` is
set independently from on-chain events — so a `private_forever` question whose sync
failed gets un-redacted at settlement (`detailsUrl`/`detailsHash`, `media[]`, status
flip on the public Ponder API; attachment bytes remain protected by the Next.js
mirror). The null→publish behavior is even unit-tested as intended
(`round-voting-engine-handlers.test.ts:420-446`) — the chosen default is fail-open
where a confidentiality feature should fail closed.

### 3.4 targetAudience is publicly readable despite "raters do not see" (LOW)

`targetAudienceInputSchema` tells agents "Raters do not see the target criteria", and
content routes strip the fields — but unauthenticated
`GET /question-metadata/:hash` (`content-routes.ts:1036-1080`) returns the full
verified metadata preimage (which contains targetAudience) plus the per-content stored
value, and the hash is public on-chain. The leak is structural: targetAudience is part
of the anchored hash preimage, so redacting the route would break preimage
verification. Either restructure the commitment (salted sub-hash) or fix the schema
documentation.

## 4. Ponder indexer

### 4.1 First gated submission halts the indexer (CRITICAL)

The `ConfidentialityConfigured` handler unconditionally runs
`context.db.update(content, { id: contentId }).set({...})`
(`ponder/src/ConfidentialityEscrow.ts:51-55`). But the escrow emits that event inside
`ContentRegistry._configureConfidentiality`, which runs **before**
`emit ContentSubmitted` in the same transaction — and only the ContentSubmitted
handler inserts the content row. Ponder processes events in (block, logIndex) order,
so the update hits a missing row, throws `RecordNotFoundError` (non-retryable), and
**indexing halts entirely** on the first gated question. The fix already half-exists:
the ContentSubmitted handler's `applyIndexedConfidentialityConfig` reads the
`confidentialityConfig` row and applies the gating fields — the content update in the
config handler is both unnecessary and fatal; drop it (or find-guard it).

### 4.2 Target-audience payout exclusions fail open and are non-reproducible (MEDIUM)

`d069ef14` makes `/round-votes` exclude audience-mismatched votes from payout scoring
via `content.targetAudience` (`correlation-routes.ts:219, 361`) — the first
payout-affecting input **not derived from chain events**. No indexer handler writes the
column; it is filled only by the token-gated metadata push, whose failures the
submission flow swallows. Consequences: (1) sync failure → null → everyone eligible →
the keeper proposes a weightRoot paying audience-mismatched voters, silently defeating
enforcement; (2) any Ponder reindex wipes all synced values with no backfill;
(3) artifacts become time-dependent — a keeper building before vs. after the sync
computes different weightRoots for the same round, breaking the optimistic challenge
model, and the keeper's artifact fingerprint (keyed on candidates + scoring params)
cannot distinguish the two states.

## 5. MCP / agents

### 5.1 Local-signer asks hard-fail whenever the metadata base URL differs (HIGH)

Both canonical payloads that derive `operationKey`/`payloadHash` now include
`questionMetadataUri` (`c25f6d3a`). The server builds it from
`NEXT_PUBLIC_PONDER_URL ?? NEXT_PUBLIC_APP_URL` (`questionPayload.ts:782-785`); the
agents' localSigner builds it with **no base argument**, falling back to
`https://rateloop.ai` (`agents/src/questionSpecs.ts:211`). In production
`NEXT_PUBLIC_PONDER_URL` is required and points at the Ponder origin, so the two
canonical JSON payloads differ, the sha256 operationKeys diverge, and
`validateLocalSignerTransactionPlan` rejects every local-signer ask
(`localSigner.ts:3181-3198`, also the x402-authorization path ~3801-3818). Tests pass
only because env is unset in tests. This defeats the exact parity the
"bind confidentiality in local signer plans" work was meant to guarantee.

### 5.2 Dry-run result violates the declared outputSchema (MEDIUM)

`574140ff` added `targetAudienceMatch` to `resultPackageOutputSchema` **and its
required list** (`agent/schemas.ts:1207, 1265`). The live path includes it
(`resultPackage.ts:633`); the dry-run fixture (`mcp/tools.ts:2654-2751`) omits the key
entirely, so schema-validating clients reject every dry-run result. Same class as
pass-1 finding 4.3 (all fixed in this range) — regressed by the newly added field.

## 6. App hooks

### 6.1 Claimed refunds shown as claimable forever (MEDIUM)

`2ed0420c` made `cancelledRoundRefundClaimed` internal, and
`buildRoundClaimStateLookup` now returns `null` for cancelled/tied/reveal-failed
rounds; `useAllClaimableRewards.ts:125` treats `null` lookups as **unconditionally
unclaimed** (`if (!claimLookups[i]) return true;`), with no fallback to Ponder claim
records. Once a user claims such a refund it keeps appearing as claimable:
`totalClaimable` is overstated by the refunded stake, and every "Claim all" re-issues
a `claimCancelledRoundRefund` that reverts `AlreadyClaimed`, burning a real or
sponsored transaction each time.

## 7. Keeper

### 7.1 Failed unlock can permanently park an advisory lock in the pool (LOW)

In the reworked `releaseAdvisoryLock` (`keeper-state.ts:87-101`), an unlock-query
failure is warn-once'd and `client.release()` is called **without the error**, so
pg-pool returns the still-locked session to the idle pool (it only destroys clients
when release receives an error or the connection is unqueryable). Advisory locks are
re-entrant per session and idle checkout is LIFO, so each subsequent tick acquires
(1→2) and unlocks once (2→1) on the same session — the lock never reaches 0, and with
`KEEPER_INTERVAL_MS` (30s) equal to `idleTimeoutMillis` the reaper can't be relied on
to clear it. A standby keeper can then never acquire the lock, silently defeating
failover. Fix: `client.release(error)` in the catch path.

---

## Status of pass-1 findings (27 total)

**Fixed (24):** 1.1–1.5 (resolved by the `dfd909e2` full redeploy — verified via
selector checks on the new implementations), 3.1–3.4 (keeper-state rework + dedicated
client locking + test updates), 4.1–4.6, 5.1–5.3, 6.1, 7.1–7.5.

**Partially fixed (3):**

- **2.1 RaterRegistry storage shift** — resolved via the redeploy (new lineage matches
  the snapshot), but HEAD source has *re-drifted* (see new finding 2.2). Unlike last
  time, the CI control correctly flags it.
- **2.2 Fee-withdrawal bypass via deregistration** — fixed in source (`8d703066`:
  `completeDeregister` now enforces `feeReviewAvailableAt` and reverts
  "Fee withdrawal delay active", with tests), but the commit landed **6 minutes after**
  the redeploy: the live 4801 implementation (`0xc20a…49bc`) does not contain the new
  revert (verified via bytecode grep), so the deployed contract still allows the
  14-day sweep until the next upgrade/redeploy.
- **5.4 FeedbackBonusEscrow comments / phantom settledAt** — the phantom `settledAt`
  is fixed (`ff815732`); the false "pools can target terminal rounds" comment in
  `ponder/src/FeedbackBonusEscrow.ts:17-19` remains.

## Refuted candidates (for the record)

- **`unbanIdentity` not undoing propagated bans** — refuted on code trace.
- **Ponder auto-publishing gated context at settlement (medium variant)** — refuted as
  stated; the narrower fail-open-default version survived as finding 3.3.

## Suggested order of attack

1. **4.1** (one-line indexer fix) and **3.1** (image→contentId linker) — both small,
   both currently total failures of their feature.
2. **Section 2**: answer the upgrade-vs-redeploy question per drifted contract, fix
   the layouts (append, don't insert; restore deleted slots), regenerate snapshots —
   CI is red until this lands, and it gates step 3.
3. **Section 1 ops pass**: deploy ConfidentialityEscrow + redeploy the non-upgradeable
   X402QuestionSubmitter + upgrade/redeploy ContentRegistry/ProtocolConfig/
   RoundVotingEngine/RaterRegistry, then refresh `deployments/4801.json` and
   `deployedContracts.ts` **after** the feature is final — also picks up the pass-1
   2.2 residue.
4. **3.2** (prepare-time gating + cache header) and **5.1** (pass the base URL into
   the agent payload, or pin the canonical URI server-side) before any production
   agent traffic.
5. **4.2** needs a design decision: index targetAudience from the anchored metadata
   (verifiable) rather than a best-effort push, or accept and document fail-open.
6. The rest are contained fixes (5.2, 6.1, 7.1, 1.3, 3.3, 3.4).
