# Non-Contract Current-Head Bug And Consistency Review - 2026-07-02

Pre-report head reviewed: `1827f9196` on `main`.

Scope: non-Solidity application code, agents package, SDK/node utilities, keeper, Ponder, repository scripts, workflows, docs, package metadata, tests, and static/generated assets. Smart contracts, Solidity implementation review, Foundry contract tests, and contract security findings were excluded. TypeScript contract metadata was considered only where non-contract tooling consumes it.

Three read-only agents checked separate slices in parallel:

- Ponder, keeper, workflows, and observability: found the remaining correlation-finality sample cap issue and the missing RBTS settlement payout-consumer readiness check.
- Agents, SDK, local signer, and browser handoff flows: confirmed the mixed-asset signer/tag-copy follow-up items are fixed, and found a Feedback Bonus browser-handoff retry gap.
- Next.js app/API/components/docs/static assets: found stale USDC-only copy on generic product and promo surfaces.

## Summary

| ID | Severity | Status | Finding |
| --- | --- | --- | --- |
| NC-CH-1 | Medium | Open | Ponder's correlation finality SLA can still hide normal-path breaches behind the shared 1,000-row attention-state sample cap. |
| NC-CH-2 | Medium | Open | Live readiness never validates the RBTS settlement payout consumer for payout domain 5. |
| NC-CH-3 | Medium | Open | Browser handoff has no safe retry path when Feedback Bonus confirmation fails after wallet calls are broadcast. |
| NC-CH-4 | Low | Open | Generic public, docs, and promo copy still frames RateLoop as USDC-only in several high-visibility places. |

## Findings

### NC-CH-1 - Correlation finality SLA can still hide normal-path breaches

The current `/correlation/finality-sla` builder fixed the earlier consumed-row and source-ready blind spots: finalized round rows with `consumedAt` now return `null`, and source-ready unproposed work is summarized in `source_ready_unproposed` buckets.

The remaining issue is that `roundPayoutSnapshot` and `correlationEpochSnapshot` are each loaded through one status-mixed query capped at `SLA_ROW_LIMIT` (`1,000`). Challenged and rejected rows are non-normal-path attention rows, but they share the same capped sample as proposed and finalized/unconsumed normal-path rows. Because the query orders by `updatedAt`, a deployment with more than 1,000 older challenged/rejected rows in a snapshot table can exclude newer proposed or ready-for-consumer rows from the sample. In that case the endpoint can return `attention` with no `degraded` breach even though a normal-path payout-finality breach exists outside the sample.

Impact: `/correlation/finality-sla`, `/health/indexer`, and keeper metrics that consume the SLA payload can under-report a one-hour normal-path breach after enough attention-state history accumulates.

Evidence:

- `packages/ponder/src/api/correlation-finality-sla.ts:80` and `:88` classify challenged and rejected snapshots as `normalPath: false`.
- `packages/ponder/src/api/correlation-finality-sla.ts:139` records normal-path breaches only for rows that were included in the sampled input.
- `packages/ponder/src/api/correlation-finality-sla.ts:409` through `:451` load round and epoch rows with shared status filters, `updatedAt` ordering, and `limit(SLA_ROW_LIMIT)`.
- `packages/ponder/src/api/correlation-finality-sla.ts:477` through `:483` returns `degraded` only when sampled normal breaches are present, otherwise falls back to `attention` for sampled disputed/rejected rows.

Suggested fix:

1. Split finality SLA loading into separate bounded queries or aggregates for normal-path backlog and attention states.
2. Compute the normal-path breach count from active proposed/finalized/source-ready work independently of rejected/challenged history.
3. Keep challenged/rejected states visible as `attention`, but do not let them consume the only sample used to determine `degraded`.
4. Add a regression with more than 1,000 older rejected/challenged rows plus a newer breached proposed/finalized row.

### NC-CH-2 - Readiness misses the RBTS settlement payout consumer

