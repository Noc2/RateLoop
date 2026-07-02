# Non-Contract Review Final Sweep - 2026-07-02

Reviewed head: `f1d3ade77` on `main`.

Scope: non-Solidity application code, agents package, SDK/node utilities, keeper, Ponder, repository scripts, workflows, docs, package metadata, tests, and static/generated assets. Smart contracts, Solidity implementation review, Foundry contract tests, and contract security findings were excluded. TypeScript contract metadata was considered only where non-contract tooling consumes it.

Three read-only explorer agents checked separate slices in parallel:

- Next.js app/API/components/docs rendering: no new actionable findings.
- Agents, keeper, and Ponder: found keeper metrics and handoff linting inconsistencies.
- Tooling, workflows, docs, and static assets: found staging readiness, focused-test, and promo fallback drift issues.

## Summary

| ID | Severity | Status | Finding |
| --- | --- | --- | --- |
| NC-FS-1 | Medium | Open | Keeper payout-finality breach counter does not count observed SLA breaches. |
| NC-FS-2 | Medium | Open | Keeper increments an unregistered HRC health warning counter. |
| NC-FS-3 | Medium | Open | Scheduled Base Sepolia live readiness is configured to fail against the known stale staging submitter. |
| NC-FS-4 | Low | Open | `handoff --image` can reject valid single-question bundle payloads before image staging. |
| NC-FS-5 | Low | Open | Focused root Node test command can false-fail package-local Next.js tests. |
| NC-FS-6 | Low | Open | Promo video offline voiceover fallback has stale narration. |

## Findings

### NC-FS-1 - Keeper payout-finality breach counter does not count observed SLA breaches

`packages/keeper/src/metrics.ts:45` registers `keeper_payout_finality_sla_breaches_total`, and `packages/keeper/src/metrics.ts:272` documents it as "Total healthy unchallenged payout-finality paths observed past the one-hour SLA." The live SLA payload is consumed by `recordCorrelationFinalitySlaMetrics` at `packages/keeper/src/metrics.ts:128`, but that function only resets/populates backlog gauges and ignores `payload.breachCount`.

The only current increment is in `packages/keeper/src/index.ts:85`, where startup rejects a misconfigured launch finality budget. That is a configuration-policy violation, not an observed healthy-path SLA breach.

Impact: operators can wire alerts to a counter whose name and HELP text imply live payout-finality breach observations, while the counter remains flat during actual Ponder-reported breach states and can increment for a different failure class.

Suggested fix: split the metric into explicit concepts. For example, keep a gauge for current observed breach count from Ponder's SLA payload, and rename the startup counter to a launch-budget configuration violation counter. Avoid incrementing a total on every poll for the same live breach unless it is deduplicated by breached path.

### NC-FS-2 - Keeper increments an unregistered HRC health warning counter

`packages/keeper/src/keeper.ts:792` calls `incrementCounter("keeper_work_hrc_health_warning_total")` when Ponder reports stale `humanVerifiedCommitCount` health. That counter is not present in the `counters` registry in `packages/keeper/src/metrics.ts:10`, and `incrementCounter` silently ignores unknown names at `packages/keeper/src/metrics.ts:94`.

Impact: the warning is logged, but the Prometheus signal operators would reasonably expect is never emitted. This is the same class of observability drift as the previously fixed correlation-finality gauges.

Suggested fix: register `keeper_work_hrc_health_warning_total` and add HELP text, or remove the increment and expose the state through an existing registered health metric. Add a metrics test for the warning path.

### NC-FS-3 - Scheduled Base Sepolia live readiness is configured to fail against the known stale staging submitter

`.github/workflows/base-sepolia-readiness.yaml:91` runs:

```text
node scripts/check-base-sepolia-readiness.mjs --live --require-live-targets --require-one-shot-feedback-bonus-x402
```

The offline strict check already fails on current metadata:

```text
node scripts/check-base-sepolia-readiness.mjs --require-one-shot-feedback-bonus-x402 --json
```

returned:

```text
Base Sepolia X402QuestionSubmitter is the known stale staging submitter; one-shot Feedback Bonus x402 submissions remain disabled until the staging submitter is refreshed.
```

Impact: the Monday scheduled live readiness job is expected to go red before live probes are useful until staging is refreshed. That can train operators to ignore a readiness workflow that should be a deployment signal.

Suggested fix: refresh/redeploy Base Sepolia `X402QuestionSubmitter` and regenerate metadata, or make the scheduled strict one-shot Feedback Bonus gate explicitly non-blocking until the staging redeploy lands. The fresh redeploy plan makes this a staging-readiness cleanup, not a reason to preserve old contracts.

### NC-FS-4 - `handoff --image` can reject valid single-question bundle payloads before image staging

`packages/agents/src/cli.ts:380` suppresses the missing context lint error for generated-image handoffs only when the lint path is exactly `question.contextUrl`. The lint path becomes `questions.0.contextUrl` when the ask uses a valid one-item `questions` array. That shape is accepted by the parser, but the CLI filters happen before the handoff backend can attach staged image URLs.

