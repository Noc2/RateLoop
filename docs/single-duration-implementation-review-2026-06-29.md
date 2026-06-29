# Single-Duration Implementation Review Findings

Date: 2026-06-29

Scope: reviewed the fresh-redeploy simplification currently on `main` through
`ae2be514e`, with focus on the single shared question duration, removal of
post-creation bounty/bonus funding, creation-time Feedback Bonus paths,
Ponder/indexer compatibility, public agent surfaces, and test coverage.
Updated after the 2026-06-29 fix pass to mark resolved items and capture the
new regression coverage.

Review method:

- Static review by the main agent plus three parallel subagent passes covering
  contracts/indexer, app/API/agent surfaces, and docs/tests/operations.
- Targeted verification:
  - `node ../../scripts/run-node-tests.mjs lib/x402/questionSubmission.test.ts lib/mcp/tools.test.ts lib/agent/browserSigningValidation.test.ts lib/agent/handoffRoundConfig.test.ts`
    passed 82 tests from `packages/nextjs`.
  - `node ../../scripts/run-node-tests.mjs lib/x402/questionSubmission.test.ts lib/mcp/tools.test.ts lib/agent/browserSigningValidation.test.ts lib/agent/handoffRoundConfig.test.ts app/api/agent/routes.test.ts`
    passed 141 tests from `packages/nextjs` after the fix pass.
  - `yarn next:check-types` passed.
  - `yarn workspace @rateloop/contracts check-types` passed.
  - `yarn next:build` passed.
  - `forge test --match-contract QuestionRewardPoolEscrowTest --offline` passed
    192 tests from `packages/foundry`.
  - `make -C packages/foundry check-storage-layouts` and
    `make -C packages/foundry check-contract-sizes` passed.

## Resolved Findings

### P1: Ponder reward-root eligibility can diverge from on-chain qualification for x402 payer identity

Status: fixed

Resolution:

- `RewardPoolCreated` now emits the effective payer and submitter identity data
  used by on-chain qualification.
- Ponder stores those fields and filters reward-root candidates with the same
  identity keys Solidity excludes.
- Correlation tests cover gateway/payer/submitter divergence for x402 asks.

The question-reward correlation path in Ponder excludes the emitted pool
`funder`, emitted `funderIdentityKey`, and raw `content.submitter`:

- `packages/ponder/src/api/routes/correlation-routes.ts:910-923`

The contract, however, stores and later qualifies against the effective payer
identity/key and submitter identity/key:

- `packages/foundry/contracts/libraries/QuestionRewardPoolEscrowPoolActionsLib.sol:181-216`
- `packages/foundry/contracts/libraries/QuestionRewardPoolEscrowQualificationLib.sol:569-592`
- `packages/foundry/contracts/libraries/QuestionRewardPoolEscrowQualificationLib.sol:874-886`

This matters for x402-created pools because `ContentRegistry` passes both
`funder` and `submitter` into `createSubmissionRewardPoolFromRegistry`:

- `packages/foundry/contracts/ContentRegistry.sol:1165-1175`

For gateway-mediated asks, the emitted `funder` can be the gateway while the
effective payer identity is stored separately in contract storage. The current
`RewardPoolCreated` event handler indexes only the emitted `funder` and
`funderIdentityKey`:

- `packages/ponder/src/QuestionRewardPoolEscrow.ts:152-188`

Impact: an off-chain payout root can include a voter that Solidity later
excludes. That can produce raw-eligible mismatches, unclaimable payout weights,
or incorrect reward qualification during the fresh mainnet cutover.

Suggested fix:

- Add payer identity/key and submitter identity/key to the indexed data that
  backs reward-root candidate selection. Since this is a fresh redeploy, prefer
  emitting the effective payer and submitter identity data directly in the
  reward-pool creation event, then update Ponder schema/handlers and correlation
  queries to use the same exclusion inputs as `_isExcludedRater`.
- Add a Ponder or integration test for an x402 ask where gateway, payer, and
  submitter are not all the same address, and assert the off-chain eligible set
  matches the contract qualifier.

### P2: Public agent surfaces still allow or advertise unsupported Feedback Bonus modes

