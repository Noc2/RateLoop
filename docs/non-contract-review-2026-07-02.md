# Non-Contract Bug And Consistency Review - 2026-07-02

Scope: reviewed non-Solidity application code, agent tooling, tests, package scripts, CI/docs, and runtime configuration. Existing dirty Foundry contract/test/storage-layout files were treated as out of scope and left untouched.

Environment note: local shell used Node `v26.0.0`, while the repo pins `>=24 <25`. Commands below still passed except for the initially sandboxed `tsx` IPC failure noted under verification.

## Fixed During Review

### P2 - Vote runtime tests had stale `roundCore` fixtures

`yarn next:test` initially failed five tests in `packages/nextjs/lib/vote/roundVoteRuntime.test.ts`. The fixtures mocked the older 7-field compact `roundCore` tuple, while the current ABI/parser expect the canonical 8-field compact tuple including `upWins`. That made open-round fixtures parse as unopened and made the non-votable fixture reach `advisoryRoundContext` with a bad `chainHash` shape.

Fix: updated the mocked tuples in `packages/nextjs/lib/vote/roundVoteRuntime.test.ts` to match the current compact ABI shape. The targeted test and full Next unit suite now pass.

### P2 - Agent SDK example quoted one request and submitted another

`packages/agents/examples/landing-pitch-review.ts` quoted with `chainId: 84532` and a custom `roundConfig`, but the later `askPayload` omitted both. Because signing intents forward the request as given, users could receive quote guidance for one chain/duration and then create a signing link for a different/default request.

Fix: shared `chainId` and `roundConfig` between quote, signing-intent, and `askHumans` request paths.

### P2 - `lint:questions` missed parser-enforced invalid ask shapes

The lint path allowed several inputs that the x402 parser rejects later:

- Bundled `head_to_head_ab` asks when an unrelated warning already existed.
- Questions with both `imageUrls` and `videoUrl`.
- Bundles above the parser's 10-question cap.

Fix: `packages/agents/src/questions/lint.ts` now checks those parser constraints directly and reuses the exported parser bundle cap. Regression coverage was added in `packages/agents/src/__tests__/lint.test.ts`.

### P2 - File-backed handoff images accepted non-image bytes by extension

`packages/agents/src/handoffImages.ts` previously fell back to filename extension when PNG/JPEG/WEBP magic bytes were not recognized. A text file named `not-image.png` could be accepted as `image/png` with no dimensions.

Fix: file-backed handoff images now require recognizable PNG/JPEG/WEBP bytes. Regression coverage was added in `packages/agents/src/__tests__/handoffImages.test.ts`.

### P3 - Agents README chain guidance was stale

`packages/agents/README.md` said all `examples/questions/*.json` should default to Base Sepolia, while some checked-in public handoff examples intentionally use Base mainnet.

Fix: clarified that local signer examples should stay on Base Sepolia, while production browser-handoff examples may use Base mainnet.

## Remaining Low-Severity Findings

### Low - Focused Node test command is cwd-sensitive

`.github/pull_request_template.md` recommends focused `node scripts/run-node-tests.mjs ...` from the repo root, but some Next tests assume `packages/nextjs` as the current working directory. Example: `packages/nextjs/e2e/playwright.config.test.ts` fails from the repo root but passes from `packages/nextjs` with `node ../../scripts/run-node-tests.mjs e2e/playwright.config.test.ts`.

Suggested follow-up: clarify the PR template or make the test runner/package tests normalize cwd for package-local assumptions.

### Low - Next README understates the PR/push E2E matrix

`packages/nextjs/README.md` describes smoke, app, responsive, accessibility, lifecycle, and keeper-backed CI coverage, but `.github/workflows/e2e.yaml` also runs API, submit, confidential-context, and World ID suites on pushes/PRs.

Suggested follow-up: align the README's CI matrix summary with the workflow.

### Low - `e2e:full` docs overstate local coverage

`packages/nextjs/README.md` calls `e2e:full` the full local Playwright suite. The script includes Chromium/lifecycle/keeper/responsive/mobile projects, but leaves browser compatibility and axe accessibility in separate scripts.

Suggested follow-up: describe `e2e:full` as the broad local app/lifecycle/mobile suite, or fold in the separate compatibility/accessibility scripts if true full coverage is desired.

### Low - Foundry seed script feedback-bonus text is stale

`packages/foundry/script/SeedContent.sh` prints feedback-bonus guidance saying local smoke asks are funded only through the x402 gateway path. Current user docs and agents docs allow same-asset wallet-call LREP or USDC Feedback Bonus flows too.

This is a non-Solidity script/docs inconsistency inside the Foundry package; it was left unchanged because the requested review excluded smart-contract-side work.

## Verification

Passed:

- `yarn dead-code`
- `yarn next:lint`
- `node ../../scripts/run-node-tests.mjs lib/vote/roundVoteRuntime.test.ts` from `packages/nextjs` - 5 passed
- `yarn next:test` - 1839 passed
- `yarn next:check-types`
- `yarn node-utils:check-types`
- `yarn node-utils:test` - 50 passed
- `yarn sdk:check-types`
- `yarn sdk:test` - 57 passed
- `yarn agents:check-types`
- `yarn workspace @rateloop/agents test` - 145 passed
- `yarn agents:lint` - all checked-in question examples passed
- `yarn keeper:check-types`
- `yarn workspace @rateloop/keeper test` - 549 passed, 2 skipped
- `yarn ponder:check-types`
- `yarn workspace @rateloop/ponder test` - 411 passed, 1 skipped

Notes:

- The first sandboxed `yarn agents:lint` attempt failed with `listen EPERM` from `tsx` trying to create an IPC pipe. Rerunning the same command outside the sandbox passed.
- Full Playwright E2E, local Docker/dev stack, live handoffs, and Foundry/Solidity test suites were not run for this non-contract review.
