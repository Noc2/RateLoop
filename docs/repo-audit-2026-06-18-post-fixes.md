# RateLoop Repo Re-Audit - Bugs & Inconsistencies (18 June 2026, post-fixes)

Read-only re-audit of the RateLoop monorepo at HEAD `363e6a0f`
(`Keep local E2E wallet on wagmi bridge`), after the previous June 18 audit
remediation batch and the follow-up local frontend fixes already present on
`main`.

Scope: bugs, inconsistencies, stale gates, docs drift, and operational drift.
Application code was not changed for this audit; this document is the only
intended repository change.

Three explorer agents reviewed independent slices in parallel:

- Solidity/foundry deployment paths
- Next.js/API/SDK/agents docs and flows
- Keeper/Ponder/readiness/ops

Load-bearing findings below were re-checked in the main workspace against
source, tests, and command output.

## TL;DR

No new High-severity contract or fund-loss issue was confirmed.

The strongest confirmed issues are:

1. The SDK agent README example configures `apiBaseUrl` to Ponder and then calls
   `quoteQuestion`/`askHumans`, but the SDK prefers direct HTTP when
   `apiBaseUrl` is present, so the example routes those writes to a host that
   does not expose `/api/agent`.
2. `local-ask` executes and confirms only the ask transaction plan; when the MCP
   ask confirmation returns a second Feedback Bonus transaction plan, local
   signer does not execute or confirm it.
3. Ponder docs say Railway ignores the stale
   `rateloop_ponder_base_sepolia_canary` schema override, but the resolver only
   ignores `rateloop_ponder_worldchain_canary`.
4. Browser-side USDC override validation can miss conflicts between
   chain-scoped public vars and unscoped x402 vars that the server checks for
   the same chain.

Base Sepolia offline readiness remains green. Base mainnet remains
intentionally blocked until `packages/foundry/deployments/8453.json` exists.

## Verification Snapshot

| Check | Result |
| --- | --- |
| `yarn base-sepolia:check` | Pass |
| `yarn test:node` | Pass, 134 tests |
| `yarn next:check-types` | Pass |
| `yarn workspace @rateloop/foundry check:sizes` | Pass; all checked deploy-profile bytecode under EIP-170 |
| `yarn workspace @rateloop/keeper test` | Pass, 220 tests, 1 skipped |
| `yarn workspace @rateloop/ponder test` | Pass, 340 tests, 1 skipped |
| `yarn dead-code:scan` | Completed with one unused exported type |
| `yarn base:check` | Expected fail: missing `packages/foundry/deployments/8453.json` |
| `yarn worldchain:check` | Manual-only legacy gate fails because `.env.production` intentionally targets Base Sepolia |

Deploy-profile size output from the passing package script:

| Contract | Size (B) | Headroom (B) |
| --- | ---: | ---: |
| `LaunchDistributionPool` | 24,561 | 15 |
| `ContentRegistry` | 24,509 | 67 |
| `QuestionRewardPoolEscrow` | 24,503 | 73 |
| `RoundVotingEngine` | 24,092 | 484 |
| `RaterRegistry` | 22,900 | 1,676 |

## High

None confirmed.

## Medium

### M1 - SDK agent README example routes quote/ask calls to Ponder

**Severity:** Medium (copy/paste integration failure for agent writes)

`packages/sdk/README.md:88-93` shows:

```ts
const agent = createRateLoopAgentClient({
  apiBaseUrl: "https://ponder.rateloop.ai",
  mcpApiUrl: "https://www.rateloop.ai/api/mcp/public",
});
```

The same example then calls `agent.quoteQuestion(...)` and later asks through
the agent client. In `packages/sdk/src/agent.ts:879-897`, `quoteQuestion`
chooses direct HTTP whenever `hasDirectAgentHttp(config)` is true and the
request has no Feedback Bonus. `askHumans` has the same direct-HTTP preference
at `packages/sdk/src/agent.ts:920-928` when `transport` is not explicitly
`"mcp"` and there is no Feedback Bonus.

