# RateLoop repo follow-up audit - 2026-06-18

This was a read-only follow-up audit of `main` at `bd83c689` on 2026-06-18,
after the previous repo re-audit fixes were committed. No product code changes
were made in this pass; this document is the audit artifact.

The current rollout assumption is Base Sepolia first. Base mainnet is not
deployed yet, and this audit does not assume a production deployment or a
durable production data boundary. Contract issues below are therefore treated as
pre-production blockers unless noted otherwise.

## Scope

- Contract deployment scripts, generated artifacts, helper scripts, and
  governance runbooks.
- Next.js env guards, API tests, E2E assertions, and wallet funding copy.
- Ponder API metadata sync paths, schema resolution, and Base rollout docs.
- Keeper, agents, SDK, package scripts, CI workflows, PR template, and audit
  documentation surfaces.
- Three read-only explorer agents reviewed contracts, app/indexer/service code,
  and docs/workflow surfaces in parallel; each reported without modifying files.

## Findings

### P1 - Deploy-profile contract-size gate fails

- Files:
  - `packages/foundry/contracts/ContentRegistry.sol`
  - `packages/foundry/contracts/QuestionRewardPoolEscrow.sol`
  - `packages/foundry/scripts/check-contract-sizes.sh`
  - `.github/workflows/unit-tests.yaml:12`
  - `.github/workflows/unit-tests.yaml:32`
- Evidence: `make check-contract-sizes` fails after a deploy-profile build:

  ```text
  ContentRegistry is 24951 bytes (limit 24576)
  QuestionRewardPoolEscrow is 24689 bytes (limit 24576)
  Found 2 oversized contract(s).
  ```

- Impact: the current `contract-size` CI gate fails, and these contracts cannot
  be deployed under the EIP-170 bytecode limit without changes. Since Base
  mainnet is not deployed, this is a pre-production release blocker rather than
  an in-production exploit.
- Suggested fix: reduce deployed bytecode for both contracts or move more logic
  into libraries, then rerun `make check-contract-sizes` with the deploy profile.

### P1 - Next.js local target guard fails because generated 31337 exports omit ConfidentialityEscrow

- Files:
  - `packages/nextjs/utils/env/requiredDeployments.ts:5`
  - `packages/nextjs/utils/env/requiredDeployments.ts:20`
  - `packages/nextjs/utils/env/public.ts:93`
  - `packages/nextjs/utils/env/public.ts:96`
  - `packages/contracts/src/deployedContracts.ts:66688`
  - `packages/foundry/deployments/31337.json:9`
- Evidence:
  - The public env guard requires `ConfidentialityEscrow` for every configured
    target network.
  - The raw local Foundry deployment JSON contains `ConfidentialityEscrow`.
  - The generated `@rateloop/contracts` source export has no
    `deployedContracts[31337].ConfidentialityEscrow`.
  - Direct helper check:

    ```text
    listMissingRequiredTargetContracts([31337], deployedContracts)
    => [ '31337:ConfidentialityEscrow' ]
    ```

  - Focused Next.js API test run:

    ```text
    yarn workspace @rateloop/nextjs exec node ../../scripts/run-node-tests.mjs app/api/agent/routes.test.ts
    tests 46
    pass 0
    fail 46
    Error: Missing required deployed contract definitions for target networks: 31337:ConfidentialityEscrow.
    ```

- Impact: local Next.js tests that import public env fail before reaching route
  logic. This also blocks the broad `yarn next:test` suite and can confuse local
  development because the raw Foundry deployment and generated contract package
  disagree.
- Suggested fix: make the 31337 generation/export path include
  `ConfidentialityEscrow`, or explicitly scope the public guard away from local
  contracts that are not yet exported. Add a regression test that compares the
  local generated export against the raw deployment artifact for required
  contracts.

### P2 - Base Ponder metadata sync can fall back to the wrong writable schema

- Files:
  - `packages/ponder/src/api/routes/content-routes.ts:78`
  - `packages/ponder/src/api/routes/content-routes.ts:550`
  - `packages/ponder/src/api/routes/content-routes.ts:600`
  - `packages/ponder/scripts/databaseSchema.mjs:16`
  - `packages/ponder/README.md:69`
- Evidence: `content-routes.ts` duplicates a writable-schema default map with
  `hardhat`, `worldchain`, and `worldchainSepolia`, but not `baseSepolia` or
  `base`. The launcher resolver does include Base defaults such as
  `rateloop_ponder_base_sepolia`. If the API process is launched without
  `DATABASE_SCHEMA` or `RATELOOP_PONDER_DATABASE_SCHEMA`, metadata sync falls
  back to generic `rateloop_ponder` and then runs direct updates against
  `${schema}.content`.
- Impact: a Base Sepolia or future Base Ponder API process that is not started
  through the wrapper-injected env can update or look for x402 question metadata,
  target audience fields, and confidentiality metadata in the wrong schema.
- Suggested fix: centralize schema resolution by reusing
  `packages/ponder/scripts/databaseSchema.mjs` logic or keep the duplicated map
  complete for `baseSepolia` and `base`. Add a unit test for
  `PONDER_NETWORK=baseSepolia` with both schema env vars unset.

