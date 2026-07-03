# Non-Contract Current-Head Review Post-Remediation - 2026-07-03

Reviewed head: `22ff5e3c1c333e68ec2dc94a230f4adeb4ee1900` on `main`.

Scope: non-Solidity application code, Next.js app/API/client surfaces, public docs, Ponder APIs, keeper docs, agents, SDK-facing examples, scripts, package metadata, env references, migrations, and tests. Smart contracts, Solidity implementation review, Foundry tests, and generated contract metadata were excluded. Public documentation that describes contracts was reviewed only as documentation consistency, not as a smart-contract audit.

The local branch matched `origin/main` before this report was written, and the worktree was clean. Three read-only agents checked separate non-contract slices in parallel:

- Next.js app, API, governance, public docs, MCP, and browser handoff UI.
- Agents package, SDK-facing CLI/docs, x402/local-signer boundaries, and linting.
- Ponder, keeper docs, scripts, deployment docs, and stale-report consistency.

## Summary

No high-severity non-contract issues were found. Two medium issues remain because they can mislead users or operators on current production flows.

| ID | Severity | Status | Finding |
| --- | --- | --- | --- |
| NC-PR-2026-07-03-1 | Medium | Open | Ponder viewer reward status hides LREP bounty waits for payout roots. |
| NC-PR-2026-07-03-2 | Medium | Open | Browser-handoff quickstart examples default to a Base Sepolia payload against the production handoff host. |
| NC-PR-2026-07-03-3 | Low | Open | Treasury-grant warning still reads the legacy `ContentRegistry.treasury()` source. |
| NC-PR-2026-07-03-4 | Low | Open | `/api/agent/policies/recent` still accepts partial numeric `limit` values. |
| NC-PR-2026-07-03-5 | Low | Open | Some public bounty copy still says USDC-only on LREP-capable flows. |
| NC-PR-2026-07-03-6 | Low | Open | Public handoff `ttlMs` parsing silently defaults malformed values. |
| NC-PR-2026-07-03-7 | Low | Open | `agents:lint` does not validate `bounty.asset` or `feedbackBonus.asset`. |
| NC-PR-2026-07-03-8 | Low | Open | Keeper production runbook still says to preserve the existing Base mainnet contract stack. |
| NC-PR-2026-07-03-9 | Low | Open | Design review still presents delayed-blockhash RBTS pairing as current. |
| NC-PR-2026-07-03-10 | Low | Open | The dated use-case snapshot still self-labels a stale gated-AI constraint as current. |

## Findings

### NC-PR-2026-07-03-1 - LREP bounty payout waits are hidden in viewer reward status

Ponder's viewer reward status increments `awaitingBountyPayoutCount` only when `questionRewardPool.asset != 0`. The same route family maps `asset === 0` to `LREP`, while the current README says LREP or USDC bounties wait for challengeable correlation payout roots.

Impact: voters in an LREP bounty round can have a pending reward that still waits for a payout root, but the viewer status does not show the "awaiting payout root/proof" state. That makes the claim UX misleading precisely when the user needs to know why a reward is not claimable yet.

Evidence:

- `packages/ponder/src/api/routes/data-routes.ts:1585` counts `awaitingBountyPayoutCount` only when `questionRewardPool.asset != 0`.
- `packages/ponder/src/api/routes/data-routes.ts:1879` maps `asset === 0` to `currency: "LREP"`.
- `README.md:32` says LREP or USDC bounties wait for correlation snapshots.
- `README.md:44` says correlation roots cover LREP or USDC bounty payouts.

Suggested fix:

1. Count pending payout-root waits for both LREP and USDC reward pools once a reward-pool round exists and the payout snapshot data is missing.
2. Add a Ponder API regression for an LREP bounty that is qualified but still missing the payout root/artifact.
3. Confirm the UI labels still distinguish "allocation missing" from "payout proof/root pending."

### NC-PR-2026-07-03-2 - Browser-handoff quickstart examples target staging while defaulting to production

The agents README points quickstart users at `packages/agents/examples/questions/landing-pitch-review.json`, whose `chainId` is Base Sepolia `84532`. The public handoff CLI defaults to `https://www.rateloop.ai` when `RATELOOP_API_BASE_URL` is unset, and the production handoff server rejects chains that are not submit-ready there. The docs later explain the production/staging distinction, but only after the quickstart handoff flow.