That means the README's no-Feedback-Bonus quote/ask examples target
`https://ponder.rateloop.ai/api/agent/quote` and
`https://ponder.rateloop.ai/api/agent/asks`. Ponder exposes read/indexer routes,
not Next.js `/api/agent` write routes.

**Impact:** Integrators following the README can get 404/405 style failures for
agent writes even though they also configured a valid `mcpApiUrl`.

**Suggested fix/test:** update the README to either omit `apiBaseUrl` for
MCP-only agent write examples, set direct agent `apiBaseUrl` to the Next.js
origin, or force `transport: "mcp"` in the example. Add an SDK/README snippet
test or agent-client test that explicit `mcpApiUrl` examples do not silently
prefer Ponder for writes.

### M2 - `local-ask` does not complete second-phase Feedback Bonus funding

**Severity:** Medium (agent asks can submit without funding the requested
Feedback Bonus)

The agents README encourages optional `feedbackBonus` for MCP asks
(`packages/agents/README.md:26`) and says `local-ask` executes returned
`transactionPlan.calls` and confirms hashes (`packages/agents/README.md:135`).

The local signer flow validates and executes only `finalAsk.transactionPlan` at
`packages/agents/src/localSigner.ts:3165-3194`, then calls
`params.agent.confirmAskTransactions(confirmRequest)` and returns the confirmed
ask at `packages/agents/src/localSigner.ts:3194-3204`.

However, the Next.js handoff complete flow shows the expected two-phase shape:
after confirming the ask, it reads a Feedback Bonus transaction plan, stores
`feedback_bonus_prepared`, and tells the wallet to execute
`rateloop_confirm_feedback_bonus_transactions`
(`packages/nextjs/app/api/agent/handoffs/[handoffId]/complete/route.ts:78-110`).
The local signer has no corresponding call to
`confirmFeedbackBonusTransactions`; `rg` found that name only in SDK/MCP and
handoff code, not in `packages/agents/src/localSigner.ts`.

**Impact:** A `local-ask` payload with `feedbackBonus` can complete the question
ask transaction while leaving the bonus in an awaiting-wallet-signature state,
contrary to the CLI/docs expectation that the local signer sends the returned
plans end to end.

**Suggested fix/test:** after `confirmAskTransactions`, detect
`confirmed.feedbackBonus.transactionPlan`, validate the Feedback Bonus plan,
execute it, then call `confirmFeedbackBonusTransactions`. Add a local signer
test with an MCP response that returns a second-phase Feedback Bonus plan.

### M3 - Ponder Railway Base Sepolia schema collision guard is documented but not implemented

**Severity:** Medium (production deploy can reuse a schema that Ponder rejects
as belonging to another app)

`packages/ponder/README.md:127-132` says that when `RAILWAY_DEPLOYMENT_ID` is
set, the launcher ignores deprecated static overrides such as
`rateloop_ponder_base_sepolia_canary` and uses a deployment-scoped
`railway_<deployment_id>` schema.

The resolver's deprecated schema set only contains the World Chain canary value:
`packages/ponder/scripts/databaseSchema.mjs:11-12`.

Main-workspace confirmation:

```sh
yarn workspace @rateloop/ponder node -e "import { resolvePonderDatabaseSchema } from './scripts/databaseSchema.mjs'; console.log(JSON.stringify(resolvePonderDatabaseSchema({ PONDER_NETWORK: 'baseSepolia', RATELOOP_PONDER_DATABASE_SCHEMA: 'rateloop_ponder_base_sepolia_canary', RAILWAY_DEPLOYMENT_ID: '123e4567-e89b-12d3-a456-426614174000' }), null, 2));"
```

Output kept the stale override:

```json
{
  "schema": "rateloop_ponder_base_sepolia_canary",
  "source": "RATELOOP_PONDER_DATABASE_SCHEMA",
  "ignoredLegacyDatabaseSchema": false,
  "ignoredDeprecatedStaticSchema": false
}
```

