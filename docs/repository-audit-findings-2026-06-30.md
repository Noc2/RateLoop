# Repository Inconsistency and Bug Review - 2026-06-30

## Scope

This review covered the RateLoop monorepo on `main`, including:

- Foundry contracts, deployment scripts, generated ABI metadata, and contract tests.
- Next.js API routes, scheduled jobs, agent callback plumbing, and Ponder sync surfaces.
- Keeper, Ponder, agents, SDK, node-utils, package metadata, CI, and docs.

The repository was reviewed manually and with four read-only subagents split across
contracts, frontend/API, TypeScript workspaces, and docs/CI/tooling.

## Fixed During This Pass

### F-1: Parent correlation-epoch rejection could strand pre-qualification escrow snapshots

Severity: Medium

Files:

- `packages/foundry/contracts/ClusterPayoutOracle.sol`
- `packages/foundry/contracts/interfaces/IClusterPayoutOracle.sol`
- `packages/foundry/contracts/libraries/QuestionRewardPoolEscrowRecoveryLib.sol`
- `packages/foundry/contracts/libraries/QuestionRewardPoolEscrowBundleRecoveryLib.sol`
- `packages/foundry/test/QuestionRewardPoolEscrow.t.sol`
- `packages/contracts/src/abis/ClusterPayoutOracleAbi.ts`
- `packages/contracts/src/deployedContracts.ts`

The contract audit found that an escrow could see a child payout snapshot as rejected
because its parent correlation epoch was rejected, but the escrow skip path only accepted
direct child digest/root rejection markers. The fix adds an oracle view for parent-derived
rejection and lets both single-pool and bundle pre-qualification skip paths use it, with
regression coverage and regenerated public contract metadata.

### F-2: Advisory recorder rotation could install a recorder that cannot claim launch credits

Severity: Low

Files:

- `packages/foundry/contracts/ProtocolConfig.sol`
- `packages/foundry/script/Deploy.s.sol`
- `packages/foundry/scripts-js/exportDeploymentFromBroadcast.js`
- `packages/foundry/scripts-js/exportDeploymentFromBroadcast.test.js`
- `packages/foundry/test/ProtocolConfigBranches.t.sol`
- `packages/foundry/test/RoundVotingEngineBranches.t.sol`
- `packages/foundry/audit-report-2026-06-30.md`

`ProtocolConfig.setAdvisoryVoteRecorder` now validates that the recorder is authorized by
`LaunchDistributionPool` when a launch pool exists, and `setLaunchDistributionPool` performs
the symmetric check when a recorder already exists. The deploy and broadcast-export order now
authorizes the recorder before installing it in `ProtocolConfig`.

### F-3: Agent callback deliveries had no scheduled drain and sweep auth could reject Vercel Cron

Severity: High

Files:

- `packages/nextjs/app/api/agent-callbacks/sweep/route.ts`
- `packages/nextjs/app/api/agent-callbacks/routes.test.ts`
- `packages/nextjs/lib/agent-callbacks/route-test-overrides.ts`

The scheduled sweep route discovered lifecycle callbacks but did not drain the delivery queue.
It also picked only one of `RATELOOP_AGENT_CALLBACK_DELIVERY_SECRET` or `CRON_SECRET`, so a
split production configuration could reject Vercel Cron. The sweep now accepts either configured
secret and drains due callback deliveries with a bounded `sweep:` worker id.

### F-4: Keeper Ponder work discovery reused a partially consumed timeout budget

Severity: Medium

Files:

- `packages/keeper/src/keeper.ts`
- `packages/keeper/src/__tests__/resolve-rounds.test.ts`

The keeper started the `/keeper/work` timeout before awaiting `/deployment` verification. A
slow-but-successful deployment check could leave the work request with little or no time. The
keeper now gives `/keeper/work` its own timeout after deployment verification completes, and the
test asserts the two fetches use separate abort signals.

### F-5: Account helper scripts accepted shell-sensitive keystore names

Severity: Medium

Files:

- `packages/foundry/scripts-js/checkAccountBalance.js`
- `packages/foundry/scripts-js/importAccount.js`
- `packages/foundry/scripts-js/listKeystores.js`
- `packages/foundry/scripts-js/parseArgs.js`
- `packages/foundry/scripts-js/revealPK.js`
- `packages/foundry/scripts-js/accountHelpers.test.js`