Status: fixed

Resolution:

- Public agent schemas, docs, SDK examples, and handoff copy now describe
  Feedback Bonuses as USDC-only x402/EIP-3009 creation-time funding.
- Handoff editing disables Feedback Bonus controls when an LREP bounty is
  selected and clears an incompatible stored bonus before saving.
- Browser signing rejects `agent_wallet` aliases with Feedback Bonuses early,
  and route tests cover the EIP-3009 prepare path for eligible USDC asks.

The live implementation currently supports creation-time Feedback Bonus funding
only through the USDC x402/EIP-3009 authorization path:

- `packages/nextjs/lib/mcp/tools.ts:753-759` rejects LREP Feedback Bonuses.
- `packages/nextjs/lib/x402/questionSubmission.ts:3189-3190` rejects any
  Feedback Bonus in the wallet-call preparation path.
- `packages/nextjs/lib/agent/browserSigningValidation.ts:220-223` rejects LREP
  bonus funding for browser signing.

Several public surfaces still expose or describe unsupported combinations:

- `packages/nextjs/components/agent/AgentAskHandoffPage.tsx:1662-1672`
  serializes the selected Feedback Bonus asset.
- `packages/nextjs/components/agent/AgentAskHandoffPage.tsx:3438-3448`
  offers both LREP and USDC in the Feedback Bonus asset selector.
- `packages/nextjs/lib/agent/schemas.ts:467-470` describes an optional LREP or
  USDC Feedback Bonus.
- `packages/nextjs/lib/agent/schemas.ts:528-532` recommends `wallet_calls` for
  LREP Feedback Bonuses.
- `packages/agents/README.md:25-26`, `packages/nextjs/README.md:136`,
  `packages/sdk/README.md:320-323`, `packages/nextjs/public/docs/ai.md:240`,
  and `packages/nextjs/public/skill.md:134` also document LREP or wallet-call
  Feedback Bonus paths.

There is also a prepare-time failure path for wallet-call handoffs/signing
intents with a USDC Feedback Bonus:

- `packages/nextjs/lib/agent/signingIntents.ts:66-69` defaults missing payment
  mode to `wallet_calls`.
- `packages/nextjs/lib/agent/signingIntents.ts:377-383` forwards that mode to
  the public MCP tool.
- `packages/nextjs/app/api/agent/handoffs/[handoffId]/prepare/route.ts:299-304`
  preserves stored `wallet_calls` unless an authorization is present.
- `packages/nextjs/lib/mcp/tools.ts:3413-3417` passes the parsed
  `feedbackBonus` into the wallet-call preparation dependency, which then
  rejects it.
- `packages/nextjs/app/api/agent/routes.test.ts:2622-2628` mocks this as a
  success, so the regression is not exercised end-to-end.

Impact: agents and users can create or follow documented payloads that save
successfully but fail during prepare, or choose LREP in the handoff UI even
though the live path rejects it.

Suggested fix:

- Pick one product rule and make every surface match it:
  - If Feedback Bonuses are USDC-only for the fresh redeploy, remove the LREP
    option from the handoff UI, update schemas/docs, and reject wallet-call
    bonus payloads earlier with clear copy.
  - If LREP or wallet-call Feedback Bonuses are intended, implement the missing
    wallet-call creation-time contract/app path and add direct route tests that
    exercise the real prepare dependency.
- Replace the mocked wallet-call-plus-bonus success test with a test that
  asserts the current explicit rejection, or update it to exercise the newly
  supported path if that path is implemented.

### P2: Live ask guidance still recommends impossible post-creation top-ups

Status: fixed

Resolution:

- Low-response guidance no longer emits `top_up`.
- The replacement action is `create_replacement_ask`, with
  `suggestedReplacementBountyAtomic` reserved for planning a new ask rather
  than modifying an existing one.
- Callback tests assert the replacement-ask guidance shape.

`liveAskGuidance` still models and emits `top_up`:

- `packages/nextjs/lib/agent/liveAskGuidance.ts:4-9`
- `packages/nextjs/lib/agent/liveAskGuidance.ts:108-113`

That guidance is published in low-response callbacks:

- `packages/nextjs/lib/agent-callbacks/lifecycle.ts:336-350`

This conflicts with the simplified product/contract surface where existing
questions no longer support Add bounty or Add feedback bonus top-ups:

- `docs/lrep-usdc-add-bounty-topups.md:5-7`

Impact: agents can receive operational guidance telling them to top up a live
ask even though the action was removed from the product and contracts for the
fresh deployment.

Suggested fix:

- Replace `top_up` with a supported action such as `retry_later`,
  `create_replacement_ask`, or `monitor`, depending on the desired product
  behavior.
- Remove `suggestedTopUpAtomic` or rename it to a planning-only value that is
  used only before ask creation.
- Update callback payload tests and any public agent docs that mention live
  top-up advice.

### P2: Playwright coverage does not yet prove the positive creation-time Feedback Bonus path

Status: fixed

Resolution:

- Added a focused browser handoff Playwright test for a USDC Feedback Bonus and
  one shared duration.
- The test verifies the restored draft values, edits the Feedback Bonus amount,
  saves the draft, and asserts the persisted authorization amount and shared
  `roundConfig` values remain coherent.
- The existing API route tests continue to cover the prepare-time one-shot
  EIP-3009 authorization path.

The redeploy checklist explicitly calls for browser coverage that submits
creation-time bounty plus Feedback Bonus handoffs with one shared duration:

- `docs/single-duration-fresh-redeploy-plan.md:78-82`

Current E2E coverage covers adjacent behaviors but not that positive path:

- `packages/nextjs/e2e/tests/agent-handoff.spec.ts:17-25` uses a request shape
  without `feedbackBonus` or `roundConfig` coverage.
- `packages/nextjs/e2e/tests/submit.spec.ts:101-106` explicitly skips the
  optional Feedback Bonus in the normal submit flow.
- `packages/nextjs/e2e/tests/funding-modals.spec.ts:8-14` checks that removed
  post-creation funding controls stay removed.

Impact: a browser regression in USDC one-shot Feedback Bonus funding,
authorization amount calculation, or shared `questionDurationSeconds` handling
could pass the current Playwright suite.

Suggested fix:

- Add a focused Playwright test that opens a browser handoff with a USDC
  Feedback Bonus, verifies the shared duration display, signs/prepares the
  one-shot authorization path, and confirms the submit plan includes both bounty
  and bonus funding.
- Keep the existing removed-controls test as a separate regression guard.

### P3: Local seed no longer creates any Feedback Bonus pool

Status: fixed

Resolution:

- `SeedContent.sh` now logs that local Feedback Bonus smoke tests should submit
  a single-question USDC x402 ask after seeding.
- The root README documents the same expectation so local smoke tests do not
  mistake the absence of standalone seeded pools for missing support.

`SeedContent.sh` now enters the Feedback Bonus section and skips it entirely:

- `packages/foundry/script/SeedContent.sh:601-615`

This is understandable after standalone pool creation was removed, but it means
local seeded environments no longer contain active Feedback Bonus data.

Impact: local Ponder/API/UI smoke tests can miss bonus award, display, and
cleanup issues unless they create a bonus through the ask-submission path during
the test itself.

Suggested fix:

- Either extend the seed flow to submit at least one question through the
  creation-time USDC Feedback Bonus path, or document that Feedback Bonus smoke
  tests must create their own ask during setup.

## Non-Findings From This Pass

- The reviewed x402 payload canonicalization, v9/v7 commitment-domain split,
  shortened reward-term ABI usage, direct/sponsored submit call routing, and
  generated ABI filtering appeared aligned with the single-duration design.
- The removed post-creation funding UI has targeted regression coverage.

## Remaining Verification Gaps

- No live Base Sepolia or Base mainnet cutover smoke was run in this review.
- No full Playwright suite was run during this review; the focused browser
  coverage was added, but local E2E preflight failed because Anvil, Next.js,
  and Ponder were not all reachable. Full-suite and cutover smoke should still
  be run before any owner-directed break-glass Base mainnet redeploy.
- No Ponder migration/index replay was run against a database containing
  gateway/payer/submitter identity divergence.
