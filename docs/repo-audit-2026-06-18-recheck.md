# RateLoop Repo Re-Audit - Bugs & Inconsistencies (18 June 2026)

Read-only re-audit of the RateLoop monorepo at HEAD `f4748893`
(`test(foundry): allow tracked old engine activity after rotation`).

Scope: bugs, inconsistencies, stale gates, and operational drift. No application
code was changed for this audit; this document is the only intended repository
change.

Two explorer agents completed read-only slices for contracts/governance and
ops/package/config. A third Next.js/API slice timed out and was shut down.
Load-bearing findings below were re-checked in the main workspace against the
current files and command output.

Worktree note: during this document pass, `packages/nextjs/components/settings/WorldIdVerificationCard.tsx`
had an unrelated unstaged edit. It is not part of this audit commit.

## TL;DR

Current Base Sepolia readiness is in much better shape than the previous audit:
`base-sepolia:check` is green, bundle correlation routes now expose
`truncated`, generated-image JSON limits now scale to the four-image handoff
limit, and browser USDC overrides now reject conflicting public vars.

The highest-confidence remaining issues are:

1. World Chain mainnet readiness CI is still wired to run on push/PR even
   though tracked `.env.production` intentionally targets Base Sepolia.
2. Keeper and Ponder service test suites now fail because Base Sepolia tests
   still expect missing `84532` shared artifacts or env-address precedence.
3. Keeper can still honor a stale live `CLUSTER_PAYOUT_ORACLE_ADDRESS` override
   instead of failing closed against the shared deployment artifact.
4. Confidentiality bond release still checks only the current registry voting
   engine, while recent rotation support tracks old active engines per content.

No new High-severity Solidity fund-loss path was confirmed in this pass.

## Verification Snapshot

| Check | Result |
| --- | --- |
| `yarn dead-code:scan` | Pass |
| `yarn next:check-types` | Pass |
| `yarn test:node` | Pass, 133 tests |
| `yarn base-sepolia:check` | Pass |
| `yarn workspace @rateloop/foundry check:sizes` | Pass; all checked deploy-profile bytecode under EIP-170 |
| `yarn base:check` | Expected fail: missing `packages/foundry/deployments/8453.json` |
| `yarn worldchain:check` | Fail: `FAIL Next.js production env targets World Chain mainnet` |
| `yarn workspace @rateloop/keeper test` | Fail: one stale Base Sepolia config test |
| `yarn workspace @rateloop/ponder test` | Fail: one stale Base Sepolia protocol deployment test |
| `make check-contract-sizes DEPLOY_PROFILE=deploy` from repo root | Fail: no root `check-contract-sizes` target |

Deploy-profile size output from the passing package script:

| Contract | Size (B) | Headroom (B) |
| --- | ---: | ---: |
| `LaunchDistributionPool` | 24,538 | 38 |
| `ContentRegistry` | 24,452 | 124 |
| `QuestionRewardPoolEscrow` | 24,424 | 152 |
| `RoundVotingEngine` | 23,911 | 665 |
| `RaterRegistry` | 22,900 | 1,676 |

## High

### H1 - World Chain mainnet readiness workflow is stale and failing

**Severity:** High (push/PR CI breakage on `main` workflows)

`.github/workflows/worldchain-mainnet-readiness.yaml:3-9` still runs on
`push` and `pull_request`, and line 32 runs:

```sh
node scripts/check-worldchain-mainnet-readiness.mjs --production
```

That checker still asserts `.env.production` must contain
`NEXT_PUBLIC_TARGET_NETWORKS=480` at
`scripts/check-worldchain-mainnet-readiness.mjs:141-149`. The tracked
production-style env now intentionally targets Base Sepolia:
`packages/nextjs/.env.production:1-4` says to keep the target on `84532` until
the Base Sepolia stack is verified end to end.

I ran `yarn worldchain:check`; it exits 1 with
`FAIL Next.js production env targets World Chain mainnet`.

**Impact:** Any push/PR path that still runs the World Chain mainnet readiness
workflow will fail for the current Base Sepolia-first rollout state, even though
the Base Sepolia readiness gate is green.

**Suggested fix/test:** make the World Chain mainnet workflow manual-only or
retire it from push/PR while Base is the active rollout path. Alternatively,
teach the checker/workflow to validate an explicitly selected target instead of
assuming tracked `.env.production` is always World Chain mainnet.

### H2 - Keeper and Ponder suites fail from stale Base Sepolia test assumptions

**Severity:** High (service test suites fail at current HEAD)

