# Non-Contract Current-Head Review - 2026-07-03

Reviewed head: `93b0e51be` on `main`.

Scope: non-Solidity application code, Next.js app/API/docs, Ponder, keeper, agents, SDK, node utilities, scripts, workflows, package metadata, env references, migrations, and public assets. Smart contracts, Solidity implementation review, Foundry tests, and generated contract metadata were excluded.

The local branch matched `origin/main` before this report was written, and the worktree was clean. Three read-only agents checked current-head slices in parallel:

- Next.js app/API/client/public docs/MCP/handoff/governance UI.
- Ponder, keeper, agents, SDK, node-utils, scripts, readiness checks, and package tooling.
- Docs, READMEs, env examples, workflows, package metadata, migrations/schema metadata, and public copy.

## Summary

| ID | Severity | Status | Finding |
| --- | --- | --- | --- |
| NC-CH-2026-07-03-1 | High | Open | Governance "Set treasury" proposes against `ContentRegistry`, while current treasury reads and protocol routing prioritize `ProtocolConfig`. |
| NC-CH-2026-07-03-2 | Medium | Open | Some Next.js API query parsers still accept partial numeric strings. |
| NC-CH-2026-07-03-3 | Low | Open | Public FAQ/diagram/skill copy still narrows LREP-or-USDC flows to USDC. |
| NC-CH-2026-07-03-4 | Low | Open | Agent discovery/setup copy still frames the default model as verified-human or USDC-only. |
| NC-CH-2026-07-03-5 | Low | Open | Historical RBTS entropy remediation docs conflict with the current fresh-redeploy posture. |
| NC-CH-2026-07-03-6 | Low | Open | Dead-code check reports an unused exported helper in Feedback Bonus recovery. |

## Findings

### NC-CH-2026-07-03-1 - Governance treasury action targets the non-authoritative path

The governance action composer exposes a single generic "Set treasury" proposal, but that template calls `ContentRegistry.setTreasury`. The current treasury balance card already treats `ProtocolConfig.treasury()` as the primary source and only falls back to `ContentRegistry.treasury()`.

Impact: governance users can create and pass a treasury-rotation proposal that leaves the current protocol treasury route unchanged. This is especially risky because the UI label is generic, while the generated proposal description says only `ContentRegistry`.

Evidence:

- `packages/nextjs/components/governance/GovernanceActionComposer.tsx:909` defines `content-set-treasury`.
- `packages/nextjs/components/governance/GovernanceActionComposer.tsx:913` targets `ContentRegistry`.
- `packages/nextjs/components/governance/GovernanceActionComposer.tsx:914` calls `setTreasury`.
- `packages/nextjs/components/governance/TreasuryBalance.tsx:106` reads `ProtocolConfig.treasury`.
- `packages/nextjs/components/governance/TreasuryBalance.tsx:120` displays `ProtocolConfig` first, then falls back to `ContentRegistry`.
- `packages/nextjs/components/governance/TreasuryBalance.tsx:174` already treats mismatched treasury addresses as noteworthy.

Suggested fix:

1. Replace the generic treasury template with `ProtocolConfig.setTreasury` when that is the current source of truth.
2. If both contracts must remain aligned, add an explicit dual-update governance runbook/template instead of a generic one-contract action.
3. Add a governance composer test asserting that the treasury action targets the intended contract(s).

### NC-CH-2026-07-03-2 - API query parsers still accept partial numeric strings

Most chain-ID surfaces now use strict decimal parsing, but some route-local numeric helpers still use `parseInt`/`Number.parseInt`. Native parsing accepts values such as `8453abc` and `10junk`.

Impact: malformed agent audit export filters or pagination params can be silently accepted instead of producing precise client feedback. The chain-ID case is the highest-risk instance because an export request can be filtered to the wrong chain rather than rejected.

Evidence:

- `packages/nextjs/app/api/agent/asks/export/route.ts:20` parses `chainId` with `Number.parseInt`.
- `packages/nextjs/app/api/agent/asks/export/route.ts:29` parses `limit` with `Number.parseInt`.
- `packages/nextjs/app/api/frontend/claimable-fees/route.ts:52` parses `limit` with `parseInt`.
- `packages/nextjs/app/api/frontend/claimable-fees/route.ts:53` parses `offset` with `parseInt`.
- `packages/nextjs/app/api/follows/profiles/route.ts:15` parses `limit` with `Number.parseInt`.
- `packages/nextjs/app/api/follows/profiles/route.ts:21` parses `offset` with `Number.parseInt`.
- `packages/nextjs/lib/chainId.ts:10` shows the stricter full-string decimal approach used elsewhere.

