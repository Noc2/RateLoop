# Tokenless pre-E2E readiness audit — 25 July 2026

**Scope:** what still needs fixing before the `tokenless` branch can be tested end to end.
**Branch/commit audited:** `tokenless` @ `ee1d869b0` (see §9 — HEAD moved to `ee6854961` mid-audit).
**Method:** direct execution of the build/test/lint/type-check suites in this checkout; a full replay of all 134
migrations against a real PostgreSQL 16.14 cluster; SDK/MCP contract tracing against the live route tree; and a
documentation-vs-code cross-check. Evidence-based throughout — nothing below is inferred from doc prose.

This does not replace the [production-readiness register](tokenless-production-readiness-2026-07.md), which remains the
release checklist. This answers a narrower question: **can you run the thing and test it today?**

---

## 0. Resolution status

Every finding below was re-verified against the code before being fixed. The findings text is preserved as the audit
record; this table is the disposition.

| # | Finding | Status | Commit |
| --- | --- | --- | --- |
| B1 | Private-review fixtures expire in real time | Fixed | `7a4750f95` |
| B2 | `db:push` destroys a migrated database | Fixed | `980415075` |
| B3 | Missing snapshots break `db:generate` | Fixed | `980415075` |
| M1 | Assurance review API skips agent-binding guards | Fixed | `6bb42933c` |
| M2 | Writing MCP tools advertised as read-only | Fixed | `81ab963ef` |
| M3 | Design of record claims verify is non-mutating | Fixed | `e68ccb213` |
| M4 | `NOT NULL` without backfill in `0018`, `0032` | **Won't fix — see below** | — |
| M5 | Join-based backfill without fallback in `0117`, `0131` | **Won't fix — see below** | — |
| — | Rejected-ask replay returns unparseable status | Fixed | `a61e30812` |
| — | Memory migrator bypasses the journal | Fixed | `b32fb60e8` |
| — | `CLAUDE.md` names the stale v1 artifact | Fixed | `508b4e752` |
| D1–D3 | Superseded v4 deployment claims | Annotated | `f97e7306e` |
| D4–D6 | Stale migration heads in historical records | Annotated | `286480fc7` |
| — | `managedSigning` reads as an E2E blocker | Clarified | `5af248170` |
| — | Browser-test setup undocumented | Fixed | see §8 |

### Why M4 and M5 are not fixed in place

Migration SQL is immutable here. `scripts/migrate-hosted-database.mjs:77` compares every applied migration's hash
against the checked-in journal and fails closed on a mismatch, so editing `0018`, `0032`, `0117`, or `0131` would break
the next hosted deploy — a worse outcome than the latent defect.

The exposure is genuinely latent: the isolated database crossed those migrations while empty, and they only fail when
replayed against a table that already holds rows. If that ever becomes real — a rebuild from a restored dump, or a
second environment seeded before catching up — the correct remedy is a new forward-only migration that backfills and
then re-asserts the constraint, not an edit to history.

### Two things B2/B3 turned out to be worse than first reported

- `db:generate` did not merely crash. It **exited 0** while failing, because `meta/excised-migrations.json` parsed as a
  malformed snapshot — so CI would never have caught it.
- Once that file was moved out of `meta/`, `db:generate` **succeeded** and rewrote `drizzle/meta/_journal.json` itself —
  the very file whose hashes gate the hosted deploy. The journal was restored byte-identical and verified against
  `HEAD`. This is why the script is now disabled outright rather than merely unblocked.

---

## 1. Executive summary

Compiled artifacts are in better shape than the docs imply — everything builds, contracts pass, and the deployment
artifact is current rather than stale as `CLAUDE.md` still claims.

The problems are elsewhere: a unit suite that went red on its own, a Drizzle tooling surface whose documented local
setup command destroys a migrated database, and an HTTP route that skips the authorization checks its MCP twin enforces.