`yarn workspace @rateloop/keeper test` fails one test:
`packages/keeper/src/__tests__/config.test.ts:422-428` still expects Base
Sepolia keeper startup to fail with
`Missing shared deployment artifact for RoundVotingEngine on chain 84532`.
Now that `packages/foundry/deployments/84532.json` and generated shared
deployments exist, `loadKeeperConfig()` reaches the live-artifact mismatch guard
and reports conflicting stale env overrides instead.

`yarn workspace @rateloop/ponder test` also fails one test:
`packages/ponder/tests/protocol-deployment.test.ts:53-75` expects
`PONDER_CONTENT_REGISTRY_ADDRESS` and `PONDER_FEEDBACK_REGISTRY_ADDRESS` to win
for `baseSepolia`, but `packages/ponder/src/protocol-deployment.ts:70-77`
prefers shared deployments for non-`hardhat` networks.

**Impact:** The package test suites are red after the Base Sepolia artifact
promotion. The failing expectations also encode the wrong operator model:
non-local Base Sepolia should derive from shared deployment artifacts and reject
or ignore stale live address overrides.

**Suggested fix/test:** update the Keeper test to assert successful Base
Sepolia artifact resolution or the intended conflict error when stale overrides
are provided. Update the Ponder protocol metadata test to expect shared
`84532` deployment addresses for `baseSepolia`, and keep env-address precedence
only for `hardhat`.

## Medium

### M1 - Keeper can still use a stale live `ClusterPayoutOracle` override

**Severity:** Medium (wrong oracle for correlation snapshots on live chains)

`resolveOptionalContractAddress()` only escalates shared-artifact mismatches to
errors when `rejectLiveMismatch` is set
(`packages/keeper/src/config.ts:286-315`). The ClusterPayoutOracle resolver at
`packages/keeper/src/config.ts:537-543` does not set that flag.

This means a leftover `CLUSTER_PAYOUT_ORACLE_ADDRESS` can override the shared
`@rateloop/contracts` deployment artifact on Base Sepolia/Base while producing
only a warning.

**Impact:** Keeper correlation snapshot work can read/write against a stale
oracle address on live chains, while core required contracts fail closed on the
same class of mismatch.

**Suggested fix/test:** pass `rejectLiveMismatch: true` for live optional
contracts that are deployment-bound, at least `ClusterPayoutOracle`. Add a
config test with `CHAIN_ID=84532` and a conflicting oracle override.

### M2 - Confidentiality bond release ignores tracked old engines after rotation

**Severity:** Medium (bond liveness delay after engine rotation)

`ConfidentialityEscrow._isBondReleasable()` delegates active-content release to
`_currentRoundTerminal()` (`packages/foundry/contracts/ConfidentialityEscrow.sol:512-518`).
`_currentRoundTerminal()` only reads `registry.votingEngine()`
(`ConfidentialityEscrow.sol:528-545`).

Recent engine-rotation support exposes the tracked old engine at
`ContentRegistry.trackedVotingEngine()` (`packages/foundry/contracts/ContentRegistry.sol:1283-1285`)
and updates it on activity (`ContentRegistry.sol:1291-1300`). The nexus
authorization path already considers tracked old engines
(`ConfidentialityEscrow.sol:547-556`), but the bond-release terminal-state path
does not.

**Impact:** If a tracked old engine settles after a registry voting-engine
rotation, confidentiality bonds can remain unreleasable until
`maxBondLockDuration + evidenceWindow` even though the relevant round is
terminal.

**Suggested fix/test:** have bond release inspect the tracked engine for the
content before falling back to the current registry engine, or otherwise define
the intended post-rotation release rule. Add a regression test where a gated
round starts on the old engine, the registry rotates, the old engine settles,
and the bond becomes releasable after the evidence window.

### M3 - Governance UI still exposes single-engine rotation actions

**Severity:** Medium (operator/governance footgun)

The governance composer still exposes standalone voting-engine proposals for
`FrontendRegistry.setVotingEngine` at
`packages/nextjs/components/governance/GovernanceActionComposer.tsx:312-322`
and `ContentRegistry.setVotingEngine` at
`GovernanceActionComposer.tsx:826-832`.

That conflicts with pinned-engine dependencies elsewhere:
`QuestionRewardPoolEscrow` requires the registry voting engine to equal its
pinned engine (`packages/foundry/contracts/QuestionRewardPoolEscrow.sol:1391-1397`),
and `FeedbackBonusEscrow` reverts with `"Stale engine"` when registry and
escrow voting engines diverge
(`packages/foundry/contracts/FeedbackBonusEscrow.sol:523-525`).

**Impact:** Governance can still compose a proposal that looks like a normal
single-contract engine rotation but strands new reward/feedback work until the
full replacement stack is deployed and rewired.

**Suggested fix/test:** remove or strongly gate these standalone actions, or
replace them with a coordinated engine-migration template/runbook action that
includes escrows, registries, fee creditor wiring, and submitter pointers.