Impact: a user following the README can validate and sandbox the example, then create a browser handoff against production with a staging-chain payload. That fails late and feels like a broken handoff UX rather than an environment mismatch.

Evidence:

- `packages/agents/examples/questions/landing-pitch-review.json:3` uses `chainId: 84532`.
- `packages/agents/README.md:45` through `:57` uses that example for lint, sandbox, quote, and then handoff without a nearby staging API override.
- `packages/agents/src/handoffUpload.ts:26` defaults the handoff API base URL to `https://www.rateloop.ai`.
- `packages/nextjs/lib/agent/handoffs.ts:916` through `:924` rejects unavailable handoff chains.
- `packages/nextjs/app/(public)/docs/ai/page.tsx:171` through `:173` says production asks use Base mainnet and Base Sepolia is staging/testnet validation.

Suggested fix:

1. Either switch the browser-handoff quickstart example to Base mainnet `8453`, or add an explicit staging-origin export beside the Base Sepolia example before the first handoff command.
2. Keep local signer examples on Base Sepolia so test wallets stay on testnet assets.
3. Add a README copy test that the first public handoff example has matching chain and origin guidance.

### NC-PR-2026-07-03-3 - Treasury-grant warning still reads the legacy treasury source

The governance composer now proposes the generic treasury rotation through `ProtocolConfig.setTreasury`, and the treasury card treats `ProtocolConfig.treasury()` as the source of truth. The grant warning still reads `ContentRegistry.treasury()` and warns against that address.

Impact: after a ProtocolConfig treasury rotation, a governance user can see a false treasury warning, or miss the actual mismatch, when composing a treasury grant.

Evidence:

- `packages/nextjs/components/governance/GovernanceActionComposer.tsx:909` through `:919` targets `ProtocolConfig.setTreasury`.
- `packages/nextjs/components/governance/GovernanceActionComposer.tsx:1022` through `:1026` reads `ContentRegistry.treasury` for the grant warning.
- `packages/nextjs/components/governance/GovernanceActionComposer.tsx:1404` through `:1408` warns about the `ContentRegistry` treasury address.
- `packages/nextjs/components/governance/TreasuryBalance.tsx:106` reads `ProtocolConfig.treasury`.

Suggested fix:

1. Read `ProtocolConfig.treasury()` for the treasury-grant guard.
2. Keep `ContentRegistry.treasury()` only as an explicit mismatch diagnostic if it remains useful.
3. Add a governance composer test that a ProtocolConfig treasury mismatch drives the grant warning.

### NC-PR-2026-07-03-4 - Recent policy route still accepts partial numeric limits

Most recently hardened routes use a strict shared query parser, but `/api/agent/policies/recent` still parses `limit` with `Number.parseInt`. Values such as `?limit=10junk` become `10` instead of a malformed-query response.

Impact: this route is signed-read protected, so the blast radius is limited, but client mistakes are accepted silently and behavior diverges from sibling agent routes.

Evidence:

- `packages/nextjs/app/api/agent/policies/recent/route.ts:39` through `:44` uses `Number.parseInt` plus clamping.
- `packages/nextjs/lib/http/queryNumbers.ts:1` contains the stricter query integer helper.
- `packages/nextjs/app/api/agent/routes.test.ts:3538` through `:3544` covers strict rejection for malformed agent export numerics.

Suggested fix:

1. Replace the route-local `parseInt` path with the shared query parser.
2. Reject malformed present values with `400`, while keeping the default when `limit` is absent.
3. Add a signed-read route test for `limit=10junk`.

### NC-PR-2026-07-03-5 - Some public bounty copy remains USDC-only

Most live docs now say wallet-call asks can fund LREP or USDC bounties and Feedback Bonuses, while EIP-3009/x402 remains USDC-only. A few generic bounty surfaces still say "USDC" outside a native-authorization context.

Impact: users can infer that LREP bounties are unsupported or that only USDC bounty claims wait for payout roots.

Evidence:

- `packages/nextjs/components/agent/AgentAskHandoffPage.tsx:307` through `:308` says the bounty amount is a "USDC amount."
- `packages/nextjs/components/agent/AgentAskHandoffPage.tsx:3968` shows the adjacent bounty asset selector.
- `packages/nextjs/app/(public)/docs/how-it-works/page.tsx:178` labels generic bounty timing as "USDC payout timing."
- `packages/nextjs/app/(public)/docs/smart-contracts/page.tsx:79` and `:566` describe generic claim paths as USDC claims.
- `packages/nextjs/scripts/whitepaper/sections.ts:263`, `:293`, and `:403` still use USDC-only phrasing for some generic bounty/payout-root copy.