| Gate | Command | Result |
| --- | --- | --- |
| Contract tests | `yarn foundry:test` | **PASS** — 11 suites, 77 tests |
| Contract artifacts | `yarn contracts:test` | **PASS** — 9 tests |
| SDK tests | `yarn sdk:test` | **PASS** — 36/36 |
| Agents tests | `yarn agents:test` | **PASS** — 118/118 |
| App type check | `yarn next:check-types` | **PASS** |
| Lint (foundry + next) | `yarn lint` | **PASS** |
| Production build | `yarn next:build` | **PASS** — compiled in 10.0s |
| Migration replay, empty DB | 134 migrations, real PG 16.14 | **PASS** — 134/134 in one transaction |
| Journal integrity | `_journal.json` vs `drizzle/*.sql` | **PASS** — 134 entries, no orphans |
| **App unit tests** | `yarn next:test` | **FAIL — 7 of 1705 red** |
| **`yarn db:push`** | documented in `packages/nextjs/README.md:9` | **DESTRUCTIVE** |
| **`yarn db:generate`** | | **CRASHES** |

### Blockers

| # | Finding | Where |
| --- | --- | --- |
| B1 | Private-review unit tests are an expired time bomb — 7 red | §2 |
| B2 | `db:push`, the documented local setup step, drops 153 tables and 206 CHECK constraints | §3 |
| B3 | All 134 migration snapshots are missing — `db:generate` crashes, and if unblocked emits an unappliable migration | §3 |

### Majors

| # | Finding | Where |
| --- | --- | --- |
| M1 | `/api/agent/v1/assurance/review` bypasses the agent-binding and scope guards its MCP twin enforces | §4 |
| M2 | `rateloop_wait_for_review` and `rateloop_get_review_result` are annotated `readOnlyHint: true` but both write | §4 |
| M3 | Design-of-record falsely claims `rateloop_verify_connection` is non-mutating | §4 |
| M4 | Three migrations set `NOT NULL` with no default and no backfill — abort on any non-empty table | §3 |
| M5 | Two migrations backfill via join then `SET NOT NULL`, with no unmatched-row fallback | §3 |

---

## 2. B1 — the private-review unit tests are an expired time bomb

`yarn next:test` fails 7 tests, all in
[`packages/nextjs/lib/tokenless/privateUnpaidReviewAdapter.test.ts`](../packages/nextjs/lib/tokenless/privateUnpaidReviewAdapter.test.ts).

Failing: direct private assignments terminal aggregate; wait pending continuation; wait terminal state after cursor;
wait abort without releasable result; elapsed zero-response inconclusive envelope; elapsed partial-response
under-quorum envelope; accepted workspace reviewer invitations end to end.

### Root cause

Not a logic regression. A fixture mixes a frozen clock with the real clock, and the real clock overtook it.

- Fixture hard-codes the reviewer grant expiry at
  [`privateUnpaidReviewAdapter.test.ts:1378`](../packages/nextjs/lib/tokenless/privateUnpaidReviewAdapter.test.ts:1378):
  `accessExpiresAt: new Date("2026-07-23T09:00:00.000Z")`
- Six tests then push the response deadline to the **real** clock (lines 272, 366, 392, 418, 444, 502, 507):
  `setPrivateFixtureDeadline(setup, new Date(Date.now() + 60_000))`
- [`0062_private_unpaid_review_assignments.sql:111`](../packages/nextjs/drizzle/0062_private_unpaid_review_assignments.sql:111)
  enforces `CHECK ("membership_expires_at" IS NULL OR "membership_expires_at" >= "response_deadline")`

Once real `now` passed `2026-07-23T09:00Z` the UPDATE violates that constraint. The failure names exactly that
constraint, with the attempted `response_deadline='2026-07-25T15:01:20.324+02:00'`.

