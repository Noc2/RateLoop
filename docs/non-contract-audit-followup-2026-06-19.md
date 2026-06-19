# Non-Contract Audit Follow-Up - 2026-06-19

Scope: application, Ponder, Keeper, agents, SDK-adjacent tooling, docs, and CI/readiness surfaces. This follow-up does not inspect Solidity implementation details or propose smart contract changes. Base mainnet is treated as the production deployment boundary and Base Sepolia as staging/validation.

This pass used three read-only explorer agents plus local static review and verification commands. No fixes are included in this document.

## Findings

### P2 - Confidential gated-context access is still primary-deployment scoped

Evidence:

- `packages/nextjs/lib/confidentiality/context.ts:174` resolves the current confidentiality deployment with `getPrimaryServerTargetNetwork()`.
- `packages/nextjs/app/api/confidentiality/terms/route.ts:62` and `packages/nextjs/app/api/confidentiality/context/route.ts:35` normalize only `address` and `contentId`, with no `chainId` or deployment key.
- Client calls also omit chain scope: `packages/nextjs/components/vote/ConfidentialContextGate.tsx:238`, `packages/nextjs/lib/confidentiality/clientTermsStatus.ts:6`, and `packages/nextjs/hooks/useGatedContextManifest.ts:37`.

Impact: in any multi-target or non-primary path, gated-context terms, read sessions, viewer checks, bond checks, breach reports, and `after_settlement` disclosure can resolve against the wrong deployment. A rater can be interacting with one chain while the server checks the primary chain, and overlapping `contentId` values can point at the wrong hosted context.

Suggested repair direction: plumb a validated `chainId` or deployment key through confidentiality terms, challenge/session, context, breach, disclosure, client hook, query key, and MCP gated-helper flows. Resolve DB scope and on-chain gate clients from that chain, and reject unsupported or mismatched chains explicitly.

### P2 - Keeper accepts Ponder work without verifying deployment identity

Evidence:

- `packages/keeper/src/keeper.ts:562` fetches `/keeper/work` from `PONDER_BASE_URL`.
- `packages/keeper/src/keeper.ts:589` through `packages/keeper/src/keeper.ts:605` authenticates the request and parses work, but does not compare the remote Ponder deployment to the Keeper's configured chain or contract addresses.
- Ponder already exposes deployment metadata at `packages/ponder/src/api/index.ts:130`, backed by `chainId`, registry addresses, and `deploymentKey` in `packages/ponder/src/protocol-deployment.ts:102`.

Impact: a Base mainnet Keeper pointed at Base Sepolia or a legacy World Chain Ponder can consume wrong candidate sets, waste gas or RPC, miss real work, or act on overlapping IDs. The bearer token proves access to that Ponder instance, not that the instance is the matching deployment.

Suggested repair direction: on startup or first Ponder fetch, call `/deployment` and require `chainId`, `contentRegistryAddress`, `feedbackRegistryAddress`, or `deploymentKey` to match Keeper's resolved shared artifacts. Fail closed in production; development can keep a clear fallback warning.

### P3 - Secondary Ponder profile and submitter endpoints can disclose moderated metadata

Evidence:

- `/submitter-settled-rounds` filters only by submitter and settled state at `packages/ponder/src/api/routes/content-routes.ts:1562` through `packages/ponder/src/api/routes/content-routes.ts:1579`.
- Public profile summary counts all submitted content at `packages/ponder/src/api/routes/content-routes.ts:1723` through `packages/ponder/src/api/routes/content-routes.ts:1726`.
- The recent-submissions path correctly applies `buildAllowedContentCondition` at `packages/ponder/src/api/routes/content-routes.ts:1838` through `packages/ponder/src/api/routes/content-routes.ts:1845`.

Impact: blocked or moderated content can still be inferred through content IDs, round IDs, or aggregate counts even when main listing routes hide it.

Suggested repair direction: apply the same allowed-content predicate to submitter settled rounds and public profile content counts, or explicitly split public counts from trusted/admin totals.

### P3 - Rendered public AI docs still point paid asks at Base Sepolia

Evidence:

- `packages/nextjs/app/(public)/docs/ai/page.tsx:31` uses `"chainId": 84532` in the rendered ask payload example.
- `packages/nextjs/app/(public)/docs/ai/page.tsx:346` tells users to put the wallet on Base Sepolia.
- `packages/nextjs/app/(public)/docs/ai/errors/page.tsx:176` shows an audit URL with `chainId=84532`.
- The Markdown runbook now says examples use Base mainnet `8453` and Base Sepolia `84532` only for staging/testnet validation at `packages/nextjs/public/docs/ai.md:9`.

Impact: public `/docs/ai` users and agent integrators can follow the rendered page into staging while the static runbook and current production boundary point to Base mainnet.