Impact: agents can use the documented `handoff --file ask.json --image mockup.png` flow and still be rejected locally if their otherwise valid payload uses `questions: [{ ... }]` instead of `question: { ... }`. This is a UX-only issue, but it affects the image handoff path the repo explicitly documents for large generated images.

Suggested fix: when generated images are present, suppress the same missing-context lint message for `questions.<index>.contextUrl` in the single-question case. Keep all other context/media validation intact.

### NC-FS-5 - Focused root Node test command can false-fail package-local Next.js tests

`.github/pull_request_template.md:19` recommends focused root runs with `node scripts/run-node-tests.mjs ...`. Some Next.js tests assume the package cwd. For example:

```text
node scripts/run-node-tests.mjs packages/nextjs/e2e/playwright.config.test.ts
```

failed with 9 test failures from the repo root, including missing `e2e/tests`, missing `../../.github/workflows/e2e.yaml`, and a wrong Playwright artifact path of `/Users/david/Documents/source/RateLoop/e2e/test-results`.

The same suite passes when run through the package test command because it executes in the expected workspace context.

Impact: reviewers following the template can get false negatives on focused Next.js tests, or skip focused coverage because the documented command looks broken.

Suggested fix: update `scripts/run-node-tests.mjs` to group files by nearest workspace cwd, add a package-local wrapper for focused Next tests, or adjust the PR template to show the workspace-local command for package-scoped tests.

### NC-FS-6 - Promo video offline voiceover fallback has stale narration

`packages/promo-video/public/audio/README.md:3` says committed `vo-*.m4a` assets are generated by `scripts/generate-openai-voiceover.mjs`, while `packages/promo-video/scripts/generate-voiceover.zsh` remains as an offline fallback. The fallback transcript differs materially from the OpenAI source:

- `generate-openai-voiceover.mjs:52` says the idea becomes one focused question backed by a USDC bounty, while `generate-voiceover.zsh:32` says "one sharp RateLoop question, with real money attached and the right people ready to answer."
- `generate-openai-voiceover.mjs:56` includes public or confidential handoff, while `generate-voiceover.zsh:35` only mentions approving the bounty.
- `generate-openai-voiceover.mjs:64` says "People and agents rate it blind", while `generate-voiceover.zsh:38` says "Verified humans rate it blind."
- `generate-openai-voiceover.mjs:68` has a shorter settlement line, while `generate-voiceover.zsh:41` still says the score settles on-chain so the agent can cite it.

Impact: regenerating audio offline can silently drift promo assets away from the current product message and captions.

Suggested fix: update the fallback script to use the same clip text as `generate-openai-voiceover.mjs`, or remove the fallback and add a small consistency test for voiceover source text.

## Rechecked Prior Items

- The governance composer now resolves `ClusterPayoutOracleAbi` for `setOracleTimingConfig`, and the targeted composer regression exists.
- Ponder correlation finality now filters finalized epoch rows past veto, includes source-ready phases, and `/keeper/work` returns `health.correlationFinality`.
- Agent question lint now rejects parser-rejected numeric, `roundPreset`, `targetAudience`, and excessive `imageUrls` shapes.
- Keeper correlation finality backlog gauges are populated from the Ponder SLA payload.
- Whitepaper/governance veto wording now matches the finalization veto behavior.
- `CorrelationSnapshotMetricsResult` is module-local and `yarn dead-code` is clean.

## Verification

Passed:

- `yarn workspace @rateloop/node-utils test` - 50 passed.
- `yarn workspace @rateloop/sdk test` - 57 passed.
- `yarn workspace @rateloop/agents test` - 151 passed.
- `yarn workspace @rateloop/keeper test` - 550 passed, 2 skipped.
- `yarn workspace @rateloop/ponder test` - 417 passed, 1 skipped.
- `yarn workspace @rateloop/nextjs test` - 1845 passed.
- `yarn workspace @rateloop/node-utils check-types`.
- `yarn workspace @rateloop/sdk check-types`.
- `yarn workspace @rateloop/agents check-types`.
- `yarn workspace @rateloop/keeper check-types`.
- `yarn workspace @rateloop/ponder check-types`.
- `yarn workspace @rateloop/nextjs check-types`.
- `yarn workspace @rateloop/nextjs lint`.
- `node scripts/run-node-tests.mjs scripts` - 128 passed.
- `yarn dead-code`.
- `yarn npm audit --recursive --environment production` - no audit suggestions.
- `yarn npm audit --recursive --environment development` - no audit suggestions.

Expected/focused failures reproduced:

- `node scripts/check-base-sepolia-readiness.mjs --require-one-shot-feedback-bonus-x402 --json` fails because the checked-in Base Sepolia submitter is the known stale staging submitter.
- `node scripts/run-node-tests.mjs packages/nextjs/e2e/playwright.config.test.ts` fails from the repo root because that package-local test assumes the `packages/nextjs` cwd.

Not run:

- Foundry/Solidity tests and smart-contract review.
- Full Playwright browser E2E/local dev-stack.
- Live Vercel/Railway/Base Sepolia probes.