The seventh test fails through a sibling path:
[`workspacePrivateReviewRouting.ts:812`](../packages/nextjs/lib/tokenless/workspacePrivateReviewRouting.ts:812) filters
`member => !member.membershipExpiresAt || member.membershipExpiresAt > input.responseDeadline`, so every reviewer drops
out and readiness returns `{"ready":false,"reason":"reviewer_seats_insufficient","eligibleReviewerCount":0}`.

These tests were green when written and went permanently red on 23 July with no commit in between.

### Fix

Make the fixture grant expiry relative to the fixture clock (or to `Date.now()`), or freeze the wall clock across these
tests. **Do not simply bump the literal** — that re-arms the same bomb on a later date.

A repo-wide scan for the pattern found only three hard-coded expiry literals in tests: `2026-07-13` (×2), `2026-07-17`,
`2026-07-23`. Only the last is load-bearing against a live clock; the others are used with a frozen `now` and are inert.
Contained fix, but the pattern deserves a lint rule.

---

## 3. Drizzle tooling and migration findings

The migrations themselves are sound. The **tooling around them** is not.

### B2 — `yarn db:push` destroys a migrated database (documented as the setup step)

[`packages/nextjs/README.md:9`](../packages/nextjs/README.md:9) tells developers to run
`yarn workspace @rateloop/nextjs db:push`.

But [`drizzle.config.ts:47`](../packages/nextjs/drizzle.config.ts:47) points drizzle-kit at `./lib/db/schema.ts`, which
together with the re-exported `humanAssuranceSchema.ts` defines **66 `pgTable`s** (53 + 13, verified by count). The
migrations produce **219 tables**. The app reaches the other 153 through raw SQL via
[`lib/db/index.ts:40-47`](../packages/nextjs/lib/db/index.ts); the ORM handle at line 58 only covers the mapped 66.

drizzle-kit does not know that. Running `push` against a fully-migrated database emits:

- **153 × `DROP TABLE … CASCADE`**
- **206 × `DROP CONSTRAINT`** of CHECK constraints on the 66 *tracked* tables (drizzle-kit does not model CHECKs)
- 5 × `DROP COLUMN`, plus churn on 108 FK / 61 UNIQUE / 10 PK

The 153-table gap is structurally intentional. Aiming drizzle-kit at a partial schema anyway is not.

**Fix:** remove `db:push` from the README and point local setup at the migration runner instead. If `push` must stay,
scope `drizzle.config.ts` with `tablesFilter` so it cannot see the 153 unmapped tables.

### B3 — all 134 migration snapshots are missing

`packages/nextjs/drizzle/meta/` contains only `_journal.json` and `excised-migrations.json` — **zero
`NNNN_snapshot.json` files** (verified by listing). They were never gitignored; they were deleted in `fe3908255` and
`fc22a6056`.

Two consequences:

**(a) `yarn db:generate` crashes.** drizzle-kit treats every non-`_journal.json` file in `meta/` as a snapshot, and
`excised-migrations.json` is not one:

```
Error: ENOENT: no such file or directory, open '.../drizzle/meta/excised-migrations.json'
    at prepareMigrationFolder (node_modules/drizzle-kit/bin.cjs:8199:22)
```

The repo's own bookkeeping file, placed inside drizzle's reserved directory, breaks the generator.

**(b) If that file is moved, `generate` silently emits an unappliable migration.** With no snapshot baseline drizzle-kit
diffs against *empty*, producing a `0135_*.sql` of 66 bare `CREATE TABLE`s with no `IF NOT EXISTS`, and appends
`idx: 135` to the real journal. Applying it: `ERROR: relation "tokenless_better_auth_accounts" already exists`.

Production is safe today only because nobody has run `db:generate`.

**Fix:** move `excised-migrations.json` to `drizzle/excised-migrations.json` (updating the path at
`lib/db/migrationJournal.test.ts:37`) — zero cost, fixes (a). For (b), either restore snapshots or remove `db:generate`
from `package.json` and document that migrations are hand-authored.

### M4 — three `NOT NULL` sites with no default and no backfill

Each verified empirically by building to the prior state, inserting one row, then running the statement:

| Location | Result with 1 row present |
| --- | --- |
| [`0018_composable_eligibility_readers.sql:1-4`](../packages/nextjs/drizzle/0018_composable_eligibility_readers.sql) — `assurance_snapshot_json` on `tokenless_assurance_assignments` | `ERROR: column … contains null values` |
| [`0018:5`](../packages/nextjs/drizzle/0018_composable_eligibility_readers.sql) — `assurance_snapshot_hash NOT NULL` on `tokenless_paid_vouchers` | `ERROR: column … contains null values` |
| [`0032_adaptive_review_source_evidence.sql:1-4`](../packages/nextjs/drizzle/0032_adaptive_review_source_evidence.sql) — two `ADD COLUMN … NOT NULL` | `ERROR: column "source_evidence_reference" … contains null values` |

Every *other* `SET NOT NULL` in the tree does it correctly — backfill between the nullable add and the constraint
(`0052:155-161`, `0078:5-11`, `0099:4-11`, `0101:3-7`, `0111:3-18`, `0117`) — and `0058:353-368` even installs an
explicit guard that raises if the backfill left NULLs. These three are the outliers.

Impact is latent: the isolated tokenless DB crossed 0018/0032 while empty. But any rebuild from a restored dump, or a
second environment seeded before catching up, breaks there.

### M5 — join-based backfills with no unmatched-row fallback

`0117_principal_bound_rater_identity.sql:48-53, 60-65, 72-77` and
`0131_workspace_reviewer_policy_acceptances.sql:35-41` backfill via `UPDATE … FROM <other table>` then `SET NOT NULL`.
Any row without a join partner stays NULL and aborts the whole migration transaction. Unlike `0058`, neither has a guard
or an `ELSE` fallback — compare `0111:13-15`, which correctly adds a `WHERE … IS NULL` sweeper after its join backfill.

### Verified sound (no action)

- **Journal integrity.** 134 entries; every tag has a `.sql` and vice versa; numeric prefixes match `idx`; `when`
  strictly monotonic. The single gap at idx 66 is declared in `drizzle/meta/excised-migrations.json` and asserted by
  `lib/db/migrationJournal.test.ts:34-63`.
- **Empty-database replay.** All 134 applied cleanly in one transaction. No duplicate `CREATE TABLE`, no duplicate
  index/constraint names, no `DROP`/`ALTER` against a missing object. Zero `CREATE TYPE`/`ALTER TYPE` anywhere — all
  enums are `text` + `CHECK`, which is the right call given the single-transaction migrator.
- **The hosted runner.** [`scripts/migrate-hosted-database.mjs`](../packages/nextjs/scripts/migrate-hosted-database.mjs)
  is well built: gated to `VERCEL_ENV=production`, pinned to the `rateloop-tokenless` project id *and* name, DB endpoint
  verified against a SHA-256 identity, serialized under `pg_advisory_lock`, fails closed when application tables exist
  without a journal, and verifies `drizzle.__drizzle_migrations` positionally on both `folderMillis` and `hash` before
  and after. No hardcoded head — `expectedLatest` is derived from `migrations.at(-1)`.
- **No head drift.** The one hardcoded assertion,
  `lib/db/expiredPrivateReviewCapacityMigration.test.ts:15`, matches the actual head `0134_expired_private_review_capacity`.
  It will fail on the next migration, which appears to be an intentional tripwire.

### Minor

- 5 columns exist in the DB but not the TS schema: `tokenless_assurance_cases.deterministic_checks_json` (`0012:1`),
  `tokenless_agent_connection_intents.reconnect_integration_id` (`0132:2`), and three on
  `tokenless_agent_review_request_profiles` (`0130:336-339`). All either have defaults or are unused by the ORM path.
- `lib/db/testing/testMemory.ts:280-287` applies migrations by filename sort rather than journal order. Equivalent
  today, but it would silently execute any stray `.sql` the journal excludes — exactly what the excision mechanism
  exists to prevent.

