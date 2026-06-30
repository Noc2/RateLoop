# Single-duration fresh redeploy implementation plan

This plan intentionally ignores compatibility with previous Base deployments. The target is a fresh RateLoop stack where
question creation starts the first rewardable round immediately, and the product exposes one user-facing timing value:
`questionDuration`.

## Target semantics

- `questionDuration` is the only user-facing round/reward/feedback timing field.
- Question creation time is the shared anchor.
- The initial rewardable round opens in the question submission transaction.
- `round.epochDuration == round.maxDuration == questionDuration`.
- Bounty eligibility opens at question creation and closes at `createdAt + questionDuration`.
- Feedback must be published by `createdAt + questionDuration` to be bonus-eligible.
- Creation-time bounties and feedback bonuses settle against one required settled round; multi-round bounty knobs are
  removed from the product surface and rejected by new funding entrypoints.
- Bounties and feedback bonuses can only be attached during question creation.
- Later organic rating rounds may still exist, but they do not accept new bounty or feedback bonus funding.
- Reveal grace, settlement, claim grace, feedback award decision grace, oracle challenge windows, and refund windows remain
  separate protocol safety windows.

## Commit sequence

1. Contract timing and round anchoring

   - Enforce equal epoch/max duration in `ProtocolConfig`.
   - Add a registry-to-engine initial-round opening path that avoids `nonReentrant` callback deadlocks.
   - Make submission reserve and open the first round in the same transaction.

2. Creation-time-only reward pools

   - Derive reward pool windows from content creation time and `questionDuration`.
   - Store submission reward pools as already open with fixed close timestamps.
   - Apply the same model to question bundle rewards.
   - Remove or hard-disable public post-creation bounty funding entrypoints and their authorization typehashes.

3. Creation-time-only feedback bonuses

   - Derive feedback close from the initial round/question duration.
   - Keep only submission/gateway-attached feedback bonus creation.
   - Keep arbitrary standalone post-creation bonus funding disabled, but allow the bounded follow-up create-pool entrypoint used after confirmed single-question wallet-call asks.
   - Continue rejecting arbitrary `feedbackClosesAt`.

4. x402, reservations, generated ABIs, and scripts

   - Replace old typed data with `questionDuration`.
   - Update x402 submitter, reservation builders, tlock helpers, local seed scripts, and generated contract exports.
   - Bump typed-data/domain versions so old signatures cannot be replayed against the fresh stack.

5. Ponder and keeper

   - Update indexed schema/handlers/API routes to expose `questionDuration`, `rewardOpensAt`, `rewardClosesAt`, and
     derived feedback close.
   - Remove discovery or API affordances for post-creation funding.
   - Keep keeper reveal, settle, cleanup, claim, and feedback forfeiture paths.

6. Next.js, SDK, and agents

   - Replace round/bounty/feedback timing inputs with one `Question duration` control.
   - Remove add-bounty and add-feedback-bonus UI from existing questions.
   - Update browser signing, handoff, MCP, SDK, agents CLI, linting, examples, and postcondition checks.
   - Make copy clear that the clock starts when the question is created.

7. Documentation and whitepaper

   - Update root README, package READMEs, public docs, `packages/nextjs/public/skill.md`, generated examples, and
     whitepaper content/tests.
   - Remove stale references to `bountyStartBy`, separate `epochDuration` / `maxDuration`, and post-creation funding.

8. Verification
   - `yarn foundry:test`
   - `yarn workspace @rateloop/foundry check:sizes`
   - `yarn test:ts`
   - targeted Playwright submit, browser handoff/social ask, vote, funding-removal, and docs smoke tests
   - `yarn next:build`
   - Base Sepolia fresh deploy plus `yarn base-sepolia:check -- --live`
   - Owner-directed Base mainnet fresh deploy plus `yarn base-mainnet:check -- --live`; see
     `packages/foundry/README.md` for production redeploy guidance

## Extra checks before mainnet

- A created question opens round `1` in the submission transaction.
- Round start, reward open, reward close, and feedback close share the expected timestamps.
- Old post-creation bounty/bonus calls are absent or revert.
- USDC one-shot bounty plus feedback bonus works.
- LREP/USDC wallet-call submission works, and asks with Feedback Bonuses return and execute the follow-up approve/create-pool transaction plan.
- Ponder and the app display the same duration and close timestamps.
- The keeper can reveal, settle, forfeit expired feedback bonus residue, and process cleanup.
- Whitepaper and public docs describe the single-duration model.
- Playwright verifies the removed funding modals/buttons stay removed.
- Playwright verifies creation-time bounty and Feedback Bonus handoffs still submit with one shared question duration.
