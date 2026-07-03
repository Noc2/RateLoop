# Non-Contract Current-Head Review Final Pass - 2026-07-03

Reviewed head: `5a971adba84306b2d471c38f764485152cc95c5c` on `main`.

Scope: non-Solidity application code, Next.js app/API/client surfaces, Ponder APIs, keeper runtime/config/docs, agents package, SDK-facing examples, public docs, repo scripts, tests, package metadata, and CI/config. Smart contracts, Solidity implementation review, Foundry Solidity tests, and generated contract metadata were excluded. Contract documentation was reviewed only for documentation consistency, not as a smart-contract audit.

The local branch matched `origin/main` at the beginning of the pass, then an existing local docs commit (`5a971adba`) was already ahead of `origin/main` before this report was written. The worktree was clean before this report file was added.

Four read-only agents reviewed separate non-contract slices in parallel:

- Next.js app/API/client feedback and browser UX paths.
- Ponder, keeper, SDK, node-utils, and backend/runtime packages.
- Agents package, MCP/browser-handoff examples, and agent CLI/docs.
- Repo-level scripts, docs, tests, CI/config, and package metadata.

## Verification

- `yarn dead-code` - passed with no findings.
- `node ../../scripts/run-node-tests.mjs app/api/agent-callbacks/routes.test.ts app/api/attachments/images/sweep/route.test.ts app/api/confidentiality/disclosure/reconcile/route.test.ts app/api/confidentiality/log-roots/publish/route.test.ts app/api/agent/policies/routes.test.ts` from `packages/nextjs` - 20 passed.
- `node scripts/run-node-tests.mjs scripts/docs-public-copy.test.mjs scripts/readiness-workflows.test.mjs scripts/check-base-mainnet-readiness.test.mjs scripts/check-worldchain-mainnet-readiness.test.mjs scripts/check-worldchain-sepolia-readiness.test.mjs` - 83 passed.
- `yarn workspace @rateloop/agents lint:questions` - run by the agents-slice reviewer; bundled question examples passed.

One first script-test attempt included a non-existent `scripts/check-base-sepolia-readiness.test.mjs` path and failed with `ENOENT`; the corrected script/readiness test list above passed.

## Summary

No critical or high-severity non-contract issues were found. Four medium issues remain because they can block user-visible flows or create runtime/operator inconsistency. Six low issues are documentation, schema, or consistency issues that should be fixed before the next release polish pass.

| ID | Severity | Status | Finding |
| --- | --- | --- | --- |
| NC-FP-2026-07-03-1 | Medium | Open | Bundle claim candidates are not identity-scoped for wallets with multiple rater identities. |
| NC-FP-2026-07-03-2 | Medium | Open | Keeper file artifact mode can publish unfetchable artifact URLs when metrics are disabled. |
| NC-FP-2026-07-03-3 | Medium | Open | MCP create-handoff schema rejects the documented wrapped request shape. |
| NC-FP-2026-07-03-4 | Medium | Open | Already-published feedback retries can skip local feedback reconciliation. |
| NC-FP-2026-07-03-5 | Low | Open | Feedback counts can include protocol-indexed rows while the feedback list is empty during local storage outage. |
| NC-FP-2026-07-03-6 | Low | Open | Published-package quickstart uses monorepo-only `yarn agents:*` scripts. |
| NC-FP-2026-07-03-7 | Low | Open | Canonical TypeScript agent example still defaults to the legacy signing-intent path. |
| NC-FP-2026-07-03-8 | Low | Open | Managed remote MCP example implies a non-standard client-side wallet scope. |
| NC-FP-2026-07-03-9 | Low | Open | Next.js README understates the PR/push E2E matrix. |
| NC-FP-2026-07-03-10 | Low | Open | `e2e:full` docs overstate local Playwright coverage. |

## Findings

### NC-FP-2026-07-03-1 - Bundle claim candidates are not identity-scoped

The Ponder `/question-bundle-claim-candidates` query groups candidates by bundle and round set, but not by `vote.identityKey`. It then resolves the payout proof by selecting the first revealed vote from bundle index 0 for the supplied address list. If a wallet set has multiple rater identities, the SQL can count bundle completion across identities while proof resolution picks one arbitrary first-round identity.