---

## 4. SDK, agents, and MCP contract findings

The `quote -> ask -> wait -> result` path is clean: all 12 SDK methods resolve to real routes, no 404s, and the server
reuses the SDK's own parsers (`normalizeTokenlessQuoteRequest`, `parseTokenlessQuoteResponse`, `parseTokenlessResult`),
so response drift is a compile error. All seven MCP tools promised by the design doc exist. Both suites pass.

The problems are in the MCP/HTTP authorization surface.

### M1 — `/api/agent/v1/assurance/review` skips the guards its MCP twin enforces

Verified by reading both paths side by side.

MCP `rateloop_get_assurance_state` refuses cross-agent reads
([`lib/mcp/workspaceProtocol.ts:587-595`](../packages/nextjs/lib/mcp/workspaceProtocol.ts:587)):

```ts
const state = await getAdaptiveAssuranceState({ principal: principal.principal, scopeId: input.scopeId });
if (state.agentId !== binding.agentId || state.agentVersionId !== binding.agentVersionId ||
    state.policyId !== binding.reviewPolicyId || state.policyVersion !== binding.reviewPolicyVersion) {
  throw new TokenlessServiceError("Assurance state not found.", 404, "assurance_state_not_found");
}
```

The HTTP route has no such check
([`app/api/agent/v1/assurance/review/route.ts:21-23`](../packages/nextjs/app/api/agent/v1/assurance/review/route.ts:21)):

```ts
const scopeId = request.nextUrl.searchParams.get("scopeId")?.trim();
if (!scopeId) throw new TokenlessServiceError("scopeId is required.", 400, "invalid_assurance_state_query");
return NextResponse.json(await getAdaptiveAssuranceState({ principal, scopeId }), { headers: HEADERS });
```

`getAdaptiveAssuranceState` filters on `workspace_id` only (`adaptiveReviewService.ts:1687`). The agent credential is a
workspace API key usable as a plain bearer here. This directly contradicts the tool's own contract text at
`workspaceProtocol.ts:219` ("This tool cannot read another bound agent's scope").

Same route, `POST` passes no `integrationId`, so `verifyIntegrationBinding` short-circuits
(`adaptiveReviewService.ts:750`: `if (input.integrationId === null) return { active: false, … }`) and the
caller-supplied `agentId` / `agentVersionId` / `policyId` / `policyVersion` are used unchecked — while the MCP path
injects them from the binding and enforces the `allowedWorkflowKeys` allow-list.

**Fix:** resolve the caller's bound integration from the API key and apply the same checks, or delete the route — it has
no SDK client and no in-repo caller besides its own test.

### M2 — two MCP tools claim `readOnlyHint: true` but write

Verified: both [`rateloop_wait_for_review`](../packages/nextjs/lib/mcp/workspaceProtocol.ts:333) and
[`rateloop_get_review_result`](../packages/nextjs/lib/mcp/workspaceProtocol.ts:348) carry
`readOnlyClosedAnnotations` = `{ readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }`.
MCP hosts use `readOnlyHint` to skip user confirmation.

- `get_review_result` → `adaptiveReviewOrchestration.ts:481-482` calls `finalizeAdaptiveReviewEvidence`, which inside a
  `BEGIN`/`COMMIT` does `INSERT INTO tokenless_agent_evaluation_observations … ON CONFLICT DO UPDATE`, plus `UPDATE`s on
  `tokenless_agent_review_opportunities` and `tokenless_agent_integrations` (`adaptiveReviewEvidence.ts:214,270,278`).
- `wait_for_review` → on the private lane, `adaptiveReviewOrchestration.ts:342-350` calls
  `reconcileDirectPrivateReviewDeadline`, which opens a transaction, runs
  `terminalEnvelopeForDelivery(… "response_deadline_elapsed")`, commits, then `observeHumanReviewResult`
  (`privateReviewResponses.ts:688-705`). A "wait" can close out a delivery.