Suggested repair direction: update rendered React docs and error examples to default paid production asks to `8453`, with `84532` explicitly labeled as staging/testnet.

### P3 - Production readiness workflow and PR checklist are inconsistent

Evidence:

- `.github/pull_request_template.md:18` asks contributors to run `yarn base-mainnet:check`.
- `package.json:73` exposes the production readiness script as `yarn base:check`, and `yarn base-mainnet:check` currently fails with "Couldn't find a script named \"base-mainnet:check\"."
- `.github/workflows/base-mainnet-readiness.yaml:3` is `workflow_dispatch` only, while `.github/workflows/base-sepolia-readiness.yaml:3` through `.github/workflows/base-sepolia-readiness.yaml:12` runs on push, PR, schedule, and manual dispatch.
- `scripts/readiness-workflows.test.mjs:30` through `scripts/readiness-workflows.test.mjs:37` asserts only the Base Sepolia active trigger set.

Impact: production readiness regressions can merge without the same automatic offline gate used for staging, and contributors following the PR template hit a dead command when production env or deployment wiring changes.

Suggested repair direction: either add a `base-mainnet:check` alias or update the PR template to `base:check`. Add push/PR offline Base mainnet readiness while keeping live probes conditional, and extend workflow tests to assert the production gate.

### P3 - Operator docs and tests still preserve pre-Base-production semantics

Evidence:

- `scripts/docs-public-copy.test.mjs:42` names the expectation "static public docs keep Base mainnet gated behind promotion" even though Base mainnet is now production.
- `packages/foundry/README.md:62` still says "After Base Sepolia passes, deploy Base mainnet and run `base:check -- --live`."
- `README.md:166` tells Keeper operators to set contract addresses, while live Keeper config resolves non-local addresses from shared deployment artifacts and treats overrides as local-only in `packages/keeper/.env.example`.
- `scripts/check-worldchain-mainnet-readiness.mjs:137` still validates World Chain mainnet production USDC defaults, while `.github/workflows/worldchain-mainnet-readiness.yaml:1` marks the workflow retired.

Impact: tests can stay green while guarding old intent, and operators can be sent toward routine redeployment or stale live address overrides even though the intended posture is to preserve current Base mainnet contract addresses.

Suggested repair direction: update public-copy tests to assert `8453` production and `84532` staging, reword deployment docs as preservation/readiness runbooks rather than routine redeploy instructions, and make retired World Chain scripts exit with an explicit "use Base readiness" notice or move them under legacy tooling.

### P3 - Agent local signer lacks chain-scoped USDC override parity

Evidence:

- Next.js supports chain-scoped USDC env names through `readChainScopedEnv` in `packages/nextjs/lib/env/server.ts:226`.
- The agent local signer reads only `RATELOOP_LOCAL_SIGNER_USDC_ADDRESS` or unscoped `RATELOOP_X402_USDC_ADDRESS` at `packages/agents/src/localSigner.ts:3116` through `packages/agents/src/localSigner.ts:3119`.
- `docs/env-parity.md:35` through `docs/env-parity.md:38` documents chain-scoped Next.js vars but only unscoped local signer vars.

Impact: staging or custom deployments that rely on `RATELOOP_X402_USDC_ADDRESS_84532`, `RATELOOP_X402_USDC_ADDRESS_8453`, or local-signer-specific chain-scoped overrides can have app planning and local signer validation disagree.

Suggested repair direction: after the signer chain is known, resolve `RATELOOP_LOCAL_SIGNER_USDC_ADDRESS_<chainId>` and `RATELOOP_X402_USDC_ADDRESS_<chainId>` before falling back to unscoped names, then document precedence in `docs/env-parity.md` and `.env.example`.

## Verification Notes

Passed:

- `yarn base:check`
- `yarn base-sepolia:check`
- `yarn next:lint`
- `yarn next:check-types` after workspace dependencies were built
- `node --test scripts/docs-public-copy.test.mjs`
- `node --test scripts/readiness-workflows.test.mjs`

Expected/limited failures:

- `yarn base-mainnet:check` failed because the script does not exist. This supports the PR checklist finding.
- A direct `yarn next:check-types` before workspace dependency build failed because `@rateloop/node-utils` subpath types were not present in `dist`; the same command passed after the broader workspace gate built dependencies.
- `yarn test:ts` progressed through the broader workspace checks but stopped at `packages/keeper/src/__tests__/metrics.test.ts` with `listen EPERM: operation not permitted 127.0.0.1` in this sandbox. I treated that as an environment limitation, not an application finding.

Not counted as findings:

- `packages/agents/examples/*` defaulting to Base Sepolia appears intentional for local signer/test-wallet examples, because `packages/agents/README.md:169` says those examples should stay on testnet USDC.
- Smart contract implementation changes remain out of scope for this pass.
