# RateLoop repo second follow-up audit - 2026-06-18

This was another read-only audit of `main` at
`7f3d4c263b5aa26a13468a1d84daa831a8efc656` on 2026-06-18. No product code,
configuration, tests, or existing docs were changed in this pass; this document
is the only intended artifact.

The current deployment posture is still Base Sepolia first. Base mainnet is not
deployed or promoted, so deploy-related issues are treated as pre-production
blockers unless noted otherwise.

## Scope

- Three parallel read-only explorer agents covered contracts/deployment,
  app/SDK/agents/E2E, and Ponder/Keeper/service wiring.
- The main pass covered docs, CI/workflows, readiness scripts, audit-doc
  freshness, and local verification of all agent-reported findings.
- Existing findings in `docs/repo-audit-2026-06-18-follow-up.md` were rechecked
  and are called out below when still open.

## Findings

### P1 - Deploy-profile contract-size gate still fails

Status: still open from the previous audit, with an additional stale-doc note.

- Files:
  - `packages/foundry/contracts/ContentRegistry.sol`
  - `packages/foundry/contracts/QuestionRewardPoolEscrow.sol`
  - `packages/foundry/scripts/check-contract-sizes.sh:8`
  - `packages/foundry/scripts/check-contract-sizes.sh:57`
  - `.github/workflows/unit-tests.yaml:30`
  - `packages/foundry/README.md:34`
- Evidence: `make check-contract-sizes` still fails in the deploy profile:

  ```text
  ContentRegistry is 24951 bytes (limit 24576)
  QuestionRewardPoolEscrow is 24689 bytes (limit 24576)
  Found 2 oversized contract(s).
  ```

  The Foundry README table still lists deploy-profile sizes as if
  `ContentRegistry` and `QuestionRewardPoolEscrow` are below the limit
  (`24509` and `24503` bytes respectively).
- Impact: the CI `contract-size` job and deploy preflight fail. Because the Base
  contracts are not production-deployed yet, this is a release blocker rather
  than a live exploit. The README now also understates the pre-production risk.
- Suggested fix: reduce/split deployed bytecode for both contracts, rerun
  `make check-contract-sizes`, and update the README size table to the verified
  deploy-profile numbers.

### P1 - Generated local 31337 exports still omit `ConfidentialityEscrow`

Status: still open from the previous audit, with additional E2E helper impact.

- Files:
  - `packages/nextjs/utils/env/requiredDeployments.ts:20`
  - `packages/nextjs/utils/env/public.ts:93`
  - `packages/nextjs/utils/env/public.ts:96`
  - `packages/contracts/src/deployedContracts.ts:66688`
  - `packages/foundry/deployments/31337.json:9`
  - `packages/foundry/deployments/.gitignore:2`
  - `packages/nextjs/e2e/helpers/contracts.ts:21`
- Evidence:
  - The public env guard requires `ConfidentialityEscrow` for configured target
    networks.
  - The ignored local Foundry artifact in this checkout includes
    `ConfidentialityEscrow`, but the committed `31337` block in
    `packages/contracts/src/deployedContracts.ts` has no top-level
    `ConfidentialityEscrow`.
  - Direct helper check still reports:

    ```text
    [ '31337:ConfidentialityEscrow' ]
    ```

  - Focused Next.js API tests still fail 46/46 with:

    ```text
    Missing required deployed contract definitions for target networks: 31337:ConfidentialityEscrow.
    ```

  - Importing the local E2E contracts helper fails with:

    ```text
    Cannot read properties of undefined (reading 'address')
    ```

- Impact: local Next.js tests and app boot paths that use the public env guard
  fail for Foundry `31337`. E2E helpers that dereference local contract
  addresses also fail before they can start a test flow.
- Suggested fix: regenerate/fix the shared `31337` export to include
  `ConfidentialityEscrow`, or stop treating a committed `31337` export as the
  source for local tests. Add an import smoke test for
  `packages/nextjs/e2e/helpers/contracts.ts` and a required-local-contract
  export check.

### P2 - Local deployment sync validator misses generated-contract omissions

Status: new finding in this pass.

- Files:
  - `packages/foundry/scripts-js/validateLocalDeploymentSync.js:96`
  - `packages/foundry/scripts-js/validateLocalDeploymentSync.js:103`
  - `packages/foundry/deployments/31337.json:9`
  - `packages/contracts/src/deployedContracts.ts:66688`
- Evidence: the validator only reports mismatches when both the artifact and the
  generated export have an address and the values differ:

  ```js
  if (!artifactAddress || !generatedAddress || artifactAddress === generatedAddress) continue;
  ```

  Direct probe with `contractNames: ["ConfidentialityEscrow"]` returned `[]`
  even though the local artifact has an address and the generated export is
  missing it.
