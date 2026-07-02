# Non-Contract Review Post-Remediation - 2026-07-02

Scope: reviewed current `main` at `5d77c557ed657f59aa08d1d675afaf75027db8e2` after the prior non-contract findings were remediated. Solidity contracts, Foundry tests, and contract implementation review were excluded. TypeScript ABI/package metadata was inspected where it is consumed by the non-contract app.

Three read-only explorer agents checked separate slices:

- Next.js app and public docs.
- Agents, SDK, and node utilities.
- Ponder, keeper, scripts/config/workflows, and non-contract docs.

## Findings

| ID | Severity | Status | Summary |
| --- | --- | --- | --- |
| NC-PR-1 | High | Open | Governance UI exposes oracle timing proposals that current deployed metadata cannot encode. |
| NC-PR-2 | High | Open | Finalized correlation epochs can keep `/health/indexer` degraded forever. |
| NC-PR-3 | Medium | Open | `lint:questions` still accepts parser-rejected ask shapes. |
| NC-PR-4 | Medium | Open | Keeper correlation finality backlog gauges are advertised but never populated. |
| NC-PR-5 | Low | Open | Whitepaper generator has stale consumed-root veto wording. |
| NC-PR-6 | Low | Open | Dead-code scan reports an unused exported keeper metrics type. |

### NC-PR-1 - Governance UI exposes oracle timing proposals that current deployed metadata cannot encode

`packages/nextjs/components/governance/GovernanceActionComposer.tsx:557` defines the "Set oracle timing" action as `ClusterPayoutOracle.setOracleTimingConfig`, and proposal submission encodes the calldata with `targetContract.abi` at `packages/nextjs/components/governance/GovernanceActionComposer.tsx:1205`.

The runtime contract declarations come from `@rateloop/contracts` deployed metadata, and the only local ABI override in `packages/nextjs/utils/scaffold-eth/contract.ts:49` refreshes `RoundVotingEngine`, not `ClusterPayoutOracle`. The standalone ABI export contains `setOracleTimingConfig`, but `packages/contracts/src/deployedContracts.ts` contains five `setOracleConfig` entries and no `setOracleTimingConfig` entry. A direct check confirmed:

```text
setOracleTimingConfig in deployedContracts: false
setOracleConfig count: 5
ClusterPayoutOracleAbi setOracleTimingConfig export: true
```

Impact: users can fill the governance action, but proposal creation can fail client-side before the transaction is built. This is especially risky because the current launch UX relies on configurable challenge and finalization-veto timing.

Suggested fix: regenerate fresh deployed metadata for the redeploy, or add a `ClusterPayoutOracle` ABI override that uses `ClusterPayoutOracleAbi` until deployed metadata is regenerated. Add a composer regression that resolves the contract info and verifies `encodeFunctionData` succeeds for every proposal template.

### NC-PR-2 - Finalized correlation epochs can keep `/health/indexer` degraded forever

`packages/ponder/src/api/correlation-finality-sla.ts:100` classifies finalized rows after `vetoEndsAt` as `ready_for_consumer` when `consumedAt` is null, and that phase is a normal-path SLA state. Round payout rows can leave the sample once consumed because `roundPayoutSnapshot` has `consumedAt`, but `correlationEpochSnapshot` in `packages/ponder/ponder.schema.ts:497` has no consumed marker. The epoch query at `packages/ponder/src/api/correlation-finality-sla.ts:425` loads all finalized epoch rows, and `/health/indexer` maps `correlationFinality.status === "degraded"` to top-level degraded at `packages/ponder/src/api/index.ts:173`.

Impact: once any finalized correlation epoch is older than the one-hour normal-path SLA, the indexer health endpoint can report degraded forever even when all child payout snapshots were already finalized, consumed, and applied. That creates false readiness/production alerts and can hide the actual backlog state.

Suggested fix: do not treat finalized correlation epochs past veto as consumer backlog unless there is a concrete unconsumed child/source state tied to that epoch, or add an epoch-level completion marker. Add a regression where a finalized epoch past veto with no pending child snapshots does not degrade `/correlation/finality-sla` or `/health/indexer`.

### NC-PR-3 - `lint:questions` still accepts parser-rejected ask shapes

The lint path is still looser than the canonical parser:

- `packages/agents/src/questions/lint.ts:313` treats non-numeric bounded integer fields as non-errors, and `packages/agents/src/__tests__/lint.test.ts:854` explicitly expects non-numeric voter values to lint as OK. The parser rejects these through `parseNonNegativeInteger` at `packages/agents/src/x402QuestionPayload.ts:1013`.
- `packages/agents/src/questions/lint.ts:626` validates that `imageUrls` are RateLoop upload URLs but does not enforce the four-image limit documented in `packages/agents/README.md:278` and enforced in `packages/agents/src/x402QuestionPayload.ts:615`.
- `roundPreset` and `targetAudience` are documented in `packages/agents/README.md:284` but are only fully enforced by parser paths such as `packages/agents/src/x402QuestionPayload.ts:944` and `packages/agents/src/x402QuestionPayload.ts:1107`.

