# RateLoop repo re-audit - 2026-06-18

This was a read-only recheck of the `main` checkout on 2026-06-18. The audit
began while `main` was one commit ahead of `origin/main` with pre-existing
uncommitted escrow/keeper edits. During the audit, `origin/main` advanced to
`1cc4eb2d` (`Bind escrow snapshot readiness to pinned oracle`) and those edits
became the clean current `main` state. The committed files in that change were:

- `packages/foundry/contracts/libraries/QuestionRewardPoolEscrowBundleActionsLib.sol`
- `packages/foundry/contracts/libraries/QuestionRewardPoolEscrowBundleRecoveryLib.sol`
- `packages/foundry/contracts/libraries/QuestionRewardPoolEscrowQualificationLib.sol`
- `packages/foundry/contracts/libraries/QuestionRewardPoolEscrowRecoveryLib.sol`
- `packages/foundry/contracts/libraries/QuestionRewardPoolEscrowSnapshotConsumerLib.sol`
- `packages/foundry/test/QuestionRewardPoolEscrow.t.sol`
- `packages/keeper/src/correlation-snapshots.ts`
- `packages/keeper/src/__tests__/correlation-snapshots.test.ts`

No code changes were made during this audit. Findings that touched the
escrow/keeper changes were rechecked against clean `main` at `1cc4eb2d`. This
document itself also satisfies the README link to
`docs/repo-audit-2026-06-18-recheck.md`, which was missing before the audit
artifact existed.

## Findings

### P1 - Current main escrow suite fails the focused Foundry suite

- Files:
  - `packages/foundry/test/QuestionRewardPoolEscrow.t.sol:1437`
  - `packages/foundry/contracts/libraries/QuestionRewardPoolEscrowSnapshotConsumerLib.sol:154`
  - `packages/foundry/contracts/libraries/QuestionRewardPoolEscrowSnapshotConsumerLib.sol:191`
- Evidence: `yarn workspace @rateloop/foundry test --match-path test/QuestionRewardPoolEscrow.t.sol`
  failed against clean `main` at `1cc4eb2d` with `SourceNotReady()` in
  `testGovernanceCannotRepointQuestionBundleClusterOracleWithExistingSnapshot`.
- Impact: the committed escrow contract/test changes in `1cc4eb2d` are
  internally inconsistent. The new source-readiness gate returns `0` unless
  `msg.sender` is the pinned oracle, but this older test still tries to seed a
  replacement bundle oracle with an existing snapshot before governance
  repoints it.
- Suggested fix: decide whether the new behavior is intended. If yes, update the
  test so the replacement oracle cannot pre-squat before repoint and can propose
  only after repoint. If the old "replacement snapshot already exists" guard is
  still required as explicit coverage, mock or simulate the consumer call as the
  replacement oracle so the test reaches the intended repoint rejection.

### P2 - Public-rating oracle repointing still allows replacement pre-squat

- Files:
  - `packages/foundry/contracts/libraries/ContentRegistryRatingSnapshotLib.sol:132`
  - `packages/foundry/contracts/libraries/ContentRegistryRatingSnapshotLib.sol:150`
- Evidence: `roundPayoutSnapshotSourceReadyAt` returns readiness for any caller
  once the pending rating settlement exists, while
  `repointPendingRatingClusterPayoutOracle` rejects a replacement oracle if
  `roundPayoutSnapshotProposedAt(...) != 0`.
- Impact: an eligible proposer on a known replacement public-rating oracle can
  publish a snapshot before governance repoints the pending rating settlement.
  That makes the later repoint fail, leaving the stale pinned oracle as the only
  usable verifier.
- Suggested fix: mirror the question/bundle hardening by returning `0` unless
  `msg.sender == pending.clusterPayoutOracle`, then add coverage that a
  replacement public-rating oracle gets `SourceNotReady` before repoint and can
  propose after repoint.

### P2 - Ponder helper paths can still derive live identity from env-only addresses

- Files:
  - `packages/ponder/src/protocol-deployment.ts:76`
  - `packages/ponder/scripts/databaseSchema.mjs:70`
- Evidence: `ponder.config.ts` rejects live env-only contract addresses for
  non-local networks, but the deployment metadata and database schema helpers
  still fall back to `PONDER_CONTENT_REGISTRY_ADDRESS` and
  `PONDER_FEEDBACK_REGISTRY_ADDRESS` when shared artifacts are missing.
- Impact: stale World Chain or live address overrides can produce misleading
  `/deployment` metadata or a deployment-scoped database schema during a Base
  rollout, even though the main indexer config would fail closed.
- Suggested fix: only allow env-address fallback for `hardhat`; live networks
  should use shared `@rateloop/contracts` artifacts or return unconfigured/fail.
  Add tests for live env-only metadata and schema derivation.

### P2 - Next.js target deployment guard is too shallow

- Files:
  - `packages/nextjs/utils/env/requiredDeployments.ts:3`
  - `packages/nextjs/utils/env/requiredDeployments.ts:29`
  - `packages/nextjs/utils/env/public.test.ts:44`
- Evidence: `listMissingRequiredTargetContracts` only checks whether a contract
  key exists. Tests use empty objects as present deployments. The required list
  also omits app-consumed contracts such as `FeedbackRegistry`,
  `FeedbackBonusEscrow`, and `ConfidentialityEscrow`.