Impact: a valid bundle claim can disappear from `claimableItems`, or a candidate can be surfaced that no single identity can claim. This hurts reward UX without changing the underlying contract behavior.

Evidence:

- `packages/ponder/src/api/routes/data-routes.ts:609` joins `vote` by content/round and voter address.
- `packages/ponder/src/api/routes/data-routes.ts:644` through `:676` groups and requires `count(distinct bundleIndex)` without grouping by `vote.identityKey`.
- `packages/ponder/src/api/routes/data-routes.ts:222` through `:243` re-selects the first bundle-index-0 vote and uses that identity for the proof.
- `packages/ponder/src/api/routes/data-routes.ts:712` through `:716` drops proof-required candidates when proof resolution returns null.

Suggested fix:

1. Make bundle claim candidates identity-scoped by selecting and grouping by `vote.identityKey` and the associated identity holder.
2. Require `count(distinct bundleIndex)` per identity, not across the whole supplied wallet/address set.
3. Pass the selected identity key/commit key into proof resolution instead of re-querying the first bundle round vote.
4. Add a Ponder regression where two addresses or identity keys split a bundle and only one identity has a valid full bundle.

### NC-FP-2026-07-03-2 - Keeper file artifact mode can publish unfetchable artifact URLs

Automatic correlation snapshots with `KEEPER_CORRELATION_ARTIFACT_STORAGE=file` write artifact JSON to disk and propose `publicBaseUrl/<hash>.json` on-chain. The built-in file-serving route lives on the metrics server. Config validates public URL and non-loopback bind address for public file artifacts, but it does not reject `METRICS_ENABLED=false`.

Impact: an operator can run the keeper in a configuration that writes and proposes public artifact URIs, while the bundled runtime never starts the route that serves those files. That weakens decentralized auditability because challengers and frontends may not be able to fetch the artifact named on-chain.

Evidence:

- `packages/keeper/src/config.ts:494` through `:504` computes public file-artifact exposure independently of `metricsEnabled`.
- `packages/keeper/src/config.ts:802` through `:807` parses `METRICS_ENABLED` after those file-artifact booleans.
- `packages/keeper/src/index.ts:154` through `:168` only mounts the artifact directory when `config.metricsEnabled` starts the metrics server.
- `packages/keeper/src/correlation-artifact-storage.ts:38` through `:45` writes the file and returns the public artifact URI.
- `packages/keeper/src/correlation-snapshots.ts:1463` through `:1476` proposes that artifact URI to the oracle.

Suggested fix:

1. Reject `publishesPublicFileArtifacts && !metricsEnabled` unless an explicit external artifact server mode is configured.
2. Alternatively split artifact serving from the metrics flag and validate that artifact-serving endpoint separately.
3. Add a keeper config test for `KEEPER_CORRELATION_ARTIFACT_STORAGE=file`, public base URL set, and `METRICS_ENABLED=false`.

### NC-FP-2026-07-03-3 - MCP create-handoff schema rejects the documented wrapped request shape

The MCP tool implementation accepts a wrapped handoff input like `{ request, generatedImages, ttlMs }`, but the advertised input schema still requires top-level `clientRequestId`, `bounty`, and `maxPaymentAmount`.

Impact: schema-driven MCP clients can reject the recommended browser handoff call before it reaches RateLoop. That blocks the preferred human-wallet UX for generated images and browser-reviewed funding.

Evidence:

- `packages/nextjs/lib/agent/schemas.ts:534` through `:539` documents the optional wrapped `request` object.
- `packages/nextjs/lib/agent/schemas.ts:552` still requires unwrapped `clientRequestId`, `bounty`, and `maxPaymentAmount`.
- `packages/nextjs/lib/mcp/tools.ts:711` through `:719` accepts `args.request` and strips wrapper-only fields for unwrapped calls.
- `packages/sdk/src/agent.ts:266` through `:276` exposes `CreateAskHandoffRequest` as either unwrapped ask fields or wrapped `{ request }`.
- `packages/sdk/README.md:280` through `:285` recommends `createAskHandoff({ request, generatedImages })`.

Suggested fix:

1. Change the handoff input schema to an `anyOf`/`oneOf` style shape: wrapped `{ request, generatedImages?, ttlMs? }` or unwrapped ask fields.
2. Keep `clientRequestId`, `bounty`, and `maxPaymentAmount` required only in the unwrapped branch.
3. Add a schema regression for the SDK-documented wrapped handoff payload.

