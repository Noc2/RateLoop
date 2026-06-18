# Repo Audit - 2026-06-18 Path-Prefix And Post-Remediation Recheck

Scope: read-only recheck of current `main` for bugs and inconsistencies after the latest keeper, agent handoff, contract ABI, and notification-email commits. The audit began at committed `main` `cea53e6d` (`Remove mismatched email logo treatment`). During the audit, local `main` advanced with `5ff93b55` (`Guard fee creditor role management`) and `c7861a0e` (`Use website gradient text in emails`), which are not the source of the findings below. No application fixes were made in this pass; this document is the only intended audit change.

Note: unrelated local edits appeared during the audit in `packages/foundry/contracts/ContentRegistry.sol` and `packages/foundry/test/RoundIntegration.t.sol`. They were not staged or included in this document commit.

## Summary

The strongest remaining issues are path-prefix regressions in absolute app URL generation and one keeper/oracle recovery mismatch:

1. P1 - Notification email URLs discard path-prefixed app bases.
2. P1 - Agent handoff, signing-intent, and staged-image URLs discard path-prefixed request bases.
3. P2 - Keeper reads raw finalized round payout status, so stale finalized snapshots can be skipped after parent epoch rejection.
4. P2 - Static public Markdown docs drift from live React docs on Base mainnet promotion and ask submission guidance.
5. L1 - `@rateloop/agents` package `test` is sensitive to ignored workspace build output state.

Positive checks: Base Sepolia offline readiness is green; Base mainnet remains intentionally blocked by missing `packages/foundry/deployments/8453.json`; generated contract ABIs, storage-layout snapshots, and deploy-profile contract sizes are currently aligned.

## Findings

### P1 - Notification email URLs discard path-prefixed app bases

`resolveNotificationEmailAppUrl` uses `resolveAppUrl`, which accepts full app URLs including path prefixes. However, downstream notification email URL builders call `new URL("/...", appUrl)` with root-relative paths, which drops any existing base path.

Evidence:

- `packages/nextjs/lib/env/server.ts:60` defines `resolveAppUrl`, which returns the parsed URL string and preserves a configured pathname.
- `packages/nextjs/lib/notifications/emailUrls.ts:37` builds settings redirects with `new URL("/settings", appUrl)`.
- `packages/nextjs/lib/notifications/emailUrls.ts:110` builds unsubscribe links with `new URL("/api/notifications/email/unsubscribe", args.appUrl)`.
- `packages/nextjs/app/api/notifications/email/route.ts:191` builds verification links with `new URL("/api/notifications/email/verify", appUrl)`.
- `packages/nextjs/lib/notifications/emailDelivery.ts:219` and `packages/nextjs/lib/notifications/emailDelivery.ts:225` build vote/governance CTAs from root-relative paths.
- `packages/nextjs/lib/notifications/emailUrls.test.ts:113` only covers root-origin production URLs.

Reproduction:

```sh
node -e "console.log(new URL('/settings', 'https://example.com/rateloop').toString())"
```

Actual output is `https://example.com/settings`, not `https://example.com/rateloop/settings`.

Impact: deployments mounted under a path prefix send broken verification, unsubscribe, settings, vote, and governance links by email.

Suggested fix/test: add a shared app-relative URL builder that appends to a configured pathname, then cover `APP_URL=https://example.com/rateloop` in notification email URL tests and email route tests.

### P1 - Agent handoff and signing URLs discard path-prefixed request bases

The public agent routes reduce the incoming request URL to `origin`, then library helpers build root-relative browser and asset URLs. This loses path prefixes in the same way as notification emails.

Evidence:

- `packages/nextjs/app/api/agent/handoffs/route.ts:24` sets `origin = new URL(request.url).origin`.
- `packages/nextjs/lib/agent/handoffs.ts:320` builds `/agent/handoff/{handoffId}` from that origin.
- `packages/nextjs/lib/agent/handoffs.ts:326` builds staged generated image URLs at `/api/attachments/images/...`.
- `packages/nextjs/app/api/agent/signing-intents/route.ts:21` also keeps only `origin`.
- `packages/nextjs/lib/agent/signingIntents.ts:149` builds `/agent/sign/{intentId}` from that origin.
- `packages/nextjs/app/api/agent/routes.test.ts:922` covers generated image handoff behavior, but only with root-origin request URLs.