Suggested fix:

1. Reword generic bounty and payout-root text to say LREP or USDC.
2. Keep USDC-only wording only where the text explicitly describes EIP-3009/x402 one-shot authorization.
3. Extend the public-copy drift tests to include the handoff tooltip, smart-contract docs rows, and whitepaper sections.

### NC-PR-2026-07-03-6 - Public handoff TTL parsing silently defaults malformed values

The public handoff route reads `ttlMs` with `Number(value)` and returns `undefined` for invalid values. The downstream handoff code treats `undefined` as the default TTL, while CLI integer parsing rejects malformed input.

Impact: raw API callers can send malformed TTL values and receive an apparently successful handoff with the default expiry. This is low risk because TTL is clamped, but it weakens client feedback and differs from stricter CLI behavior.

Evidence:

- `packages/nextjs/app/api/agent/handoffs/route.ts:21` through `:24` parses `ttlMs` with `Number(value)`.
- `packages/nextjs/app/api/agent/handoffs/route.ts:56` passes that value into `createAgentAskHandoff`.
- `packages/nextjs/lib/agent/handoffs.ts:210` through `:216` defaults/clamps an undefined TTL.
- `packages/agents/src/cliOptions.ts:4` uses strict positive-integer parsing for CLI options.

Suggested fix:

1. Reject present-but-malformed `ttlMs` values with `400`.
2. Keep default TTL behavior only when the field is absent or intentionally empty.
3. Add route tests for `ttlMs=10junk`, fractional values, `NaN`, and oversized but valid values that should clamp.

### NC-PR-2026-07-03-7 - Agent ask lint misses bounty and Feedback Bonus asset validation

`agents:lint` validates bounty shape, amount, voter floors, and stale timing fields, but it does not validate `bounty.asset` or `feedbackBonus.asset`. Runtime handoff/x402 paths reject non-`USDC`/`LREP` assets later.

Impact: authors can get a clean lint result for an ask that later fails server-side validation. That hurts the agent-authoring loop without adding meaningful decentralization or safety.

Evidence:

- `packages/agents/src/questions/lint.ts:731` through `:757` validates bounty presence, amount, required voters, and timing/eligibility, but not `bounty.asset`.
- `packages/agents/src/questions/lint.ts:760` through `:767` checks only `feedbackBonus.feedbackClosesAt`.
- `packages/agents/src/x402QuestionPayload.ts:834` through `:836` rejects invalid `bounty.asset`.
- `packages/nextjs/lib/agent/handoffs.ts:528` through `:530` rejects invalid `feedbackBonus.asset`.

Suggested fix:

1. Add lint errors for `bounty.asset` and `feedbackBonus.asset` when present and not `USDC` or `LREP`.
2. Preserve defaulting behavior for omitted assets if that remains the payload contract.
3. Add lint tests for invalid bounty and bonus asset spellings.

### NC-PR-2026-07-03-8 - Keeper production runbook still says to preserve the existing stack

The keeper README tells Base mainnet production operators to preserve the existing deployed contract stack. Current repo guidance says Base mainnet replacement work follows owner-directed fresh deploy guidance, and the agent workflow notes emphasize coordinated replacement rather than stale engine rotation.

Impact: during a fresh redeploy or cutover, an operator can wire Ponder, Next.js, and keeper around old deployment artifacts instead of the coordinated replacement stack. That is a runbook inconsistency, not a contract-code finding.

Evidence:

- `packages/keeper/README.md:179` says "preserve the existing deployed contract stack" for Base mainnet production.
- `docs/env-parity.md:129` through `:130` points Base mainnet contract changes to fresh deploy guidance.
- `AGENTS.md:9` through `:11` says engine migration requires a coordinated replacement stack and runbook.

Suggested fix:

1. Replace "preserve the existing deployed contract stack" with "use the owner-directed fresh deployment artifacts for the current Base mainnet stack."
2. Make the keeper/Ponder/Next.js cutover steps reference the same deployment key/artifact validation.
3. Keep legacy-stack preservation language only in explicitly historical rollback sections, if needed.

