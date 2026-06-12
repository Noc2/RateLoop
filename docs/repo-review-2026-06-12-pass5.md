# Repository Review, Pass 5 — 2026-06-12

Fifth multi-agent review, covering the 54 commits between `0e2e2257` (pass 4) and
`0b8aec7f` (HEAD) — the fix wave responding to pass 4, the World Chain Sepolia fresh
redeploy, the identity-ban enforcement wave, Ponder deployment scoping, and assorted
UI/docs work. Five scoped reviewers plus an auditor for the 11 pass-4 findings and
the 2 pass-3 partials; every candidate adversarially re-verified (live `cast` probes
against the new 4801 deployment, standalone forge fuzz repros, and test runs).
15 of 18 candidates confirmed; after setting aside one verified-good record,
**14 distinct new findings**: 2 high, 5 medium, 7 low.

**Headline: 10 of the 11 pass-4 findings are verified fixed — including a real 4801
redeploy that restores TS-ABI/chain parity — and both pass-3 partials are now closed
(the disclosure policy is finally chain-recoverable).** The one partial is the
gated-attachment linkage fix: it repaired the agent wallet-plan flows but not the
browser path or the native-x402 payment mode, so the two highs this pass are the
same end state as pass-4 finding 2 — gated content that bonded viewers paid for
permanently 404s — now reached through the paths the fix missed. The browser case is
worse than before: pass 4's fail-fast on-chain revert became a success screen with
silently unservable content.

## Summary

| # | Sev | Area | Finding |
|---|-----|------|---------|
| 1 | High | Gating | Browser gated submissions now mine successfully but their attachments can never be linked — gated details/images permanently 404 while the submitter sees success |
| 2 | High | Gating | Receipt-based gated linking misses the native x402 payment mode — `recordNativeX402SubmissionPlan` never stores `questionAttachments` |
| 3 | Medium | Upgrade | `e4b039eb` retypes RaterRegistry slot 32 (`bytes32` → `bytes32[]`) after the Sepolia deploy; layout gate re-snapshotted in the same commit, fresh-deploy doc names only ContentRegistry |
| 4 | Medium | Agents | Local signer still hardcodes confidentiality `flags=0` — every self-custody gated `private_forever` submission deterministically fails |
| 5 | Medium | Ponder | Metadata-sync writes bypass the new deployment gate — during a mismatch window, pushes hit the old deployment and can overwrite the wrong row via content-ID collisions |
| 6 | Medium | Ponder | One 429/503/timeout on the `/deployment` probe blacks out all Ponder reads for 30 s — the probe has no retry and shares the rate-limit bucket with data routes |
| 7 | Medium | Sponsorship | Unmetered frontend-registration sponsorship has no identity binding, no quota, and no rate limit |
| 8 | Low | Contracts | A banned ex-delegate makes the innocent holder's voter-pool reward permissionlessly confiscatable — permanent in RoundRewardDistributor, recoverable in the two escrows |
| 9 | Low | Contracts | `RoleUpdated` stream is wrong at genesis (initialize grants are silent) and the event is `anonymous`, so topic0 subscriptions never match |
| 10 | Low | Contracts | On-chain confidentiality `flags` are accepted unvalidated — ungated content can be indexed as `private_forever` |
| 11 | Low | Gating | Gated "image or description" contract drift: UI promises image-only private context; validation/server require a description |
| 12 | Low | Gating | `attachImagesToContent` matches by agentId only, diverging from prepare-time validation — wallet-owned images in agent asks silently fail to link |
| 13 | Low | Feedback | Migration 0007 never backfills `deployment_key`, hiding any feedback written in the redeploy→migration window |
| 14 | Low | Ponder | `PONDER_CHAIN_ID` shifts the deployment fingerprint and schema but not the indexed network — undocumented footgun |

---

## 1. Browser gated submissions: mined on-chain, unservable forever (HIGH)

