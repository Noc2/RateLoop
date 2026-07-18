# RateLoop Tokenless Post-remediation Bug and Security Audit — 18 July 2026

**Status:** Internal engineering audit of commit `98975e556af0b4ce540af03841fd3ec10d0ed960` on the `tokenless`
branch. This is not customer-facing product copy. It follows the
[18 July re-audit](tokenless-repository-security-reaudit-2026-07-18.md) and its
[remediation record](tokenless-security-reaudit-remediation-2026-07-18.md).

## Executive summary

This fresh pass confirmed **16 actionable defects**: 3 high, 12 medium, and 1 low. No critical issue was confirmed.
The three high-severity issues are:

1. the autonomous x402 signer pins the deployment and total but does not bind the signed round to the agent's quoted
   question and audience;
2. browser recovery records store payout private keys and the secret that decrypts them together in origin-wide
   storage, making one user's funds and review identity available after an account switch on the same browser; and
3. an in-flight GRC export continues after its owner pauses or updates the connector, can deliver with the retired
   credential, and can overwrite the paused connector's state.

The re-audit fixes materially improved the branch. The fund-core custody, liability, compensation, and claim
invariants survived this review, as did the repaired v4 tuple. One claimed remediation is incomplete: sustained new
round creation at the keeper's full scan budget still starves historical rounds, so `REAUD-13` is reopened by
`POST-06`.

The branch remains unsuitable for real users or real money. It still has no current v4 deployment, and these findings
sit alongside the release gates in the
[production-readiness register](tokenless-production-readiness-2026-07.md).

| ID      | Severity | Area                     | Finding                                                                      |
| ------- | -------- | ------------------------ | ---------------------------------------------------------------------------- |
| POST-01 | High     | Autonomous x402 custody  | Signed payment terms are not bound to the locally requested review intent    |
| POST-02 | High     | Browser key recovery     | Recovery ciphertext and its unwrap secret cross browser-account boundaries   |
| POST-03 | High     | GRC connector revocation | A paused or rotated connector does not stop an in-flight stale delivery      |
| POST-04 | Medium   | Keeper reveal processing | One malicious committed payload can abort the whole keeper scan              |
| POST-05 | Medium   | Keeper race handling     | The minimal ABI cannot decode the custom errors classified as expected races |
| POST-06 | Medium   | Keeper scheduling        | Full-budget round growth still starves all historical work                   |
| POST-07 | Medium   | Attestation concurrency  | Reclaimed attestation leases have no fencing generation                      |
| POST-08 | Medium   | Anonymous quote API      | Unauthenticated quotes create durable, unswept database content              |
| POST-09 | Medium   | Private review privacy   | Plaintext drafts persist across accounts and assignment expiry               |
| POST-10 | Medium   | Image handoff            | API-key-staged images cannot pass the browser's mandatory preview gate       |
| POST-11 | Medium   | Rate limiting            | A provider header overrides Vercel's spoof-resistant client identity         |
| POST-12 | Medium   | Chain recovery           | Durable signed-transaction recovery has no automatic worker                  |
| POST-13 | Medium   | Deployment health        | Ponder can report a nonexistent or mixed contract bundle as healthy          |
| POST-14 | Medium   | Ponder availability      | Public status requests materialize the complete deployment history           |
| POST-15 | Medium   | Release preflight        | Gold-injection keys bypass hosted secret and role validation                 |
| POST-16 | Low      | Ponder keeper feed       | The work feed becomes stale and permanently omits rounds after 500           |

## Scope and method

Four independent passes covered:

- Foundry contracts, generated and handwritten ABIs, the keeper, and Ponder;
- Next.js authentication, authorization, tenancy, payments, workers, webhooks, privacy, and deployment checks;
- browser storage, reviewer and handoff journeys, SDK and agent signing, media, OAuth, and dependency exposure; and
- a final cross-check of the implementation plan, production-readiness register, prior findings, and remediation
  claims.

The audit used static source review, raw ABI decoding, in-memory database concurrency schedules, fault-injection tests,
Foundry invariants, Slither, the package test matrix, and a current recursive dependency audit. External research was
limited to primary sources. In particular:

- Vercel documents `x-vercel-forwarded-for` as the stable client-IP header when another proxy may overwrite
  `x-forwarded-for`, and documents provider-specific headers such as `CF-Connecting-IP` in the separate Verified Proxy
  configuration: [Vercel request headers](https://vercel.com/docs/headers/request-headers) and
  [Vercel reverse proxies](https://vercel.com/docs/security/reverse-proxy).
- The repository's `next@15.5.18` is above the `15.5.9` patched floor in the official December 2025 RSC advisory:
  [Next.js security update](https://nextjs.org/blog/security-update-2025-12-11).
- The installed `better-auth@1.6.23` is newer than the security fixes reviewed in the project's primary release and
  advisory records: [Better Auth releases](https://github.com/better-auth/better-auth/releases) and
  [GHSA-hjpm-7mrm-26w8](https://github.com/better-auth/better-auth/security/advisories/GHSA-hjpm-7mrm-26w8).

## Detailed findings

### POST-01 — High — Signed x402 payment terms are not bound to the locally requested intent

**Evidence.** `packages/agents/src/tokenlessRun.ts:56-100` compares the quoted total to a local ceiling, checks the
funder, and passes the locally pinned deployment to the typed-data builder. It then signs all round terms returned by
the server. `packages/sdk/src/tokenlessPayment.ts:187-251` proves those terms are internally consistent and belong to
the pinned contracts, but does not compare them with the original `TokenlessQuoteRequest`.

The signed fields at `packages/sdk/src/tokenlessTypes.ts:321-338` include `contentId`, `termsHash`,
`admissionPolicyHash`, `feeRecipient`, beacon facts, deadlines, quorum, and the economic allocation. Existing adversarial
tests at `packages/agents/src/__tests__/tokenlessRun.test.ts:131-169` cover changed contracts and totals, not changed
intent at the same total. Supplying the expected deployment and total while replacing the policy, terms hash, or fee
recipient reaches both signing calls.

**Impact.** A compromised or misrouted API can keep the approved spend ceiling and immutable contracts while causing
an unattended agent to fund and authorize a different review, audience, fee recipient, or schedule. Deployment pinning
closed arbitrary-contract redirection but did not close same-deployment intent substitution.

**Recommended fix.** Return a canonical intent commitment in the quote. Locally recompute or exact-compare every
signable round field derived from the request and quote; separately pin platform-selected fee, beacon, and timing
policies. Add same-total substitutions for content, audience, fee recipient, allocation, and deadlines.

### POST-02 — High — Browser recovery ciphertext and its unwrap secret cross account boundaries

**Evidence.** `packages/nextjs/lib/tokenless/rater/deviceRecovery.ts:6-20,65-89` puts `recoveryPackage` and
`recoverySecret` in the same origin-wide `localStorage` record keyed only by vote key. The package contains both the
vote and payout private keys at `packages/nextjs/lib/tokenless/rater/recovery.ts:103-113`.
`packages/nextjs/components/tokenless/answer/PublicQuestionCard.tsx:264-279` creates and stores the combined record.
`packages/nextjs/components/tokenless/human/FeedbackBonusClaimsClient.tsx:58-85,113-141` lists every such record and
decrypts it using the co-located secret. Logout at `packages/nextjs/lib/auth/client.ts:46-52` neither scopes nor protects
the records.

**Impact.** On a shared browser, user B can sign in after user A, select A's saved review through normal UI, and recover
A's payout and vote private keys without another credential. B can claim or sweep A's awards and correlate A with the
otherwise one-time review key. Encrypting keys provides no boundary when the decryption secret is stored beside them.

**Recommended fix.** Namespace and authorize records by the opaque browser principal, and keep the unwrap capability
outside ordinary origin storage. Prefer a non-exportable device/passkey key or an explicitly user-held recovery secret.
Provide export, removal, account-switch, and accepted-work recovery flows, and test two principals on one browser.

### POST-03 — High — A paused or rotated GRC connector does not stop an in-flight stale delivery

**Evidence.** Updating or pausing a connector increments its version but supersedes only `pending` and `retry` jobs at
`packages/nextjs/lib/tokenless/assuranceGrcConnectors.ts:391-417,442-468`. Claims at `:792-824` have no generation or
random lease token. The external delivery at `:980-1085` never rechecks the current connector version or status before
I/O. Success and failure writes at `:857-958` do not fence on the lease or connector version and do not require the job
transition to have succeeded before updating connector state.

A deterministic schedule held worker A inside its evidence source, paused the connector, and then released A. The old
worker still delivered once, marked its v1 job `succeeded`, and set `lastDeliveryStatus=succeeded` on the now-v2 paused
connector.

**Impact.** Evidence can be disclosed to a retired destination or old GRC account after an owner explicitly pauses or
rotates it. An expired worker can also overwrite the state of a successor and create false delivery/audit evidence.

**Recommended fix.** Add a monotonic generation or random claim token. Supersede and advance the fence for processing
jobs on pause/update; immediately before adapter I/O, transactionally require the exact fence and an enabled connector
whose version equals the job snapshot. Fence every receipt, job, and connector write and check its affected-row count.
Add pause/update and expired-worker schedules. An HTTP request already accepted by a provider cannot be recalled, so
also cancel in-flight work where possible and document that boundary.

### POST-04 — Medium — One malicious committed payload can abort the complete keeper scan

**Evidence.** Decrypted material is checked only for round and vote key at
`packages/keeper/src/keeper.ts:261-296`. The keeper does not recompute the on-chain payout commitment or full reveal
commitment and does not reject a zero payout address before caching and submitting the material. The contract correctly
rejects the invalid address or mismatch at `packages/foundry/contracts/tokenless/TokenlessPanel.sol:398-409`, but that error escapes the
per-commit loop and aborts the sequential round scan at `packages/keeper/src/keeper.ts:821-838`.

An admitted rater can therefore sign an on-chain commit whose encrypted plaintext uses the correct round and vote key
but a different response, payout, or salt. Decryption and local validation succeed; `reveal` deterministically reverts
`InvalidCommitment`; later rounds in the tick are not serviced.

**Impact.** One malicious participant can repeatedly disrupt hosted reveal, settlement, compensation, claim, and stale
return automation for unrelated accepted work. Permissionless contract exits remain available, but the primary
automatic terminal path is weakened.

**Recommended fix.** Recompute and compare the payout and exact reveal commitments, reject the zero payout address,
and isolate permanent per-commit errors so one invalid commitment cannot terminate a round or tick. Test a malformed
tip-round commitment followed by honest older work.

### POST-05 — Medium — The keeper ABI cannot decode the custom errors treated as expected races

**Evidence.** The handwritten ABI at `packages/keeper/src/tokenless-abi.ts:6-26` contains functions and one event but no
custom errors. `isExpectedRace` at `packages/keeper/src/keeper.ts:216-241` searches display text for names such as
`InvalidState` and `CursorMismatch`. The canonical ABI contains those errors, including `InvalidState` at
`packages/contracts/src/tokenless/abis/TokenlessPanelAbi.ts:1915`.

Decoding the real `InvalidState` selector `0xbaf3f0f7` with the keeper ABI produced
`AbiErrorSignatureNotFoundError`, not an error containing `InvalidState`. Existing tests inject already-decoded mock
messages and therefore exercise a behavior the live minimal ABI cannot provide.

**Impact.** Ordinary competition between permissionless callers turns an expected lost race into a failed keeper tick
and abandons the rest of that scan.

**Recommended fix.** Consume the canonical ABI or include all expected errors. Classify the decoded error cause or raw
selector instead of regexing display strings. Test raw revert data from two competing callers.

### POST-06 — Medium — Full-budget round growth still starves historical keeper work

**Evidence.** `scanRoundIds` fills the tick budget with unseen IDs at `packages/keeper/src/keeper.ts:574-578` and gives
historical work only the remaining slots at `:581-593`. With `maxRoundsPerTick=3` and three new rounds before every tick,
the historical cursor never advances. The regression at
`packages/keeper/src/__tests__/tokenless-keeper.test.ts:371` covers one arrival against capacity three, not arrival at
or above capacity.

**Impact.** Sustained cheap round creation can keep older accepted work from reveal, settlement, claim, compensation,
or stale return. This reopens the scalability conclusion recorded for `REAUD-13`.

**Recommended fix.** Give new and historical lanes independent fair quotas or persist due work. Prove monotonic
historical progress when arrivals equal and exceed the configured budget, while retaining bounded tip discovery.

### POST-07 — Medium — Reclaimed attestation jobs have no lease fencing

**Evidence.** `packages/nextjs/lib/tokenless/assuranceAttestationPipeline.ts:333-356` claims new or expired work using
only state and expiry, without a lease generation or token. External signer, Rekor, and timestamp-authority calls occur
at `:357-380`. Terminal writes at `:381-420` require only the job ID and `state='processing'`. Migration
`packages/nextjs/drizzle/0074_assurance_attestation_jobs.sql:16-22,35-38` persists an expiry but no fence.

In a two-worker reproduction, A's lease expired while it held old-signer evidence. B reclaimed and reached Rekor. A
then completed under B's lease and stored `old-key`/`rekor-old`; B also published externally but reported retry.

**Impact.** Worker overlap or key rotation can produce conflicting external witnesses, persist stale signer evidence,
and make worker summaries and audit state false.

**Recommended fix.** Add and atomically advance a lease generation or random token. Require it in every terminal
write, report success only when the fenced update succeeds, recheck before external publication, and bind the selected
signer version to the claimed job. Add the exact expired-A/reclaimed-B schedule.

### POST-08 — Medium — Unauthenticated quotes create durable, unswept database content

**Evidence.** `packages/nextjs/app/api/agent/v1/quote/route.ts:7-10` parses and persists a quote without authentication,
a route body limit, or rate limiting. `packages/nextjs/lib/tokenless/server.ts:95-177,295-330` accepts private/internal
classifications and stores the normalized request and response JSON. Unique request hashes create unique durable rows;
replay refreshes expiry. No runtime path deletes expired unreferenced quotes, despite the expiry index created in
`packages/nextjs/drizzle/0000_tokenless_agent_api.sql:1-10`.

**Impact.** Any caller can submit unbounded distinct 4,000-character prompts, growing Postgres storage and cost after
the logical 15-minute validity ends. The route also accepts private or internal content before a tenant or credential
boundary exists.

**Recommended fix.** Bound the raw body before JSON parsing, apply an atomic anonymous quota, require authentication
and a tenant policy for non-public classifications, and sweep expired unreferenced quotes. Add flood, content-policy,
and retention tests.

### POST-09 — Medium — Plaintext private-review drafts persist across accounts and assignment expiry

**Evidence.** `packages/nextjs/lib/tokenless/reviewDrafts.ts:1-17,36-60` stores raw draft JSON in origin-wide
`localStorage`, keyed only by lane and assignment ID, without principal scope or TTL.
`packages/nextjs/components/tokenless/HumanAssuranceRaterClient.tsx:183-199,286-325` persists artifact choice, failure
tags, and plaintext rationale, and clears only after successful submission.

**Impact.** A later user of the same browser can recover confidential customer evaluation rationale and decisions,
including after the original assignment or artifact lease has expired.

**Recommended fix.** Scope drafts to the authenticated opaque principal, enforce assignment/lease expiry, and purge on
terminal or revoked assignments and account change. Prefer `sessionStorage` for private material unless durable drafts
have an explicit user need. Add account-switch and expiry tests.

### POST-10 — Medium — API-key-staged images cannot pass the mandatory browser preview gate

**Evidence.** Agent uploads are owned as `api_key:<key-id>` at
`packages/nextjs/app/api/agent/v1/media/images/route.ts:15-36` and
`packages/nextjs/lib/tokenless/publicQuestionMedia.ts:218-223,300-315`. Browser preview reads authenticate as the
browser principal at `packages/nextjs/app/api/public-media/images/[assetId]/route.ts:11-24`. Before ask creation the
asset is staged and unbound; `readPublicQuestionImage` at
`packages/nextjs/lib/tokenless/publicQuestionMedia.ts:496-524` permits only the exact stored owner or an already-bound,
fully approved public asset.

The handoff client blocks privacy approval, quote, and submission until every image loads at
`packages/nextjs/components/tokenless/TokenlessHandoffClient.tsx:440-445,495-514,731-770,800-804`. Descriptor tests do
not exercise this cross-principal fetch.

**Impact.** The documented SDK/CLI image-handoff path deadlocks: the owner cannot preview the unbound image, and the UI
correctly refuses to approve unseen media.

**Recommended fix.** Issue a short-lived handoff capability bound to exact asset IDs and digests, or bind staged assets
to a handoff that authorized workspace managers can read. Do not make pending media public. Add a real
API-key-upload-to-browser-approval E2E test.

### POST-11 — Medium — A provider header overrides Vercel's spoof-resistant client identity

**Evidence.** `packages/nextjs/lib/mcp/rateLimit.ts:16-31` selects `CF-Connecting-IP` before `x-real-ip`,
`x-forwarded-for`, and bearer identity. The same limiter protects public MCP operations and dynamic OAuth registration
and device authorization. Vercel documents `x-forwarded-for` as overwritten to prevent spoofing and
`x-vercel-forwarded-for` as the stable value when another proxy may overwrite it. It documents
`CF-Connecting-IP` specifically as part of the Cloudflare Verified Proxy configuration, not as a universal application
trust signal.

The application-level reproduction held `x-real-ip=203.0.113.5` constant and changed only `cf-connecting-ip`. Both
requests returned `requestCount=1`, proving that the unverified provider header partitions the limiter ahead of the
platform identity.

**Impact.** Where the isolated Vercel URL is directly reachable or the header is not stripped by an explicitly
verified proxy boundary, a caller can rotate the header and bypass the 60-per-minute protection for OAuth database
writes and MCP work.

**Recommended fix.** On Vercel, use `x-vercel-forwarded-for` as the primary hosted identity. Accept provider-specific
headers only when an explicit verified-proxy mode and direct-origin restriction are both proven. Add conflicting-header
tests and fail closed on ambiguous hosted identity.

### POST-12 — Medium — Durable signed-transaction recovery has no automatic worker

**Evidence.** `executeServerChainPayment` safely persists and reuses exact signed bytes at
`packages/nextjs/lib/tokenless/chain/payments.ts:1081-1291`. Its only non-test caller is payment POST at
`packages/nextjs/app/api/agent/v1/asks/[operationKey]/payment/route.ts:68`. `reconcileChainPayment` at
`payments.ts:1342-1353` is not called by production code. The scheduled worker seeds only already-confirmed executions
for transparency publication at `packages/nextjs/lib/tokenless/scheduledMaintenance.ts:80-118`.

Crash tests at `packages/nextjs/lib/tokenless/chain/chainConcurrency.test.ts:404-548` prove byte-identical recovery only
after manually expiring the lease and explicitly calling `executeServerChainPayment` again. The autonomous client calls
`submitPayment` once at `packages/agents/src/tokenlessRun.ts:101-104`; its wait loop does not reconcile payment.

**Impact.** A crash or lost response after the chain accepts a server-funded transaction can leave a mined round and
reserved application operation unconfirmed indefinitely unless the initiating caller returns after lease expiry. The
exact signed bytes prevent replacement and double funding, but durability without a recovery trigger does not provide
eventual reconciliation.

**Recommended fix.** Add a bounded, fenced scheduled processor for due `signed`, `broadcast`, and expired-claim server
executions. It should reconcile exact hashes first, replay only persisted bytes, publish dead-letter/health evidence,
and never move payment work into a GET status route. Test recovery with no second client request.

### POST-13 — Medium — Ponder can report a nonexistent or mixed contract bundle as healthy

**Evidence.** `packages/ponder/src/protocol-deployment.ts:126-201` validates address syntax and compares a deployment key
recomputed from the same environment values, but performs no live bytecode or immutable-wiring validation. The health
route at `packages/ponder/src/api/index.ts:74-88` executes two database reads and returns `status: ok` even when those
tables contain no deployment rows. Keeper validation is stronger, but checks the optional x402 address only for any
bytecode at `packages/keeper/src/keeper.ts:778-789`, not its immutable `panel()` and `usdc()` wiring.

**Impact.** A typo, stale address, arbitrary-bytecode adapter, or mixed bundle can present green service health and
misleading deployment evidence while indexing nothing or observing the wrong contracts. This conflicts with the
branch's complete deployment-key and fail-closed service requirement.

**Recommended fix.** Share a startup/readiness validator that proves chain ID, bytecode, deployment block, panel
issuer/USDC/constants, Feedback Bonus issuer/USDC, and adapter panel/USDC. Health must fail until validation succeeds
and must expose index progress relative to the configured deployment block.

### POST-14 — Medium — Public Ponder status materializes complete deployment history

**Evidence.** Unauthenticated `GET /status/tokenless` at `packages/ponder/src/api/index.ts:91-140` selects every round
state, credit balance, credit-event ID, bonus-pool ID, and bonus-event ID into application memory, then counts and sums
the arrays in JavaScript. CORS configuration is not server-side access control.

**Impact.** As history grows, one cheap public request causes increasing database, network, allocation, and heap work.
Repeated requests can degrade or exhaust the evidence service.

**Recommended fix.** Use database-side `COUNT`, grouped counts, and `SUM`, with short cache and hosted rate limiting.
Test bounded query results against a large fixture.

### POST-15 — Medium — Gold-injection keys bypass hosted secret and role validation

**Evidence.** Required configuration at
`packages/nextjs/scripts/check-tokenless-production-readiness.mjs:34-115`, public-secret rejection at `:117-158`, and
secret-role separation at `:509-623` omit `TOKENLESS_GOLD_INJECTION_KEY_VERSION`,
`TOKENLESS_GOLD_INJECTION_KEYS`, and their `NEXT_PUBLIC_` variants. Runtime selection at
`packages/nextjs/lib/tokenless/goldQuality.ts:43-73,303-365` rejects public variants and requires the current version to
resolve to exactly 32 bytes.

The hosted validator accepted an otherwise-valid environment containing
`NEXT_PUBLIC_TOKENLESS_GOLD_INJECTION_KEYS=browser-visible` and reported no errors; its exported required-variable list
also contains no gold key.

**Impact.** Release preflight can report ready while an eligible customer-invited gold run later fails closed, or while
the gold selection secret is browser-exposed or reused for another role.

**Recommended fix.** Require the server keyring/version when the capability is enabled, forbid both public variants in
test and production gates, parse the current 32-byte entry exactly as runtime does, and add it to distinct secret-role
validation. Test missing, malformed, public, and reused keys.

### POST-16 — Low — Ponder's keeper work feed becomes stale and omits all rounds after 500

**Evidence.** `/keeper/work` sorts oldest-first and applies `.limit(500)` before filtering actionable rows at
`packages/ponder/src/api/index.ts:371-409`. Once the first 500 rounds exist, round 501 and later can never appear.
`openReveal` changes contract state without a transition event at
`packages/foundry/contracts/tokenless/TokenlessPanel.sol:366`; the `RevealAccepted` handler at
`packages/ponder/src/TokenlessPanel.ts:147-177` updates tallies but not the implicit state, so the feed can repeat stale
`open_reveal` actions.

**Impact.** An authorized feed consumer can receive reverting stale work and permanently miss newer due rounds. The
dedicated keeper currently reads chain state directly, limiting present impact.

**Recommended fix.** Query only actionable rows with deadline/state predicates and keyset pagination or fair recent and
historical lanes. For unreleased v4, emit and index an explicit reveal-window transition, or remove exact-state claims
from an event-derived feed that cannot maintain them. Delete the feed if no supported consumer needs it.

## Verification results

| Gate                                    | Result                                                                                                                                       |
| --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `yarn foundry:test`                     | Passed: 62 tests, including lifecycle, custody, conservation, compensation, x402, and Feedback Bonus invariants.                             |
| `yarn test:packages`                    | Passed: 1,448 tests across contracts, node utilities, SDK, agents, keeper, Ponder, promo video, and Next.js; package typechecks also passed. |
| `yarn security:audit`                   | Passed against the current registry: no production or development audit suggestions.                                                         |
| Slither                                 | Analyzed 31 contracts with 101 detectors; reported items were manually triaged and produced no additional actionable fund-core issue.        |
| Focused concurrency and fault schedules | Reproduced stale GRC delivery, stale attestation completion, header-partitioned rate limits, and full-budget keeper starvation.              |

Passing tests do not negate the findings: the missing cases are cross-account browser reuse, same-total payment-intent
substitution, live raw revert decoding, full-budget scheduling, worker overlap after lease reclaim, and cross-principal
media preview.

## Areas with no additional actionable finding

- `TokenlessPanel` and `TokenlessFeedbackBonus` custody separation, liability conservation, base compensation, late
  reveal handling, claims, credits, and stale-return arithmetic;
- credential rotation boundaries, x402 on-chain authorization binding, RBTS scoring, reveal-set commitments, and
  bounded contract pagination;
- the repaired canonical v4 `Round` tuple across current consumers and signed-byte chain transaction recovery itself;
- webhook SSRF protection, DNS pinning, redirect rejection, delivery fencing, and signature handling;
- browser session hashing/cookies, same-origin mutation checks, OAuth PKCE/redirect validation, wallet challenge
  binding, CSP, return-path normalization, encrypted local agent keystore permissions, and tracked-secret scanning; and
- currently reviewed Next.js and Better Auth dependency advisories.

## Release implications

These findings do not replace the production-readiness register. In addition to remediating them, a release still
requires a fresh v4 deployment and atomic service configuration, deployment-scoped reindexing, live integrity epochs,
real-money and legal controls, EU resource evidence, key-management and recovery exercises, and operational monitoring.
A documentation commit or successful branch push is not a release approval, and this audit authorized no deployment.