**Impact:** A Railway Base Sepolia deploy that still has
`RATELOOP_PONDER_DATABASE_SCHEMA=rateloop_ponder_base_sepolia_canary` can keep
colliding with a previous Ponder app identity instead of being automatically
moved to the deployment-scoped schema promised by the docs.

**Suggested fix/test:** add `rateloop_ponder_base_sepolia_canary` to
`DEPRECATED_STATIC_RAILWAY_SCHEMAS` and cover it with a
`databaseSchema.mjs` test.

### M4 - Browser USDC override guard misses chain-scoped vs unscoped x402 conflicts

**Severity:** Medium (browser approvals/display can disagree with server x402
validation)

Browser `getDefaultUsdcAddress(chainId)` calls
`assertMatchingPublicUsdcOverrides(chainId)` and then falls back through
chain-scoped and unscoped public vars
(`packages/nextjs/lib/questionRewardPools.ts:125-144`).

For known chains, `getPublicUsdcAddressOverride(84532)` reads only
`NEXT_PUBLIC_USDC_ADDRESS_84532`, and
`getPublicX402UsdcAddressOverride(84532)` reads only
`NEXT_PUBLIC_RATELOOP_X402_USDC_ADDRESS_84532`
(`packages/nextjs/lib/questionRewardPools.ts:61-74`). The assertion therefore
does not compare `NEXT_PUBLIC_USDC_ADDRESS_84532` against an unscoped
`NEXT_PUBLIC_RATELOOP_X402_USDC_ADDRESS`.

Server `getX402UsdcAddressOverride(84532)` does compare the chain-scoped public
USDC value with the unscoped public x402 value because it uses
`readChainScopedEnv(...) ?? readEnv(...)` for each family
(`packages/nextjs/lib/env/server.ts:232-252`).

**Impact:** A config such as
`NEXT_PUBLIC_USDC_ADDRESS_84532=A` and
`NEXT_PUBLIC_RATELOOP_X402_USDC_ADDRESS=B` makes server x402 fail closed while
browser defaults silently use `A`. This is the same class of parity issue the
triple-env guard was meant to eliminate, just across chain-scoped/unscoped
fallbacks.

**Suggested fix/test:** have browser USDC resolution build the same effective
chain-scoped/unscoped candidate set as the server helper, and add tests for
chain-scoped public vs unscoped public-x402 conflicts.

## Low

### L1 - Production local-signer metadata URL env is required but omitted from docs/examples

**Severity:** Low (production setup docs drift)

`packages/agents/src/localSigner.ts:519-524` throws in production unless
`RATELOOP_LOCAL_SIGNER_QUESTION_METADATA_BASE_URL` or
`--question-metadata-base-url` pins the metadata base URL.

The CLI help mentions the flag, but the agents README config table at
`packages/agents/README.md:165-184` and
`packages/agents/.env.example:1-38` omit the environment variable.

**Impact:** Copying the documented `.env.example` can still leave production
`local-ask` unusable until the operator discovers the hidden required env.

### L2 - React AI docs page contains an invalid `imageUrls` example

**Severity:** Low (documentation drift)

`packages/nextjs/app/(public)/docs/ai/page.tsx:58-61` shows:

```json
"imageUrls": ["https://www.rateloop.ai/api/attachments/images/example-generated-concept.webp"]
```

The validator requires `/api/attachments/images/att_*.webp` and a
`#sha256=0x...` fragment (`packages/nextjs/lib/attachments/imageAttachmentUrls.ts:3-4`,
`imageAttachmentUrls.ts:81-85`). The Markdown public docs already use the
valid shape around `packages/nextjs/public/docs/ai.md:223-225`.

**Impact:** Users copying the React-rendered docs page will submit an image URL
that local validation rejects.

### L3 - Ponder env/docs still describe live address fallbacks that runtime rejects

**Severity:** Low (operator docs drift)

