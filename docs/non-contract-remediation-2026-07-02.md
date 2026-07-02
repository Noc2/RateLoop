# Non-Contract Remediation Report - 2026-07-02

Scope: remediation for NC-FS-1 through NC-FS-6 from `docs/non-contract-review-final-sweep-2026-07-02.md`. Smart-contract implementation review and Solidity tests remained out of scope.

## Plan Check

Two parallel plan reviewers checked the remediation approach before implementation:

- Keeper metrics: separate live SLA state from startup configuration violations, register the HRC warning metric, and test HELP/TYPE/value behavior.
- Tooling and UX: keep the Base Sepolia stale one-shot x402 submitter gate manual until a fresh redeploy, suppress only the exact generated-image handoff lint false positive, group focused Node tests by workspace cwd, and share promo narration from one side-effect-free source.

The plan did not add centralized infrastructure, did not preserve stale contract assumptions as launch behavior, and improved UX for generated-image handoffs and focused test runs.

## Fixes

| ID | Status | Fix commit |
| --- | --- | --- |
| NC-FS-1 | Fixed | `5b44083c0` - `keeper: split payout finality warning metrics` |
| NC-FS-2 | Fixed | `5b44083c0` - `keeper: split payout finality warning metrics` |
| NC-FS-3 | Fixed | `d10b6f304` - `ci: keep stale x402 gate manual` |
| NC-FS-4 | Fixed | `3879e6cc3` - `agents: allow generated-image handoffs for single-question arrays` |
| NC-FS-5 | Fixed | `6ed7e3d92` - `test: run focused node tests from workspace cwd` |
| NC-FS-6 | Fixed | `758b8de95` - `promo-video: share voiceover clips` |

## Notes

- Keeper metrics now expose the current observed payout-finality breach count as a gauge and keep launch-budget configuration violations as a separate counter.
- The HRC health warning path now increments a registered Prometheus counter.
- Scheduled Base Sepolia live readiness still requires live targets, but the known stale one-shot Feedback Bonus x402 staging submitter no longer makes scheduled checks red. The strict x402 gate is available as a manual workflow input for fresh redeploy verification.
- `handoff --image` now keeps all ordinary linting intact while allowing the single-question `questions: [{...}]` image-staging shape.
- `scripts/run-node-tests.mjs` now runs package-local test files from their nearest workspace cwd while preserving repo-root script tests.
- Promo OpenAI and offline voiceover generation now share `voiceover-clips.mjs`, with a drift test that does not import the API-key-requiring OpenAI generator.

## Verification

Passed:

- `yarn workspace @rateloop/keeper test` - 551 passed, 2 skipped.
- `yarn workspace @rateloop/agents test` - 155 passed.
- `yarn workspace @rateloop/nextjs test` - 1845 passed.
- `node scripts/run-node-tests.mjs scripts` - 128 passed.
- `node scripts/run-node-tests.mjs packages/nextjs/e2e/playwright.config.test.ts packages/promo-video/scripts/voiceover-clips.test.mjs` - 17 passed across the focused Next and promo groups.
- `node scripts/run-node-tests.mjs scripts/readiness-workflows.test.mjs packages/foundry/scripts-js/checkContractSizesScript.test.js packages/nextjs/e2e/playwright.config.test.ts` - 26 passed across repo, Foundry JS, and Next groups.
- `node scripts/run-node-tests.mjs packages/promo-video/scripts/voiceover-clips.test.mjs` - 2 passed.
- `node scripts/check-base-sepolia-readiness.mjs` - passed offline readiness with the expected stale staging submitter warning.
- `yarn workspace @rateloop/keeper check-types`.
- `yarn workspace @rateloop/agents check-types`.
- `yarn workspace @rateloop/promo-video check-types`.
- `yarn workspace @rateloop/nextjs check-types`.
- `yarn dead-code`.
- `git diff --check`.

Not run:

- Foundry/Solidity tests and smart-contract review.
- Full Playwright browser E2E/local dev-stack.
- Live external readiness probes.