### NC-FP-2026-07-03-4 - Already-published feedback retries skip local reconciliation

`useContentFeedback` detects when the on-chain feedback publication already exists and immediately returns success after invalidating the query. It skips the `/api/feedback` POST that saves or reconciles the local feedback row. The server route explicitly accepts `publicationTxHash: null` and verifies the already-published feedback on-chain before saving.

Impact: if the browser or API call fails after the on-chain feedback transaction but before local storage, a retry can report success while the feedback panel remains missing the local row.

Evidence:

- `packages/nextjs/hooks/useContentFeedback.ts:431` through `:434` returns early when `publishedFeedback.alreadyPublished`.
- `packages/nextjs/hooks/useContentFeedback.ts:435` through `:454` is the skipped local `/api/feedback` reconciliation call.
- `packages/nextjs/app/api/feedback/route.ts:147` through `:150` accepts `publicationTxHash: null`.
- `packages/nextjs/app/api/feedback/route.ts:205` through `:223` verifies on-chain publication, then saves the local feedback row.
- `packages/nextjs/app/api/feedback/route.ts:225` through `:235` treats an identical duplicate as success.

Suggested fix:

1. In the `alreadyPublished` branch, still call `/api/feedback` with the signed payload and `publicationTxHash: null`.
2. Keep duplicate success handling as the idempotent recovery path.
3. Add a hook or route regression for the "published on-chain, local row missing, retry submit" scenario.

### NC-FP-2026-07-03-5 - Feedback counts and list can diverge during storage outage

`listContentFeedback` returns an empty result immediately when local feedback storage is unavailable. `listContentFeedbackCounts` handles the same storage-unavailable case by continuing with `rows = []` and then counting protocol-indexed feedback.

Impact: the UI can show a nonzero feedback count from protocol-indexed data while the feedback panel opens empty, making it look like feedback disappeared.

Evidence:

- `packages/nextjs/lib/feedback/contentFeedback.ts:1237` through `:1249` returns empty from `listContentFeedback` on storage-unavailable errors.
- `packages/nextjs/lib/feedback/contentFeedback.ts:1255` through `:1261` is the protocol-indexed fallback that is skipped by that early return.
- `packages/nextjs/lib/feedback/contentFeedback.ts:1324` through `:1327` keeps counts going with `rows = []`.
- `packages/nextjs/lib/feedback/contentFeedback.ts:1341` through `:1349` counts protocol feedback even without local rows.

Suggested fix:

1. Make `listContentFeedback` mirror the counts path: set local rows/counts to empty on storage-unavailable and continue to `listProtocolContentFeedback`.
2. Add a regression where local feedback storage is unavailable but protocol-indexed feedback exists.

### NC-FP-2026-07-03-6 - Published-package quickstart uses monorepo-only scripts

The agents README says the package works "in any Node runtime" after `npm install`, but the immediate quickstart commands use root monorepo scripts. NPM consumers outside this repository do not have `yarn agents:templates` or `yarn agents:lint`.

Impact: first-time package users can follow the published quickstart and hit missing-script errors before they reach the working CLI.

Evidence:

- `packages/agents/README.md:37` through `:45` combines `npm install @rateloop/sdk @rateloop/agents` with `yarn agents:*` commands.
- `package.json:82` through `:95` defines those `agents:*` scripts only at the monorepo root.
- `packages/agents/package.json:21` exposes the consumer CLI as `rateloop-agents`.

Suggested fix:

1. Split the README into "npm package" and "monorepo checkout" quickstarts.
2. Use `npx rateloop-agents templates` and `npx rateloop-agents lint --file ...` for the npm package path.
3. Keep root `yarn agents:*` examples only in the monorepo section.

### NC-FP-2026-07-03-7 - Canonical TypeScript agent example still defaults to signing intents

The examples README says human wallets should prefer browser handoff links, but the canonical TypeScript loop still calls `agent.createSigningIntent()` by default when there is no managed MCP token and raw wallet calls are not explicitly enabled.

Impact: agents copying the canonical example miss the current browser handoff flow: draft review/editing, generated-image staging, handoff status polling, and the safer "do not paste wallet calls/signatures" UX.