`620f7ecf` correctly fixes pass-4 finding 3 — `toOnChainQuestion` blanks
contextUrl/detailsUrl/imageUrls/videoUrl on both the sponsored and direct-wallet
paths, with submissionKey/revealCommitment built from the blanked question (verified
against the deployed contract's selectors and hash constants), so gated browser
submissions now mine. But the linkage half of the repair (`57b6c281`) only touched
the x402 confirm flow, which the browser never uses. After mining, the browser calls
`attachQuestionDetailsAfterSubmission` with the original un-blanked URLs
(`ContentSubmissionSection.tsx:2746-2748`) against
`/api/attachments/details/attach` — which only attaches URLs it can prove from
receipt logs. `ContentDetailsSubmitted` is never emitted for gated content
(`ContentRegistry.sol:1109-1113` skips empty URLs), so the route returns HTTP 200
with `attached: 0` and even the `.catch(console.warn)` never fires. Gated images are
worse: the gated UI fully supports them, they're blanked on-chain, and the attach
call doesn't even send image URLs.

Net effect: for every browser-submitted gated question, `contentId` stays NULL
forever; the serving routes fail closed on exactly that field, and
`listAuthenticatedGatedContextUrls` returns `[]`. A viewer who accepts terms and
posts the real on-chain bond gets nothing; the submitter escrowed the USDC bounty
and saw a success screen. This converts pass 4's fail-fast revert into silent fund
loss — materially worse. (Gated *bundles* are correctly blocked client-side, so this
is the primary single-question gated flow.) **Fix shape:** give the browser path the
same receipt-persisted (or hash-based) linkage the wallet-plan flow got, and make
the attach route accept hash-proven gated attachments.

## 2. Native x402 payment mode missed by the receipt-linking fix (HIGH)

`57b6c281` added `questionAttachments: serializeQuestionAttachmentRefs(...)` to
`recordAgentWalletSubmissionPlan` (`questionSubmission.ts:2388`) and a confirm-time
fallback `attachStoredQuestionAttachments` — but there are TWO receipt writers, and
`recordNativeX402SubmissionPlan` (:2477-2493) was not updated: its receipt has no
`questionAttachments`. Gated questions are fully supported on the native path
(`prepareNativeQuestionSubmissionRequest` runs `markGatedHostedAttachmentsForSubmission`
at :3182; nothing rejects gated + `x402_authorization`), and both payment modes
confirm through the same `confirmAgentWalletQuestionSubmissionRequest`
(`mcp/tools.ts:3688`). At confirm, `attachStoredQuestionAttachments` reads
`receipt?.questionAttachments ?? []` → empty → returns, and the event-based
fallbacks dead-end for gated content (blanked URLs). So an agent asking a gated
question with paymentMode `x402_authorization` — the flow the feature is named
for — hits exactly the pass-4 finding-2 failure the commit was meant to fix:
contentId never set, bonded viewers 404, confirm reports `submitted`. Only
`wallet_calls` (the default) and the permissionless wallet-plan modes were fixed.
For the record, receipt trustworthiness checks out: receipts are written server-side
at prepare, ownership is validated, and confirm re-verifies content hashes against
on-chain receipts — a malicious confirm cannot link foreign attachments. **Fix:**
add the same `questionAttachments` field to `recordNativeX402SubmissionPlan`.

## 3. RaterRegistry slot 32 retyped after the deploy — undocumented brick-on-upgrade (MEDIUM)

`e4b039eb` changed `mapping(bytes32 => bytes32) _identityBanSource` to
`mapping(bytes32 => bytes32[]) _identityBanSources` at the same slot
(`RaterRegistry.sol:148`). This is a *reinterpreting* layout change: on a proxy
carrying old data, a stored keccak source-key becomes the dynamic array **length**,
so `isIdentityKeyBanned` (:1281-1289) would iterate ~2^255 elements — out-of-gas on
every ban check for affected identities, and `89a569a2` made that check load-bearing
in `setDelegate`/`acceptDelegate` too. Verified on-chain: the 4801 RaterRegistry
proxy was created at block 30349520 with the OLD layout (impl from `4d904696`
source) and has never been upgraded — `e4b039eb` landed ~8 minutes after the deploy.
The storage-layout gate cannot flag it (the snapshot was re-pinned in the same
commit, which the script's header explicitly trusts), and `bac3ab6c`'s new
fresh-deploy-only constraint in `packages/foundry/README.md:34-40` names **only
ContentRegistry** — RaterRegistry's hazard is strictly worse (data corruption vs
clean revert) and is recorded nowhere. Currently data-safe only because the fresh
chain has no derived bans yet. **Fix:** add RaterRegistry to the README constraint
(or use a new slot for the retyped mapping), and consider making the layout gate
flag retype-in-place even when re-snapshotted.

## 4. Agents local signer rejects the new on-chain confidentiality flags (MEDIUM)

`1c4cf861` (the pass-3 finding-4 fix) makes the server encode the disclosure policy
on-chain: `flags = privateForever ? 1 : 0`, folded into the confidentiality hash.
The agents package was not updated: its `buildQuestionConfidentialityHash`
(`localSigner.ts:359-376`) hashes a literal `0`, and `assertQuestionConfidentiality`
(:2681-2685) asserts decoded calldata flags `== 0` — while the package fully
supports `disclosurePolicy: "private_forever"` in its payload schema and single
gated questions are explicitly supported in local-signer mode. So every self-custody
gated `private_forever` ask deterministically throws before signing (both the flags
assertion and the reveal-commitment hash mismatch). Fail-closed — no funds at risk —
but a guaranteed break of a supported feature combination introduced in this range,
and agents have no working way to put the private-forever policy on-chain. **Fix:**
derive expected flags from the agent's own `disclosurePolicy`
(`gated && private_forever ? 1 : 0`) in both functions, mirroring
`questionConfidentialityConfig`.

## 5. Ponder writes bypass the deployment gate (MEDIUM)

`d380a951` added `assertPonderAvailableForDataRead()` to `ponderGet` only;
`ponderPost` (`client.ts:401-416`) — used by `syncQuestionMetadata` — performs no
availability/deployment check and authenticates with the static
`PONDER_METADATA_SYNC_TOKEN`. During exactly the window the feature defends against
(nextjs redeployed, Ponder still on the old deployment), reads fail closed but
metadata pushes still land on the old-deployment Ponder. Consequences: (1) the push
is silently lost for the new deployment (both call sites swallow errors; no resync
job); (2) content IDs restart at 1 on a fresh registry, so new contentId N collides
with old row N, and `updateQuestionMetadataRow` (`content-routes.ts:709-713`) guards
only on `questionMetadataHash IS NULL OR matches` — old rows with null hashes accept
the new question's metadata, overwriting `gated` and
`confidentialityDisclosurePolicy` on the wrong deployment's row (worst case flipping
an old gated row to `gated=false`, which the content API then serves un-redacted).
The colliding write returns `updated: 1`, masking the misdirection. **Fix:** gate
`ponderPost` on the same deployment-key assertion, and/or have the sync endpoint
verify the caller's expected deployment key in the body.

