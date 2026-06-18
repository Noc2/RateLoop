# RateLoop Repo Re-Audit - Bugs & Inconsistencies (18 June 2026, post-remediation recheck)

Read-only re-audit of the RateLoop monorepo at HEAD `f87357bf`
(`Make legacy Sepolia readiness manual`). Application code was not changed for
this audit; this document is the only intended repository change.

Scope: bugs, inconsistencies, stale Base rollout surfaces, path-prefix support,
readiness checks, public/docs copy drift, and contract/governance regressions.

Three explorer agents reviewed independent slices in parallel:

- Solidity/foundry governance, oracle, rewards, and deployment-artifact wiring
- Keeper/Ponder/readiness/dev-stack/env wiring and path-prefix behavior
- Next.js frontend/docs/legal/SDK/agents/E2E copy and flow regressions

Load-bearing findings below were re-checked in the main workspace against
source and command output. The audit also applied the repository `AGENTS.md`
guidance: Base Sepolia is the next live rollout gate, Base mainnet remains
gated until deliberate promotion, and optimistic oracle challenge-bond /
reveal-grace parameters were not treated as findings.

## TL;DR

No new High-severity contract or fund-loss issue was confirmed.

The strongest confirmed issues are:

1. Existing `FeedbackBonusEscrow` pools depend on the mutable global
   `feedbackRegistry` at award time, while pool storage snapshots only the rater
   registry. A registry rotation or bad replacement registry can make old pools
   unawardable or weaken feedback-timeliness validation.
2. Ponder's recovery monitor still overwrites the configured status URL path
   with `/status`, dropping path prefixes even though recent fixes preserved
   Ponder prefixes in other clients.
3. Public SDK docs still describe Base mainnet `8453` as "production mainnet"
   while the repo's production env and readiness gates still target Base Sepolia
   and Base mainnet intentionally lacks `packages/foundry/deployments/8453.json`.

Base Sepolia offline readiness remains green. Base mainnet remains
intentionally blocked until `packages/foundry/deployments/8453.json` exists.

## Verification Snapshot

| Check | Result |
| --- | --- |
| `node scripts/check-base-sepolia-readiness.mjs --json` | Pass |
| `node scripts/check-base-mainnet-readiness.mjs --json` | Expected fail: missing `packages/foundry/deployments/8453.json` |
| `node scripts/run-node-tests.mjs scripts/check-worldchain-sepolia-readiness.test.mjs scripts/check-worldchain-mainnet-readiness.test.mjs scripts/readiness-workflows.test.mjs` | Pass, 39 tests |
| `node ../../scripts/run-node-tests.mjs e2e/helpers/service-urls.test.ts 'app/(public)/page.test.tsx' 'app/(public)/legal/terms/page.test.tsx' components/docs/ProtocolPiecesDiagram.test.tsx components/shared/VotingQuestionCard.test.ts lib/docs/whitepaperContent.test.ts` from `packages/nextjs` | Pass, 18 tests |
| `yarn workspace @rateloop/keeper test src/__tests__/correlation-artifact-builder.test.ts src/__tests__/ponder-url.test.ts` | Pass, 17 tests |
| Frontend/docs explorer | `yarn workspace @rateloop/nextjs check-types` passed; World Chain Sepolia readiness passed; legacy World Chain mainnet production check failed as expected because production env targets Base Sepolia |
| Keeper/Ponder explorer | Dev-stack node tests passed; targeted Keeper config/correlation tests passed; targeted Ponder config/recovery tests passed |
| Contracts explorer | Base Sepolia readiness passed; Solidity/governance/reward surfaces reviewed read-only. Forge build/size/storage commands were not run in that explorer because they can update local build artifacts |

## High

None confirmed.

## Medium

### M1 - Feedback bonus pools use a mutable, weakly validated feedback registry

**Severity:** Medium (funded pools can become unawardable after registry
rotation, and a bad replacement can weaken feedback-timeliness validation)

`packages/foundry/contracts/FeedbackBonusEscrow.sol:42-58` defines
`FeedbackBonusPool` with a `raterRegistrySnapshot`, but no
`feedbackRegistrySnapshot`. Pool creation stores the rater-registry snapshot at
`packages/foundry/contracts/FeedbackBonusEscrow.sol:282-299`.

Awards read the current global registry at
`packages/foundry/contracts/FeedbackBonusEscrow.sol:336-339`:

```solidity
uint256 feedbackPublishedAt =
    feedbackRegistry.awardableFeedbackPublishedAt(pool.contentId, pool.roundId, commitKey, feedbackHash);
```

