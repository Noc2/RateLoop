# Non-Contract Follow-Up Bug And Consistency Review - 2026-07-02

Pre-report head reviewed: `c8f750574` on `main`.

Scope: non-Solidity app, agent, SDK, keeper, Ponder, docs, scripts, package configuration, and tests. Smart contracts and Foundry contract tests were excluded from this pass.

## Summary

| ID | Severity | Status | Finding |
| --- | --- | --- | --- |
| NC-FU-1 | Medium | Open | Ponder's public correlation finality SLA can miss active backlog states. |
| NC-FU-2 | Medium | Open | `/health/indexer` reports `ok` when correlation finality needs `attention`. |
| NC-FU-3 | Medium | Open | Mixed-asset Feedback Bonus support differs between hosted flows, local signer behavior, and package docs. |
| NC-FU-4 | Low | Open | Browser handoff tag validation error says "categories". |

## Findings

### NC-FU-1 - Ponder's public correlation finality SLA can miss active backlog states

`packages/ponder/src/api/correlation-finality-sla.ts` summarizes only existing `roundPayoutSnapshot` and `correlationEpochSnapshot` rows whose status is proposed, challenged, finalized, or rejected. The two queries are capped with `limit(1000)` and do not order the rows or exclude consumed finalized rows. Consumed rows are explicitly classified as `phase: "consumed"` and remain in the same sample set.

The endpoint therefore has two blind spots:

- Old consumed snapshots can crowd out active proposed/challenged/finalized rows once the deployment has more than 1,000 historical snapshot rows.
- Source-ready work with no proposal yet is absent from `/correlation/finality-sla`, even though Ponder exposes source-ready candidate routes such as `/correlation/round-candidates`, `/correlation/launch-round-candidates`, `/correlation/bundle-round-candidates`, `/correlation/rating-round-candidates`, and `/correlation/rbts-settlement-round-candidates`.

This is an observability gap, not a decentralization or protocol-liveness failure. The keeper already tracks a related metric, `keeper_correlation_source_ready_backlog_oldest_seconds`, so the inconsistency is that the public Ponder SLA endpoint can still say `ok` while the keeper metric is showing source-ready work with no proposal.

Evidence:

- `packages/ponder/src/api/correlation-finality-sla.ts:84` classifies finalized rows with `consumedAt` as `consumed`.
- `packages/ponder/src/api/correlation-finality-sla.ts:176` queries snapshot tables without ordering, without filtering consumed rows, and with a 1,000-row limit.
- `packages/ponder/src/api/routes/correlation-routes.ts:551` exposes `/correlation/finality-sla`.
- `packages/ponder/src/api/routes/correlation-routes.ts:557`, `:616`, `:675`, `:760`, and `:806` expose pre-proposal candidate routes that the SLA builder does not inspect.
- `packages/keeper/src/metrics.ts:260` documents the keeper-side source-ready backlog gauge.

Suggested fix:

1. Make the SLA query active-first: proposed, challenged, and finalized/unconsumed rows should be selected before historical consumed rows, with deterministic ordering by the oldest relevant phase timestamp.
2. Add source-ready pre-proposal buckets by querying the candidate routes' underlying predicates directly, or by factoring the candidate selectors into shared helpers that `buildCorrelationFinalitySla` can reuse.
3. Report these as explicit phases such as `source_ready_unproposed`, grouped by payout domain, with `oldestAgeSeconds`.
4. Add route-validation coverage for consumed-row crowd-out and source-ready/no-proposal cases.

### NC-FU-2 - `/health/indexer` reports `ok` when correlation finality needs `attention`

`buildCorrelationFinalitySla` returns `status: "attention"` when it sees challenged or rejected snapshot rows and no normal-path SLA breach. The `/health/indexer` wrapper only degrades the top-level status for human-verified commit warnings or `correlationFinality.status === "degraded"`. As a result, `/health/indexer` can return top-level `status: "ok"` while its nested `checks.correlationFinality.status` says `attention`.

This can hide disputed or rejected payout-finality states from simple uptime checks that read only the top-level status.

Evidence:

- `packages/ponder/src/api/correlation-finality-sla.ts:219` returns `attention` for disputed or rejected rows.
- `packages/ponder/src/api/index.ts:173` only treats `correlationFinality.status === "degraded"` as a top-level problem.
- `packages/ponder/tests/api-index.test.ts:22` mocks only the `ok` correlation finality status; there is no top-level `attention` regression test.

Suggested fix:

1. Decide whether top-level `/health/indexer` should return `attention` or normalize `attention` to `degraded`.
2. Preserve the nested detailed status either way.
3. Add `api-index` tests for `ok`, `attention`, and `degraded` finality states so simple monitoring behavior is deliberate.

### NC-FU-3 - Mixed-asset Feedback Bonus support differs between hosted flows, local signer behavior, and package docs

The hosted browser/MCP flow now supports mixed-asset Feedback Bonuses through wallet-call plans. Public docs describe that behavior. The local signer in `@rateloop/agents` still rejects a Feedback Bonus whose asset differs from the bounty asset, and some agent/root docs still state the same-asset requirement.

This means a payload documented as valid for browser handoff or hosted MCP can fail before submission for agents using the local signer. The issue does not require removing the hosted mixed-asset UX; the inconsistency is that the local signer/docs do not clearly describe the split.

Evidence:

- `packages/nextjs/lib/mcp/tools.ts:1249` only limits same-transaction EIP-3009 funding to USDC bounty plus USDC Feedback Bonus; wallet-call mode has no same-asset rejection there.
- `packages/nextjs/public/docs/ai.md:190`, `packages/nextjs/public/docs/sdk.md:190`, and `packages/nextjs/public/skill.md:136` document mixed-asset wallet-call Feedback Bonuses.
- `packages/agents/src/localSigner.ts:768` and `:812` reject mixed-asset Feedback Bonuses before local signing.
- `packages/agents/src/__tests__/localSigner.test.ts:1415` asserts that rejection.
- `README.md:43`, `packages/agents/README.md:26`, and `packages/agents/examples/README.md:109` still say wallet-call asks must keep bounty and bonus in the same asset.

Suggested fix:

1. Choose the intended local signer policy.
2. If local signer should match hosted wallet-call UX, allow mixed-asset bonuses by executing the ask plan and separate Feedback Bonus wallet plan the same way hosted flows do.
3. If local signer should remain same-asset only, update root/agent docs to say mixed-asset wallet-call bonuses are hosted/browser-MCP only, and add a clear local-signer limitation near the examples.
4. Keep EIP-3009/x402 one-shot funding USDC-only.

### NC-FU-4 - Browser handoff tag validation error says "categories"

`buildQuestionDraftPayload` parses `draft.tags`, but the validation error for zero or more than three tags says the question needs "one to three categories." The field and UI concept are tags, so the message can send users toward the wrong input.

Evidence:

- `packages/nextjs/components/agent/AgentAskHandoffPage.tsx:1623` parses tags.
- `packages/nextjs/components/agent/AgentAskHandoffPage.tsx:1627` reports "one to three categories."

Suggested fix: change the message to "one to three tags" and add a focused unit test if this validation helper is already testable from the component module.

## Non-Findings And Notes

- The stale multi-hour payout-finality language found in the earlier review appears fixed in the current public app/docs surfaces; remaining occurrences in `docs/ux-impact-audit-2026-07-02.md` are marked as pre-remediation historical audit context.
- `24 hours` occurrences reviewed in non-contract docs/code mostly refer to EIP-3009 authorization validity, vote cooldowns, privacy retention, or operational limits rather than the current one-hour payout/result finality posture.
- Two auxiliary agents did not return additional actionable evidence. One auxiliary agent found the local-signer/mixed-asset and tag-copy issues included above.

## Verification

Passed:

- `yarn workspace @rateloop/agents test` - 147 tests.
- `yarn workspace @rateloop/keeper test` - 549 passed, 2 skipped.
- `yarn workspace @rateloop/ponder test` - 412 passed, 1 skipped.
- `yarn workspace @rateloop/sdk test` - 57 tests.
- `yarn workspace @rateloop/node-utils test` - 50 tests.
- `yarn workspace @rateloop/nextjs check-types`.
- `yarn workspace @rateloop/nextjs test` - 1,844 tests.

Additional review commands:

- Searched timing and Feedback Bonus wording across `README.md`, `docs`, `packages/agents`, `packages/keeper`, `packages/nextjs`, `packages/ponder`, `packages/sdk`, and `packages/node-utils`.
- Reviewed Ponder correlation finality routes, indexer health bootstrap tests, local signer Feedback Bonus behavior, hosted MCP payment-mode handling, and browser handoff draft validation.

Not run:

- Foundry/Solidity test suites, because smart contracts were explicitly out of scope for this pass.
- Full local Docker/dev-stack Playwright E2E and live deployment checks.