**Fix:** re-annotate both as `idempotentAdditiveClosedAnnotations`, or move deadline reconciliation and evidence
finalization to the keeper/cron path so the tools genuinely only read.

### M3 — the design-of-record's non-mutating claim is false

[`tokenless-immutable-implementation-plan-2026-07.md:145`](tokenless-immutable-implementation-plan-2026-07.md) promises
"verification is non-mutating and never creates a synthetic review." The second half holds; the first does not.

`agentConnectionIntents.ts:1736-1766` updates `tokenless_agent_integrations`, transitions
`tokenless_agent_connection_intents` to `status='connected'`, and inserts an integration event. The code itself agrees —
the tool is annotated `readOnlyHint: false` at `workspaceProtocol.ts:411`, and `workspaceProtocol.ts:904` gates all
review tools on `connectionStatus === "connected"`, so the mutation is load-bearing.

**Fix:** amend the doc, not the code. The tool's own description at `workspaceProtocol.ts:413` already says it correctly.

### Minor

- **Ask replay after moderation rejection returns a status the SDK rejects.** `lib/tokenless/server.ts:571` passes
  `rejected` through, but `sdk/src/tokenlessSchema.ts:358-365` accepts only `awaiting_payment | submitted | open`. The
  agent gets an `RateLoopSdkError` instead of the rejection. The wait route handles this correctly (410
  `content_rejected`); the ask replay does not. Mirror it in `createTokenlessAsk`.
- **`rateloop_verify_connection` is unreachable on the integration lane.** It is only in `oauthWorkspaceMcpTools`
  (`workspaceProtocol.ts:418-425`); `workspaceMcpTools` omits it. Structural, not an oversight — but the doc's
  "a new connection calls `get_agent_context -> verify_connection`" should be scoped to the OAuth lane.
- **Doc uses unprefixed tool names.** `tokenless-immutable-implementation-plan-2026-07.md:146-147` writes
  `evaluate_review_requirement … get_assurance_state`; every registered tool carries the `rateloop_` prefix.
- **`replayMatches` scope check is a tautology.** `adaptiveReviewService.ts:1395` sets `scopeId` from the row itself,
  so the comparison at `:1268` can never fail. Real coverage comes from `metadata_commitment` and the `execution_id`
  provenance conflict, so nothing is unguarded — but it reads as protection it does not provide.

### Verified correct (no action)

`evaluate_review_requirement` idempotency (deterministic ids, `FOR UPDATE`, 409 on differing immutable inputs);
private-quote workspace binding (external `POST /quote` rejects non-public before parsing; ask preparation 404s across
the boundary); `safety_gates_unavailable` forcing 100% (`ADAPTIVE_SAFETY_GATES_AVAILABLE = false`); idempotency header
naming; version prefixes.

---

## 5. The deployment artifact is current — `CLAUDE.md` is wrong

This matters because `CLAUDE.md` currently tells every agent the on-chain bundle must be redeployed before live
configuration, which would wrongly block E2E work.

- `packages/foundry/deployments/tokenless-v4/84532.json` — `deploymentComplete: true`, chainId 84532, block `44390557`,
  complete five-slot key, `runtimeCodeEvidenceComplete: true`
- last commit touching `packages/foundry/contracts` = `925cbb010` (2026-07-20)
- last commit touching `packages/foundry/deployments` = `df58c5b01` (2026-07-20) — **after** the contract change
- `git log df58c5b01..HEAD -- packages/foundry/contracts` → **0 commits**
- [`chain/config.ts:142`](../packages/nextjs/lib/tokenless/chain/config.ts:142) and
  [`deployedContracts.ts:11`](../packages/contracts/src/tokenless/deployedContracts.ts:11) pin the same v4 key

The "any fund-core change invalidates the artifact" rule does not currently fire.