- Impact: a malformed or partial generated deployment artifact can pass the
  browser-facing public env guard and fail later in feedback, bonus,
  confidentiality, X402, or contract helper flows.
- Suggested fix: validate required deployment entries with `isAddress`, reject
  the zero address, expand the required contract list to app-required contracts,
  and update `public.test.ts` with positive Base Sepolia coverage and negative
  malformed-artifact coverage.

### P2 - Ignored local 31337 deployment artifact is stale

- Files:
  - `packages/foundry/deployments/31337.json:2`
  - `packages/contracts/src/deployedContracts.ts:66688`
  - `packages/foundry/script/SeedContent.sh:9`
- Evidence: `packages/foundry/deployments/31337.json` is ignored and present
  locally, while `SeedContent.sh` reads it directly. Sample mismatches:
  - `LoopReputation`: ignored `0x067c804bb006836469379D4A2A69a81803bd1F45`,
    shared `0x6379ebD504941f50D5BfDE9348B37593bd29C835`
  - `ContentRegistry`: ignored `0xEAb25969e5285dF34a3B245324d0B2B91E31cAD4`,
    shared `0x2c4b93b614DdbfAF0807e8F4Ca982e9f9c2e2Aa4`
  - `ClusterPayoutOracle`: ignored `0x0777DBe3E4a1781F467A456aE589878556601457`,
    shared `0xa7328DEAa1B585a494f055Fc9Bd99ea56d52CD3d`
- Impact: local seeding/dev tooling can target stale contracts after regenerated
  shared artifacts, producing confusing local-only failures.
- Suggested fix: regenerate or remove the ignored artifact and add a seed
  preflight that compares `31337.json` with `deployedContracts.ts` before using
  it.

### P3 - README fee-withdrawal copy still says 14 days

- Files:
  - `README.md:48`
  - `packages/foundry/contracts/FrontendRegistry.sol:62`
- Evidence: README says frontend operator fee withdrawals wait out a 14-day
  slashable review window, but the contract constant is
  `FEE_WITHDRAWAL_DELAY = 21 days`. Other docs/UI already use 21 days.
- Impact: operator-facing top-level copy understates the fee withdrawal delay and
  conflates it with the separate 14-day frontend unbonding period.
- Suggested fix: update README to say 21 days for fee withdrawals and keep 14
  days only for frontend unbonding.

### P3 - World Chain mainnet readiness workflow is now misleading

- Files:
  - `.github/workflows/worldchain-mainnet-readiness.yaml:25`
  - `scripts/check-worldchain-mainnet-readiness.mjs:143`
  - `packages/nextjs/.env.production:1`
- Evidence: `node scripts/check-worldchain-mainnet-readiness.mjs --production`
  fails because tracked `.env.production` intentionally targets Base Sepolia
  (`NEXT_PUBLIC_TARGET_NETWORKS=84532`), while the World Chain mainnet readiness
  check requires `480`.
- Impact: a manually triggered legacy World Chain mainnet readiness workflow now
  fails by design, which makes it look like an actionable production-readiness
  failure instead of a retired path.
- Suggested fix: mark the workflow as retired/legacy, decouple it from tracked
  `.env.production`, or move it to a World Chain-specific env fixture.

## Non-findings and expected gates

- `yarn base-sepolia:check` passes offline against the current Base Sepolia
  artifact.
- `yarn base:check` fails with `Base mainnet is not deployed: missing
  packages/foundry/deployments/8453.json.` This is expected for the Base Sepolia
  first rollout model.
- `node scripts/check-worldchain-sepolia-readiness.mjs` passes offline.
- The 5 USDC `ClusterPayoutOracle` challenge bond and 60-minute
  `revealGracePeriod` were treated as accepted product/security parameters, not
  findings.

## Verification run

Commands run locally by the main audit pass:

- `yarn base-sepolia:check` - passed.
- `yarn base:check` - failed as expected because `packages/foundry/deployments/8453.json` is absent.
- `yarn workspace @rateloop/foundry test --match-path test/QuestionRewardPoolEscrow.t.sol` - failed against clean `main` at `1cc4eb2d` with 209 passed, 1 failed.
- `yarn workspace @rateloop/keeper test src/__tests__/correlation-snapshots.test.ts` - passed, 10 tests.
- `yarn keeper:check-types` - passed.
- `yarn contracts:test` - passed, 37 tests.
- `yarn test:node` - passed, 146 tests.
- `yarn workspace @rateloop/foundry test --match-path test/ContentRegistryRepoint.t.sol` - passed, 5 tests.
- `node scripts/check-worldchain-mainnet-readiness.mjs --production` - failed on the expected `NEXT_PUBLIC_TARGET_NETWORKS=480` check.
- `node scripts/check-worldchain-sepolia-readiness.mjs` - passed.

Additional read-only sub-agent checks reported:

- `git diff --check` - passed.
- `forge fmt --check contracts test script` - failed with existing formatting diffs; not classified above because no formatting change was requested.
- Focused Ponder, Keeper, Next.js, Agents, SDK, contracts, readiness workflow,
  and release metadata tests - passed in the scopes reported by the sub-agents.