Governance can rotate that global registry through
`packages/foundry/contracts/FeedbackBonusEscrow.sol:434-435`, and validation in
`packages/foundry/contracts/FeedbackBonusEscrow.sol:488-491` only checks for a
nonzero code address. The interface at
`packages/foundry/contracts/interfaces/IFeedbackRegistry.sol:4-12` exposes no
shape method or pinned voting-engine check.

There is existing coverage for `ContentRegistry` voting-engine rotation at
`packages/foundry/test/FeedbackBonusEscrow.t.sol:329-349`, but that test keeps
the escrow's global `feedbackRegistry` unchanged. It does not cover
`setFeedbackRegistry` with old funded pools.

**Impact:** a governance runbook mistake can point the escrow at a replacement
registry that has no old feedback records, bricking awards from existing funded
pools. A malicious or incompatible registry can also fabricate
`awardableFeedbackPublishedAt` and weaken the "timely published feedback"
invariant.

**Suggested fix/test:** snapshot the feedback registry per pool and use that
snapshot for awards, or make registry rotation explicitly future-pool-only with
protections for existing pools. Add validation that the replacement registry is
bound to the expected voting engine, if the registry exposes that shape. Add
tests that old pools remain awardable after registry rotation and that
mismatched/fake feedback registries are rejected.

### M2 - Ponder recovery status polling drops path prefixes

**Severity:** Medium (path-mounted Ponder recovery can poll the wrong endpoint
and miss stuck shutdown recovery)

`packages/ponder/scripts/devWithRecovery.mjs:82-89` builds the status URL from
`PONDER_STATUS_URL`, `NEXT_PUBLIC_PONDER_URL`, or the default URL, then forces:

```js
url.pathname = "/status";
```

For `NEXT_PUBLIC_PONDER_URL=http://127.0.0.1:42069/ponder`, the recovery
monitor polls `http://127.0.0.1:42069/status` instead of
`http://127.0.0.1:42069/ponder/status`. The same overwrite also makes an
explicit `PONDER_STATUS_URL=http://127.0.0.1:42069/ponder/status` non-exact.

The existing recovery tests exercise shutdown detection and `/status` matching
at `packages/ponder/scripts/devWithRecovery.test.ts:67-88`, but they do not
cover prefixed status URLs.

**Impact:** if local or routed Ponder is exposed under a path prefix, the
recovery monitor can probe the wrong service and fail to reset a stuck
`ShutdownError` state. This is inconsistent with the recent path-prefix fixes
in E2E, readiness, and Keeper Ponder helpers.

**Suggested fix/test:** preserve any configured base path when appending
`status`. Treat explicit `PONDER_STATUS_URL` as exact, or document that it is a
base URL and append path-preservingly. Add tests for prefixed
`NEXT_PUBLIC_PONDER_URL` and prefixed `PONDER_STATUS_URL`.

### M3 - SDK docs prematurely frame Base mainnet as production-ready

**Severity:** Medium (copy/paste integration guidance can send users to an
unsupported network before promotion)

`packages/nextjs/app/(public)/docs/sdk/page.tsx:19` and
`packages/nextjs/app/(public)/docs/sdk/page.tsx:47` comment that examples use
Base Sepolia `84532` and "Production mainnet is 8453." The explanatory copy at
`packages/nextjs/app/(public)/docs/sdk/page.tsx:176-177` repeats that examples
use Base Sepolia and "production mainnet is 8453."

That is ahead of the repo's rollout state: `.env.production` targets Base
Sepolia, `node scripts/check-base-sepolia-readiness.mjs --json` passes, and
`node scripts/check-base-mainnet-readiness.mjs --json` fails closed because
`packages/foundry/deployments/8453.json` does not exist.

**Impact:** public SDK readers can target Base mainnet for production flows even
though the repo has not intentionally promoted a Base mainnet deployment.

**Suggested fix/test:** mirror the safer `packages/sdk/README.md` wording:
`8453` is Base mainnet after intentional promotion, while current examples use
Base Sepolia. Add a docs test or stale-copy guard for "Production mainnet is
8453" / "production mainnet is 8453".

## Low

### L1 - Failed pending-rating settlement side effects have no replay path

**Severity:** Low (a transient side-effect failure can permanently skip the
visible rating review source for a round)

`packages/foundry/contracts/RoundVotingEngine.sol:1079-1086` calls
`RoundSettlementSideEffectsLib.recordSettlement` after settlement. The library
intentionally catches failures from
`registry.recordPendingRatingSettlement(...)` and only emits
`SettlementSideEffectFailed` at
`packages/foundry/contracts/libraries/RoundSettlementSideEffectsLib.sol:28-32`.

If that call fails, `ContentRegistry.pendingRatingSettlement[contentId][roundId]`
is never stored. `packages/foundry/contracts/ContentRegistry.sol:1417-1424`
then returns the source readiness from the missing pending settlement, and the
source readiness is zero. Existing tests at
`packages/foundry/test/RoundIntegration.t.sol:2833-2870` assert settlement still
succeeds and the failure event is emitted, but do not cover any later replay.