### M4 - Base live readiness does not prove cross-contract wiring

**Severity:** Medium (deployment-readiness blind spot)

The shared live readiness probe checks RPC chain ID, bytecode, and required
selector presence (`scripts/check-worldchain-sepolia-readiness.mjs:404-428`).
It does not read critical wiring such as `ContentRegistry.votingEngine()`,
escrow pointers, fee creditor pointers, or submitter escrow pointers. Keeper has
the style of guard needed here: it reads `ContentRegistry.votingEngine()` and
compares it to the configured engine in
`packages/keeper/src/contract-reads.ts:258-270`.

**Impact:** Base Sepolia or Base mainnet live readiness can pass with the right
code deployed at the right addresses while cross-contract pointers still refer
to an old or partial stack.

**Suggested fix/test:** extend live readiness with read-contract checks for the
same wiring the deployment and keeper depend on: registry voting engine,
reward/feedback escrows, fee creditor, confidentiality escrow, and x402
submitter pointers.

## Low

### L1 - Public package docs describe Base mainnet as already promoted

**Severity:** Low (public docs drift)

`packages/sdk/README.md:23` references
`packages/foundry/deployments/8453.json`, but that file is absent; tracked
deployments are `31337.json`, `480.json`, `4801.json`, and `84532.json`.

`packages/agents/README.md:153` says production mainnet uses chain `8453` and
that `.env.production` contains `NEXT_PUBLIC_TARGET_NETWORKS=8453`, but
`packages/nextjs/.env.production:4` currently targets `84532`.

`packages/contracts/README.md:22` still uses a World Chain Sepolia `4801`
example, which is stale for the Base-first public package story.

### L2 - Ops docs link to a missing `docs/testing` tree

**Severity:** Low (broken docs links)

`README.md:56-57` links to `[docs/testing](docs/testing)`, and
`packages/foundry/certora/README.md:7-9` links to
`docs/testing/certora.md`. There is no `docs/testing` directory in the
repository.

### L3 - Ponder README schema examples still steer toward World Chain names

**Severity:** Low (operator docs drift)

`packages/ponder/README.md:60-62` correctly says the next live rollout starts
on `baseSepolia`, but the schema examples at lines 70-71 still use
`rateloop_ponder_worldchain_sepolia`. The launcher defaults are Base-aware:
`packages/ponder/scripts/databaseSchema.mjs:13-19` maps `baseSepolia` to
`rateloop_ponder_base_sepolia`.

### L4 - Contract-size docs reference a root make target and stale numbers

**Severity:** Low (operator docs drift)

`packages/foundry/README.md:32-34` references
`make check-contract-sizes` and `make check-contract-sizes DEPLOY_PROFILE=deploy`.
Running that command from the repo root fails because the Makefile lives under
`packages/foundry`. The package script works:
`yarn workspace @rateloop/foundry check:sizes`.

The same table lists `ContentRegistry` as 24,387 bytes / 189 bytes headroom at
`packages/foundry/README.md:39`. The current deploy-profile check reports
24,452 bytes / 124 bytes headroom.

### L5 - `@rateloop/node-utils` is public but has no package README

**Severity:** Low (public package documentation gap)

`packages/node-utils/package.json:2-27` defines a public package with npm entry
metadata and `files: ["dist"]`, but there is no `packages/node-utils/README.md`.
The release metadata gate checks exports and package shape, not package-local
usage docs.

## Previously Reported Items That Now Look Closed

These findings from the latest audit documents were re-checked and should not
be carried forward as open:

- `/correlation/bundle-round-votes` now scans with a page budget and returns
  `truncated` (`packages/ponder/src/api/routes/correlation-routes.ts:705-993`).
- Agent generated-image JSON budget now scales for four 10 MB images
  (`packages/nextjs/lib/auth/imageUploadChallenge.shared.ts:1-17`).
- Browser USDC override resolution now rejects conflicting public USDC vars
  (`packages/nextjs/lib/questionRewardPools.ts:122-142`), and
  `docs/env-parity.md:30-41` documents the guard.

## Suggested Remediation Order

1. Disable or retarget the World Chain mainnet readiness workflow while Base
   Sepolia is the active production-style rollout target.
2. Update the failing Keeper and Ponder tests to the post-`84532` shared
   artifact model.
3. Fail closed on live `ClusterPayoutOracle` override mismatches.
4. Fix confidentiality bond release for tracked old engines and add a rotation
   regression test.
5. Gate standalone governance engine-rotation actions behind a coordinated
   migration flow.
6. Add live-readiness wiring checks before Base mainnet promotion.
7. Clean up the public package and ops documentation drift.