The non-contract readiness script validates `ClusterPayoutOracle` consumer wiring for domains 1 through 4, but the runtime payout-domain set now includes domain 5 for RBTS settlement. The keeper has a finalized RBTS settlement snapshot applier for domain 5, and Ponder exposes RBTS settlement candidates, but live readiness never asks `ClusterPayoutOracle.consumer(5)` to confirm it points at `RoundVotingEngine`.

Impact: Base Sepolia or Base mainnet live readiness can pass even if the domain-5 RBTS settlement payout consumer is unset or points to the wrong contract. That would leave a settlement path unchecked at launch.

Evidence:

- `packages/node-utils/src/correlationScoring.ts:12` through `:16` define payout domains 1 through 5, including `PAYOUT_DOMAIN_RBTS_SETTLEMENT = 5`.
- `packages/keeper/src/correlation-snapshots.ts:919` through `:937` apply finalized RBTS settlement snapshots for domain 5.
- `scripts/readiness-core.mjs:397` through `:418` define `REQUIRED_CLUSTER_PAYOUT_ORACLE_CONSUMERS` with only domains 1, 2, 3, and 4.
- `scripts/readiness-core.mjs:1133` through `:1152` live-validate only that list.
- `scripts/check-worldchain-sepolia-readiness.test.mjs:265` through `:278` locks in the stale domain list.

Suggested fix:

1. Add domain `5` to `REQUIRED_CLUSTER_PAYOUT_ORACLE_CONSUMERS`.
2. Set `expectedContractName` to `RoundVotingEngine` and label it as the RBTS settlement consumer.
3. Update readiness mocks and tests to expect domains `[1, 2, 3, 4, 5]`.
4. Add a negative live-readiness unit test proving a wrong domain-5 consumer fails the check.

### NC-CH-3 - Browser handoff lacks Feedback Bonus confirmation recovery

The browser handoff flow now supports mixed-asset Feedback Bonus wallet-call plans, but the post-ask bonus confirmation path does not preserve the submitted bonus transaction hashes before confirmation succeeds. If wallet calls broadcast successfully and `/complete-feedback-bonus` fails due to a transient network, receipt, MCP, or server error, the browser only shows an error. The handoff remains a submitted terminal ask, and there is no stored-hash retry action equivalent to the main ask completion path.

Impact: a user can pay for the Feedback Bonus transactions, then lose the browser-handoff path for attaching the funded pool unless they manually recover hashes and call a lower-level confirmation route. This is a UX and recovery bug, not a custody loss if the transactions can still be confirmed by another path.

Evidence:

- `packages/nextjs/components/agent/AgentAskHandoffPage.tsx:3080` through `:3095` executes the Feedback Bonus transaction plan and then posts hashes to `/complete-feedback-bonus`.
- `packages/nextjs/components/agent/AgentAskHandoffPage.tsx:3108` through `:3111` only stores a visible error if the bonus confirmation fails.
- `packages/nextjs/app/api/agent/handoffs/[handoffId]/complete-feedback-bonus/route.ts:47` through `:60` confirms the bonus but does not persist the submitted hashes or a retry state before confirmation succeeds.
- `packages/nextjs/components/agent/AgentAskHandoffPage.tsx:2182` treats `submitted` handoffs as terminal.
- `packages/nextjs/lib/agent/handoffs.ts:973` through `:975` already has a stored-hash retry message for the main ask completion path, but no equivalent for the Feedback Bonus follow-up.
- `packages/nextjs/lib/x402/questionSubmission.ts:3325` through `:3329` stores the confirmed Feedback Bonus pool only after successful confirmation.

Suggested fix:

1. Persist Feedback Bonus transaction hashes and confirmation status on the handoff as soon as the browser receives hashes from wallet calls.
2. Add a retry `nextAction` for bonus confirmation that uses stored hashes and never rebroadcasts wallet calls.
3. Let the submitted handoff page retry `/complete-feedback-bonus` when a pending or failed bonus confirmation has stored hashes.
4. Add route/component tests covering a failed first confirmation followed by a stored-hash retry.

### NC-CH-4 - Generic copy still frames RateLoop as USDC-only