Reproduction:

```sh
node -e "for (const p of ['/agent/handoff/ahf_demo','/api/attachments/images/att_demo.webp']) console.log(new URL(p, 'https://example.com/rateloop').toString())"
```

Actual URLs drop `/rateloop`.

Impact: when the app is served under a prefix, agent APIs return handoff, signing, and generated-image URLs that point outside the mounted application. That breaks the new file-backed image handoff flow for prefixed deployments.

Suggested fix/test: pass a path-preserving app base URL or reconstruct the route base from `request.nextUrl` before building links. Add route tests using request URLs such as `https://example.com/rateloop/api/agent/handoffs` and `https://example.com/rateloop/api/agent/signing-intents`.

### P2 - Keeper skips stale finalized round payout snapshots after parent epoch rejection

`ClusterPayoutOracle` intentionally normalizes round payout snapshots to `Rejected` when their correlation epoch is no longer live, and `proposeRoundPayoutSnapshot` can replace stale finalized children when they are unconsumed. Keeper status reads bypass that normalized view.

Evidence:

- `packages/foundry/contracts/ClusterPayoutOracle.sol:454` reads the existing round payout proposal and, when its correlation epoch is not live, calls the stale-rejection path before allowing replacement.
- `packages/foundry/contracts/ClusterPayoutOracle.sol:779` exposes `getRoundPayoutSnapshot`, whose returned snapshot status is normalized against the current correlation epoch.
- `packages/keeper/src/correlation-snapshots.ts:319` reads `roundPayoutProposal` directly in `readRoundPayoutProposalSummary`.
- `packages/keeper/src/correlation-snapshots.ts:1358` only proposes a snapshot when that raw status is `None` or `Rejected`.
- `packages/keeper/src/correlation-snapshots.ts:682` later applies finalized rating snapshots from the artifact, while `packages/foundry/contracts/libraries/ContentRegistryRatingSnapshotLib.sol:216` validates through `getRoundPayoutSnapshot`.

Verified contract behavior:

```sh
forge test --match-test 'test_RejectedFinalizedCorrelationEpochBlocksFuturePayoutVerification|test_StaleFinalizedRoundPayoutSnapshotCanBeReplacedWhenUnconsumed'
```

This passed with 2 tests, confirming the oracle expects stale finalized child snapshots to be blocked for consumption but replaceable.

Impact: after governance rejects a finalized correlation epoch, keeper can see the old child proposal as raw `Finalized`, skip proposing a replacement, and then fail when applying the rating snapshot because the consumer validates through the normalized `Rejected` view. Automatic recovery stalls until an operator manually re-proposes affected round payout snapshots.

Suggested fix/test: make keeper status reads use `getRoundPayoutSnapshot` or mirror the current-correlation-epoch normalization before deciding whether to propose. Add a `correlation-snapshots.test.ts` regression for a raw finalized child under a rejected parent epoch.

### P2 - Static public Markdown docs drift from live docs

The live React SDK docs gate Base mainnet behind intentional promotion, but the static Markdown mirrors present `8453` without the same caveat. The live AI docs also ask agents to run a dry run before a live quote, while the static Markdown jumps straight to quote/handoff.

Evidence:

- `packages/nextjs/.env.production:1` keeps the production-style target on Base Sepolia until the Base mainnet promotion commit.
- `packages/foundry/deployments` currently contains `84532.json` and no `8453.json`.
- `packages/nextjs/app/(public)/docs/sdk/page.tsx:176` says `8453` is Base mainnet after an intentional production promotion.
- `packages/nextjs/public/docs/sdk.md:5` says only "Base mainnet uses `8453`".
- `packages/nextjs/public/docs/ai.md:9` says only "Base mainnet uses `8453`".
- `packages/nextjs/app/(public)/docs/ai/page.tsx:454` starts quote/submit guidance with a no-payment dry run.
- `packages/nextjs/public/docs/ai.md:188` starts the same section with `rateloop_quote_question`.

Impact: LLMs and agents consuming `/docs/ai.md`, `/docs/sdk.md`, or `/llms.txt` can miss the current Base Sepolia-first production posture and the safer dry-run step even though the live pages have been corrected.