**Impact:** after a transient registry/config/rotation failure, the round can be
settled but the public rating review source never becomes ready, so the
cluster-adjusted visible rating update can be skipped.

**Suggested fix/test:** persist enough failed side-effect data for a safe retry,
or expose a permissionless replay path from the engine. Test a forced
`recordPendingRatingSettlement` revert, clear the failure, retry, and assert
`RatingReviewPending` plus nonzero `roundPayoutSnapshotSourceReadyAt`.

### L2 - Keeper optional live-contract fallback is looser than the shared-artifact policy

**Severity:** Low (future partial live artifacts can let optional Keeper
addresses diverge from Ponder/frontend/readiness)

`packages/keeper/src/config.ts:278-318` resolves optional contract addresses by
accepting an env value whenever it is syntactically valid. If a shared artifact
exists and conflicts, `rejectLiveMismatch: true` rejects on non-local chains.
But if no shared artifact exists, the env value is still accepted.

The optional live addresses for `CLUSTER_PAYOUT_ORACLE_ADDRESS` and
`FEEDBACK_BONUS_ESCROW_ADDRESS` use that resolver at
`packages/keeper/src/config.ts:537-551`.

**Impact:** Base Sepolia is currently protected because shared artifacts exist
and mismatches are rejected. A future partial artifact or promotion path could
still run Keeper against env-only optional live contracts while
Ponder/frontend/readiness resolve shared artifacts, violating the Base rollout
policy that live service addresses should come from `@rateloop/contracts`
artifacts.

**Suggested fix/test:** for non-local chains, require shared artifacts for these
deployment-bound optional contracts when the related feature is enabled, and
only allow env values that match. Add config tests for absent shared optional
contracts plus env overrides on `84532`.

### L3 - E2E Keeper health probes strip path prefixes

**Severity:** Low (settlement-Keeper E2E checks can probe the wrong endpoint if
the Keeper service is path-mounted)

`packages/nextjs/e2e/helpers/service-urls.ts:13-15` defines:

```ts
export const E2E_KEEPER_HEALTH_URL = new URL("/health", E2E_KEEPER_URL).toString();
```

`packages/nextjs/e2e/scripts/preflight.mjs:35-39` repeats the same root-absolute
construction for `REQUIRE_E2E_KEEPER=1`.

The same E2E area already has a path-preserving helper at
`packages/nextjs/e2e/service-url.mjs:1-4`, and Ponder preflights now use it.

**Impact:** `E2E_KEEPER_URL=https://example.test/keeper` resolves to
`https://example.test/health` instead of `https://example.test/keeper/health`.
That can false-fail or false-pass settlement-Keeper E2E preflight checks.

**Suggested fix/test:** use `buildE2EServiceUrl(E2E_KEEPER_URL, "/health")` in
both places and add a helper test for prefixed Keeper URLs.

### L4 - Stale World Chain / World ID copy remains in secondary docs

**Severity:** Low (docs drift against the Base-first rollout and
optional-credential model)

The main public copy was refreshed, but several secondary docs still carry
World Chain era assumptions:

- `packages/nextjs/scripts/whitepaper/sections.ts:653-654` says governance
  delay/period are based on "the 2s World Chain clock".
- `docs/use-cases-2026-06.md:171` says the "World App rater base" remains the
  structural cap.
- `docs/use-cases-2026-06.md:189` frames the crowd as "World ID-gated".
- `docs/agent-to-agent-acceptance-oracle-2026-06.md:208` says "World Chain
  ~2s blocks" in the mainnet-ready epoch-floor rationale.

**Impact:** these docs contradict the Base Sepolia-first rollout and the
optional credential model, and can reintroduce stale launch assumptions during
strategy or public-doc refreshes.

**Suggested fix/test:** make the generated whitepaper clock language
chain-neutral or Base-specific, and reframe strategy docs around optional World
ID credentialing plus Base-compatible rater acquisition. Add stale-copy guards
for `World Chain clock`, `World App rater base`, `World ID-gated`, and `World
Chain ~2s blocks` in active docs.

## Checked But Not Findings

- Base mainnet readiness failing without `packages/foundry/deployments/8453.json`
  is expected and desirable until intentional promotion.
- Legacy World Chain readiness/tests still exist and pass/fail according to the
  manual legacy gate design; they were not treated as live rollout blockers.
- Historical audit documents still contain older World Chain wording; those
  archival references were ignored when searching for stale active copy.
- `ClusterPayoutOracle` challenge bonds and the 60-minute reveal grace period
  were not flagged, per the repository trust-model notes.