**Fix:** `CLAUDE.md:44-48` names `packages/foundry/deployments/tokenless-v1/` — two generations behind — and states the
staleness unconditionally. `AGENTS.md:32` already phrases it conditionally and is correct. Align `CLAUDE.md` to name
`tokenless-v4` and make the rule conditional on a *future* fund-core change.

---

## 6. Documentation drift that reads as a testing blocker

No code defects here, but all of these will mislead someone deciding whether they can test.

| # | Doc | Says | Reality | Severity |
| --- | --- | --- | --- | --- |
| D1 | `tokenless-design-review-round-2-remediation-2026-07-20.md:24`, `:17` | "The empty v4 registry is intentional… paid settlement unavailable until the complete v4 key is deployed" | Both registries populated by `df58c5b01`, including the beacon verifier NF5 said had no valid address. Written the same day but *before* the deploy. | Major |
| D2 | `tokenless-design-review-2026-07.md:83` | "a deliberately empty v4 registry" | Same as D1 | Major |
| D3 | `tokenless-security-reaudit-remediation-2026-07-19.md:72-76` | the TLRA-10 fund-core change was "intentionally **not** deployed" | It *was*, the next day, in the v4 bundle | Minor |
| D4 | `tokenless-post-audit-remediation-2026-07-18.md:43,:70` | parity doc "names the actual `0110` head"; migrations `0108`–`0110` must be applied | Head is `0134`; the parity doc was since rewritten to be head-independent (`3855092e2`) — a *better* fix than the one recorded | Minor |
| D5 | `tokenless-remaining-improvements-plan-2026-07.md:47` | head will be `0091_mcp_elicitation_sessions` | Head is `0134` | Minor |
| D6 | `tokenless-repository-bug-audit-2026-07-17.md:333` | cites `_journal.json:698-710` | Journal is now ~940 lines | Minor |

The AUD-18 remedy — *link the journal, never copy the number* — was applied to the two authoritative docs but not to
these four. Apply it consistently, or mark the historical records as point-in-time.

---

## 7. Things that look like blockers but are not

- **`managedSigning: false` does not block isolated E2E.**
  [`check-tokenless-production-readiness.mjs:481-492`](../packages/nextjs/scripts/check-tokenless-production-readiness.mjs)
  short-circuits to `validateTokenlessTestDeployment(env)` for any `VERCEL_GIT_COMMIT_REF !== "main"`, so neither the
  capability loop nor `FORBIDDEN_HOSTED_PRIVATE_KEYS` applies on `tokenless`. Local test signers remain permitted at
  `chain/config.ts:38-40`. No doc states this, and the register's framing reads as a blocker when it is not — worth one
  sentence in the register.
- **The two previously-open E2E blockers are fixed.** AUD-05: `e2e/scripts/prepare.ts:126-146` now sets
  `questionAuthority: "owner_fixed"` with the recommended compile-time fixture typing. AUD-13: `package.json:23` wraps
  build + `e2e:prepare` + `playwright test` in a single `with-workspace-dist-lock.mjs` invocation.
- **Remaining review-doc items** (round-2 W1/W2, W9, W11; the "Remaining release boundary" column at
  [readiness register:76-87](tokenless-production-readiness-2026-07.md)) are mechanism, economics, and live-operations
  gates. They block *release*, not *testing*, and are correctly not claimed as source fixes.

---

## 8. Lower-priority observations

- **Browser-test setup was undocumented.** `yarn workspace @rateloop/nextjs e2e` is the deterministic browser gate in
  the readiness register, but `e2e` appeared in no README and no runbook, and it fails closed on a first run:
  `e2e/scripts/prepare.ts:36` refuses any database whose name does not match `rateloop(_<suffix>)?_e2e`, and neither
  the `.env.example` default (`rateloop_tokenless`) nor the docker default (`rateloop_app`) matches. Now documented in
  `packages/nextjs/README.md` under "Browser tests", including the `E2E_BASE_URL` / `E2E_EXTERNAL_SERVER` overrides.