Evidence:

- `packages/agents/examples/README.md:3` through `:10` says to prefer a browser handoff link for human wallets.
- `packages/agents/examples/landing-pitch-review.ts:88` through `:97` creates a signing intent and prints `signingUrl`.
- `packages/sdk/README.md:280` through `:285` says live human-wallet asks should prefer `createAskHandoff({ request, generatedImages })`.

Suggested fix:

1. Update `landing-pitch-review.ts` to call `agent.createAskHandoff({ request: askPayload, ttlMs })`, print `handoffUrl`, and poll `getAskHandoffStatus`.
2. If signing intents still matter for a specialized path, label that branch explicitly as legacy/specialized.

### NC-FP-2026-07-03-8 - Managed remote MCP example implies client-side wallet scoping

`generic-remote-mcp.json` includes a top-level `walletAddress` inside the MCP server config object. That field is not a standard MCP server field, and the RateLoop MCP server gets scoped wallets from managed server-side policy/static env or from explicit tool arguments.

Impact: a client can ignore this non-standard field while the operator believes the managed wallet was scoped. The first tokenless ask can then fail with `walletAddress is required`, or the operator can misunderstand where wallet authorization lives.

Evidence:

- `packages/agents/examples/generic-remote-mcp.json:3` through `:10` puts `walletAddress` beside `url`, `transport`, and `headers`.
- `packages/nextjs/.env.example:67` shows managed agent wallet scoping via server-side `RATELOOP_MCP_AGENTS`.
- `packages/nextjs/app/api/agent/routes.test.ts:3117` through `:3130` verifies tokenless asks require explicit `walletAddress`.

Suggested fix:

1. Remove the non-standard field from the generic config, or mark it as client-specific if a known client consumes it.
2. Add a nearby note that managed wallet scoping belongs in RateLoop-managed token/server policy, while public wallet-mode calls must pass `walletAddress` explicitly.

### NC-FP-2026-07-03-9 - Next.js README understates the PR/push E2E matrix

The Next.js README says CI runs smoke, app, responsive, accessibility, lifecycle, and keeper-backed suites. The workflow also runs API, submit, confidential, and World ID suites on pushes and PRs. The root README already has the more complete list.

Impact: contributors can miss the right focused suite while reproducing CI failures, or misunderstand what CI protects.

Evidence:

- `packages/nextjs/README.md:42` lists an incomplete CI matrix.
- `.github/workflows/e2e.yaml:50` through `:79` includes API, submit, confidential, and World ID suites.
- `README.md:245` lists the broader PR/push matrix accurately.

Suggested fix:

1. Update the package README CI sentence to match the workflow/root README.
2. Keep the scheduled-only browser-compat and mobile distinction explicit.

### NC-FP-2026-07-03-10 - `e2e:full` docs overstate local Playwright coverage

The docs call `e2e:full` the full local Playwright suite. The script is broad, but it does not include the separately defined accessibility and browser-compatibility projects.

Impact: someone using the docs as a release checklist can believe they ran all local Playwright coverage while skipping accessibility and cross-browser checks.

Evidence:

- `packages/nextjs/README.md:37` calls `e2e:full` the full local Playwright suite.
- `README.md:238` through `:239` labels it "Full local E2E run."
- `packages/nextjs/package.json:49` defines `e2e:full` without `accessibility-axe` or compat browser projects.
- `packages/nextjs/package.json:40` through `:41` define `e2e:a11y` and `e2e:compat` separately.

Suggested fix:

1. Rename the docs to "broad local app/lifecycle/mobile suite", or add an explicit note that `e2e:a11y` and `e2e:compat` are separate.
2. If the desired behavior really is full local coverage, update the script or add a new aggregate command.

## Notes

- The previous post-remediation report items around LREP bounty waits, ProtocolConfig treasury reads, strict agent numerics, reward asset linting, fresh redeploy copy, and generated local deployment exports were not carried forward as open findings because current HEAD contains the corresponding fixes.
- Several `World Chain` and `Base Sepolia` references remain intentionally historical, legacy, testnet, or readiness-related and were not treated as findings.
- Local `.env` files seen in the filesystem are ignored; the only tracked production env file checked in this pass was `packages/nextjs/.env.production`, which contains public defaults and an empty secret placeholder.