## 6. One throttled probe response = 30-second Ponder read blackout (MEDIUM)

`/deployment` is registered after the global 120 req/min rate limiter
(`ponder/src/api/index.ts:62` vs :122), and `checkPonderAvailabilityDirect`
classifies ANY non-OK response — including a limiter 429 or transient 503 — as
`deployment_unconfigured`, caching the negative status for 30 s
(`client.ts:313-323`, :286). Since `d380a951`, every `ponderGet` awaits that status,
so a single rate-limited or slow (>2 s probe timeout vs 10 s for data reads) probe
response blacks out all server- and client-side Ponder reads for 30 s with a
misleading reason. The asymmetry is stark: actual data requests retry 429/502/503
with backoff and honor Retry-After, but the probe that now gates all of them has no
retry and no error-class distinction — and all nextjs server traffic shares one
egress IP and thus one 120/min bucket, while the outbound queue allows ~800 req/min,
so the limit is exhaustible by legitimate load and the system oscillates. **Fix:**
treat 429/5xx/timeouts as transient (keep last-known-good status, retry with
backoff), and reserve the deployment-mismatch classification for an actual
key mismatch; consider exempting `/deployment` from the rate limiter.

## 7. Unmetered registration sponsorship: no identity, no quota, no rate limit (MEDIUM)

`a940cdbc` added a branch in `evaluateFreeTransactionAllowance`
(`freeTransactions.ts:1369-1378`) that returns `isAllowed: true` for the
approve(FrontendRegistry, 1000 LREP) + register() bundle BEFORE any rater-identity
or quota logic. `isUnmeteredFrontendRegistrationOperation` (:1128-1173) checks only
call shape; the verify-transaction route has no `checkRateLimit`; and the client
gate (`canUseUnmeteredSponsoredSubmitCalls`) requires only a thirdweb in-app wallet —
any logged-in user, with no rater identity and zero remaining free-transaction
quota. Every other sponsored operation (including `register` outside this exact
bundle) flows through the metered, identity-bound quota gate. The worst-case
"unbounded reverting-userOp gas drain" is tempered by bundler-side gas estimation
(guaranteed-revert ops are hard to spam through a bundler), and successful
registrations are capital-bounded by the 1000-LREP stake — but the eligibility gate
itself is fail-open relative to the rest of the sponsorship system. Only testnet is
live today. **Fix:** require a resolved rater identity (or at least apply the
standard rate limiter and a per-wallet cap) on the unmetered branch.