Suggested fix:

1. Introduce a small shared strict decimal parser for route query integers, with positive and non-negative variants.
2. Use it for the audit-export `chainId` and `limit` path first.
3. Decide whether malformed pagination params should reject with `400` or fall back only when absent, then cover both behaviors in tests.

### NC-CH-2026-07-03-3 - Public copy still narrows LREP-or-USDC flows to USDC

The main AI and SDK docs now correctly say wallet-call asks can use LREP or USDC bounties and Feedback Bonuses. A few active public/discovery surfaces still use USDC-only wording outside explicitly x402/EIP-3009 contexts.

Impact: users and agents can infer that supported wallet-call Feedback Bonuses or payout roots are USDC-only, even though current wallet-call asks support LREP or USDC and the x402-only restriction applies only to native authorization flows.

Evidence:

- `packages/nextjs/lib/docs/landingFaq.ts:56` says public agent wallet flows and EIP-3009 authorization use USDC on the target network.
- `packages/nextjs/lib/docs/landingFaq.ts:61` titles the Feedback Bonus FAQ as "Extra USDC".
- `packages/nextjs/lib/docs/landingFaq.ts:63` says a question can add an optional USDC Feedback Bonus.
- `packages/nextjs/components/docs/OracleChallengeFlowDiagram.tsx:22` says roots become usable by USDC bounty and launch LREP claim paths.
- `packages/nextjs/public/skill.md:132` says LREP rewards wait for the RBTS snapshot and USDC bounties wait for payout roots.
- `packages/nextjs/app/(public)/docs/ai/page.tsx:402` through `:405` shows the intended current LREP-or-USDC Feedback Bonus wording.
- `packages/nextjs/public/docs/ai.md:129` and `packages/nextjs/public/docs/sdk.md:188` show the intended current LREP-or-USDC bounty-claim wording.

Suggested fix:

1. Update generic public copy to say LREP or USDC for wallet-call bounties, bounty claims, and Feedback Bonuses.
2. Keep USDC-only wording only where the text is explicitly about EIP-3009/x402 one-shot authorization.
3. Add `public/skill.md`, the landing FAQ, and docs diagrams to the existing copy-drift checks.

### NC-CH-2026-07-03-4 - Agent discovery/setup copy still frames a narrower model

The current product posture is open human and AI raters with optional Proof-of-Human payout eligibility, and LREP or USDC wallet-call funding. Some discovery/setup copy still describes the agent skill as verified-human feedback or tells operators to fund only USDC.

Impact: agent registries and setup users can start from a legacy mental model and miss supported open-rater, AI-rater, LREP bounty, or LREP Feedback Bonus flows.

Evidence:

- `packages/nextjs/public/.well-known/agent-skills/index.json:6` says "Ask verified humans".
- `packages/nextjs/app/(public)/docs/page.tsx:9` says "verified humans in the loop, or from other agents".
- `packages/agents/.env.example:4` says to fund the wallet with Base Sepolia USDC for testnet asks.
- `README.md:8` describes RateLoop as open to humans, AI raters, teams, and apps.
- `README.md:37` says people, AI raters, and teams use the default path without mandatory identity proof.
- `packages/agents/README.md:25` through `:26` describes LREP or USDC funding and LREP or USDC Feedback Bonuses.

Suggested fix: reword discovery and setup copy to "open human and AI raters" and "LREP or USDC for wallet-call asks", with Proof-of-Human called out only as optional bounty payout eligibility and USDC-only called out only for x402/EIP-3009.

### NC-CH-2026-07-03-5 - Historical RBTS entropy docs conflict with the current launch posture

The current README and incentives remediation plan say the fresh redeploy must not rely on a future-blockhash or sequencer non-grinding assumption. An older remediation report still says the fix was a future blockhash/EIP-2935 path.

