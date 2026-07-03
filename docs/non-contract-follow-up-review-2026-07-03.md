# Non-Contract Follow-Up Bug And Consistency Review - 2026-07-03

Reviewed head: `496c582a4` on `main`.

Scope: non-Solidity application code, public docs, agents, SDK, Ponder, keeper-facing APIs, scripts, package metadata, env references, migrations, and tests. Smart contracts, Solidity implementation review, and Foundry contract tests were excluded.

The local worktree already contained unstaged edits in `README.md`, `docs/incentives-remediation-plan-2026-07.md`, and multiple `packages/foundry` contract/test files before this report was written. Solidity files were ignored. Existing non-contract doc edits were reviewed as worktree context only and were not staged by this report commit.

Three read-only agents checked separate slices in parallel:

- Next.js app, API, client, handoff, MCP, and rendered public-doc flows.
- Ponder, keeper-facing API behavior, agents, SDK, scripts, and package tooling.
- Docs, migrations, env references, and public copy consistency.

## Summary

| ID | Severity | Status | Finding |
| --- | --- | --- | --- |
| NC-FU-2026-07-03-1 | Medium | Open | Rendered `/docs/ai` skips the Feedback Bonus follow-up required by low-level MCP wallet-call flows. |
| NC-FU-2026-07-03-2 | Medium | Open | Next.js deployment env docs omit required metadata-sync and image-sweep secrets. |
| NC-FU-2026-07-03-3 | Medium | Open | Database docs still point non-local migration work at `db:push`. |
| NC-FU-2026-07-03-4 | Low | Open | Ponder BigInt route params accept blank, signed, and non-decimal input. |
| NC-FU-2026-07-03-5 | Low | Open | Invalid `PONDER_REPLICA_COUNT` suppresses the production rate-limit warning. |
| NC-FU-2026-07-03-6 | Low | Open | Agent CLI and SDK status/result chain IDs bypass strict decimal validation. |
| NC-FU-2026-07-03-7 | Low | Open | Public reward docs still describe generic bounty claims as USDC-only. |
| NC-FU-2026-07-03-8 | Low | Open | Frontend-operator docs hard-code a 20-minute epoch despite configurable question duration. |
| NC-FU-2026-07-03-9 | Low | Open | Worktree docs disagree on whether RBTS pairing entropy remediation is still planned. |

## Findings

### NC-FU-2026-07-03-1 - Rendered AI docs skip Feedback Bonus confirmation

The rendered public AI docs tell low-level MCP wallet-call hosts to call `rateloop_ask_humans`, execute `transactionPlan.calls`, confirm the ask, and then poll status/result. The markdown source includes the missing step: if `rateloop_confirm_ask_transactions` returns `feedbackBonus.transactionPlan`, execute that plan and call `rateloop_confirm_feedback_bonus_transactions`.

Impact: an agent following the rendered page can submit the question but skip funding or confirming the Feedback Bonus, leaving the promised bonus pending or unrecovered. This is a docs/runtime-flow inconsistency; the underlying MCP tooling exposes the correct confirm tool.

Evidence:

- `packages/nextjs/app/(public)/docs/ai/page.tsx:479` through `:480` omits the Feedback Bonus follow-up in the low-level MCP flow.
- `packages/nextjs/public/docs/ai.md:177` through `:180` documents the missing follow-up.
- `packages/nextjs/lib/mcp/tools.ts:491` defines `rateloop_confirm_feedback_bonus_transactions`.
- `packages/nextjs/lib/mcp/tools.ts:2552` returns the Feedback Bonus confirm tool for the follow-up transaction plan.

Suggested fix:

1. Update the rendered `packages/nextjs/app/(public)/docs/ai/page.tsx` flow to mirror `public/docs/ai.md`.
2. Explicitly tell low-level hosts to inspect `feedbackBonus.transactionPlan`, execute it, and call `rateloop_confirm_feedback_bonus_transactions`.
3. Add a small docs parity check if this page and markdown source are expected to stay equivalent.

### NC-FU-2026-07-03-2 - Next.js env docs omit required secrets

