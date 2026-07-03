# Non-Contract Bug And Consistency Review - 2026-07-03

Reviewed head: `ff9b690b8` on `main`.

Scope: non-Solidity application code, agents package, SDK/node utilities, keeper, Ponder, repository scripts, workflows, docs, package metadata, migrations, tests, and static/generated assets. Smart contracts, Solidity implementation review, and Foundry contract tests were excluded. TypeScript contract metadata was considered only where non-contract tooling consumes it.

Three read-only agents checked separate slices in parallel:

- Next.js app, API, handoff, governance UI, and confidentiality surfaces.
- Ponder, keeper, agents, node-utils, scripts, readiness checks, and package tooling.
- Docs, examples, migrations/schema metadata, package metadata, and public copy consistency.

## Summary

| ID | Severity | Status | Finding |
| --- | --- | --- | --- |
| NC-2026-07-03-1 | High | Open | Feedback Bonus handoff recovery can still lose broadcast transaction hashes when receipt waiting fails. |
| NC-2026-07-03-2 | Medium | Open | Live readiness can pass while Ponder reports degraded or attention indexer health. |
| NC-2026-07-03-3 | Medium | Open | Drizzle migration journal omits the required `0018` Feedback Bonus recovery migration. |
| NC-2026-07-03-4 | Medium | Open | Database docs conflate `db:push` with applying numbered SQL migrations. |
| NC-2026-07-03-5 | Low | Open | Production deploy docs still single out old migration `0012` and omit newer required migrations. |
| NC-2026-07-03-6 | Low | Open | `--json --live` readiness output emits multiple JSON documents. |
| NC-2026-07-03-7 | Low | Open | Several integer parsers accept trailing junk despite invalid-input branches. |

## Findings

### NC-2026-07-03-1 - Feedback Bonus recovery can still lose broadcast hashes

The new browser handoff Feedback Bonus retry path persists bonus transaction hashes once `/complete-feedback-bonus` is called, and that route stores `pending_confirmation` before MCP confirmation. However, the client only reaches that route after `executeWalletTransactionPlan` fully resolves.

For sequential wallet calls, `useWalletTransactionPlanExecutor` receives the transaction hash from `sendTransaction`, pushes it into the local `hashes` array, then waits for the receipt. If receipt polling times out or throws after the transaction was broadcast, the outer catch rethrows the original error without surfacing the partial hashes. The handoff component catches that error and shows "Ask submitted, but Feedback Bonus funding failed" without storing local or server recovery hashes.

Impact: a user can broadcast the Feedback Bonus pool transaction, hit a transient wallet/RPC receipt wait failure, and lose the handoff retry state. If the transaction later lands, the UI can lead the user toward rebroadcasting instead of confirming the already-broadcast pool, risking a duplicate funded Feedback Bonus pool.

Evidence:

- `packages/nextjs/hooks/useWalletTransactionPlanExecutor.ts:112` starts the wallet send.
- `packages/nextjs/hooks/useWalletTransactionPlanExecutor.ts:129` stores the hash locally and `:132` waits for the receipt.
- `packages/nextjs/hooks/useWalletTransactionPlanExecutor.ts:391` through `:396` rethrows without attaching the partial hashes.
- `packages/nextjs/components/agent/AgentAskHandoffPage.tsx:3184` through `:3198` only stores Feedback Bonus recovery hashes after the wallet plan resolves.
- `packages/nextjs/components/agent/AgentAskHandoffPage.tsx:3203` through `:3207` handles the failure as a plain error.
- `packages/nextjs/app/api/agent/handoffs/[handoffId]/complete-feedback-bonus/route.ts:48` through `:53` would persist hashes early, but it is not called on the partial-hash failure path.

Suggested fix:

1. Surface partial transaction hashes from `executeWalletTransactionPlan` failures, either through a typed error carrying `transactionHashes` or through an immediate `onCallSent` callback.
2. For Feedback Bonus handoffs, store the relevant bonus hashes as soon as the pool-creation hash is known, before receipt waiting can fail.
3. Reuse the existing `/complete-feedback-bonus` confirm-only retry path with stored hashes and do not rebroadcast wallet calls.
4. Add a regression for "hash returned, receipt wait rejects, recovery state is still stored."

### NC-2026-07-03-2 - Live readiness misses degraded Ponder health

`validateLiveReadiness` probes `/keeper/work` and treats an HTTP 200 response as success. That route includes Ponder health details in its JSON body, including `health.correlationFinality`, but live readiness does not parse the body or compare it with `/health/indexer`.