- Impact: the P1 local deployment gap can recur silently because the sync
  validator treats "artifact present, generated missing" as success.
- Suggested fix: make missing artifact addresses and missing generated addresses
  explicit failures, and add tests for artifact-present/generated-missing and
  generated-present/artifact-missing cases.

### P2 - Metadata sync posts the primary target deployment key, not the content chain key

Status: new finding in this pass.

- Files:
  - `packages/nextjs/lib/x402/questionSubmission.ts:2329`
  - `packages/nextjs/lib/x402/questionSubmission.ts:2366`
  - `packages/nextjs/lib/x402/questionSubmission.ts:3367`
  - `packages/nextjs/app/api/attachments/details/attach/route.ts:492`
  - `packages/nextjs/app/api/attachments/details/attach/route.ts:506`
  - `packages/nextjs/services/ponder/client.ts:263`
  - `packages/nextjs/services/ponder/client.ts:1508`
  - `packages/ponder/src/api/routes/content-routes.ts:1069`
  - `packages/nextjs/utils/env/targetNetworks.ts:16`
- Evidence:
  - x402 submission confirmation carries `config.contentRegistryDeploymentKey`
    for the actual submitted chain into confidentiality writes, but then calls
    `ponderApi.syncQuestionMetadata(entries)` without passing that key.
  - The details-attachment route similarly has `context.deploymentKey` for the
    verified content chain, but calls `ponderApi.syncQuestionMetadata` without
    passing it.
  - `ponderApi.syncQuestionMetadata` recomputes the key from
    `scaffoldConfig.targetNetworks[0]`.
  - `NEXT_PUBLIC_TARGET_NETWORKS` supports comma-separated multi-network
    configs.
  - The Ponder `/question-metadata` endpoint returns 409 when the submitted
    deployment key does not match the Ponder deployment.
- Impact: in a multi-target app config, or during a Base Sepolia to Base mainnet
  transition, metadata for content submitted or attached on a non-primary target
  chain can confirm on-chain while Ponder rejects the off-chain metadata sync.
  The x402 path logs and continues, so question metadata, target audience fields,
  and confidentiality metadata can be missing from Ponder.
- Suggested fix: make `ponderApi.syncQuestionMetadata` accept an explicit
  deployment key or chain context and pass the already-resolved content-chain key
  from x402 and attachment paths. If only one Ponder deployment is supported at a
  time, reject non-primary metadata sync attempts explicitly.

### P2 - Base Ponder metadata sync can fall back to the wrong writable schema

Status: still open from the previous audit.

- Files:
  - `packages/ponder/src/api/routes/content-routes.ts:78`
  - `packages/ponder/src/api/routes/content-routes.ts:550`
  - `packages/ponder/src/api/routes/content-routes.ts:600`
  - `packages/ponder/scripts/databaseSchema.mjs:16`
  - `packages/ponder/README.md:69`
- Evidence: the API route has a duplicated schema-default map containing
  `hardhat`, `worldchain`, and `worldchainSepolia`, but not `baseSepolia` or
  `base`. The launcher resolver includes `rateloop_ponder_base_sepolia` and
  `rateloop_ponder_base`.
- Impact: a Base Ponder API process launched outside the wrapper, or without
  explicit schema env, can write metadata sync updates to generic
  `rateloop_ponder` instead of the Base-specific schema.
- Suggested fix: centralize writable-schema resolution on the launcher helper or
  keep the API route's map complete for Base networks. Add a unit test for
  `PONDER_NETWORK=baseSepolia` with schema env unset.

### P2 - Base Sepolia tlock commit helper remains mainnet-only

Status: still open from the previous audit.

- Files:
  - `packages/foundry/scripts-js/generateTlockCommit.js:10`
  - `packages/foundry/scripts-js/generateTlockCommit.js:177`
  - `packages/foundry/scripts-js/generateTlockCommit.js:185`
  - `packages/foundry/script/Deploy.s.sol:614`
  - `packages/foundry/script/SeedContent.sh:778`
- Evidence: Base Sepolia deploy config resolves testnet `quicknet-t` drand
  values, but `generateTlockCommit.js` imports and uses `mainnetClient()`
  unconditionally and rejects mismatched drand tuples. `SeedContent.sh` calls
  this helper for seeded commits.
- Impact: Base Sepolia seeded blind commits can fail before `commitVote`, even
  though the deployment correctly uses testnet drand.
- Suggested fix: choose the tlock client by on-chain drand tuple or chain ID, and
  add a Base Sepolia helper regression test.

### P2 - Governance rotation runbook names the one-shot fee-creditor path

Status: still open from the previous audit.

- Files:
  - `packages/foundry/README.md:150`
  - `packages/foundry/contracts/FrontendRegistry.sol:558`
  - `packages/foundry/contracts/FrontendRegistry.sol:587`
  - `packages/foundry/contracts/FrontendRegistry.sol:623`