Impact: reviewers reading the repo docs can get conflicting answers about whether the accepted current posture is precommitted reveal entropy or future-blockhash/EIP-2935. This is documentation-only, but it affects audit review and redeploy readiness.

Evidence:

- `README.md:57` says the fresh redeploy uses precommitted reveal entropy without adding another wait.
- `docs/incentives-remediation-plan-2026-07.md:55` says not to treat a future-blockhash assumption as the launch model.
- `docs/incentives-remediation-plan-2026-07.md:57` describes deriving the seed from precommitted voter entropy.
- `docs/new-issues-remediation-report-2026-07-02.md:21` says predictable entropy was replaced with a future-blockhash/EIP-2935 path.
- `docs/new-issues-remediation-report-2026-07-02.md:36` describes the future-blockhash/EIP-2935 path as fixed/current.

Suggested fix: mark the older remediation report section as superseded by the fresh-redeploy entropy plan, or add a short erratum pointing readers to `docs/incentives-remediation-plan-2026-07.md`.

### NC-CH-2026-07-03-6 - Feedback Bonus recovery has an unused exported helper

`yarn dead-code` reports one unused export. The helper is still used internally by the same module, so this is just export-surface cleanup rather than a runtime bug.

Impact: small API-surface and maintenance drift in recently changed Feedback Bonus recovery code.

Evidence:

- `yarn dead-code` reports `isFeedbackBonusRecoveryHash function packages/nextjs/components/agent/feedbackBonusRecovery.ts:6:17`.
- `packages/nextjs/components/agent/feedbackBonusRecovery.ts:6` exports `isFeedbackBonusRecoveryHash`.
- `packages/nextjs/components/agent/feedbackBonusRecovery.ts:19`, `:36`, and `:43` use it only within the same module.

Suggested fix: remove the `export` keyword unless another module should intentionally consume this validator.

## Rechecked Prior Items

The prior July 3 follow-up findings are no longer reproducible at current head:

- Rendered AI docs include the Feedback Bonus follow-up.
- Next.js env docs include `PONDER_METADATA_SYNC_TOKEN` and `RATELOOP_IMAGE_ATTACHMENT_SWEEP_SECRET`.
- Non-local database docs now describe `db:push` as schema sync, not the deploy migration runner.
- Drizzle journal includes `0018_agent_handoff_feedback_bonus_recovery`.
- Readiness JSON live mode emits one JSON document.
- Live readiness rejects degraded Ponder indexer health and warns on `attention`.
- Ponder BigInt route parsing and invalid `PONDER_REPLICA_COUNT` handling are strict.
- Agent CLI and SDK lookup chain IDs are strict.
- Frontend-code docs no longer hard-code a 20-minute question duration.

## Verification

Passed during this current-head pass:

- `yarn workspace @rateloop/node-utils test` - 50 passed.
- `yarn workspace @rateloop/sdk test` - 59 passed.
- `yarn workspace @rateloop/agents test` - 159 passed.
- `yarn workspace @rateloop/keeper test` - 551 passed, 2 skipped.
- `yarn workspace @rateloop/ponder test` - 431 passed, 1 skipped.
- `yarn workspace @rateloop/nextjs test` - 1849 passed.
- `node scripts/run-node-tests.mjs scripts` - 131 passed.
- `yarn workspace @rateloop/node-utils check-types`.
- `yarn workspace @rateloop/sdk check-types`.
- `yarn workspace @rateloop/agents check-types`.
- `yarn workspace @rateloop/keeper check-types`.
- `yarn workspace @rateloop/ponder check-types`.
- `yarn workspace @rateloop/nextjs check-types`.
- `yarn workspace @rateloop/nextjs lint`.
- `git diff --check`.
- `yarn npm audit --recursive --environment production` - no audit suggestions.
- `yarn npm audit --recursive --environment development` - no audit suggestions.

Additional signal:

- `yarn dead-code` exited successfully but reported the unused export in NC-CH-2026-07-03-6.
- The shell reported Node `v26.0.0`; the repo declares Node `>=24 <25`. The tested suites still passed, with `DEP0205` warnings from Node's test loader path.

Not run:

- Foundry/Solidity tests and smart-contract review, because smart contracts were explicitly out of scope.
- Full local Docker/dev-stack Playwright E2E.
- Live external readiness probes.