The account helper scripts now reuse the deployment keystore-name validator, filter unsafe
keystore names, avoid shell execution for `cast`, and expose tests for reserved and shell-unsafe
names.

### F-6: Static analysis did not include the dependency audit gate

Severity: Low

Files:

- `.github/workflows/static-analysis.yaml`
- `package.json`
- `scripts/readiness-workflows.test.mjs`

Static analysis now includes a pinned Node 24 dependency audit job that runs both production and
development Yarn audits through the new `security:audit` script.

### F-7: Cleanup report contained stale promo-video findings

Severity: Low

File:

- `docs/cleanup-opportunities-2026-06-26.md`

The cleanup report now marks the old World Chain promo-video copy and legacy music fallback
items as resolved, matching the current `Base mainnet` copy and `music.mp3` asset state.

## Remaining Follow-Ups

### O-1: Ponder metadata sync can still fail open after accepted question/details submissions

Severity: Medium

Status: Fixed in follow-up

Evidence:

- `packages/nextjs/services/ponder/client.ts`
- `packages/ponder/src/api/routes/content-routes.ts`
- `packages/nextjs/lib/x402/questionSubmission.ts`
- `packages/nextjs/app/api/attachments/details/attach/route.ts`

If `PONDER_METADATA_SYNC_TOKEN` is missing or mismatched, Ponder rejects metadata sync while the
user-facing submission or details attachment path can still return success with a warning/log.
The live readiness checks already validate metadata-sync auth when configured, but accepted
metadata can still remain unindexed until retry or operator repair. Consider making sync auth
failure fail-fast for production submission paths, or adding a durable retry/alert queue for
accepted-but-unsynced metadata.

Follow-up resolution:

- `ponderApi.syncQuestionMetadata` now marks production metadata sync auth/config failures as
  required service configuration.
- Direct details attachment returns a `503 metadata_sync_required` response for auth/config
  failures and a retryable `503 metadata_sync_unavailable` response if verified metadata is
  skipped or otherwise incomplete.
- x402 confirmation now fails with an `X402QuestionConfigError` if verified metadata cannot be
  synced completely, instead of logging and recording a clean submitted status.

### O-2: Dead-code scan reports unused public exports

Severity: Low

Status: Fixed in follow-up

Evidence:

- `packages/nextjs/lib/env/server.ts`
- `packages/nextjs/lib/questionRewardPools.ts`
- `packages/nextjs/lib/questionSubmissionSelectorSupport.ts`
- `packages/nextjs/lib/thirdweb/freeTransactionReservationSession.ts`
- `packages/nextjs/hooks/signedCollectionWalletContext.ts`
- `packages/nextjs/lib/vote/walletContext.ts`
- `packages/ponder/src/api/human-verified-commit-health.ts`
- `packages/ponder/src/api/shared.ts`

`yarn dead-code` currently reports 11 unused exports and 5 unused exported types. No runtime
bug was confirmed, but the list is useful cleanup debt because these exports widen local API
surface and can hide stale helper code.

Follow-up resolution:

- The unused exports were converted to module-local declarations or removed where unused.
- A follow-up `yarn dead-code` run completed with no reported unused exports or types.

## Verification

Passed:

- `yarn lint`
- `yarn dead-code` (completed with the unused-export findings listed above)
- `make generate-abis-only`
- `make check-contract-sizes`
- `make check-storage-layouts`
- `forge test --offline --match-test 'testPreQualificationParentRejectedClusterSnapshotRoundCanBeSkippedAndRefunded|testBundleRefund_PreQualificationParentRejectedSnapshotRoundSetCanBeSkipped'`
- `forge test --offline -vv`
- `yarn test:ts`
- `node ../../scripts/run-node-tests.mjs app/api/agent-callbacks/routes.test.ts`
- `yarn workspace @rateloop/keeper test --run src/__tests__/resolve-rounds.test.ts`

Environment note: the shell was running Node `v26.0.0` while the repo declares Node `>=24 <25`
and pins Node `24` in `.nvmrc` / `.node-version`. The test suite has Node 26 compatibility
guards, and the new CI dependency-audit job uses Node 24.