## 8. Banned ex-delegate forfeits the innocent holder's reward (LOW)

`89a569a2` added a commit.voter address-key ban probe to all three reward consumers.
For delegated commits, `commit.voter` is the **delegate/stake-payer**, while the
voter-pool reward belongs to the identity **holder**. The taint-at-claim policy is
substantially intended (it closes a laundering channel where a banned operator farms
rewards through sybil holders), the trigger is governance-gated, and bans expire —
so the QuestionRewardPoolEscrow and FeedbackBonusEscrow blocks are recoverable
reverts. The residual defect is in RoundRewardDistributor only: during even a
*temporary* ban of an ex-delegate (banned later, for unrelated conduct, after
`_attestHumanCredential` silently cleared the delegation), anyone can call the
permissionless `confiscateBannedReward` (:245-263) and **irreversibly** route the
clean holder's earned reward to the protocol — no recovery after the ban expires,
while the banned delegate is made whole on stake. That permanence is internally
inconsistent with the recoverable treatment of the identical condition in the two
escrows. **Fix:** make confiscation re-claimable if the ban lapses (or check the ban
at claim time only, like the escrows do).

## 9. RoleUpdated: silent at genesis, anonymous on the wire (LOW)

`41dd8e8a` + `e557a0c4` fixed pass-4 finding 7, but with two gaps: (a) to stay under
the size limit, `_grantRole` went back to a silent storage write
(`RoundVotingEngine.sol:349-351`), so the two `initialize` grants (DEFAULT_ADMIN,
PAUSER) produce no log — a role stream that looks authoritative but is wrong at
genesis; (b) `RoleUpdated` is declared `anonymous` and emitted via `log3` with no
selector topic (:336), so standard topic0-keyed `eth_subscribe`/`getLogs` filters
can never match it — only address-filtered consumers that know to decode 3-topic
anonymous logs will see role changes (the TS ABIs do correctly mark
`anonymous: true`). Also, the no-op dedup was dropped, so re-granting emits
duplicate logs. The self-revoke guard and slot derivation were verified correct.

## 10. Confidentiality flags accepted unvalidated (LOW)

Neither `ContentRegistry._configureConfidentiality` (:1115-1125) nor
`ConfidentialityEscrow.configure` (:186-202) validates `flags`. A submitter calling
the public 13-arg submit directly with `{gated: false, bondAmount: 0, flags: 1}`
gets an ungated question whose escrow config carries the private-forever bit, which
Ponder indexes as `confidentialityDisclosurePolicy = "private_forever"` on public
content. Every current consumer guards on `gated === true`, so the bogus value is
inert today — but the column exists precisely to be consumed, and any future
consumer treating it as an enforcement signal inherits submitter-controlled garbage.
The encoding itself is otherwise consistent end-to-end (browser, server, Ponder all
agree bit 1 = private_forever; event ordering safe). **Fix:** one-line revert in
`configure` for unknown bits or nonzero flags on ungated configs.

## 11. "Image or description" — three surfaces disagree (LOW)