The Next.js README env table documents `NEXT_PUBLIC_PONDER_URL`, but not `PONDER_METADATA_SYNC_TOKEN`. The env example says that token must match Ponder, and production metadata sync throws when it is missing. The same table documents the question-details sweep secret but omits the image-attachment sweep secret required by the image sweep route.

Impact: operators following only the README can deploy a production app where question metadata sync fails closed, and where stale unattached image cleanup cannot be scheduled.

Evidence:

- `packages/nextjs/README.md:84` lists `NEXT_PUBLIC_PONDER_URL` without the corresponding server-side metadata sync token.
- `packages/nextjs/.env.example:142` through `:144` documents `PONDER_METADATA_SYNC_TOKEN`.
- `packages/nextjs/services/ponder/client.ts:18` reads `PONDER_METADATA_SYNC_TOKEN`.
- `packages/nextjs/services/ponder/client.ts:1831` throws when production metadata sync lacks the token.
- `packages/nextjs/README.md:112` documents `RATELOOP_QUESTION_DETAILS_SWEEP_SECRET`.
- `packages/nextjs/.env.example:86` through `:87` documents `RATELOOP_IMAGE_ATTACHMENT_SWEEP_SECRET`.
- `packages/nextjs/app/api/attachments/images/sweep/route.ts:28` requires `RATELOOP_IMAGE_ATTACHMENT_SWEEP_SECRET`.

Suggested fix:

1. Add `PONDER_METADATA_SYNC_TOKEN` and `RATELOOP_IMAGE_ATTACHMENT_SWEEP_SECRET` to the Next.js env table.
2. Mention that the Ponder and Next.js metadata-sync tokens must match.
3. Include the image sweep route in the deployment or cron checklist beside the question-details sweep route.

### NC-FU-2026-07-03-3 - Database docs still point non-local migration work at `db:push`

The Drizzle README correctly says numbered SQL migrations are the deploy source of truth and that `db:push` does not execute them. The root README and the Next.js local-development note still tell operators to run `db:push` manually when they intend to migrate a non-local database.

Impact: staging or production operators can skip numbered SQL migrations, or run schema synchronization against shared data while believing they applied the deploy migration flow.

Evidence:

- `README.md:124` says to run `yarn workspace @rateloop/nextjs db:push` manually when intending to migrate a non-local database.
- `packages/nextjs/README.md:140` repeats the same non-local `db:push` guidance.
- `packages/nextjs/drizzle/README.md:5` says `db:push` is schema synchronization and does not execute numbered SQL migration files.
- `packages/nextjs/package.json:20` defines `db:push` as `drizzle-kit push`.

Suggested fix:

1. Reword root and Next.js docs so `db:push` is local/dev schema sync only.
2. Point non-local deploys to `packages/nextjs/drizzle/README.md` and the host migration process.
3. If a repo-native migration runner exists or is added later, document it separately from `db:push`.

### NC-FU-2026-07-03-4 - Ponder BigInt route params accept loose input

`safeBigInt` calls native `BigInt(value)`. Existing tests codify `safeBigInt("") === 0n`, and native `BigInt` also accepts inputs such as `0x10` and `+1`. Several required route filters use this helper by passing `c.req.query("contentId") ?? ""`.

Impact: missing required params can be coerced to `0n`, and non-decimal forms can pass validation on API surfaces that otherwise look strict. This makes client mistakes harder to diagnose and leaves the prior strict-integer remediation incomplete for BigInt route params.

Evidence:

- `packages/ponder/src/api/utils.ts:13` through `:19` calls native `BigInt`.
- `packages/ponder/tests/api-utils.test.ts:36` through `:37` asserts the blank-string-to-zero behavior.
- `packages/ponder/src/api/routes/data-routes.ts:307` parses required `contentId` with `safeBigInt(c.req.query("contentId") ?? "")`.
- `packages/ponder/src/api/routes/data-routes.ts:360` repeats the same pattern for Feedback Bonus awards.
- `packages/ponder/src/api/routes/correlation-routes.ts:345` uses `safeBigInt` for correlation route IDs.
- `packages/ponder/src/api/routes/keeper-routes.ts:35` uses `safeBigInt` for keeper timing params.

Suggested fix:

1. Replace API-facing `safeBigInt` with a decimal-only parser that rejects blank, signed, hex, and fractional input.
2. Add explicit positive and non-negative variants where routes need different domains.
3. Add route regressions for missing `contentId`, `0x10`, `+1`, and blank required params.

### NC-FU-2026-07-03-5 - Invalid replica count suppresses production warning

The Ponder API boot warning parses `PONDER_REPLICA_COUNT` with `parseStrictUnsignedInteger`, but only warns when the parsed value is non-null and greater than one. The malformed-env test asserts that `2abc` is not partially parsed, but does not require any diagnostic for the invalid setting.

Impact: a production typo like `PONDER_REPLICA_COUNT=2abc` disables the exact multi-replica in-memory rate-limit warning the env var is meant to surface.

Evidence:

- `packages/ponder/src/api/index.ts:80` parses `PONDER_REPLICA_COUNT`.
- `packages/ponder/src/api/index.ts:82` warns only when the parsed value is non-null and greater than one.
- `packages/ponder/tests/api-index.test.ts:85` through `:99` checks that `2abc` does not produce the two-replica warning, but does not require a malformed-env warning or boot failure.

Suggested fix:

1. Treat a set-but-invalid `PONDER_REPLICA_COUNT` as a production warning or boot-time configuration error.
2. Add an explicit test for malformed values such as `2abc`.
3. Keep the existing no-partial-parse behavior.

### NC-FU-2026-07-03-6 - Agent status/result chain IDs bypass strict decimal validation

The agent CLI `status` and `result` commands parse `--chain-id` with `Number(...)` inline. The SDK lookup URL builders only check truthiness before stringifying `params.chainId`.

Impact: `--chain-id 0x1e0` is accepted as `480`, and malformed values that become `NaN` can produce misleading missing-parameter errors or malformed lookup URLs. This is inconsistent with stricter payload validation elsewhere in the agent surfaces.

Evidence:

- `packages/agents/src/cli.ts:574` through `:577` parses status `--chain-id` with `Number`.
- `packages/agents/src/cli.ts:600` through `:603` parses result `--chain-id` with `Number`.
- `packages/sdk/src/agent.ts:1865` through `:1872` only checks truthiness before adding `chainId` to the status lookup URL.
- `packages/sdk/src/agent.ts:1907` through `:1917` does the same for result lookups.

Suggested fix:

1. Add a decimal-only positive safe-integer parser for CLI and SDK lookup params.
2. Reject hex, signed, junk-suffix, `NaN`, zero, and unsafe integer values with a precise error.
3. Add CLI and SDK tests for those invalid inputs.

### NC-FU-2026-07-03-7 - Generic bounty-claim docs still say USDC-only

Several public docs now say users can fund LREP or USDC bounties, but generic settlement and payout-root text still describes bounty claims or payouts as USDC-only. USDC-only wording remains correct for EIP-3009/x402 authorization paths, but these examples are in generic reward-settlement copy.

Impact: users and operators can infer that only USDC bounty claims wait for payout roots, even though wallet-call asks support LREP bounty flows too.

Evidence:

- `README.md:29` says questions can attach a LREP or USDC bounty.
- `README.md:32` says finalization covers "USDC bounties" but omits LREP bounty claims.
- `README.md:44` says correlation roots cover "USDC payouts" and launch LREP payouts.
- `packages/nextjs/public/docs/ai.md:129` says USDC bounty claims wait for finalized payout roots.
- `packages/nextjs/app/(public)/docs/ai/page.tsx:399` repeats the USDC-only bounty-claim wording.
- `packages/nextjs/app/(public)/docs/governance/page.tsx:116`, `packages/nextjs/app/(public)/docs/smart-contracts/page.tsx:629`, and `packages/nextjs/app/(public)/docs/tech-stack/page.tsx:278` contain similar generic USDC-only phrasing.
- `packages/agents/README.md:25` and `packages/nextjs/lib/x402/questionSubmission.test.ts:590` confirm LREP bounty wallet-call support.

Suggested fix:

1. Reword generic payout-root and settlement text to say LREP or USDC bounty claims.
2. Keep USDC-only language only in EIP-3009/x402 authorization sections.
3. Add a focused docs search check if this copy has regressed repeatedly.