### NC-PR-2026-07-03-9 - Design review still presents delayed-blockhash RBTS pairing as current

The current README and incentives remediation plan say the fresh redeploy should not rely on a future-blockhash or sequencer non-grinding assumption, and should use precommitted reveal entropy. The design review still lists weak PRNG pairing as delayed-blockhash based and later says the current code does not implement the stated reveal-entropy intent.

Impact: reviewers get conflicting answers about whether delayed blockhash pairing is accepted, fixed, or still open for the fresh deployment posture.

Evidence:

- `README.md:57` says the fresh redeploy uses precommitted reveal entropy without adding another wait.
- `docs/incentives-remediation-plan-2026-07.md:55` through `:60` says not to treat future-blockhash assumptions as the launch model.
- `docs/design-review-2026-07.md:188` says reference/peer draws come from a delayed-blockhash seed.
- `docs/design-review-2026-07.md:310` says RBTS pairing seed is still derived purely from a delayed blockhash and does not implement the reveal-entropy intent.

Suggested fix:

1. Mark the delayed-blockhash paragraphs as superseded for the fresh redeploy, or move them to historical/resolved context.
2. Point readers to the current reveal-entropy launch posture.
3. If any contract implementation is still mid-migration, state that plainly as deployment-gating work rather than mixing current and historical states.

### NC-PR-2026-07-03-10 - Dated use-case snapshot still labels stale gated-AI constraints as current

`docs/use-cases-2026-06.md` has a top warning that the snapshot is historical and should be re-verified before current guidance, but the body still has a "Capability envelope (current)" section and says gated rounds are human-credential-only with AI raters excluded. Current repo framing says the core rating path does not require proof-of-personhood and AI raters are first-class on public questions; current docs also say optional identity does not block AI or pseudonymous accounts.

Impact: a reader skimming the dated report can carry forward a stale product constraint into planning, especially around confidential asks and AI raters.

Evidence:

- `docs/use-cases-2026-06.md:1` through `:6` warns the file is historical and should be re-verified.
- `docs/use-cases-2026-06.md:51` labels the capability envelope as current.
- `docs/use-cases-2026-06.md:57` says gated rounds are human-credential-only and AI raters excluded.
- `docs/use-cases-2026-06.md:132` and `:252` repeat that confidential asks cannot use the AI tier.
- `README.md:8` through `:10` says the protocol includes AI raters and does not require proof-of-personhood on the core path.
- `packages/nextjs/app/(public)/docs/how-it-works/page.tsx:256` through `:261` says optional identity does not block AI raters or pseudonymous accounts.

Suggested fix:

1. Rename the section to "Capability envelope at snapshot time" and remove "current."
2. Either mark gated-AI limitations as historical, or link to current docs for the live confidentiality model.
3. Add a short note near the stale statements so readers do not miss the top warning.

## Rechecked Prior Items

The earlier July 3 non-contract findings were rechecked against the current head:

- Generic "Set treasury" now proposes through `ProtocolConfig.setTreasury`; only the treasury-grant warning still uses the legacy source.
- The previously reported export/query parsing issue is fixed in the audited export paths; `/api/agent/policies/recent` remains a smaller signed-read straggler.
- Public LREP-or-USDC funding copy was substantially improved; the remaining issue is narrower generic bounty wording and tooltips.
- The historical RBTS entropy report now points to the fresh-redeploy posture; the remaining conflict is in the design-review document.
- Feedback Bonus recovery's unused export is no longer reported by `yarn dead-code`.
- Ponder health and finality SLA surfaces now expose the previously missing attention/source-ready signals.

## Verification

Passed during this post-remediation review:

- `yarn dead-code`.
- `node scripts/run-node-tests.mjs scripts/docs-public-copy.test.mjs` - 9 passed.
- Static `rg` sweeps over non-contract app/API/docs/agents/Ponder/keeper surfaces for query parsing, LREP/USDC wording, handoff chain/origin guidance, treasury source reads, RBTS entropy docs, and dated AI-rater constraints.
- Three parallel read-only agent reviews over the non-contract slices listed above.

Not run:

- Foundry/Solidity tests and smart-contract review, because smart contracts were explicitly out of scope.
- Full Docker/dev-stack Playwright E2E.
- Live external readiness probes.
- Full package test matrix; this report made no runtime code changes.