`620f7ecf` made gated browser asks require a description (consistent with the
contract's non-zero detailsHash requirement), but the inline error still says "Add a
hosted image or description" (`ContentSubmissionSection.tsx:4475-4479`) — and that
message only shows when no image exists at all, so a user who follows it and uploads
an image sees all inline errors disappear while submit still fails with nothing
highlighted (the Description label still reads "(optional)"). The handoff page
accepts image-only gated drafts (`AgentAskHandoffPage.tsx:907-916`) that the server
then hard-rejects (`detailsUrl is required for gated questions`,
`questionPayload.ts:619-621`). Fails closed; pure contract drift across UI,
client validation, and server.

## 12. Image-linking predicate diverges from validation (LOW)

Prepare-time validation accepts images owned by the agent OR the submitting wallet
(`imageAttachments.ts:991-997`), and details-linking mirrors that with an OR
predicate — but `attachImagesToContent` (:1085-1090) matches by agentId ONLY when
one is set (`markImagesRequireGatedAccess` shares the defect). A wallet-uploaded
image referenced in an agent's gated ask passes preflight, the question is paid and
submitted, and the confirm-time link updates zero rows with no error (callers never
check the `attached` count) — leaving the image permanently 404 (if flagged gated)
or serving publicly (if not). Narrow cross-identity flow, silent post-payment
integrity failure. **Fix:** use the same OR predicate as details linking.

## 13. Feedback scoping migration hides rollout-window rows (LOW)

`0007_content_feedback_deployment_scope.sql` adds `deployment_key` nullable with no
backfill, and every read/dedupe path now filters on strict equality — so all
pre-migration rows are invisible to every API. A backfill was genuinely impossible
(old and new deployment rows are indistinguishable: same chain_id, registry-local
content IDs), and hiding old-deployment rows is the point of the commit. The real
residue is narrow: feedback written against the *current* deployment between the
redeploy (08:48) and the migration (09:41) is silently orphaned with no
reconciliation path or operator note — rows are hidden, not deleted, and remain
recoverable via manual SQL on `created_at`. The old unique indexes were also
replaced with partial ones (`WHERE deployment_key IS NOT NULL`), but no code path
can insert NULL keys anymore, so only frozen legacy rows lose enforcement.

## 14. `PONDER_CHAIN_ID` fingerprint/indexing asymmetry (LOW)

`8c4459f4`'s three resolvers honor a `PONDER_CHAIN_ID` env override (priority over
`PONDER_NETWORK`), but `ponder.config.ts` derives the indexed network exclusively
from `PONDER_NETWORK` and never reads it. Most mismatch combinations fail closed
(missing artifacts throw; null metadata 503s), but `PONDER_NETWORK=hardhat` +
`PONDER_CHAIN_ID=4801` indexes local hardhat while `/deployment` reports the
genuine Sepolia deployment key — a frontend expecting 4801 sees `available: true`
against hardhat data. The variable is documented nowhere (its only three occurrences
are the resolvers themselves). **Fix:** validate `PONDER_CHAIN_ID` against
`PONDER_NETWORK` or derive the fingerprint chainId from the same source the config
uses.

---

## Verified good (recorded so it isn't re-audited)

- **Snapshot accessor** (`4c001671` + `e557a0c4`): the re-introduced assembly
  computes the inner hash from contentId before roundId overwrites scratch —
  fuzz-verified (256 runs) against the high-level mapping read in a standalone forge
  project; the deployed 4801 engine impl contains the selector and was compiled from
  post-fix source; live probe returns the correct escrow with clean upper bits.
- **SubmissionMediaValidatorFactory** (`b318e70a`): `factory.create()` runs in the
  proxy's delegatecall context so `initializeEmitter` binds the proxy; one-shot
  guard; attacker-created validators are inert (Ponder filters anchors by the
  registry-reported validator address). Verified live on 4801.
- **4801 artifact parity** (`4d904696`): all 19 exported addresses match between
  `4801.json` and `deployedContracts.ts`; per-contract `deployedOnBlock` values
  verified against actual creation blocks; storage-layout check passes for all 11
  proxied contracts; live selector probes pass including the previously-missing
  setRole/snapshot/nexus/revoke selectors; the new mainnet readiness script's
  verifier selector is correct.

## Status of pass-4 findings

**10 of 11 fixed, 1 partial**; both pass-3 partials closed:

- **1 (snapshot accessor) — FIXED.** Correct slot math (empirically verified), test
  fixture now non-diagonal, deployed impl is post-fix.
- **2 (gated linkage) — PARTIAL.** Wallet-plan flows fixed via receipt-persisted
  attachments; gated bundles now rejected pre-chain. The native-x402 receipt writer
  and the entire browser path were missed — see findings 1 and 2 above.
- **3 (browser gated reverts) — FIXED.** Blanking mirrored on both browser routes,
  including submissionKey/revealCommitment; the revert path is gone (the remaining
  linkage problem is tracked under finding 2 / new findings 1-2).