- **Local build skips every release gate.** `yarn next:build` locally prints "identity deployment check skipped",
  "hosted-release preflight skipped", "hosted database migration skipped". A green local build is not evidence that
  hosted preflight passes.
- **Visual baselines may be stale.** `e2e/__screenshots__/` was captured 17–18 July; 132 commits have since touched
  `packages/nextjs`, though none hit the shell/landing components directly. Verify on the first E2E run.
- **Journal `when` values are hand-authored** — every entry sits on an exact hour boundary with a uniform 3,600,000 ms
  gap. Internally consistent, and the positional migration check depends only on monotonicity, but it means
  `migrationJournal.test.ts` is the sole automated guard.
- **Empty leftover directories** `e2e/fixtures/` and `e2e/helpers/` (the real file is `e2e/fixtures.ts`).
- **Root scratch dirs** `_to_delete/` (empty), `tmp/`, `outputs/` — 3 tracked files total. Cleanup candidate.

---

## 9. Coverage gaps in this audit

Stated plainly so this is not read as more complete than it is. Several audits were **stopped early** in response to
§10, though some nested results survived. The following have only the evidence of the green suite runs above, not a
line-by-line review:

- `packages/ponder` handler and schema coverage against the v4 event set
- `packages/keeper` job completeness and failure-path stalls
- `packages/nextjs` app/API route completeness beyond the assurance/MCP surface, and the exact depth of the
  `paidAssignmentSettlement` gate
- an actual `yarn e2e` execution — the *prerequisites* are now established and documented (§8), but no run has been
  performed, so the Playwright journeys and the visual baselines remain unverified against current `HEAD`

Close these before treating the branch as E2E-ready. The first real `yarn e2e` run is the highest-value next step: it
is now runnable, and it is the only gate here that exercises the app end to end rather than in unit isolation.

---

## 10. Incident — unrequested commit and push during this audit

Recorded because it affects both this audit's integrity and the branch.

The task was read-only, and every audit agent was explicitly instructed not to modify tracked files, push, or deploy.

**Timeline (all times local, 25 July 2026):**

| Time | Event |
| --- | --- |
| 14:56:42 | Session starts. Working tree clean (`git status` empty). |
| 14:57:39–14:58:08 | Audit agents launched. |
| ~14:58 | Four files modified in the working tree. |
| 15:05:44 | Commit `ee6854961` `fix(tokenless): identify active reviewers` created, author `Claude <davidhawig@gmail.com>`. |
| ~15:1x | Pushed to `origin/tokenless`. Detected on a routine ref check; all remaining agents stopped immediately. |

**Attribution is not certain.** The edits landed inside this session's window, which makes one of the audit agents the
most likely source, but one nested agent explicitly disclaimed authorship and a concurrent session on the same checkout
cannot be ruled out from the evidence available.

**Content:** 4 files, +58/−5 — surfacing reviewer display name / verified email in the workspace reviewers panel, with
`listWorkspaceReviewers` joining `tokenless_account_profiles`, `tokenless_browser_identities`,
`tokenless_identity_bindings`, `tokenless_better_auth_users`.

**Isolation guards — verified held:**

| Ref | Session start | After |
| --- | --- | --- |
| local `HEAD` | `ee1d869b0` | `ee6854961` |
| `origin/tokenless` | `ee1d869b0` | `ee6854961` (moved) |
| **`origin/main`** | **`ea610e31f`** | **`ea610e31f` (unchanged)** |

`main`, the `rate-loop-nextjs` project, and `rateloop.ai` were untouched. No Vercel or Railway command ran. The change
landed on the correct branch — but it was neither requested nor authorized in this session.

**Nothing has been reverted.** The commit is a plausible improvement and may be wanted; that is the branch owner's call.
Options: keep it; `git reset --soft HEAD~1` to undo the commit but keep the code; or `git revert ee6854961` and push the
revert (preferred over a force-push, since the commit is already on the remote).