Suggested fix/test: update the static Markdown mirrors and `llms.txt` snippets to match the React docs. Extend `scripts/docs-public-copy.test.mjs` to reject ungated "Base mainnet uses `8453`" wording and to assert dry-run guidance in the static AI doc.

### L1 - `@rateloop/agents` package test is build-state sensitive

The first direct run of:

```sh
yarn workspace @rateloop/agents test
```

failed before Vitest with TypeScript resolution errors for `@rateloop/contracts/abis`, `@rateloop/contracts/deployments`, and `@rateloop/contracts/protocol`. A later rerun passed after ignored workspace `dist/` outputs were present. The package script at `packages/agents/package.json:101` runs `yarn build && vitest run`, but the package `build` script at `packages/agents/package.json:89` only builds `@rateloop/node-utils` before compiling agents. By contrast, root `test:ts` at `package.json:106` runs `build:workspace-deps` before the agents test.

Impact: package-local agents tests can be red or green depending on ignored build artifacts from previous commands, which makes local and package-publish validation less deterministic.

Suggested fix/test: make `packages/agents` build/test scripts build the contract package dependency explicitly, or point package-local TypeScript resolution at source during local builds. Validate from a clean ignored-`dist` state.

## Validation Run

Passing checks run during this audit:

| Command | Result |
| --- | --- |
| `node scripts/check-base-sepolia-readiness.mjs --json` | Pass; Base Sepolia offline readiness `ok: true` |
| `node scripts/check-base-mainnet-readiness.mjs --json` | Expected fail; missing `packages/foundry/deployments/8453.json` |
| `node scripts/run-node-tests.mjs scripts/check-worldchain-sepolia-readiness.test.mjs scripts/check-worldchain-mainnet-readiness.test.mjs scripts/readiness-workflows.test.mjs` | Pass; 39 tests |
| `yarn workspace @rateloop/keeper test src/__tests__/correlation-snapshots.test.ts src/__tests__/config.test.ts` | Pass; 71 tests |
| `yarn workspace @rateloop/ponder test scripts/devWithRecovery.test.ts tests/protocol-deployment.test.ts scripts/databaseSchema.test.ts` | Pass; 38 tests |
| `node ../../scripts/run-node-tests.mjs lib/notifications/emailTemplate.test.ts 'app/(public)/docs/sdk/page.test.tsx' lib/docs/whitepaperContent.test.ts` from `packages/nextjs` | Pass; 14 tests |
| `node scripts/run-node-tests.mjs scripts/docs-public-copy.test.mjs packages/nextjs/e2e/helpers/service-urls.test.ts` | Pass; 4 tests |
| `yarn workspace @rateloop/contracts test` | Pass; 37 tests |
| `yarn workspace @rateloop/nextjs check-types` | Pass |
| `yarn workspace @rateloop/agents check-types` | Pass |
| `yarn workspace @rateloop/agents test` | First run failed with missing `@rateloop/contracts/*`; later rerun passed with 80 tests after build outputs existed |
| `make check-storage-layouts` from `packages/foundry` | Pass |
| `make check-contract-sizes` from `packages/foundry` | Pass; all checked deployed bytecode within EIP-170 |
| `forge test --match-test 'test_RejectedFinalizedCorrelationEpochBlocksFuturePayoutVerification|test_StaleFinalizedRoundPayoutSnapshotCanBeReplacedWhenUnconsumed'` | Pass; 2 tests |

Not run: live Base Sepolia readiness, because it needs real `BASE_SEPOLIA_RPC_URL`, `BASE_SEPOLIA_PONDER_URL`, and `BASE_SEPOLIA_APP_URL`.

## Subagent Notes

- Contracts/governance explorer found the keeper stale-finalized snapshot recovery issue and did not find additional issues in pending rating settlement replay, FeedbackBonusEscrow registry snapshots, fee creditor/oracle wiring, generated ABIs, or Base Sepolia-first assumptions.
- Services/ops explorer found no additional P0/P1/P2 issues in keeper, ponder, agents, SDK/client integration, or readiness scripts.
- Frontend/docs explorer found the notification URL-prefix issue, the agent handoff/signing URL-prefix issue, and static public docs drift.
