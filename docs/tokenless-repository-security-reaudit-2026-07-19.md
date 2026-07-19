# RateLoop Tokenless Repository Bug and Security Re-audit — 19 July 2026

**Status:** Internal engineering audit of commit `c52160010e9cfe9e6e039132eb7338772bd33ba4` on the `tokenless`
branch. This is a point-in-time source review, not customer-facing product copy, a deployment attestation, or release
approval. No fixes were made as part of this review.

## Executive summary

This pass confirmed **18 actionable defects: 2 high and 16 medium**. No critical issue was confirmed. The high-severity
findings are reviewer-action integrity defects: global keyboard handlers can act on several reviews or replace a link
activation with submission, and private batches submit immediately on the last forward action without a review or
confirmation step.

The most important security-adjacent findings are cross-principal browser state and local persistence, paid-commit
recovery gaps, incomplete deployment/database isolation checks, generic eligibility identifiers stored with
dictionary-recoverable hashes, and staged media that can be falsely tombstoned after a failed blob deletion. The
keeper also retains the deployment-to-tip log query previously identified inside `REAUD-13`; this eventually exceeds
Base's documented reliable `eth_getLogs` range.

No new fund-custody, accounting-conservation, admission-signature, or settlement-signature defect was found in
`TokenlessPanel`, `TokenlessFeedbackBonus`, `TokenlessCredentialIssuer`, or the x402 submitter. The branch is still not
ready for real users or real money: the current v4 deployment and the separate operational, privacy, legal, and
real-money hardening gates remain open in the
[production-readiness register](tokenless-production-readiness-2026-07.md).

| ID | Severity | Origin | Area | Finding |
| --- | --- | --- | --- | --- |
| TLRA-01 | High | Residual | Reviewer input | Global shortcuts fan out and Enter on a link can advance or submit |
| TLRA-02 | High | Residual | Private review | The last forward action submits a batch without review or confirmation |
| TLRA-03 | Medium | New | Browser sessions | Authenticated client islands retain the previous principal's state |
| TLRA-04 | Medium | New | Browser storage | Public drafts and commit retries are ownerless across browser accounts |
| TLRA-05 | Medium | New | Commit recovery | The UI bypasses its queue's deadline and backoff policy |
| TLRA-06 | Medium | Residual | Rater sign-in | Generic sign-in returns raters to the operator workspace wizard |
| TLRA-07 | Medium | Residual | Authentication | Network rejection can leave Better Auth controls permanently disabled |
| TLRA-08 | Medium | New | Idempotency | Globally scoped keys permit credentialed cross-tenant request denial |
| TLRA-09 | Medium | New | Deployment isolation | Hosted migrations do not prove which environment owns the database |
| TLRA-10 | Medium | New | Sponsored commits | The server accepts ciphertext beyond the keeper's 16 KiB boundary |
| TLRA-11 | Medium | New | Commit recovery | A post-broadcast crash leaves durable rater state unrecoverable |
| TLRA-12 | Medium | New | Eligibility privacy | Generic provider identifiers use stable, unkeyed SHA-256 references |
| TLRA-13 | Medium | New | Media retention | A failed blob deletion is permanently recorded as deleted |
| TLRA-14 | Medium | Residual | Keeper RPC | Reveal processing queries deployment-to-tip logs on every round |
| TLRA-15 | Medium | New | Keeper memory | Reveal material and invalid keys are cached without eviction |
| TLRA-16 | Medium | New | Ponder availability | Public stats requests repeat an uncached full-table aggregate |
| TLRA-17 | Medium | New | Release preflight | Two public runtime-forbidden variables bypass hosted validation |
| TLRA-18 | Medium | New | Email notifications | GET performs unsubscribe mutation and is vulnerable to link scanners |

“New” means not found in the repository audit records reviewed for this pass; it does not establish the introducing
commit. “Residual” means the source condition was documented previously and remains present.

## Scope and method

Four independent passes covered:

- Foundry contracts, contract/ABI boundaries, the keeper, and Ponder;
- Next.js routes, authentication, tenancy, payments, workers, privacy, database migrations, and deployment gates;
- browser state, rating flows, SDK/agent clients, OAuth, wallet and recovery surfaces, and media handling; and
- dependencies, committed-secret patterns, GitHub Actions trust, current advisories, earlier audit claims, and release
  records.