- Evidence: the runbook says the fee creditor is cleared until
  `initializeFeeCreditor` is called again. The contract exposes `addFeeCreditor`
  as the reusable governance path, while `initializeFeeCreditor` is one-shot and
  reverts after first use.
- Impact: governance following the runbook literally can revert or leave fee
  crediting disabled after a voting-engine rotation.
- Suggested fix: update the runbook to use `addFeeCreditor` for post-deploy
  rotations and reserve `initializeFeeCreditor` for initial wiring only.

### P2 - Settings E2E still asserts retired World Chain wallet-funding copy

Status: still open from the previous audit.

- Files:
  - `packages/nextjs/e2e/tests/settings.spec.ts:107`
  - `packages/nextjs/components/settings/WalletSettingsPanel.tsx:113`
  - `packages/nextjs/lib/thirdweb/walletFunding.ts:3`
  - `packages/nextjs/e2e/playwright.config.ts:122`
  - `packages/nextjs/e2e/playwright.config.ts:127`
- Evidence: `settings.spec.ts` expects
  `ETH top-up is available on World Chain mainnet deployments.`, while the
  component now renders generic live-deployment copy and direct thirdweb Pay
  funding support is currently Base-mainnet-only.
- Impact: broad `ci-app`/`chromium` E2E projects can fail when this assertion is
  reached, and the test documents the wrong Base-first rollout behavior.
- Suggested fix: update the assertion to current copy and add explicit Base
  Sepolia unavailable/Base mainnet available coverage.

### P2 - Upgradeability docs omit proxy-backed contracts

Status: new finding in this pass.

- Files:
  - `packages/foundry/README.md:130`
  - `packages/foundry/README.md:133`
  - `packages/foundry/script/Deploy.s.sol:217`
  - `packages/foundry/script/Deploy.s.sol:252`
  - `packages/foundry/script/Deploy.s.sol:273`
  - `packages/foundry/scripts/check-storage-layouts.sh:33`
- Evidence: the README architecture section lists proxy-backed contracts but
  omits `RaterRegistry`, `ConfidentialityEscrow`, and `FeedbackRegistry`, then
  says identity/helper contracts are non-upgradeable. The deploy script deploys
  all three behind `TransparentUpgradeableProxy`, and the storage-layout gate
  includes them.
- Impact: upgrade/governance readers can miss proxy-admin and storage-layout
  obligations for those contracts.
- Suggested fix: update the architecture/runbook text so the proxy-backed list
  matches the storage-layout gate.

### P3 - Several API chainId parsers accept suffixed junk

Status: new finding in this pass.

- Files:
  - `packages/nextjs/app/api/agent/asks/by-client-request/route.ts:16`
  - `packages/nextjs/app/api/agent/results/by-client-request/route.ts:16`
  - `packages/nextjs/app/api/leaderboard/route.ts:53`
  - `packages/nextjs/lib/mcp/tools.ts:2514`
  - `packages/nextjs/lib/mcp/tools.ts:2541`
  - `packages/nextjs/lib/mcp/tools.ts:2859`
  - `packages/nextjs/utils/env/targetNetworks.ts:22`
- Evidence: several request/tool parsers use `Number.parseInt(...)`, so
  `Number.parseInt("84532abc", 10)` becomes `84532`. The target-network env
  parser already uses a stricter all-digits check.
- Impact: malformed API or MCP requests can route to a real chain instead of
  returning a 400/tool error. This is low-severity input hygiene, but it can make
  agent lookups, audit exports, dry-run IDs, and cache/rate-limit semantics
  confusing.
- Suggested fix: introduce a shared strict positive-integer parser for chain IDs
  and add `84532abc` rejection tests for the affected routes/tools.

### P3 - Certora/formal-verification rationale docs are still referenced but absent

Status: still open from the previous audit.

- Files:
  - `.github/workflows/certora.yaml:16`
  - `packages/foundry/Makefile:130`
  - `packages/foundry/certora/README.md:148`
  - `packages/foundry/certora/specs/ClusterPayoutOracle.spec:30`
  - `packages/foundry/certora/specs/RoundVotingEngineLifecycle.spec:15`
  - `packages/foundry/certora/specs/QuestionRewardPoolEscrow.spec:19`
- Evidence: comments and workflow docs reference files such as
  `docs/testing/certora.md`, `docs/testing/certora-round3-plan.md`,
  `docs/testing/certora-security-findings.md`, and
  `docs/testing/certora-followup.md`, but `docs/testing/` is not tracked.
- Impact: formal-verification coverage boundaries and deferred-proof rationale
  are hard to audit from the repo.
- Suggested fix: restore/add the missing docs or update the references to
  current tracked Certora documentation.

### P3 - Retired World Chain mainnet readiness remains exposed as an active root script