- **4 (4801 ABI drift) — FIXED.** Real fresh redeploy at block 30349613; live probes
  confirm all previously-missing selectors; readiness selector checks extended
  (`967e7b1c`/`a615fee7`) and pass live. Note: 10 contract commits landed *after*
  the 08:48 redeploy (ban hardening, `confiscateBannedReward`, validator factory),
  so HEAD source is ahead of 4801 again — currently consistent (the new surface is
  absent from chain AND TS artifacts alike), this is normal dev state under the
  documented fresh-deploy flow, but the next artifact regen without a redeploy would
  recreate pass-4 finding 4.
- **5 (bricked ContentRegistry upgrade) — FIXED** via the documented-constraint
  option: README records fresh-deploy-only for the validator and observer mappings,
  the fresh deploy made the live validator current, the readiness probe now verifies
  the stored validator's selectors live, and `b318e70a` makes fresh init atomic via
  the factory. No reinitializer was added — in-place upgrades remain impossible by
  documented design.
- **6 (phantom metadata pins) — FIXED.** Inherited non-HTTPS values resolve to
  undefined; valid inherited values are kept unpinned and defer to the server; only
  explicit pins throw on mismatch. 30/30 tests pass.
- **7 (eventless roles) — FIXED.** `setRole` emits on every change and the
  last-admin lockout is structurally closed (self-revoke guard); dead event
  declarations removed from contract and ABIs. Residuals below the original bar:
  genesis grants silent, event anonymous — finding 9 above.
- **8 (bundle observer backfill) — FIXED** by documentation + fresh redeploy: the
  constraint is in the README and no pre-upgrade bundles can exist on 4801.
- **9 (dead regression test) — FIXED.** Now mocks the shared deployments module;
  verified it actually runs and passes at HEAD.
- **10 (ProtocolConfig over-inclusion) — FIXED.** Removed from
  `PONDER_INDEXED_CONTRACTS` (now exactly the 15 Ponder-registered contracts) with a
  guard test; script passes offline and live.
- **11 (hidden sanctions) — FIXED.** Standalone sanction card renders for
  third-party profiles without a self-report; data source broadened.
- **p3-1 (toggle-ordering image leak) — FIXED.** Enabling private context now clears
  images from the draft, and the handoff path repairs flags at submit time via
  `markGatedHostedAttachmentsForSubmission`.
- **p3-4 (disclosure lost on reindex) — FIXED.** The policy is now encoded on-chain
  (flag bit 1), indexed from the event, and used by settlement publication — a full
  reindex reconstructs both policy and publishedAt from chain data. The fresh 4801
  deploy guarantees no pre-flag gated content exists.

## Refuted candidates (for the record)

- **4801 lags 10 later contract commits / probes can't detect it** — chain ==
  4801.json == TS artifacts holds at HEAD; HEAD source being ahead of a testnet is
  the documented fresh-deploy workflow, and the in-range commits *improved* the
  pass-4 detection gap. Kept as a residual note under audit item 4.
- **Toggle OFF ships forever-gated images on public questions** — refuted: the
  attach route's confidentiality upsert sets `publishedAt` for ungated questions,
  which is the deliberate un-gating mechanism; the image serves publicly after
  linkage.
- **`--schema` launches write into a different schema than indexed** — the
  mechanics are real but byte-identical before and after this range
  (`8c4459f4`'s new branch never executes on the `--schema` path), the flag is
  undocumented, and the standard no-flag path is consistent by construction.
  Latent repo-wide note, not an in-range finding.

## Suggested order of attack

1. **Findings 1 + 2** — close the last two gated-linkage paths (browser, native
   x402); together with the wallet-plan fix this finally makes gated content
   retrievable on every submission route. Add one end-to-end test per path that
   submits gated content and retrieves it as a bonded viewer.
2. **Finding 4** — two-function fix in the agents package; until then, self-custody
   agents cannot use `private_forever` at all.
3. **Findings 5 + 6** — gate `ponderPost` and make the availability probe tolerate
   transient errors; both are cheap and the corruption path in 5 touches
   confidentiality fields.
4. **Finding 3** — add RaterRegistry to the fresh-deploy constraint doc now (one
   line); decide whether the layout gate should flag same-commit re-snapshots that
   retype slots.
5. **Finding 7** — add identity/rate-limit to the unmetered branch before mainnet.
6. **8-14** are small, independent cleanups; 8 and 10 are one-liners in Solidity
   review order.