### NC-FU-2026-07-03-8 - Frontend-operator docs hard-code 20-minute epochs

The frontend-code operator docs say votes are revealed after each 20-minute epoch. Other public and agent docs correctly describe `roundConfig.questionDurationSeconds` as configurable per question.

Impact: operators can write reveal and settlement runbooks around a fixed 20-minute duration even when asks use shorter fast rounds or longer high-value rounds.

Evidence:

- `packages/nextjs/app/(public)/docs/frontend-codes/page.tsx:172` says "After each 20-minute epoch ends".
- `packages/nextjs/app/(public)/docs/ai/page.tsx:408` says `roundConfig.questionDurationSeconds` controls the shared blind-window close.
- `packages/agents/README.md:25` documents `roundConfig.questionDurationSeconds`.
- `packages/nextjs/app/(public)/docs/smart-contracts/page.tsx:410` lists `questionDurationSeconds` in the round config.

Suggested fix: replace the hard-coded duration with "after the configured question duration ends" and mention 20 minutes only as an example preset if needed.

### NC-FU-2026-07-03-9 - Worktree docs disagree on RBTS entropy remediation

This finding is worktree-context only: it compares two existing unstaged doc edits that were present before this report. The dirty root README now describes future block hash plus the EIP-2935 historical-hash fallback as the accepted RBTS reference/peer pairing seed. The dirty incentives remediation plan still says to replace delayed-blockhash-dependent pairing with precommitted voter entropy.

Impact: reviewers of the local worktree cannot tell whether future-block/EIP-2935 is the accepted launch posture or an unresolved remediation target.

Evidence:

- Dirty `README.md:57` describes future block hash plus EIP-2935 fallback as the current model.
- Dirty `docs/incentives-remediation-plan-2026-07.md:53` through `:59` still plans to replace the delayed-blockhash dependency with voter entropy.

Suggested fix: either mark that remediation-plan section superseded by the accepted EIP-2935/future-block model, or rewrite it as a future hardening item rather than the current implementation plan.

## Rechecked Prior Items

- Focused readiness tests passed for one-document JSON output, degraded indexer-health rejection, and `attention` health warning behavior.
- Focused Drizzle migration journal tests passed for the current migration set.
- Focused Feedback Bonus handoff recovery tests passed.
- Focused Ponder strict unsigned integer tests passed, but BigInt-specific parser behavior remains loose as described above.
- Focused x402 payload and local signer tests passed, while status/result chain-ID lookup validation remains separate.

## Verification

Passed during this review:

- `node scripts/run-node-tests.mjs scripts/readiness-workflows.test.mjs scripts/check-worldchain-sepolia-readiness.test.mjs` - 57 passed.
- From `packages/nextjs`: `node ../../scripts/run-node-tests.mjs lib/db/migrationJournal.test.ts lib/chainId.test.ts components/agent/feedbackBonusRecovery.test.ts` - 5 passed.
- `yarn workspace @rateloop/ponder vitest run tests/api-utils.test.ts tests/api-index.test.ts tests/protocol-deployment.test.ts` - 60 passed.
- `yarn workspace @rateloop/agents vitest run src/__tests__/x402QuestionPayload.test.ts src/__tests__/localSigner.test.ts` - 64 passed.
- A read-only Next.js slice also passed from `packages/nextjs`: `node ../../scripts/run-node-tests.mjs components/agent/feedbackBonusRecovery.test.ts lib/webmcp/handoffTools.test.ts app/api/agent/routes.test.ts lib/mcp/tools.test.ts` - 116 passed.

Additional review commands:

- Searched non-contract app/docs/agent/Ponder/SDK surfaces for `db:push`, env-table drift, Feedback Bonus MCP follow-up flows, BigInt parsing, replica-count warnings, chain-ID parsing, LREP/USDC bounty wording, and hard-coded question durations.
- Checked local branch parity with `origin/main` before writing this report: `main...origin/main` was `0 0`.

Not run:

- Foundry/Solidity tests and smart-contract review, because smart contracts were explicitly out of scope.
- Full Next.js, keeper, SDK, agents, node-utils, and Ponder package test suites.
- Full local Docker/dev-stack Playwright E2E.
- Live external readiness probes.