Status: still open from the previous audit.

- Files:
  - `package.json:75`
  - `scripts/check-worldchain-mainnet-readiness.mjs:143`
  - `.github/workflows/worldchain-mainnet-readiness.yaml:17`
  - `docs/env-parity.md:15`
- Evidence: the workflow is retired and only echoes a retired-path message, but
  root `package.json` still exposes `worldchain:check`. The checker still
  requires production env to target chain `480`, while current production-style
  testing intentionally targets Base Sepolia `84532`.
- Impact: operators can discover and run a stale command that fails as if it
  were an actionable readiness problem.
- Suggested fix: remove or rename the root script to make its legacy status
  explicit, or have it emit the same retired-path message as the workflow.

### P3 - README still points to an older audit as the latest re-audit

Status: still open from the previous audit, and made more stale by this document.

- Files:
  - `README.md:56`
  - `README.md:58`
  - `docs/repo-audit-2026-06-18-recheck.md`
  - `docs/repo-audit-2026-06-18-follow-up.md`
- Evidence: README still links `docs/repo-audit-2026-06-18-recheck.md` as the
  "latest repo re-audit", but two later audit artifacts now exist.
- Impact: readers following the top-level README can land on a stale findings
  list and miss current blockers.
- Suggested fix: after accepting this document, update the README pointer to the
  newest audit artifact or replace it with a stable audit index.

### P3 - Pull request checklist still under-represents current gates

Status: still open from the previous audit.

- Files:
  - `.github/pull_request_template.md:13`
  - `.github/pull_request_template.md:16`
  - `package.json:61`
  - `package.json:106`
  - `.github/workflows/base-sepolia-readiness.yaml:43`
  - `.github/workflows/unit-tests.yaml:12`
  - `.github/workflows/e2e.yaml:43`
- Evidence: the PR template asks for Foundry tests, Next lint, Next type check,
  and local `yarn start`. Current CI also depends on contract size, Base Sepolia
  readiness, broader TypeScript/package tests, and E2E matrix jobs. Root
  `yarn test` is Foundry-only.
- Impact: contributors can check every box while still missing gates enforced by
  CI.
- Suggested fix: refresh the checklist to match current CI at a high level.

## Non-findings and expected gates

- `yarn base-sepolia:check` passes offline against the current Base Sepolia
  deployment artifact.
- `yarn base:check` fails closed with
  `Base mainnet is not deployed: missing packages/foundry/deployments/8453.json.`
  This is expected because Base mainnet is not deployed/promoted.
- `yarn sdk:test`, `yarn sdk:check-types`, and
  `yarn workspace @rateloop/agents test` pass when run one at a time. A
  concurrent SDK/agents run briefly failed while both touched
  `packages/contracts/dist`; the solo reruns passed, so this was not counted as
  a source finding.
- The 5 USDC `ClusterPayoutOracle` challenge bond and 60-minute reveal grace
  period remain accepted product/security parameters and are not findings.

## Verification log

Commands/checks run by the main audit pass:

```text
git status --short --branch
git rev-parse --short HEAD
git log --oneline -5
yarn base-sepolia:check
yarn base:check
make check-contract-sizes
yarn test:node
yarn contracts:test
yarn next:check-types
yarn workspace @rateloop/nextjs exec node ../../scripts/run-node-tests.mjs app/api/agent/routes.test.ts
yarn sdk:test
yarn sdk:check-types
yarn workspace @rateloop/agents test
yarn workspace @rateloop/keeper test
yarn workspace @rateloop/ponder test
yarn workspace @rateloop/foundry test
node probes for listMissingRequiredTargetContracts, validateLocalDeploymentSync, E2E helper import, and parseInt behavior
```

Results:

- Passing:
  - `yarn base-sepolia:check`
  - `yarn test:node` (153 tests)
  - `yarn contracts:test` (37 tests)
  - `yarn next:check-types`
  - `yarn sdk:test` (51 tests)
  - `yarn sdk:check-types` when rerun alone
  - `yarn workspace @rateloop/agents test` (81 tests) when rerun alone
  - `yarn workspace @rateloop/keeper test` (228 passed, 1 skipped)
  - `yarn workspace @rateloop/ponder test` (348 passed, 1 skipped)
  - `yarn workspace @rateloop/foundry test` (1,805 tests)
- Expected failure:
  - `yarn base:check` fails because `packages/foundry/deployments/8453.json` is
    absent.
- Current failures:
  - `make check-contract-sizes` fails for `ContentRegistry` and
    `QuestionRewardPoolEscrow`.
  - focused Next.js agent route tests fail 46/46 because generated local
    deployment definitions miss `31337:ConfidentialityEscrow`.
  - importing `packages/nextjs/e2e/helpers/contracts.ts` fails because
    `chain31337.ConfidentialityEscrow` is undefined.