### P2 - Base Sepolia tlock commit helper is mainnet-only

- Files:
  - `packages/foundry/scripts-js/generateTlockCommit.js:10`
  - `packages/foundry/scripts-js/generateTlockCommit.js:177`
  - `packages/foundry/scripts-js/generateTlockCommit.js:186`
  - `packages/foundry/script/Deploy.s.sol:60`
  - `packages/foundry/script/Deploy.s.sol:611`
- Evidence: `generateTlockCommit.js` imports and uses `mainnetClient()` from
  `tlock-js` unconditionally, then rejects if the on-chain drand tuple differs
  from the tlock-js mainnet chain. `Deploy.s.sol` resolves testnets, including
  Base Sepolia, to the separate `quicknet-t` drand tuple.
- Impact: Base Sepolia deployments that correctly use testnet drand should fail
  this helper before it can produce a usable live testnet commit. This affects
  operator/developer testing of tlock-backed commit flows before mainnet.
- Suggested fix: select the tlock client/chain info from the on-chain drand
  tuple or chain ID instead of hardcoding `mainnetClient()`. Add a Base Sepolia
  helper test that expects `quicknet-t`.

### P2 - Governance voting-engine rotation runbook names a one-shot fee-creditor call

- Files:
  - `packages/foundry/README.md:150`
  - `packages/foundry/README.md:163`
  - `packages/foundry/contracts/FrontendRegistry.sol:587`
  - `packages/foundry/contracts/FrontendRegistry.sol:620`
  - `packages/foundry/contracts/FrontendRegistry.sol:623`
- Evidence: the README says `FrontendRegistry.setVotingEngine` clears the fee
  creditor until `initializeFeeCreditor` is called again. The contract marks
  `initializeFeeCreditor` as deploy-time one-shot and reverts once
  `initialFeeCreditorConfigured` is true. The available governance rebind path
  is `addFeeCreditor`.
- Impact: a governance proposal following the runbook literally would revert or
  leave fee crediting disabled after a voting-engine rotation.
- Suggested fix: update the runbook to name `addFeeCreditor` for post-deploy
  rebinds, and keep `initializeFeeCreditor` documented as deploy-time only.

### P2 - Settings E2E still asserts World Chain wallet-funding copy

- Files:
  - `packages/nextjs/e2e/tests/settings.spec.ts:104`
  - `packages/nextjs/e2e/tests/settings.spec.ts:107`
  - `packages/nextjs/components/settings/WalletSettingsPanel.tsx:110`
  - `packages/nextjs/components/settings/WalletSettingsPanel.tsx:113`
  - `packages/nextjs/lib/thirdweb/walletFunding.ts:3`
  - `packages/nextjs/e2e/playwright.config.ts:122`
  - `packages/nextjs/e2e/playwright.config.ts:127`
- Evidence: `settings.spec.ts` expects the exact text
  `ETH top-up is available on World Chain mainnet deployments.` The component now
  renders `ETH top-up is available on live deployments.` for unsupported local
  top-up, and `walletFunding.ts` currently enables thirdweb Pay direct funding
  only for Base mainnet (`8453`). The broad `ci-app` and `chromium` Playwright
  projects do not exclude `settings.spec.ts`.
- Impact: the settings E2E can fail once it reaches this assertion, and the test
  no longer describes the Base-first rollout behavior.
- Suggested fix: update the E2E assertion to the current product copy and add
  explicit coverage for Base Sepolia/testnet fallback and Base mainnet support.

### P3 - Certora and formal-verification rationale docs are referenced but absent

- Files:
  - `.github/workflows/certora.yaml:16`
  - `packages/foundry/Makefile:130`
  - `packages/foundry/certora/README.md:148`
  - `packages/foundry/certora/specs/ClusterPayoutOracle.spec:30`
  - `packages/foundry/certora/specs/RoundVotingEngineLifecycle.spec:15`
  - `packages/foundry/certora/specs/QuestionRewardPoolEscrow.spec:19`
- Evidence: formal-verification comments and workflow docs reference paths such
  as `docs/testing/certora.md`, `docs/testing/certora-round3-plan.md`,
  `docs/testing/certora-security-findings.md`, and
  `docs/testing/certora-followup.md`, but `docs/testing/` is not tracked.
- Impact: deferred proof rationale and coverage boundaries are hard to audit
  from the repo. This is documentation debt, not a runtime bug.
- Suggested fix: either restore/add the missing docs or update references to the
  current tracked Certora documentation locations.

### P3 - Retired World Chain mainnet readiness remains exposed as an active root script

- Files:
  - `package.json:75`
  - `scripts/check-worldchain-mainnet-readiness.mjs:22`
  - `scripts/check-worldchain-mainnet-readiness.mjs:149`
  - `.github/workflows/worldchain-mainnet-readiness.yaml`
  - `scripts/readiness-workflows.test.mjs:19`
  - `packages/nextjs/.env.production:1`
- Evidence: the workflow has been retired and tests assert it no longer calls the
  World Chain readiness script, but root `package.json` still exposes
  `worldchain:check`. Running that script is expected to fail against tracked
  production env because the repo intentionally targets Base Sepolia.