Reproduction: a throwaway valid ask wrapper with five valid-looking RateLoop upload URLs and `roundConfig.minVoters: "not-a-number"` returned:

```json
{
  "findings": [],
  "errorCount": 0,
  "ok": true,
  "warningCount": 0
}
```

Impact: the documented pre-submit safety gate can say `ok: true`, then the same ask fails later during quote, browser handoff, or submission. That hurts the agent UX without changing protocol decentralization.

Suggested fix: make lint call the same normalizers where possible, or mirror the parser checks for numeric round config fields, `roundPreset`, structured `targetAudience`, and max four images. Flip the non-numeric lint test to expect an error.

### NC-PR-4 - Keeper correlation finality backlog gauges are advertised but never populated

`packages/keeper/src/metrics.ts:71` initializes these gauges to `-1`:

- `keeper_correlation_source_ready_backlog_oldest_seconds`
- `keeper_correlation_epoch_finalization_backlog_oldest_seconds`
- `keeper_round_payout_finalization_backlog_oldest_seconds`
- `keeper_round_payout_apply_backlog_oldest_seconds`

The Prometheus HELP text advertises them at `packages/keeper/src/metrics.ts:260`, and the one-hour finality plan lists them at `docs/one-hour-payout-finality-plan-2026-07-02.md:107`. However, `recordCorrelationSnapshotResult` only increments counters, and the only work-discovery gauge updates in `packages/keeper/src/keeper.ts:578` cover generic discovery and settlement backlog metrics, not the correlation finality gauges.

Impact: alerting wired to these metrics will see "none" forever, even when correlation sources or round payout snapshots are delayed. This weakens the one-hour payout-finality operational posture.

Suggested fix: populate the gauges from the same Ponder SLA/backlog data used by proposal/finalization/apply work, or remove them from the advertised launch metric set until they are real. Add metrics tests that set non-empty correlation backlog inputs and assert non-`-1` output.

### NC-PR-5 - Whitepaper generator has stale consumed-root veto wording

`packages/nextjs/scripts/whitepaper/sections.ts:638` says that once an escrow or launch consumer has consumed a finalized payout root, the root "cannot be rejected through the veto path." Current public docs say the opposite launch behavior: `packages/nextjs/app/(public)/docs/governance/page.tsx:137` and `packages/nextjs/public/docs/how-it-works.md:150` both state that governance can still reject a finalized root during the finalization veto window even after consumption, and that consumed roots only pin after the veto window.

Impact: generated whitepaper output can contradict the app docs and the current redeploy runbook for the same trust-model question.

Suggested fix: update the whitepaper paragraph to match the public docs, and add/extend a whitepaper content test for within-window consumed-root rejection and post-window pinning.

### NC-PR-6 - Dead-code scan reports an unused exported keeper metrics type

`yarn dead-code` passed but reported one unused exported type:

```text
Unused exported types (1)
CorrelationSnapshotMetricsResult  interface  packages/keeper/src/metrics.ts:103:18
```

Impact: low. This is not a runtime issue, but it is a stale public export in a package where metrics shape drift has already caused observability inconsistencies.

Suggested fix: make `CorrelationSnapshotMetricsResult` module-local unless external consumers need it.

## Non-Findings / Checked Notes

- The `advanceToRevealFailedFinalizationWindow` E2E helper multiplies `revealGracePeriod` by `24`; this matches keeper logic and the on-chain reveal-failed grace multiplier comments/tests, so it was not treated as a bug.
- The prior mixed-asset Feedback Bonus and handoff tag-validation fixes stayed covered by the agents and Next.js suites.
- Historical audit documents still contain superseded pre-remediation context, but several include explicit status notes. I did not count archived audit narrative as active public-product copy unless it is generated or surfaced as current docs.

## Verification

Passed:

- `yarn workspace @rateloop/node-utils test` - 50 passed.
- `yarn workspace @rateloop/sdk test` - 57 passed.
- `yarn workspace @rateloop/agents test` - 147 passed.
- `yarn workspace @rateloop/keeper test` - 549 passed, 2 skipped.
- `yarn workspace @rateloop/ponder test` - 417 passed, 1 skipped.
- `yarn workspace @rateloop/nextjs test` - 1844 passed.
- `yarn workspace @rateloop/node-utils check-types`.
- `yarn workspace @rateloop/sdk check-types`.
- `yarn workspace @rateloop/agents check-types`.
- `yarn workspace @rateloop/keeper check-types`.
- `yarn workspace @rateloop/ponder check-types`.
- `yarn workspace @rateloop/nextjs check-types`.
- `yarn dead-code` completed and reported NC-PR-6.

Targeted reproductions/checks:

- Verified `deployedContracts.ts` lacks `setOracleTimingConfig` while `ClusterPayoutOracleAbi.ts` contains it.
- Ran `@rateloop/agents lint:questions` against a throwaway ask with non-numeric `roundConfig.minVoters` and five valid-looking uploaded `imageUrls`; lint returned `ok: true`.

Not run:

- Full Playwright/local dev-stack E2E, live deployment/Railway/Vercel checks, Foundry/Solidity tests, and smart-contract review.