`packages/ponder/README.md:46-50` and
`packages/ponder/.env.example:28` describe `PONDER_*_ADDRESS` values as
fallbacks when the active chain has no shared deployment artifacts.

Runtime behavior is stricter for non-local networks:
`packages/ponder/ponder.config.ts:229-235` intentionally refuses required
contract env fallbacks without shared artifacts, and optional live artifacts
also fail closed at `ponder.config.ts:281-285`.

**Impact:** Operators bringing up Base mainnet before `8453.json` exists may
expect env-address fallback to work, while Ponder correctly requires shared
artifacts first.

### L4 - Dead-code scan reports an unused exported type

**Severity:** Low (cleanup)

`yarn dead-code:scan` reports:

```text
Unused exported types (1)
ThirdwebBatchSponsorshipMode  type  packages/nextjs/hooks/useThirdwebSponsoredSubmitCalls.ts:50:13
```

The type is still used internally in the same file, but it does not need to be
exported unless another module is meant to consume it.

### L5 - Base deploy branches have limited Solidity test depth

**Severity:** Low (coverage gap, not a confirmed deployment bug)

Base constants and branches exist in `packages/foundry/script/Deploy.s.sol`,
including Base USDC values at lines 48-49, USDC resolution at lines 568-573,
World ID router resolution at lines 585-596, and testnet drand routing at lines
611-616.

`packages/foundry/test/DeployRateLoopAllocations.t.sol` still has deploy
harness helpers and explicit tests centered on World Chain router paths, for
example lines 44-48 and 265-276. The JavaScript readiness/export tests cover
Base artifact validation, so this is only a Solidity test-depth gap.

### L6 - Governance comments still say World Chain after Base migration

**Severity:** Low (non-functional wording drift)

`packages/foundry/contracts/governance/RateLoopGovernor.sol:55-70`,
`RateLoopGovernor.sol:97-98`, and `RateLoopGovernor.sol:308-309` still describe
governance timing in terms of World Chain's 2-second block clock and use a
`WORLD_CHAIN_BLOCK_TIME_SECONDS` constant name.

The value is still 2 seconds, so this is not a confirmed functional mismatch
for Base, but the naming/comments are stale under the Base-first rollout.

### L7 - Manual World Chain mainnet readiness is stale under current production-style env

**Severity:** Low (manual-only legacy gate)

`.github/workflows/worldchain-mainnet-readiness.yaml:3` is manual-only, so this
is no longer a push/PR blocker. If dispatched, `yarn worldchain:check` still
requires `.env.production` to target World Chain mainnet and fails because the
current production-style env intentionally targets Base Sepolia until Base
mainnet promotion.

**Impact:** A manual World Chain readiness dispatch produces expected failure
noise unless the operator retargets `.env.production` or runs the check with a
World Chain-specific env file.

## Confirmed Closed From The Previous June 18 Recheck

These older items were re-checked and should not be carried forward as open:

- World Chain mainnet readiness is manual-only, not push/PR CI.
- Keeper and Ponder package tests pass after the Base Sepolia shared-artifact
  expectation refresh.
- Keeper rejects stale live `CLUSTER_PAYOUT_ORACLE_ADDRESS` overrides.
- Confidentiality bond release checks tracked old engines.
- Standalone governance engine-rotation templates are hidden.
- Live readiness now includes critical cross-contract wiring checks.
- Bundle correlation routes return `truncated`.
- Generated-image JSON budget scales to the four-image limit.
- Browser public USDC override checking exists for same-scope public vars; M4
  above is the remaining chain-scoped/unscoped parity gap.

## Suggested Remediation Order

1. Fix the SDK agent README routing example or SDK transport precedence (M1).
2. Add local signer second-phase Feedback Bonus execution/confirmation (M2).
3. Add the Base Sepolia canary schema to Ponder's deprecated Railway schema set
   and test it (M3).
4. Align browser USDC override conflict detection with server chain-scoped
   fallback behavior (M4).
5. Clean up low-risk docs drift and dead-code export items.
