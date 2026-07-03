# Non-Contract Remediation Report - 2026-07-03

Scope: remediation for NC-2026-07-03-1 through NC-2026-07-03-7 from `docs/non-contract-review-2026-07-03.md`. Smart-contract implementation review and Solidity tests remained out of scope.

Plan review: two parallel reviewers checked the plan before implementation. One reviewed the Feedback Bonus recovery approach and confirmed it should store only pool-creation hashes immediately, avoid rebroadcasts, and rely on the existing confirm-only retry path. The other reviewed readiness, Drizzle metadata/docs, and integer parsing, confirming `/health/indexer` as the live health source, single-envelope JSON for `--json --live`, `db:push` docs as schema sync only, and fail-fast malformed `PONDER_CHAIN_ID` handling.

## Fixed Findings

| ID | Status | Fix |
| --- | --- | --- |
| NC-2026-07-03-1 | Fixed | `7a57372e7` stores Feedback Bonus pool-creation hashes as soon as wallet calls are sent, retries confirmation without rebroadcasting after receipt-wait failures, and keeps recovery state until confirmation succeeds. |
| NC-2026-07-03-2 | Fixed | `4fe6e9318` makes live readiness fetch `/health/indexer`, fail on `degraded`, and warn on `attention`. |
| NC-2026-07-03-3 | Fixed | `bef51344d` adds the missing Drizzle journal entry for `0018_agent_handoff_feedback_bonus_recovery` and a journal coverage test. |
| NC-2026-07-03-4 | Fixed | `bef51344d` clarifies that `db:push` is Drizzle schema synchronization for controlled local/dev environments, not numbered SQL migration execution. |
| NC-2026-07-03-5 | Fixed | `bef51344d` replaces the stale single-`0012` production note with a pointer to the full Drizzle deploy checklist. |
| NC-2026-07-03-6 | Fixed | `4fe6e9318` keeps offline-only JSON output unchanged and emits one `{ offline, live }` envelope for `--json --live`. |
| NC-2026-07-03-7 | Fixed | `12db77e06` replaces partial `parseInt` parsing across the reviewed Ponder and agent surfaces with strict whole-string integer parsing and regression tests. |

## Verification

Passed:

- `node ../../scripts/run-node-tests.mjs components/agent/feedbackBonusRecovery.test.ts app/api/agent/routes.test.ts lib/webmcp/handoffTools.test.ts` from `packages/nextjs` - 69 tests.
- `yarn workspace @rateloop/nextjs check-types`.
- `node scripts/run-node-tests.mjs scripts/check-worldchain-sepolia-readiness.test.mjs` - 48 tests.
- `node scripts/check-base-sepolia-readiness.mjs --json --live` - emitted one JSON envelope and exited 0.
- `node scripts/check-base-sepolia-readiness.mjs` - passed offline readiness with the expected stale X402 submitter warning.
- `node ../../scripts/run-node-tests.mjs lib/db/migrationJournal.test.ts` from `packages/nextjs` - 1 test.
- `yarn workspace @rateloop/ponder vitest run tests/api-utils.test.ts tests/route-validation.test.ts tests/protocol-deployment.test.ts tests/api-index.test.ts tests/payout-proofs.test.ts` - 198 tests.
- `yarn workspace @rateloop/agents vitest run src/__tests__/x402QuestionPayload.test.ts` - 6 tests.
- `yarn workspace @rateloop/ponder check-types`.
- `yarn workspace @rateloop/agents check-types`.
- `rg -n "parseInt|Number\\.parseInt" packages/ponder/src/api packages/ponder/src/protocol-deployment.ts packages/agents/src/x402QuestionPayload.ts` - no remaining hits.

Commit hooks also reran the relevant Next.js, Ponder, agents, and contract build/type-check tasks for the committed files.

Not run:

- Foundry/Solidity tests and smart-contract review, because smart contracts were explicitly out of scope for the non-contract review.
- Full local Docker/dev-stack Playwright E2E.