Impact: a live readiness run can pass while Ponder is already reporting `degraded` or `attention` indexer health, such as correlation-finality breaches or human-verified commit count warnings. This weakens redeploy gates without adding a decentralized safety check.

Evidence:

- `scripts/readiness-core.mjs:1531` through `:1552` checks only `/keeper/work` HTTP status.
- `packages/ponder/src/api/routes/keeper-routes.ts:356` through `:365` includes health details in `/keeper/work`.
- `packages/ponder/src/api/index.ts:167` through `:180` exposes `/health/indexer` with top-level `ok`, `attention`, or `degraded`.
- `scripts/check-worldchain-sepolia-readiness.test.mjs` currently tests that `/keeper/work` accepts the bearer token, not that its health payload is acceptable.

Suggested fix:

1. Parse `/keeper/work` health or fetch `/health/indexer` during live readiness.
2. Fail live readiness on `degraded` and deliberately choose whether `attention` should fail or warn.
3. Add tests for HTTP 200 with degraded/attention health.

### NC-2026-07-03-3 - Drizzle journal omits migration `0018`

`0018_agent_handoff_feedback_bonus_recovery.sql` adds the columns that the handoff recovery code now expects, and the Drizzle README lists it as required. The Drizzle journal still stops at `0017_confidentiality_frontend_scope`.

Impact: deployers or tooling that rely on Drizzle migration metadata can miss the required Feedback Bonus recovery columns and run current code against a database missing `feedback_bonus_transaction_hashes`, `feedback_bonus_status`, and `feedback_bonus_error`.

Evidence:

- `packages/nextjs/drizzle/0018_agent_handoff_feedback_bonus_recovery.sql:1` through `:5` adds the recovery columns.
- `packages/nextjs/lib/db/schema.ts:723` through `:725` expects those columns.
- `packages/nextjs/lib/agent/handoffs.ts:118` through `:125` treats those columns as a required pending migration.
- `packages/nextjs/drizzle/README.md:16` lists `0018` as a required deploy migration.
- `packages/nextjs/drizzle/meta/_journal.json:124` through `:130` stops at `0017_confidentiality_frontend_scope`.

Suggested fix:

1. Regenerate or add the Drizzle journal entry for `0018_agent_handoff_feedback_bonus_recovery`.
2. Refresh any matching snapshot if Drizzle expects it for this workflow, or clearly document that post-`0017` numbered SQL files are applied outside the journal.
3. Add a lightweight test that the journal covers every numbered SQL migration that is intended to be journal-managed.

### NC-2026-07-03-4 - Database docs conflate `db:push` with SQL migrations

The Drizzle README says SQL migrations are the source of truth and then tells operators to apply them with `yarn workspace @rateloop/nextjs db:push`. The Next.js package README also says `db:push` applies migrations. In package scripts, `db:push` is `drizzle-kit push`, which syncs schema state instead of executing the numbered SQL migration-file workflow.

Impact: production or staging operators can reasonably treat `db:push` and applying numbered SQL migrations as equivalent, then miss migration-specific artifacts such as the new `0018` handoff recovery SQL.

Evidence:

- `packages/nextjs/drizzle/README.md:3` through `:7` calls SQL migrations the source of truth and points to `db:push`.
- `packages/nextjs/package.json:19` through `:20` defines `db:push` as `drizzle-kit push`.
- `packages/nextjs/README.md:29` through `:30` describes `db:push` as "Apply migrations".
- `packages/nextjs/README.md:40` says to run `db:push` or apply SQL migrations before production deploy.

Suggested fix:

1. Clarify that `db:push` syncs the current schema for controlled environments.
2. Document the explicit numbered-SQL migration process for deploys.
3. If migration-file execution is intended, add a dedicated `db:migrate` script and point deployers to it.

### NC-2026-07-03-5 - Production deploy docs omit newer migration gates

The Next.js README production deploy note still frames the database prep requirement around `0012_agent_signing_intent_prepared_artifacts.sql`. The Drizzle README now lists later required migrations, including `0016` and `0018`.

Impact: a deployer reading only the package README could think the predeploy database requirement is just `0012`, even though current runtime paths depend on newer migrations.

Evidence:

- `packages/nextjs/README.md:40` only names migration `0012`.
- `packages/nextjs/drizzle/README.md:13` through `:16` lists required `0012`, `0013`, `0016`, and `0018`.

Suggested fix: replace the specific `0012` callout with a pointer to the full Drizzle migration checklist, or list all currently required production migrations in one place.

### NC-2026-07-03-6 - `--json --live` readiness output is not one JSON document