- Impact: operators can still discover and run a command that now fails by
  design, making a retired path look like an actionable readiness failure.
- Suggested fix: remove or rename the root script to make its legacy status
  explicit, or add an immediate retired-path message similar to the workflow.

### P3 - README still points to the previous audit as the latest re-audit

- Files:
  - `README.md:56`
  - `README.md:58`
  - `docs/repo-audit-2026-06-18-recheck.md:118`
  - `docs/repo-audit-2026-06-18-recheck.md:131`
- Evidence: README still links `docs/repo-audit-2026-06-18-recheck.md` as the
  latest repo re-audit. That earlier document records findings that have since
  been fixed, including the README fee-withdrawal delay copy and retired
  World Chain workflow behavior.
- Impact: readers following the top-level "latest audit" pointer can land on a
  stale findings list and miss this follow-up audit.
- Suggested fix: after accepting this document, update the README pointer to the
  newest audit artifact or maintain a stable audit index.

### P3 - Pull request checklist under-represents current gates

- Files:
  - `.github/pull_request_template.md:13`
  - `.github/pull_request_template.md:16`
  - `package.json:61`
  - `package.json:106`
  - `.github/workflows/base-sepolia-readiness.yaml:43`
  - `.github/workflows/unit-tests.yaml:12`
  - `.github/workflows/e2e.yaml:43`
- Evidence: the PR template asks for Foundry tests, Next lint, Next type check,
  and local `yarn start`. Current CI also depends on contract-size checks, Base
  Sepolia readiness, broad TypeScript/package suites, and E2E matrix jobs. The
  root `yarn test` script is Foundry-only, while `yarn test:all`/`yarn test:ts`
  cover much more.
- Impact: contributors can check every template box while missing gates that CI
  actually enforces.
- Suggested fix: refresh the checklist to match current CI at a high level,
  including contract size, Base Sepolia readiness, TypeScript/package tests, and
  relevant E2E projects.

## Resolved prior-audit items confirmed

- `189e4170` fixed the public-rating oracle readiness pre-squat issue from the
  prior audit.
- `a0c4917f` removed live Ponder identity fallback to env-only addresses.
- `40fa39c5` hardened Next.js deployment target validation and added required
  app-consumed contracts.
- `82f20a6f` added a local seed guard for stale 31337 deployments.
- `bd83c689` retired the World Chain readiness workflow path and corrected the
  README fee-withdrawal copy to 21 days.

## Non-findings and expected gates

- `yarn base-sepolia:check` passes offline against the current Base Sepolia
  deployment artifact.
- `yarn base:check` fails with
  `Base mainnet is not deployed: missing packages/foundry/deployments/8453.json.`
  This is expected because Base mainnet has not been promoted.
- `yarn sdk:test` and `yarn sdk:check-types` pass when run by themselves. An
  earlier SDK failure was caused by running package builds/tests concurrently and
  should not be treated as a source issue.
- `yarn workspace @rateloop/agents test` passes when run by itself. An earlier
  agents failure was also a concurrent build-artifact race.
- The previous audit's ClusterPayoutOracle challenge-bond and reveal-grace
  concerns remain intentionally accepted protocol parameters and are not raised
  as findings here.

## Verification log

Commands run during this follow-up:

```text
git status --short --branch
git rev-parse --short HEAD
yarn base-sepolia:check
yarn base:check
yarn test:node
yarn contracts:test
yarn workspace @rateloop/foundry test
yarn next:check-types
yarn workspace @rateloop/keeper test
yarn workspace @rateloop/ponder test
yarn workspace @rateloop/agents test
yarn sdk:test
yarn sdk:check-types
make check-contract-sizes
yarn workspace @rateloop/nextjs exec node ../../scripts/run-node-tests.mjs app/api/agent/routes.test.ts
git diff --check
repo-local Markdown link sweep excluding vendored dependencies
```

Results:

- Passing checks:
  - clean `main...origin/main` at `bd83c689` before writing this document
  - `yarn base-sepolia:check`
  - `yarn test:node` (153 tests)
  - `yarn contracts:test` (37 tests)
  - `yarn workspace @rateloop/foundry test` (1805 tests)
  - `yarn next:check-types`
  - `yarn workspace @rateloop/keeper test` (228 passed, 1 skipped)
  - `yarn workspace @rateloop/ponder test` (348 passed, 1 skipped)
  - `yarn workspace @rateloop/agents test` (81 tests) when rerun alone
  - `yarn sdk:test` (51 tests) when rerun alone
  - `yarn sdk:check-types`
  - `git diff --check`
  - repo-local Markdown link sweep over 43 Markdown files after this document,
    excluding vendored dependencies
- Expected failure:
  - `yarn base:check` fails closed because `packages/foundry/deployments/8453.json`
    is absent.
- Current failures:
  - `make check-contract-sizes` fails for `ContentRegistry` and
    `QuestionRewardPoolEscrow`.
  - focused Next.js agent route tests fail 46/46 because
    `31337:ConfidentialityEscrow` is missing from generated deployed-contract
    definitions.
