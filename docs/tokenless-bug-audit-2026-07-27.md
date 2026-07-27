# Tokenless bug audit — 27 July 2026

A bug hunt across the repository at `25e235d90`, run as six parallel subsystem
reviews plus an independent tooling pass. Every finding below was re-verified by
hand against the source before it was written down; findings that did not
survive that check were dropped and are listed in
[Claims that did not survive verification](#claims-that-did-not-survive-verification)
so they are not rediscovered later.

## Baseline

Everything green at the time of the audit, which is the point: these are defects
the existing gates do not catch.

| Gate                                                         | Result            |
| ------------------------------------------------------------ | ----------------- |
| `yarn next:test`                                             | 1956 pass, 0 fail |
| `yarn foundry:test`                                          | 77 pass, 0 fail   |
| Every other package suite                                    | pass              |
| `yarn next:check-types`, `yarn next:lint`, `yarn next:build` | pass              |
| `yarn npm audit` (production and development)                | no advisories     |

`strict: true` is on, and the repository carries exactly one type suppression
and nine `as any` casts, all nine in test files.

## Severity

**High** — data-protection failure, money, or a security boundary. **Medium** —
wrong behaviour a user or operator will hit. **Low** — correctness or tooling
debt with no current user impact.

## Fix these first

Ordered by what breaks if they are left alone.

1. **[7] Text-only MCP handoffs cannot be submitted at all.** The primary
   documented agent flow returns 400 on every plain-text question. A one-line
   parser change.
2. **[2, 23, 24] Dead scheduled work is unrecoverable, and it eventually stops
   evidence publication platform-wide.** One root cause, three symptoms; the
   third is a silent global halt. Needs a revive path and an operator requeue.
3. **[10] A prepaid invoice is emailed before it is recorded.** Money can arrive
   with nothing credited, no error, and no alert. Bind the invoice before
   sending, and write the draft reconciler the index was already built for.
4. **[1] Workspace deletion leaves trader identity and billing addresses
   behind.** Three tables from one migration, half covered.
5. **[8] The idempotency scope is caller-chosen.** Double funding, then a
   permanently broken handoff.
6. **[32, 31, 30] Three user-facing breakages in the review path** — a blank
   queue with no recovery, a terms checkbox that clears whenever the reviewer
   reads the terms, and a crash on hybrid specialist panels.

Two are cheap and worth doing while nearby: **[16]** the timing-unsafe token
comparison that its own sibling route already does correctly, and **[19]** the
prototype-chain hole in `parseWelcomeChoice`.

The scoring mechanism itself is **not** on this list: RBTS, conservation, and the
round state machine were checked arithmetically and came out clean, and the
deployment artifact was verified at the bytecode level.

---

## Data protection and persistence

### 1. Workspace deletion never erases the governance, client, or cost-centre tables — High

[`lib/privacy/workspaceDeletion.ts`](packages/nextjs/lib/privacy/workspaceDeletion.ts)
covers roughly fifty tables. It never touches `tokenless_workspace_governance`,
`tokenless_workspace_clients`, or `tokenless_workspace_cost_centers`.

The governance row holds `trader_legal_name`, `trader_registration_number`,
`trader_registered_address`, `vat_id`
([`drizzle/0008_workspace_governance.sql:5-9`](packages/nextjs/drizzle/0008_workspace_governance.sql:5)),
plus the billing address columns added by
[`drizzle/0085_prepaid_topups.sql:3`](packages/nextjs/drizzle/0085_prepaid_topups.sql:3).
For a sole trader — the ordinary case for an individual EU customer — legal name
plus registered address plus VAT identifier is direct personal data.

What makes this an oversight rather than a decision: the same migration created
six tables, and deletion covers exactly the three `member_*` ones
(`member_governance`, `member_clients`, `member_invites`) while missing the
other three.

No cascade rescues it. Deletion **tombstones** the workspace —
[`workspaceDeletion.ts:1109`](packages/nextjs/lib/privacy/workspaceDeletion.ts:1109)
sets `status = 'deleted'` and never issues `DELETE FROM tokenless_workspaces` —
so the `REFERENCES tokenless_workspaces` foreign key never fires. A
repository-wide search for the table name outside `member_governance` finds only
readers and writers in `lib/tokenless/workspaceGovernance.ts` and
`lib/billing/workspaceBilling.ts`. There is no delete and no anonymise anywhere,
including in `accountDeletion.ts`, `deletionReconciliation.ts`,
`workspaceDeletionRetention.ts`, and `privacyRetention.ts`.

**Failure scenario.** A sole trader completes VAT and trader verification, then
deletes the workspace. `requestWorkspaceDeletion` returns
`{ deleted: true, immediate: true, status: "completed" }` and writes a
completion receipt. The trader's legal name and registered address remain in
`tokenless_workspace_governance` indefinitely, with no retention deadline and no
expiry job. The deletion postconditions
([`workspaceDeletion.ts:1113-1189`](packages/nextjs/lib/privacy/workspaceDeletion.ts:1113))
do not assert on the table, so the job reports success.

### 2. A dead `delete_artifact` work item can never be retried, and it strands the deletion job forever — High

`insertWorkItem`
([`lib/tokenless/scheduledMaintenance.ts:129-137`](packages/nextjs/lib/tokenless/scheduledMaintenance.ts:129))
uses `ON CONFLICT (kind, subject_key) DO NOTHING`. An item flips to
`state = 'dead'` after `MAX_ATTEMPTS = 20`
([`:517`](packages/nextjs/lib/tokenless/scheduledMaintenance.ts:517)), with the
backoff capped at one hour.

The only revive path in the codebase is the `ON CONFLICT … DO UPDATE … WHERE
state IN ('completed','dead')` in
[`lib/tokenless/nonceRecovery.ts:128`](packages/nextjs/lib/tokenless/nonceRecovery.ts:128),
and it is reachable only for the two kinds `workKind()` can return —
`recover_chain_execution` and `recover_rater_commit`. Nothing ever deletes rows
from `tokenless_scheduled_work_items` either, so the dead row is permanent and
every future seeding attempt silently no-ops.

Legal holds are handled correctly: `deletion_blocked_by_hold` and
`deletion_not_due` are in `NON_COUNTING_DEFER_CODES`, so a long hold does not
burn attempts. These do burn attempts: any raw error from
`runtime.store.delete()`, `retention_policy_unavailable`,
`artifact_deletion_checkpoint_invalid`, and `artifact_deletion_audit_conflict`.

**Failure scenario.** A blob-storage token is rotated with the wrong scope and
`del()` returns 403 for about thirteen hours. Every due `delete_artifact` item
burns its twenty attempts and dies. Credentials are fixed. The next
`seedTokenlessScheduledWork` selects the same still-active `object_id`, the
`DO NOTHING` drops it, and the artifact is retained forever. Downstream,
`reconcileWorkspaceDeletionJobs` counts the still-active object, keeps the
workspace deletion job `running` and the subject request `in_progress`
indefinitely, and the erasure request never completes.

### 3. Audit export raises a false tamper alarm on any workspace with no events yet — Medium

[`lib/privacy/audit.ts:557`](packages/nextjs/lib/privacy/audit.ts:557) builds
`snapshotHead` from `snapshot.rows[0]`, which always exists because the retention
policy CTE is `LEFT JOIN`ed. With no `tokenless_audit_heads` row the result is a
_truthy_ object `{ last_sequence: null, last_digest: null }`.

`verifyWorkspaceAuditRows`
([`:410`](packages/nextjs/lib/privacy/audit.ts:410)) therefore takes the `head &&
…` branch. `Number(null) === 0` matches `eventCount`, but `rowString` returns
`null` for a missing digest ([`:48`](packages/nextjs/lib/privacy/audit.ts:48)),
and `null !== GENESIS_DIGEST`, so it returns `valid: false` and the export throws
`409 audit_invalid`.

`verifyWorkspaceAuditChain` ([`:419`](packages/nextjs/lib/privacy/audit.ts:419))
passes `headResult.rows[0]`, which is genuinely `undefined` in the same state,
takes the `!head && eventCount > 0` branch, and returns `valid: true`. **The two
functions disagree about identical database state.**

Reachable today: `createWorkspace`
([`lib/tokenless/productCore.ts:314`](packages/nextjs/lib/tokenless/productCore.ts:314))
inserts the evidence-retention policy but calls `appendAuditEvent` nowhere, so
every freshly created workspace is in exactly this state. An owner who exports
the audit log before taking any auditable action is told "The workspace audit
chain failed integrity verification" instead of receiving an empty valid export.

### 4. The legacy key-domain fallback breaks decryption after the first key rotation — Medium, conditional

`parseKeyDomain`
([`lib/tokenless/artifactPrivacy.ts:184-187`](packages/nextjs/lib/tokenless/artifactPrivacy.ts:184))
returns the **currently active** provider's `keyResource` for a legacy row, while
`keyVersion` still comes from the row itself. The unwrap guard at
[`lib/privacy/vault/platformSecret.ts:228`](packages/nextjs/lib/privacy/vault/platformSecret.ts:228)
then requires `wrapped.keyResource === keyResource(wrapped.keyVersion)` and
throws when they disagree.

**Failure scenario.** A row carries the plain legacy `key_domain =
'customer_artifact'` and `key_version = 'artifact-v1'`. An operator rotates to
`artifact-v2`, keeping `artifact-v1` in the keyring. The resolved `keyResource`
now names `artifact-v2` while the version is still `artifact-v1`, so unwrap
throws `503 vault_key_unavailable` permanently — for every legacy artifact, even
though the correct root key is present. The bug fires precisely on the operation
the versioned keyring exists to support.

Rows written by `storeEncryptedArtifact`, which persists the JSON key domain, are
unaffected. Marked conditional because whether such legacy rows exist in the
deployed database is an operational fact this audit could not establish. The
existing rotation test only exercises the provider API with a well-formed
`WrappedDataKey` and never reaches `parseKeyDomain`, so it passes regardless.

### 5. `local-test` unwrap branch skips per-tenant key derivation — Low

[`lib/privacy/vault/platformSecret.ts:225-227`](packages/nextjs/lib/privacy/vault/platformSecret.ts:225)
decrypts with the raw root key when `wrapped.provider === "local-test"`, skipping
`tenantWrappingKey()` — the per-tenant isolation the module exists to provide.
The gate is a self-declared field on an attacker-controlled database column, in
production code.

This is defence-in-depth, not a break: the AAD still binds
`workspaceId:projectId:artifactId:keyVersion`, GCM authenticates it, and the
identifier charset `[A-Za-z0-9_-]` forbids the `:` delimiter, so no
delimiter-confusion replay is possible, and forging a ciphertext still requires
the root key.

### 6. Subject-export payloads outlive account deletion — Low

[`lib/privacy/lifecycle.ts:1041`](packages/nextjs/lib/privacy/lifecycle.ts:1041)
stores the whole subject export as **plaintext JSON** in
`tokenless_subject_request_exports.payload_json` — not vault-wrapped — with a
seven-day `delete_after`. `deleteAccount` never references that table.

A user who exports their data and deletes the account the same day gets a
completion receipt while the full plaintext dump remains in the primary database
for up to seven more days, removed only by the retention sweep. No authenticated
read can reach it once the principal is gone, so this is residual data rather
than exposure — but it contradicts the receipt.

---

## Agent API, SDK and MCP

### 7. Every text-only MCP handoff is rejected at ask submission — High

This breaks the primary documented MCP flow.

The handoff page always includes `mediaPreviews` in the ask body
([`TokenlessHandoffClient.tsx:774`](packages/nextjs/components/tokenless/TokenlessHandoffClient.tsx:774)),
and for a text-only handoff its value is `[]` — `validateMediaPreviews` returns
an empty array when the question has no images
([`:112`](packages/nextjs/components/tokenless/TokenlessHandoffClient.tsx:112)),
matching `handoff.ts:144`. `JSON.stringify` keeps the key, so the server sees the
field _present and empty_.

The parser distinguishes present-and-empty from absent
([`lib/tokenless/server.ts:283-290`](packages/nextjs/lib/tokenless/server.ts:283)):

```ts
if (raw === undefined) return [];
if (!Array.isArray(raw) || raw.length < 1 || raw.length > 4) throw … 400 invalid_media_preview_capability
```

`[]` fails `raw.length < 1` and throws. I executed both branches to confirm:
the key absent passes, the empty array throws.

**Failure scenario.** `rateloop_create_handoff` with a plain text question, open
the handoff URL, approve, "Get price" succeeds, "Submit and reserve" returns
**400 `invalid_media_preview_capability`** — an error about staged images for a
handoff that has none. No ask is ever created, and
`rateloop_get_handoff_status` reports `"prepared"` forever.

Nothing catches it:
[`app/api/agent/v1/asks/route.ts:30`](packages/nextjs/app/api/agent/v1/asks/route.ts:30)
calls the parser on the raw body before any other handling, and
`parseTokenlessAskMediaPreviewGrants` has no test at all. The nearest test is a
`readFileSync` source-string match.

### 8. The idempotency scope is chosen by a caller-controlled field — High

The scope is built _after_ workspace resolution, and for prepaid the workspace
comes from the request body
([`productCore.ts:1463`](packages/nextjs/lib/tokenless/productCore.ts:1463),
scope at [`:1522`](packages/nextjs/lib/tokenless/productCore.ts:1522)):

```ts
`workspace:${workspaceId}:account:${accountAddress}`;
```

Uniqueness is `(idempotency_scope, idempotency_key)`
([`schema.ts:236`](packages/nextjs/lib/db/schema.ts:236)), so changing
`payment.workspaceId` moves a replay into a _different_ scope and no conflict is
detected. `resolveWorkspace` accepts any workspace the account belongs to.

The quote does not stop it. `loadQuote`
([`productCore.ts:874-881`](packages/nextjs/lib/tokenless/productCore.ts:874))
applies its ownership check only when `visibility !== "public"`, and
[`quote/route.ts:61`](packages/nextjs/app/api/agent/v1/quote/route.ts:61) accepts
_only_ `visibility === "public"` — so every handoff quote is public and
unbound to a workspace. Quotes are not consumed on use either.

**Failure scenario.** A user belongs to funded workspaces A and B. They submit a
handoff from A: one ask, one prepaid reservation for the full quoted total.
Re-opening the same handoff URL and selecting B submits a _second_ ask with a
second full reservation. One handoff, charged twice.

It then breaks permanently: `getTokenlessAskByIdempotencyKey`
([`server.ts:730-741`](packages/nextjs/lib/tokenless/server.ts:730)) queries by
key with **no scope** and throws `409 ambiguous_idempotency_key` on more than one
row. Since the schema deliberately permits duplicate keys across scopes, both
`rateloop_get_handoff_status` and `rateloop_get_result` fail for that handoff
from then on. The same divergence applies to two API keys in one workspace,
because `apiKeyId` is part of the scope.

### 9. Smaller API issues — Medium and Low

- **Semantic errors become opaque 500s.** `callTool`
  ([`lib/mcp/protocol.ts:307`](packages/nextjs/lib/mcp/protocol.ts:307)) maps only
  `TokenlessMcpToolError`; a `TokenlessServiceError` escapes to the generic
  handler and returns `-32603 internal_error`. Combined with finding 8 the agent
  gets an unactionable 500 instead of a 409.
- **No rate limiting on the authenticated agent routes.** Only `/quote` and the
  two MCP routes call `consumeMcpRateLimit`; `middleware.ts` only sets CSP
  headers. `waitForTokenlessAsk` polls every 250 ms, so one 60-second `/wait`
  costs roughly 240 database round-trips with no cap on concurrent waits per
  credential. In the same loop, a cursor-less call only breaks on `resultJson`,
  so a status change alone does not end the poll and the first call always burns
  the full timeout.
- **No request body cap on `/asks` and `/assurance/*`.** `/quote` and both MCP
  routes cap bodies at 64 KiB; these call `await request.json()` unbounded, and
  the private-review schema permits base64 artifacts up to 10 MB.
- **SDK types contradict the server.** `TokenlessQuoteRequest` marks
  `visibility`, `dataClassification` and `confirmedNoSensitiveData` optional and
  defaults them to `private`/`internal`, which `/quote` rejects outright. A
  caller who follows the types always fails; the README example happens to set
  all three.

---

## Billing and payments

### 10. A prepaid invoice is emailed before it is bound in the database — High

`createPrepaidTopup`
([`lib/billing/prepaidTopups.ts:247`](packages/nextjs/lib/billing/prepaidTopups.ts:247))
finalizes **and sends** the invoice, and only afterwards runs the `UPDATE` that
records `provider_invoice_id` and sets `state='sent'`. `createAndSendPrepaidInvoice`
itself throws _after_ `sendInvoice` has returned
([`lib/billing/stripe.ts:282-297`](packages/nextjs/lib/billing/stripe.ts:282)),
and a pool timeout, redeploy, or process restart in that window has the same
effect.

**Failure scenario.** A workspace requests a $500 top-up. `sendInvoice` succeeds
and the customer receives a payable invoice. The instance is recycled before the
`UPDATE` commits. Days later the customer pays. `invoice.paid` arrives,
`projectPrepaidInvoice` looks up by `provider_invoice_id`, finds no row, and
returns `{ matched: false, credited: false }`
([`prepaidTopups.ts:386`](packages/nextjs/lib/billing/prepaidTopups.ts:386)).
The webhook only acts `if (projected.matched)`
([`webhooks.ts:215`](packages/nextjs/lib/billing/webhooks.ts:215)), marks the
event `processed`, and returns 200. **$500 received, nothing credited, no
error, no alert.**

Nothing recovers it. `reconcilePrepaidTopups` selects only
`state IN ('sent','paid')` ([`:496`](packages/nextjs/lib/billing/prepaidTopups.ts:496)),
so draft rows are never reconciled — while the partial index created for exactly
this purpose _does_ include `'draft'`
([`drizzle/0085_prepaid_topups.sql:105`](packages/nextjs/drizzle/0085_prepaid_topups.sql:105)),
which suggests a draft reconciler was planned and never written. The one path
that would rebind — retrying with the same `idempotencyKey` — is unreachable
from the UI, because `WorkspaceSettingsClient.tsx:523` mints a fresh
`browser:${crypto.randomUUID()}` on every submit. A user's natural retry issues a
_second_ invoice, leaving the customer holding two payable invoices of which only
one credits.

### 11. No refund, credit-note, or dispute handling — Medium-High

`HANDLED_EVENTS` ([`webhooks.ts:10-18`](packages/nextjs/lib/billing/webhooks.ts:10))
covers checkout, subscription, `invoice.paid`, `invoice.payment_failed` and
`invoice.voided`. `credit_note.created`, `charge.refunded`,
`charge.dispute.created`/`.closed` and `invoice.marked_uncollectible` all fall
through to the `else` branch and are marked `processed` with no state change.
There is no debiting ledger write anywhere for a reversal — the only negative
prepaid ledger insert in the codebase is the round-consumption debit.

**Failure scenario.** A workspace tops up $10,000. Support refunds it in the
Stripe dashboard. The resulting events are recorded as processed and ignored, and
`reservePrepaid` still sees the full $10,000 as spendable on paid review work.

### 12. Two webhook `throw`s poison the shared billing endpoint — Medium

[`prepaidTopups.ts:408`](packages/nextjs/lib/billing/prepaidTopups.ts:408) throws
`paid_invoice_for_failed_topup` on any non-void invoice event once a top-up has
reached `failed`. A Stripe-side amount drift produces a terminal validation error
and marks the top-up `failed`; if the customer then pays, `invoice.paid` throws,
the transaction rolls back, and the route returns 500. Stripe retries for about
three days, failing every time. Because this is the single endpoint for **all**
billing events, sustained failures put subscription projection at risk too.

Compounding it, `tokenless_billing_webhook_events` is written by `webhooks.ts` and
read by nothing else in the codebase. Rows stuck in `processing` or `failed` are
never alerted on, re-driven, or reported.

### 13. Price rotation breaks existing subscribers — Medium

`supportedSubscription` ([`webhooks.ts:40-45`](packages/nextjs/lib/billing/webhooks.ts:40))
throws unless the subscription's price id equals the single current
`STRIPE_EARLY_ACCESS_MONTHLY_PRICE_ID`. Meanwhile `plans.ts` carries
`LEGACY_EARLY_ACCESS_PRICE_VERSION` and maps it to `early_access` — the reader is
built for subscribers on a prior price while the writer accepts exactly one price
id, and no legacy price-id variable exists.

On the next rotation, every subscription event for a subscriber still on the old
price throws, returns 500, and never projects — those workspaces silently fall
back to Free at period end while still being charged.

### 14. Requesting a top-up can delete the subscription's EU VAT ID — Medium

[`lib/billing/stripe.ts:200-208`](packages/nextjs/lib/billing/stripe.ts:200)
deletes every stored `eu_vat` tax id when `input.vatId` is absent, and it runs
unconditionally from the top-up path. The Stripe customer is shared between the
subscription and prepaid invoicing.

**Failure scenario.** A German workspace subscribes through Checkout with tax-id
collection, so Stripe applies reverse charge. The owner later fills in the billing
profile leaving the optional VAT fields blank and requests a top-up. The VAT id is
deleted from the customer, and every subsequent renewal is invoiced with VAT
charged rather than reverse-charged.

---

## Authentication and authorization

The sweep enumerated all ~220 route handlers and traced each to its enforcement
SQL rather than sampling. **No IDOR was found**, and the Better Auth rule holds —
provider subjects and emails are used only as identity bindings, never as
workspace authorization keys.

### 15. Email-bound private-group invitations can never be redeemed — Medium

[`lib/tokenless/privateGroups.ts:913-916`](packages/nextjs/lib/tokenless/privateGroups.ts:913)
gates redemption on `tokenless_browser_identities.primary_email` and
`.email_verified`. Neither column is ever written: the only production insert
([`lib/auth/principal.ts:65-69`](packages/nextjs/lib/auth/principal.ts:65))
hardcodes `email_verified = false` and omits `primary_email`, and no `UPDATE`
exists anywhere in `lib/` or `app/`.

So `!rowBoolean(identity, "email_verified")` is always true and every invitation
carrying `intended_email_hash` or `intended_email_domain` returns
`403 private_group_invitation_binding`, for both redeem and preview.

The correct implementation exists three hundred lines away:
[`workspaceReviewers.ts:582-593`](packages/nextjs/lib/tokenless/workspaceReviewers.ts:582)
reads `tokenless_better_auth_users.email` — the table Better Auth actually
populates. The private-group path was written against the legacy column and never
migrated.

**Failure scenario.** An admin creates a group invitation scoped to `@acme.com`.
The invited reviewer signs in with a verified account at that domain and is
permanently rejected.

### 16. Timing-unsafe comparison of the pipeline secret on one route — Medium

[`app/api/internal/tokenless/moderation/route.ts:16`](packages/nextjs/app/api/internal/tokenless/moderation/route.ts:16)
compares the bearer token with `!==`. The sibling route guarding the _same_
`TOKENLESS_PIPELINE_TOKEN` hashes both sides and uses `timingSafeEqual`
([`pipeline/route.ts:18-24`](packages/nextjs/app/api/internal/tokenless/pipeline/route.ts:18)),
as does every other internal guard in the repository. This one is the outlier.

Recovering the token would yield approve/reject/delist on any operation or public
rater response, plus the pipeline route. Remote timing attacks on V8 string
comparison over TLS are difficult in practice and exploitability was not
demonstrated — the finding rests on the inconsistency with its own sibling.

### 17. API-key scopes are not asserted on three agent mutation routes — Medium

`requireProductPrincipalScope` is never reached from
`agent/v1/media/images` (POST), `agent/v1/assurance/projects` (POST), or
`agent/v1/assurance/private-reviews` (POST). The latter two authenticate through
`authenticateAssuranceApiPrincipal`, which validates the key and rejects session
principals but asserts no scope.

A key issued with `scopes: ["telemetry:write"]` for a low-trust agent can still
create assurance projects, open private reviews, and stage media. It stays inside
the key's own workspace, so this is a scope-restriction bypass rather than a
cross-tenant one. `agent/v1/assurance/review` _does_ assert `review:decide`, so
the vocabulary is applied inconsistently rather than deliberately omitted.

### 18. OAuth refresh-token replay detection is unreachable — Medium-Low

[`lib/tokenless/agentOAuth.ts:732-742`](packages/nextjs/lib/tokenless/agentOAuth.ts:732)
revokes a token family when a refresh token shows `used_at` or `replaced_at`.
Neither column is ever written; the refresh branch returns the same refresh token
unchanged. A leaked refresh token is therefore usable for its full 30-day life
alongside the legitimate client, undetected, and
`agent-integrations/[integrationId]/recover-oauth` can only ever return 404
because it requires one of those columns to be set.

A doc comment suggests stable refresh tokens were a deliberate move, but the
schema still carries `used_at`, `replaced_at` and a `UNIQUE(token_family_id,
generation)` constraint, and `agentOAuth.test.ts` has no rotation or replay test
either way.

### 19. Smaller auth issues — Low

- **`parseWelcomeChoice` accepts prototype keys.**
  [`lib/auth/welcome.ts:11`](packages/nextjs/lib/auth/welcome.ts:11) uses
  `value in WELCOME_DESTINATIONS`, which walks the prototype chain; I confirmed by
  execution that `toString`, `constructor`, `valueOf` and `__proto__` all return
  `true`. Posting `choice=toString` passes validation, commits
  `completePrincipalWelcome`, then calls `redirect()` with a function. Use
  `Object.hasOwn`. The existing test asserts only that `"unknown"` is rejected —
  which is not on the prototype, so it passes on the broken code.
- **The `__Host-` session cookie is not cleared on logout.**
  `response.cookies.delete()` emits a `Set-Cookie` without `Secure` and `Path=/`,
  and browsers reject any `__Host-` cookie lacking them. Server-side revocation
  still works, so the impact is a dead token lingering in the browser.
- **`/api/rater/feedback-bonus-entitlements` authenticates then discards the
  principal.** Every field returned is already public on chain, so this is not a
  vulnerability — but the shape reads like scoping was intended and lost.
- **Header-derived controls depend on the host.** The MCP rate-limit identity
  falls back to `x-real-ip`, and the rater geoblock reads `x-vercel-ip-country`
  straight from headers. On Vercel the platform-set headers win; off-platform both
  are spoofable.

---

## Scheduled work, cron and contracts

Findings 2, 23 and 24 share one root cause and should be fixed together: **a
work item that reaches `state = 'dead'` can never be revived by anything in the
codebase.** Nothing resets it, nothing deletes it, and no route or script exposes
a requeue. The two kinds that do have a revive `UPDATE`
([`scheduledMaintenance.ts:249-254`](packages/nextjs/lib/tokenless/scheduledMaintenance.ts:249),
`:265-270`) match `state = 'completed'` only — never `'dead'`.

### 23. A dead `publish_finalized_round` item loses that round's evidence forever — High

The backoff is 30 s doubling to a one-hour cap, so twenty attempts is roughly
fourteen hours. Any outage of that length — the app origin it calls, or a storage
provider — kills the item. From then on that round's `round.finalized`
transparency event is never published and there is no in-product way to retry it.
Recovery requires direct SQL.

### 24. Dead items then head-of-line-block the seed query, platform-wide — High

The seeding query
([`scheduledMaintenance.ts:171-179`](packages/nextjs/lib/tokenless/scheduledMaintenance.ts:171)):

```sql
WHERE e.state = 'confirmed' AND e.round_id IS NOT NULL AND t.event_id IS NULL
ORDER BY e.updated_at ASC LIMIT 100
```

A dead item still matches forever — publication never happened, so `t.event_id IS
NULL` stays true — and its `updated_at` never changes, so it stays permanently
among the _oldest_ rows. Each dead item permanently consumes one of the hundred
seed slots.

**Failure scenario.** Once a hundred rounds have accumulated dead publish items,
the seed query returns only those hundred, `insertWorkItem` no-ops on every one,
and **every newly finalized round is silently never seeded**. Evidence
publication stops platform-wide, producing no new errors and no new dead items.

### 25. The evidence alert goes blind exactly when the failure becomes permanent — Medium

`evidencePendingOperationalHealth`
([`:551`](packages/nextjs/lib/tokenless/scheduledMaintenance.ts:551)) counts
`state IN ('pending','retry','processing')` and **excludes `'dead'`**, so a
publish item drops out of the fifteen-minute alert at the moment its situation
becomes unrecoverable.

The compensating signal is a global `deadWorkItems > 0` count over a table nothing
ever cleans, so once any single item of any kind has ever died, `status` is pinned
to `degraded` for the life of the database and carries no information. The cron
route returns HTTP 200 regardless, so a degraded run is indistinguishable from a
healthy one to the platform's monitoring.

### 26. Around thirty serial processors share a sixty-second budget — Medium

`maxDuration = 60` with a `*/5` cron, and the pipeline runs its processors
strictly sequentially, several doing outbound network I/O. `deliverWebhooks` is
second-to-last and `processNotifications` is last.

**Failure scenario.** The earlier half slows down and every run is killed at sixty
seconds before reaching them. Because a hard timeout is not a caught exception,
the `catch` never runs: the `tokenless_scheduled_worker_runs` row stays
`status='running'` with no `last_error`. Webhook and notification delivery stop
indefinitely while the run ledger shows no failures at all. Position in a fixed
order decides who starves.

Separately, `seedTokenlessScheduledWork`, `claimDueWork`, `processClaimedWork`
and `evidencePendingOperationalHealth` are _not_ wrapped in
`runIsolatedMaintenanceProcessor`, so a throw in any of them skips every
processor that follows for that tick.

### 27. Two jobs are not on the schedule — Medium

- `processDueArtifactDeletions`
  ([`artifactPrivacy.ts:1281`](packages/nextjs/lib/tokenless/artifactPrivacy.ts:1281))
  has no production caller. Its query is strictly _broader_ than the seed query
  that replaced it — it also unions `tokenless_artifact_deletion_jobs WHERE state
<> 'completed'`. So a deletion job whose object row has already left
  `status='active'` but whose job never completed is picked up only by the
  function that never runs.
- `sweepExpiredPublicQuestionMedia`
  ([`publicQuestionMedia.ts:366`](packages/nextjs/lib/tokenless/publicQuestionMedia.ts:366))
  is called only from two upload routes, so it is piggybacked on request traffic
  while every sibling sweep is on the cron. A workspace with no uploads never
  sweeps its expired public media.

### 28. `TokenlessFeedbackBonus`: awarded-but-unclaimed USDC is unrecoverable — Medium

`claimAward` has no deadline (deliberate), and `refundRemainder` refunds only
`depositedAmount - awardedAmount`
([`TokenlessFeedbackBonus.sol:316`](packages/foundry/contracts/tokenless/TokenlessFeedbackBonus.sol:316)).
If a full award is made and the recipient then cannot claim — a lost `payoutSalt`,
or a committed payout address that USDC blacklists — the refund computes to zero
and reverts `NothingToRefund`. The funds are stranded permanently.

`TokenlessPanel` solves this exact case with `returnStaleShares` gated on
`claimDeadline`; the bonus contract has no analogue. Both contracts are immutable,
so this cannot be patched after deployment. Severity is capped at Medium because
it requires claimant error or an issuer freeze, not an attacker.

### 29. Beacon-window liveness is an unfunded obligation that pays the funder — Low-Medium

If `beginSettlement` and `processAggregate` do not complete before
`beaconFailureDeadline`, only `finalizeScoringFallback` remains, `result` stays
zero-initialised, every panelist receives just the 80% `fixedBasePay`, and the
**entire 20% quality bonus is refunded to the funder**
([`TokenlessPanel.sol:627`](packages/foundry/contracts/tokenless/TokenlessPanel.sol:627)).
The guaranteed window is `MIN_BEACON_GRACE = 6 hours`. The calls are
permissionless so the funder cannot force this, but they are its sole
beneficiary — and it is the separately hosted keeper, not the Vercel cron, that
must land three transactions inside that window.

**The deployment artifact is clean.** `tokenless-v4/84532.json` was verified at
the bytecode level, not by inspection: all six contracts recompiled under the
deploy profile match the on-chain init code in the broadcast record exactly, the
`QuicknetTBeaconVerifier` runtime hash matches, `deploymentKey` decomposes into
the recorded addresses, and `git diff` over `contracts/`, `foundry.toml`,
`remappings.txt`, `lib` and `script` from the artifact commit to HEAD is empty.

---

## Browser application

### 30. Clicking any specialist area crashes the page on a hybrid audience — High, conditional

`addExpertiseDefinition`
([`AgentSetupFlow.tsx:690`](packages/nextjs/components/tokenless/agents/setup/AgentSetupFlow.tsx:690))
calls `requirementForDefinition` **inside** the `setReviewExpertise` updater, and
that function throws unconditionally for `audience === "hybrid"`
([`reviewExpertise.ts:42-44`](packages/nextjs/components/tokenless/agents/setup/reviewExpertise.ts:42)).
A throw inside a React state updater reaches the root error boundary.

Entering specialist mode is disabled for hybrid, but the "Specialist areas"
section is gated only on `reviewExpertise.needsSpecialists`, which is set from
saved requirements or legacy expertise keys — so for a workspace whose binding
was saved as hybrid with at least one specialist requirement, live "+ area"
buttons render. Clicking one replaces the whole page with the error screen and
loses every unsaved answer on a very long form. Conditional on such a saved
configuration existing in current data.

### 31. The paid-review terms checkbox unticks whenever the window regains focus — Medium-High

`subscribeToBrowserAuthSessionChanges` listens on `window focus` and
`visibilitychange` ([`lib/auth/client.ts:26-41`](packages/nextjs/lib/auth/client.ts:26)),
and `AnswerPageClient` reloads on every such event
([`:153`](packages/nextjs/components/tokenless/answer/AnswerPageClient.tsx:153)).
Each reload replaces `tasks` with freshly parsed objects, so the `task` prop
identity changes and
[`PublicQuestionCard.tsx:263-266`](packages/nextjs/components/tokenless/answer/PublicQuestionCard.tsx:263)
resets `networkTermsAccepted` to `false` — deriving state from props in an effect.

**Failure scenario.** A reviewer opens a paid network review, ticks "I accept the
exact public paid-review terms", switches away to read the terms the UI itself
links to, and returns to find the box cleared and the action disabled again, with
no explanation. It repeats indefinitely. The same root cause resets the video
player in `QuestionMedia.tsx:48-52`.

### 32. The review queue can render a completely blank page — High

Three conditions in `AnswerPageClient` disagree: the scope pills need **both**
lists non-empty, the render guards test `scope !== "public"` / `scope !== "private"`,
and the empty state needs **both** lists empty.

**Failure scenario.** A user with both public tasks and a private assignment
selects the "private" pill and submits that review. Now `assignments` is empty and
`tasks` is not: the pills vanish, the public tasks are suppressed, the empty state
is suppressed, and the content area renders nothing. The only recovery is clicking
the tab the user is already on, or editing the URL by hand.

### 33. Setup wizard navigation fails silently and races itself — Medium-High

`loadStep` has no `try`/`catch` and is called as a bare `void loadStep(...)` from
Back, the progress-bar chips, and "Check agent"; `readJson` throws on any non-2xx
and the app registers no `unhandledrejection` handler. An expired session makes
"Back" do nothing at all — no navigation, no banner, no busy state. The
neighbouring `createConnectionMessage` and `confirmAgent` paths _do_ await inside
a `try` and surface the failure, so this is an omission rather than a policy.
None of these set `busy`, so `loadStep` can also race `configureReviews` with no
sequence guard and the last response to land wins.

### 34. Signing in wipes the quote, in the flow the UI prescribes — Medium

The anonymous branch of `loadSession` guards on `sessionPrincipalRef.current !==
null` before clearing; the authenticated branch has no symmetric guard, so a
`null → principalId` transition is treated as a principal _change_.

**Failure scenario.** A user opens a handoff link signed out, ticks the
non-sensitive-data confirmation, and gets a quote. The page tells them to open
sign-in in a new tab and return. Doing exactly that fires window focus, clears the
quote and the confirmation, and the Submit section disappears.

### 35. `billing=upgrade` is parsed but nothing renders it — Medium

`WorkspaceSettingsClient` accepts `"upgrade"` into `billingReturn` but only
`"success"` and `"cancelled"` have renderers, while
[`WorkspacePlanCards.tsx:17`](packages/nextjs/components/pricing/WorkspacePlanCards.tsx:17)
points the pricing page's primary "Choose Early Access" CTA at
`/agents?tab=overview&billing=upgrade`. A user arriving from pricing gets no
acknowledgement, no scroll target, and no highlighted action — they have to find
"Upgrade to Early Access" themselves. The pricing test asserts only that the href
string exists, never that the destination reacts.

### 36. Smaller browser issues — Medium and Low

- **Whitespace-only description fails with no feedback.** `" "` passes the
  optional-field short-circuit and then throws with `field: "description"`, but
  the textarea has `name="description"` and no `error=` prop, so focus jumps into
  the box and no message appears anywhere.
- **Banners that never clear.** The connection poll's success path resets the
  failure counter but not `setError(null)`, so a recovered blip leaves a red
  "could not refresh" banner beside the green "Connected" state. Same pattern in
  `copyVisibleConnectionMessage` and in the reviewers dropdown, which calls
  `setDraft` directly and so leaves unsaved edits under a stale "saved" banner.
- **Dead `fieldErrors` wiring.** Eleven bindings in `AgentSetupFlow` reference
  field errors that the API can never produce — only five field-scoped errors
  exist across the whole surface. A test asserts on this wiring as though it were
  live.
- **Error focus does not resolve on most forms.** `useFormErrors` locates the
  control by `getElementById(field)` or `[name=field]`, but `Field` generates ids
  via `useId()` and no consumer in `WorkspaceSettingsClient`,
  `AgentConnectionPanel`, `AgentHumanReviewEditor` or `EvaluationDashboardPanel`
  passes `id` or `name`. On mobile, submitting a long form with a bad trailing
  field looks like the Save button did nothing.
- **A 5-second refetch loop.** `onConnectionStateChange` fires on every poll
  rather than on change, so an expanded "Audit history" panel snaps shut every
  five seconds while a connection is pending.
- **Contradictory reviewer-coverage copy.** A full reviewer group can show
  "2/2 seats ready · Ready" directly above "Invite later — Automatic requests stay
  unavailable", because coverage is hard-set to `null` when there are no
  specialist requirements — the same value used for "loading".
- **Lightbox has no focus trap.** It is `role="dialog" aria-modal="true"` with
  Escape and focus-on-open, but the background is neither `inert` nor
  `aria-hidden`, so two Tabs from Close lands behind the overlay.
- **Hidden validation rules.** The evaluation outcome buttons disable until a
  reason reaches ten characters, a rule stated only in a placeholder that vanishes
  as soon as the user types.

**Clean:** only one `dangerouslySetInnerHTML` and it is escaped `JSON.stringify`;
the one dynamic `href` is scheme-validated server-side; no non-`NEXT_PUBLIC_` env
var reaches a client module; and the duplicate-DOM-id bug class is genuinely
fixed — ids are keyed per round, per case, or by `useId()`.

---

## Review scoring and settlement

The scoring core came out **clean**, and two long-standing questions about it are
now settled — see the negative results at the end of this section. Only two
defects were found, both on the off-chain reporting side rather than in the
mechanism.

### 40. Earnings credit compensation to commits that never revealed and can never claim it — Medium

[`raterSettlementService.ts:220-221`](packages/nextjs/lib/tokenless/raterSettlementService.ts:220)
derives the claim from the round state alone:

```ts
const claimKind =
  state === 5 ? "payout" : state === 7 || state === 8 ? "compensation" : null;
const claimAmount =
  claimKind === "payout"
    ? BigInt(finalizedPayoutAtomic)
    : BigInt(compensationAtomic);
```

The contract requires `record.revealed` to claim compensation
([`TokenlessPanel.sol:666-669`](packages/foundry/contracts/tokenless/TokenlessPanel.sol:666)),
and `_terminalCompensation` sets `compensationPerRecipient = attemptCompensation`
**unconditionally — even when `recipients == 0`**
([`:811-812`](packages/foundry/contracts/tokenless/TokenlessPanel.sol:811)). Ponder
indexes that non-zero value faithfully and the API returns it.

**Failure scenario**, using the repository's own Foundry fixture: bounty 100 USDC
over three seats gives `attemptCompensation = 26_666_666`. One commit, zero
reveals, past the beacon-failure deadline puts the round in state 8, the funder is
refunded in full, and `claimCompensation` reverts `NotClaimable` — the existing
test asserts exactly that. But the earnings snapshot computes
`earned = 26_666_666` and status `claimable`: **26.67 USDC that does not exist.**
In state 8 every commit is unrevealed by construction, so the entire round's
earnings display is false. State 7 has the same problem for the non-revealing
subset.

It is a defect rather than a design choice because three sibling call sites get it
right — including `canClaim` twenty lines below, which _does_ check `revealed`.
That inconsistency produces the dead end: the earnings page shows "Ready to claim"
and links to payment recovery, and the recovery page then shows "Earned $26.67"
with no claim button. The reconciler meanwhile treats the binding as non-terminal
and retries until the claim deadline — up to 365 days — then labels it
`claim_expired` rather than a reveal failure.

The only test for `listReviewerEarnings` is a `readFileSync` source-string match
asserting no numeric outcome, and the one state-7 test sets `revealed: true`, so
it structurally cannot catch this.

### 41. The keeper issues doomed claims for every commit in a beacon-failure round — Low

[`keeper.ts:509-518`](packages/keeper/src/keeper.ts:509) requires
`commit.revealed` on the under-quorum arm but not on the beacon-failure arm. State
8 is reachable only when no commit revealed, so the call can never succeed, and
the keeper fires one doomed write per commit on every tick for the whole claim
window. `NotClaimable` is in the expected-race set so it is swallowed, and viem
estimates gas before sending, so the cost is wasted RPC and log noise rather than
gas. There is no keeper test covering `claimCompensation` at all.

### Verified correct — the mechanism itself

**RBTS is exact and identical across all four implementations** — the Solidity
library, the reference JS, the public verifier, and the on-chain assignment. Worked
by hand against the frozen vector: `shadow(7000, up) = 10000`,
`quadratic(10000) = 10000`, `quadratic(7000) = 9100`, `score = ⌊19100/2⌋ = 9550`.

A rounding asymmetry was flagged and then **refuted**: `quadratic` appears to floor
on one branch and ceil on the other, which would bias "down" peers by up to 1 bps —
except predictions are pinned to a 100-bps grid, so the shadow is always a multiple
of 100 and `p²/10000 = (p/100)²` is an exact integer. Neither branch ever rounds.
The only truncation anywhere is `⌊(info+pred)/2⌋` losing half a basis point, worth
about 5×10⁻⁵ of the maximum bonus, and identical in all three implementations.

No division by zero, empty peer set, or single-reviewer path exists: `minimumReveals
≥ 3` is enforced at round creation, `sortCanonical` reverts below three, and the
reference/peer offsets make self-assignment impossible.

**There is no correlation adjustment in settlement, and that is deliberate.** Payout
is exactly `fixedBasePay + ⌊maximumBonus · rbtsScoreBps / 10000⌋` and nothing else
writes `finalizedPayout`; the "correlation" language in this repository refers to
assignment-time diversification, not settlement. Crucially, **the crowd-forecast and
post-round-integrity subsystems are not dead** — both have real writers on round
finalization and real enforcement in audience assignment and paid eligibility, and
both are explicitly declared advisory with `payoutEffect: "none"` hardcoded at
insert. The "capability without reachability" hypothesis does not hold here, which
resolves a question left open by earlier audits.

**Conservation holds**, traced arithmetically on both terminal paths: liability
never exceeds the bounty, compensation never exceeds the attempt reserve, and the
bounty remainder plus every unclaimed share returns via `returnStaleShares`. No
shortfall and no accumulated drift. The state machine has no double-settle, no
double-score, and no gap between the seed and fallback finalizers.

Not confirmed: real drand outage behaviour against the six-hour grace, and the tlock
ciphertext end to end beyond verifying that the commitments byte-match the contract.

---

## Repository tooling

### 37. `yarn dead-code:scan` cannot run in a normal checkout — Low

[`playwright.hosted.config.ts:4`](packages/nextjs/playwright.hosted.config.ts:4)
calls `hostedE2eTarget()` at module top level, which throws unless the hosted-E2E
variables are set. knip loads every config file in the workspace, so the
repository's own dead-code tool fails hard with a config-load error. Producing the
output for this audit required inventing an `E2E_BASE_URL` and an
`E2E_EXPECTED_GIT_SHA`. Evaluating the target lazily inside the config would fix
it.

### 38. `promo-video` is checked by `test:packages` but absent from CI — Low

The CI matrix in
[`unit-tests.yaml:44-57`](.github/workflows/unit-tests.yaml:44) lists contracts,
node-utils, sdk, agents, keeper and ponder. `promo-video` is in the root
`test:packages` chain but has no CI job, so neither its typecheck nor its tests
ever run there. Both pass locally today — nothing is broken, but nothing would
catch a future break.

### 39. Three orphaned components — Low

`components/tokenless/account/AccountTabs.tsx`,
`components/tokenless/account/InvitationRedemption.tsx` and
`components/home/PromoVideo.tsx` have no importer anywhere. `InvitationRedemption`
is referenced only by an assertion that the profile page _does not_ contain it —
so it is a leftover from a deliberate removal, and invitation redemption is served
elsewhere. Given the repository's stated preference for removing obsolete
consumers, these are deletions rather than defects.

## Claims that did not survive verification

- **knip's 180 "unused exports" are not dead code.** Spot-checking
  `assertPaidPanelsAllowed`, `resolveWorkspaceEntitlement`,
  `assertActiveMcpHandoff`, and `enforcedSsoProviderForEmail` showed every one is
  called inside its own file; knip flags the redundant `export` keyword, not an
  absent caller. Treat that section as noise for reachability questions.
- **`tokenless_assurance_access_logs` is not an orphan** — it is pruned by
  [`lib/tokenless/evidenceRetentionEnforcement.ts:383`](packages/nextjs/lib/tokenless/evidenceRetentionEnforcement.ts:383)
  on the cron.
- **Legal holds do not starve artifact deletion retries** —
  `deletion_blocked_by_hold` is a non-counting defer code.
- **The migration journal is intact.** All 156 `_journal.json` entries match the
  156 `.sql` files on disk, prefixes match their `idx`, and `when` is strictly
  monotonic. The single gap at `idx 66` is the declared exclusion in
  `drizzle/excised-migrations.json`.
- **No schema/code drift.** All 245 migrated columns were compared against the 67
  `pgTable` definitions: no missing table, no dropped table still declared, no
  Drizzle column that migrations never create.
- **The hybrid compliance gate is no longer stubbable.**
  `requirePaidLaneComplianceApproval` is a direct static call at
  [`hybridHumanReviewAdapter.ts:954`](packages/nextjs/lib/tokenless/hybridHumanReviewAdapter.ts:954)
  and no test replaces it — a finding from the round-2 review that has since been
  fixed.
- **No committed secrets, no focused or skipped tests.** The only `sk_live_`
  matches are test fixtures and validation patterns; the tracked
  `packages/nextjs/.env.production` contains comments only.