Candidates were retained only when the current source or a deterministic fault schedule established a concrete
correctness, confidentiality, integrity, retention, availability, or isolation consequence. The audit excluded three
weaker observations after recheck: feedback-pool scan delay remains permissionlessly recoverable, feedback API
pagination has no current application consumer and preserves on-chain evidence, and oversized custom tlock output by
itself did not prove cross-user harm. The sponsored server path is retained separately in `TLRA-10` because it spends
platform gas, persists the payload, and disagrees with the hosted keeper boundary.

Primary-source research informed three conclusions:

- Base recommends keeping `eth_getLogs` ranges below 2,000 blocks and warns that large ranges can time out or be
  rejected: [Base `eth_getLogs` documentation](https://docs.base.org/base-chain/api-reference/ethereum-json-rpc-api/eth_getLogs).
- RFC 8058 exists because mail software fetches unsubscribe URLs automatically; it specifies POST for one-click
  unsubscribe and a landing/confirmation flow for manual GET:
  [RFC 8058](https://www.rfc-editor.org/rfc/rfc8058.html).
- The installed `next@15.5.18` is at or above the patched floor for the current official advisories reviewed:
  [authorization bypass](https://github.com/vercel/next.js/security/advisories/GHSA-26hh-7cqf-hhc6),
  [HTTP smuggling](https://github.com/vercel/next.js/security/advisories/GHSA-ggv3-7p47-pfv8), and
  [image XSS](https://github.com/vercel/next.js/security/advisories/GHSA-ffhc-5mcf-pf4q).

## Detailed findings

### TLRA-01 — High — Global shortcuts can trigger unintended review actions

**Evidence.** `packages/nextjs/components/tokenless/review/ReviewerShell.tsx:42-54` attaches a window-level keydown
listener for every mounted shell. `packages/nextjs/components/tokenless/answer/AnswerPageClient.tsx:134-142` renders
one shell per public task, so one `1`, `2`, `R`, or Enter event reaches every card. The target filter at
`ReviewerShell.tsx:7-14` also omits anchors. Enter on the private artifact link at
`packages/nextjs/components/tokenless/HumanAssuranceRaterClient.tsx:685-692` therefore calls advance/submit and prevents
the link action when the case is complete.

Two non-mutating interaction probes reproduced fan-out to two shells and an anchor-focused Enter event producing
`advance` with no navigation. The existing test mounts only one shell.

**Impact.** A keyboard user can change several drafts at once, initiate several saved-commit retries, or submit a
private final case while intending to open its evidence. These are signed or server-accepted actions that cannot be
treated as harmless navigation mistakes.

**Recommended fix.** Give one explicit active shell keyboard ownership, ignore events inside links and interactive
descendants, and render only the current public task if that is the intended journey. Test multiple mounted shells and
anchor activation.

### TLRA-02 — High — Private batches submit without a review or confirmation step

**Evidence.** `packages/nextjs/components/tokenless/HumanAssuranceRaterClient.tsx:414-420` advances through a batch and
calls `submitResponses()` immediately when the current case is the last one. There is no Back action, batch summary, or
distinct confirmation despite persisting per-case drafts.

**Impact.** A reviewer cannot correct an earlier selection before final acceptance, and the same forward action used
for ordinary navigation becomes an irreversible batch submission on the last case. This compounds `TLRA-01`.

**Recommended fix.** Add Back, a final review summary, editing, and an explicit confirmation action that is distinct
from case navigation. Test correction of an earlier answer and prove no POST occurs before confirmation.

### TLRA-03 — Medium — Authenticated clients retain the previous principal's state

**Evidence.** `packages/nextjs/components/tokenless/TokenlessHandoffClient.tsx:389-466` disables focus/visibility
refresh once its local session is authenticated, retaining workspace names and balances at `:933-959` if the browser
cookie changes from principal A to B in another tab. `AnswerPageClient.tsx:57-87` loads only on route/query changes and
can keep A's private assignment metadata rendered at `:129-132`. Similar one-shot state exists in
`packages/nextjs/components/auth/WalletBindingsClient.tsx:36-43,186-209` and
`packages/nextjs/components/thirdweb/ThirdwebSessionButton.tsx:101-119`.

**Impact.** B can see A's private assignment, workspace, balance, and wallet metadata in a stale tab. Mutations use the
current cookie and remain server-authorized, so no account takeover was confirmed, but stale A intent can be submitted
as B and old asynchronous responses can overwrite B state.

**Recommended fix.** Establish a shared session epoch keyed by the opaque principal, refresh on focus/visibility and
auth broadcast, synchronously purge tenant/private/action state on a proven change, and fence requests with abort plus
a monotonically increasing generation. Test deferred A responses resolving after B.

### TLRA-04 — Medium — Public drafts and commit retries cross browser-account boundaries

**Evidence.** `packages/nextjs/lib/tokenless/reviewDrafts.ts:24-32` hard-codes public draft ownership to `public` in
persistent local storage. `PublicQuestionCard.tsx:188-204` saves the decision, prediction, feedback body/category, and
source URL without a principal. The commit queue record at
`packages/nextjs/lib/tokenless/rater/queue.ts:8-18,83-103,131-155` also has no owner and uses one origin-wide IndexedDB
store. `PublicQuestionCard.tsx:225-260` selects a record by round alone; its stored relay payload at `:445-454` contains
the cleartext public response.

A direct storage probe restored `account A private rationale` under
`rateloop:review-draft:v2:public:public:42`. Server voucher ownership prevents B from spending A's voucher, containing
the financial impact.

**Impact.** A later account on the same browser can recover A's unsent rationale/source, receive A's draft as its own,
and see or trigger A's misleading retry state.

**Recommended fix.** Require a principal on draft and queue schemas and keys, hide or purge ownerless legacy records,
clear on account change, and re-read the current principal immediately before retry. Test A-to-B on the same round.

### TLRA-05 — Medium — Commit recovery bypasses deadline and backoff controls

**Evidence.** `packages/nextjs/lib/tokenless/rater/queue.ts:158-195` implements failure counts, exponential backoff,
due-time filtering, and expiry removal. Production consumers never call those helpers. Instead,
`PublicQuestionCard.tsx:225-293,501-506` lists raw records, labels them ready, retries immediately, and leaves attempts,
`nextAttemptAt`, and expiry unchanged.

**Impact.** Expired cleartext responses persist as “Ready to retry,” and repeated clicks can hammer the sponsored
commit route despite the library's intended retry policy. Server deadlines contain settlement integrity, but recovery
availability and rate control are ineffective.

**Recommended fix.** Consume only `dueTokenlessCommits`, record every failed attempt, disable early retry, and remove or
terminally explain expired work. Cover transient failure, backoff, due retry, and expiry in one integration test.

### TLRA-06 — Medium — Rater sign-in falls back to operator setup

**Evidence.** `packages/nextjs/components/thirdweb/ThirdwebSessionButton.tsx:12-17` links generically to `/sign-in`
without a return path. `packages/nextjs/components/auth/signInReturnPath.ts:3-20` sends missing or invalid paths to
`/agents`. The signed-out Discover gate in `AnswerPageClient.tsx:144-152` therefore returns a prospective reviewer to
the operator workspace wizard after authentication.

**Impact.** The primary rater acquisition path deterministically loses its destination and presents the wrong product
journey. A user can recover only by navigating back to the review area manually.

**Recommended fix.** Carry a normalized local `returnTo` through signed-out gates and use a neutral fallback rather
than `/agents`. Preserve the browser-handoff fragment exception. Add an end-to-end Discover-to-sign-in-to-Discover
test.

### TLRA-07 — Medium — Rejected authentication promises freeze the sign-in form

**Evidence.** Most handlers in `packages/nextjs/components/auth/BetterAuthSignIn.tsx:76-141` set `busy=true` and clear
it only after an expected result object. A transport-level rejection from email OTP, passkey, SSO, add-passkey, or
social sign-in escapes without `catch` or `finally`. Only `finishSignIn` at `:63-74` contains rejection.

**Impact.** A transient network or provider failure can leave every sign-in control disabled until a full page reload,
without an actionable error.

**Recommended fix.** Route all authentication actions through a shared error/finally wrapper and test rejected
promises for every provider family.

### TLRA-08 — Medium — Idempotency keys are global across tenant scopes

**Evidence.** `packages/nextjs/drizzle/0000_tokenless_agent_api.sql:11-25` makes ask idempotency keys globally unique.
`packages/nextjs/lib/tokenless/server.ts:292-305,352-362,487-506` reads and conflicts on the key before workspace
ownership is attached by `packages/nextjs/app/api/agent/v1/asks/route.ts:23-32`. Rater commit keys repeat the pattern at
`packages/nextjs/drizzle/0006_tokenless_rater_commits.sql:20-22` and
`packages/nextjs/lib/tokenless/raterService.ts:292-303`.

A two-tenant memory-database reproduction returned `idempotency_conflict`/409 after A preclaimed B's deterministic
key. Examples in repository docs make human-readable keys plausible. The attacker still needs a valid tenant
credential or rater session/voucher and must predict the victim's key; random keys are not affected.

**Impact.** A credentialed caller can deny a predicted request key in another workspace. No cross-tenant response or
data disclosure was reproduced.

**Recommended fix.** Make ask uniqueness `(workspace/caller, idempotency_key)` and commit uniqueness
`(rater/voucher, request_idempotency_key)`. Preserve same-scope exact replay and conflicting-body rejection.

### TLRA-09 — Medium — Hosted migrations do not prove database ownership

**Evidence.** `packages/nextjs/scripts/migrate-hosted-database.mjs:7-26,98-107` proves the isolated Vercel project and a
nonempty `DATABASE_URL`, then validates only schema/journal shape. The tokenless test deployment preflight at
`packages/nextjs/scripts/check-tokenless-production-readiness.mjs:259-338` does not validate a database URL or an
environment-owned identity marker.

The existing journal check rejects a typical divergent main/legacy database. A reproduction nevertheless showed an
arbitrary URL passes environment validation; an empty wrong database or a tokenless clone/staging database with a
matching journal cannot be distinguished from the intended database.

**Impact.** A misbound tokenless production project can initialize or migrate the wrong empty/shared database, or
advance a matching-journal database belonging to another environment. This violates the branch's deployment-isolation
guard even though the ordinary divergent legacy database is protected.

**Recommended fix.** Create an immutable database/environment identity marker and validate it under the migration
lock before DDL. Test a matching journal with the wrong identity.

### TLRA-10 — Medium — Sponsored commits accept ciphertext beyond the keeper boundary

**Evidence.** The normal browser and keeper use 16,384 bytes at
`packages/nextjs/lib/tokenless/rater/tlock.ts:6,88-100` and `packages/keeper/src/config.ts:237-241`. The commit server at
`packages/nextjs/lib/tokenless/raterService.ts:156-173` checks hexadecimal form and hash but no size; the route uses
unbounded `request.json()` at `packages/nextjs/app/api/rater/commits/route.ts:9-26`. The service persists before
simulation/relay at `raterService.ts:283-415`, while
`packages/foundry/contracts/tokenless/TokenlessPanel.sol:309-363` accepts any nonempty payload and emits it. The keeper
rejects bytes above its configured maximum at `packages/keeper/src/keeper.ts:117-131`.

A correctly hashed 1 MiB payload passed server validation. Exploitation requires an authenticated, paid-eligible rater
with a matching issued voucher and is bounded by voucher/round limits and the hosted request boundary. Vercel documents
the platform request body limit here: [Vercel function body-size guide](https://examples.vercel.com/kb/guide/how-to-bypass-vercel-body-size-limit-serverless-functions).

**Impact.** Oversized input is durably stored before chain simulation, can consume sponsored calldata/event gas when
relayable, and creates accepted commits the hosted keeper refuses to decrypt automatically.

**Recommended fix.** Enforce the same 16 KiB constant in the route, service, keeper, client, and contract; bound the
raw body and relay gas. Test 16,384 succeeds and 16,385 fails before database or RPC work.

### TLRA-11 — Medium — A post-broadcast crash leaves commit state unrecoverable

**Evidence.** `packages/nextjs/lib/tokenless/raterService.ts:283-346,389-415` persists a prepared row and relay nonce,
then broadcasts, then stores the transaction hash. A crash after RPC acceptance loses the only hash. Retry first
simulates at `:363-388` and encounters the already-used commit/nullifier; `getPaidRaterCommit` at `:423-465` reconciles
only `submitted` rows with a stored hash. Scheduled maintenance has no rater-commit recovery lane.

**Impact.** The chain commit can succeed while the voucher, response, API receipt, UI, and audit state remain prepared
or retry forever. The keeper can still discover, reveal, and claim the on-chain commit, so stranded payment was not
proven.

**Recommended fix.** Persist exact signed transaction bytes and derived hash before broadcast and reconcile through a
fenced scheduled state machine. Inject a crash after acceptance and recover the same transaction without replacement.

### TLRA-12 — Medium — Generic eligibility references use unkeyed stable hashes

**Evidence.** Generic provider subject and assertion identifiers accept arbitrary 8–256-character values at
`packages/nextjs/lib/tokenless/paidEligibility.ts:177-206`. The service stores stable SHA-256 references and labels
them `legacy-sha256-v2` at `:700-716,765-815`. The schema supports versioned reference schemes, and World ID already
uses a domain-separated HMAC keyring at `packages/nextjs/lib/tokenless/worldIdAssurance.ts:140-174`.

**Impact.** A database reader can dictionary-match enumerable provider identifiers such as emails or customer IDs and
link the same subject/assertion across records. Impact depends on the provider's identifier entropy; this is not a
remote disclosure by itself.

**Recommended fix.** Use a versioned, domain-separated HMAC for every new generic subject and assertion reference,
retain rotation-aware lookup, and migrate or revoke legacy references. Test that an offline SHA-256 dictionary cannot
match known identifiers.

### TLRA-13 — Medium — Failed blob deletion is permanently tombstoned

**Evidence.** `packages/nextjs/lib/tokenless/publicQuestionMedia.ts:366-409` changes expired staged-media rows to
`deleted` and commits before deleting their blobs. A transient blob failure returns the asset in `failed`, but the next
sweep selects only `ready` rows. Scheduled seeding at
`packages/nextjs/lib/tokenless/scheduledMaintenance.ts:82-129` covers explicitly requested deletions, not this expired
tombstone path.

The fault reproduction attempted deletion once; after two sweeps the database still said `deleted`, retained its
storage reference, and the blob remained orphaned.

**Impact.** Private staged media can survive its expiry indefinitely while the database falsely reports deletion,
breaking retention and deletion evidence.

**Recommended fix.** Delete the blob before the terminal database state or persist a retryable, leased deletion state.
Test failure followed by successful retry and require the object to be gone before reporting deletion.

### TLRA-14 — Medium — Keeper log queries eventually exceed Base's reliable range

**Evidence.** `packages/keeper/src/keeper.ts:251-264` queries `CommitAccepted` for every inspected round from the
deployment block to `latest`; reveal processing depends on this at `:342-358`. Base's official documentation says to
keep the range below 2,000 blocks for reliable results. This log-growth concern was part of `REAUD-13`, but later
fairness remediation did not change `commitLogsForRound`.

**Impact.** After ordinary chain growth, a constrained provider can reject or time out the query. The round throws
before reveal/claim work, and the sequential tick loses the remaining automation. No attacker action is required.

**Recommended fix.** Consume indexed commit evidence or chunk and persist a block cursor below provider limits. Mock a
provider that rejects spans above 2,000 and prove a far-behind deployment still services a fresh round.

### TLRA-15 — Medium — Keeper reveal caches grow without eviction

**Evidence.** `packages/keeper/src/keeper.ts:69-70` declares process-global material and permanently-invalid
collections. `materialForCommit` reads and appends at `:305-339`; only the test reset at `:80-85` clears them. Terminal
round handling never evicts keys.

**Impact.** Ordinary round growth increases heap monotonically; admitted invalid commits can accelerate the invalid
set one voucher at a time. A sufficiently long-lived process eventually restarts or fails, interrupting
reveal/claim/refund automation and resetting in-memory cursors.

**Recommended fix.** Evict on terminal round or use a bounded TTL/LRU keyed by round and commit. Test N terminal rounds
and assert bounded collection size with no stale reuse.

### TLRA-16 — Medium — Public stats repeats an uncached full-table aggregate

**Evidence.** Unauthenticated `GET /stats` at `packages/ponder/src/api/index.ts:263-271` executes
`SUM(tokenlessClaim.amount)` on every origin request. Its `Cache-Control` header instructs downstream caches but does
not cache or coalesce origin work. The claim table is append-only/unbounded; direct callers can use unique irrelevant
query strings to create cache misses. The earlier `POST-14` fix added an origin TTL only to `/status/tokenless`.

**Impact.** Concurrent public requests become repeated O(claim-row) scans and can saturate the Ponder database/API as
history grows.

**Recommended fix.** Maintain the total from indexed events or add an origin TTL with in-flight coalescing and rate
limits. Test N concurrent cache-busting requests and assert one aggregate execution.

### TLRA-17 — Medium — Runtime-forbidden public variables bypass preflight

**Evidence.** `packages/nextjs/lib/privacy/vault/index.ts:158-166` rejects
`NEXT_PUBLIC_TOKENLESS_KMS_KEY_RESOURCE`; `packages/nextjs/lib/tokenless/expertiseVerification.ts:65-72` rejects
`NEXT_PUBLIC_TOKENLESS_EXPERTISE_OPERATOR_ACCOUNTS`. Neither name appears in `FORBIDDEN_PUBLIC_SECRETS` at
`packages/nextjs/scripts/check-tokenless-production-readiness.mjs:120-164`.

A direct preflight probe with both variables set returned
`{"kmsRejected":false,"expertiseRejected":false}`. Existing runtime tests independently prove both later rejections.

**Impact.** A hosted build can pass deployment validation and then fail its vault or expertise path at runtime. The
KMS resource is not necessarily a secret, so the proven consequence is fail-late availability and configuration drift,
not a guaranteed credential disclosure.

**Recommended fix.** Derive one shared forbidden-public list used by preflight and runtime boundaries and test every
runtime-rejected public variable against both the tokenless test and hosted production gates.

### TLRA-18 — Medium — GET mutates email subscription state

**Evidence.** `packages/nextjs/app/api/notifications/email/unsubscribe/route.ts:8-16` consumes the signed token and
disables email on GET before redirecting. The same route correctly offers POST at `:19-23`, and outgoing messages set
both `List-Unsubscribe` and `List-Unsubscribe-Post` at
`packages/nextjs/lib/notifications/resend.ts:119-123`. RFC 8058 specifically identifies automatic URL fetching by mail
software as the source of accidental unsubscriptions and reserves the automatic one-click operation for POST.

**Impact.** Anti-spam scanners and link-safety systems can follow the signed GET before the recipient does, silently
disabling lifecycle, assignment, payment, or optional oversight email. The token prevents unauthorized guessing but
does not distinguish a scanner from the intended recipient.

**Recommended fix.** Keep signed POST idempotent for header one-click. Make GET render a non-mutating confirmation or
preference landing page and have the visible footer complete a user-confirmed POST. Test GET leaves preferences intact.

## Verification and negative evidence

| Check | Result |
| --- | --- |
| Full package matrix | Passed: contracts, node utilities, SDK, agents (101), keeper (41), Ponder (39), Next type checks and 1,281 Next tests |
| Foundry | Passed: 62 tests, including 256-run invariant campaigns |
| Focused server fault-boundary baseline | Passed: 47 existing server/rater/media/readiness/migration tests; the six new fault schedules are absent |
| Focused client baseline | Passed: 7 existing draft, queue, and reviewer-shell tests; multi-principal/multi-shell schedules are absent |
| Dependency audit | `yarn security:audit` passed with no production or development suggestions |
| Next.js resolution | `yarn why next` resolved exactly `15.5.18` |
| Secret-pattern scan | No committed private-key blocks, live Stripe keys, GitHub tokens, or AWS access-key patterns found outside excluded tests/docs/lockfile |
| GitHub Actions | External actions are SHA-pinned; local composite-action references are repository-owned; no `pull_request_target` workflow found |
| Source hygiene | `git diff --check` passed; the pre-existing unrelated feedback-migration formatting edit remained outside this audit |

Passing tests are negative evidence, not proof that the findings are false: the reproduced account-switch, multi-shell,
deletion-failure, oversized-input, post-broadcast-crash, cache-busting, and wrong-environment schedules are not present
in the current suite.

## Recommended remediation order

1. Stop unintended review actions (`TLRA-01`, `TLRA-02`) before any real reviewer flow.
2. Establish one principal epoch and principal-owned local state (`TLRA-03`, `TLRA-04`, `TLRA-05`).
3. Repair the paid-commit path and keeper RPC boundary (`TLRA-10`, `TLRA-11`, `TLRA-14`, `TLRA-15`).
4. Close isolation, privacy, and deletion-evidence gaps (`TLRA-09`, `TLRA-12`, `TLRA-13`, `TLRA-17`, `TLRA-18`).
5. Namespace idempotency and harden the remaining public/auth availability paths (`TLRA-06`, `TLRA-07`, `TLRA-08`,
   `TLRA-16`).

Each fix should receive a dedicated regression for the exact reproduced schedule and an independent commit. Closing
these source findings will not close the separate deployment, real-money, privacy-operations, legal, or key-management
release gates.