The protocol now supports LREP or USDC bounties and LREP or USDC Feedback Bonuses through wallet-call paths, while EIP-3009/x402 remains USDC-only. Several high-visibility generic surfaces still say raters earn USDC or that generic asks are backed by a USDC bounty. That wording is correct only for USDC-specific paths, not for the product as a whole.

Impact: first-viewport, SEO, docs, and promo media can steer users and agents toward USDC-only assumptions even though wallet-call asks support LREP and USDC.

Evidence:

- `packages/nextjs/app/layout.tsx:8` through `:11` metadata says raters "earn USDC".
- `packages/nextjs/app/(public)/page.tsx:200` through `:202` homepage hero copy says "earn USDC".
- `packages/nextjs/app/(public)/docs/page.tsx:35` through `:42` repeats "earn USDC" before describing LREP or USDC bounties.
- `packages/nextjs/app/(public)/docs/ai/page.tsx:161` through `:164` says agents fund open raters with USDC, while that page metadata at `:151` through `:152` already says LREP or USDC.
- `packages/nextjs/public/videos/rateloop-promo.vtt:12` and `:16` describe a generic question and handoff as USDC bounty approval.
- `packages/promo-video/scripts/voiceover-clips.mjs:10` and `:14` share the same USDC-only narration source.

Suggested fix:

1. Update generic product copy to say "LREP or USDC", "funded bounties", or "USDC and LREP" depending on the sentence.
2. Keep USDC-only wording in x402/EIP-3009-specific sections.
3. Update `voiceover-clips.mjs` and the VTT together, then regenerate any derived promo audio/caption artifacts.
4. Refresh tests that intentionally assert the old generic "earn USDC" tagline.

## Rechecked Prior Items

| Prior ID | Current status | Notes |
| --- | --- | --- |
| NC-FU-1 | Partially fixed | Consumed finalized rows and source-ready unproposed work are fixed; the remaining sample-cap variant is carried forward as NC-CH-1. |
| NC-FU-2 | Fixed | `/health/indexer` now maps nested `correlationFinality.status === "attention"` to top-level `attention`, with regression coverage. |
| NC-FU-3 | Fixed | Local signer and docs now support mixed-asset Feedback Bonus wallet-call plans. |
| NC-FU-4 | Fixed | Browser handoff validation now says "one to three tags". |

## Non-Findings And Notes

- The current review did not find evidence that the old mixed-asset local signer limitation still applies.
- The current review did not find evidence that browser handoff tag validation still says "categories".
- Historical audit documents may still contain older open statuses by design. Findings above are based on current code at `1827f9196`, not on stale report text.

## Verification

Passed:

- `yarn workspace @rateloop/agents test` - 155 passed.
- `yarn workspace @rateloop/sdk test` - 57 passed.
- `yarn workspace @rateloop/node-utils test` - 50 passed.
- `yarn workspace @rateloop/keeper test` - 551 passed, 2 skipped.
- `yarn workspace @rateloop/ponder test` - 417 passed, 1 skipped.
- `yarn workspace @rateloop/nextjs test` - 1845 passed.
- `node scripts/run-node-tests.mjs scripts` - 128 passed.
- `node scripts/check-base-sepolia-readiness.mjs` - passed offline readiness with the expected known stale staging submitter warning.
- `yarn workspace @rateloop/nextjs check-types`.
- `yarn workspace @rateloop/agents check-types`.
- `yarn workspace @rateloop/sdk check-types`.
- `yarn workspace @rateloop/keeper check-types`.
- `yarn workspace @rateloop/ponder check-types`.
- `yarn workspace @rateloop/node-utils check-types`.
- `yarn workspace @rateloop/promo-video check-types`.
- `yarn workspace @rateloop/nextjs lint`.
- `yarn dead-code`.

Not run:

- Foundry/Solidity tests and smart-contract review, because smart contracts were explicitly out of scope.
- Full local Docker/dev-stack Playwright E2E.
- Live external readiness probes.