The readiness scripts print one JSON object per result. With `--json --live`, they print an offline JSON object followed by a live JSON object, so `JSON.parse(stdout)` fails.

Impact: automation that expects a single JSON readiness payload cannot consume the live JSON mode without custom line-splitting or stream parsing.

Evidence:

- `scripts/check-base-sepolia-readiness.mjs:44` through `:47` prints a single result object, then `:155` through `:178` can print both offline and live results.
- `scripts/check-base-mainnet-readiness.mjs:51` through `:54` uses the same print pattern.
- `scripts/check-worldchain-sepolia-readiness.mjs:19` through `:22` uses the same print pattern and `:41` through `:58` can print both offline and live results.

Suggested fix: in JSON mode, accumulate and print one object such as `{ "offline": ..., "live": ... }`. Keep the current two-section output for human-readable mode.

### NC-2026-07-03-7 - Integer parsers accept trailing junk

Several input parsers use `parseInt`/`Number.parseInt` and then rely on `isNaN` or safe-integer checks. That accepts values such as `limit=10abc`, `status=0abc`, `chainId: "8453abc"`, or `PONDER_CHAIN_ID=8453abc`.

Impact: bad API input or env typos can be silently accepted, even though the surrounding code has explicit invalid-input paths. This is low severity, but it weakens operator feedback and makes client errors harder to catch.

Evidence:

- `packages/ponder/src/api/utils.ts:20` through `:31` parses pagination `limit` and `offset` with `parseInt`.
- `packages/ponder/src/api/routes/content-routes.ts:1211` through `:1214` parses the content status filter with `parseInt`.
- `packages/agents/src/x402QuestionPayload.ts:803` through `:810` parses `chainId` with `Number.parseInt`.
- `packages/ponder/src/protocol-deployment.ts:35` through `:44` parses `PONDER_CHAIN_ID` with `Number.parseInt`.

Suggested fix: add or reuse a strict unsigned-integer parser that requires the full string to match digits before conversion, then apply clamping after strict parsing. Add regression coverage for trailing junk values.

## Rechecked Prior Items

- The July 2 final-sweep findings have matching remediation report entries and current tests for keeper metrics, generated-image handoff linting, focused Node test cwd grouping, Base Sepolia stale x402 gating, and promo voiceover clip sharing.
- The July 3 current-head findings around Ponder finality sampling, RBTS payout-consumer readiness, Feedback Bonus confirm-only retry, and generic LREP/USDC copy have matching commits before this review.
- USDC-only language remains in explicit x402/EIP-3009 paths, which is intentional. Generic public copy no longer presented as USDC-only in the reviewed app/docs surfaces.
- The Base Sepolia stale X402 submitter warning remains an explicit staging redeploy gate, not a new finding.

## Verification

Passed:

- `yarn workspace @rateloop/node-utils test` - 50 passed.
- `yarn workspace @rateloop/sdk test` - 57 passed.
- `yarn workspace @rateloop/agents test` - 155 passed.
- `yarn workspace @rateloop/keeper test` - 551 passed, 2 skipped.
- `yarn workspace @rateloop/ponder test` - 418 passed, 1 skipped.
- `yarn workspace @rateloop/nextjs test` - 1846 passed.
- `yarn workspace @rateloop/node-utils check-types`.
- `yarn workspace @rateloop/sdk check-types`.
- `yarn workspace @rateloop/agents check-types`.
- `yarn workspace @rateloop/keeper check-types`.
- `yarn workspace @rateloop/ponder check-types`.
- `yarn workspace @rateloop/nextjs check-types`.
- `yarn workspace @rateloop/nextjs lint`.
- `node scripts/run-node-tests.mjs scripts` - 128 passed.
- `node scripts/check-base-sepolia-readiness.mjs` - passed offline readiness with the expected stale staging submitter warning.
- `yarn dead-code`.
- `yarn npm audit --recursive --environment production` - no audit suggestions.
- `yarn npm audit --recursive --environment development` - no audit suggestions.
- `git diff --check`.

Additional notes:

- The shell used for this pass reported Node `v26.0.0` while the repo declares `>=24 <25`. The tested suites still passed; Node emitted `DEP0205` warnings during several Node test runs.
- A focused Next.js agent-side check also passed: `node ../../scripts/run-node-tests.mjs app/api/agent/routes.test.ts lib/agent/walletTransactionPlan.test.ts components/governance/GovernanceActionComposer.test.ts` from `packages/nextjs` - 78 passed.

Not run:

- Foundry/Solidity tests and smart-contract review, because smart contracts were explicitly out of scope.
- Full local Docker/dev-stack Playwright E2E.
- Live external readiness probes.
