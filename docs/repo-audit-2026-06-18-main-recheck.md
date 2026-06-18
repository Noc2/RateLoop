# Repo Audit Recheck - 2026-06-18

Scope: read-only recheck of current `main` for bugs, stale generated output,
test inconsistencies, docs drift, and previously reported open items. This pass
used parallel agents for frontend and service/package review, then re-verified
load-bearing findings locally before writing this document.

Baseline note: the audit started from `b4094cc3` on local `main`, which was two
commits ahead of `origin/main`. One delegated protocol pass accidentally created
three local Solidity commits plus unstaged edits during the read-only audit. The
unstaged patch was saved to `/private/tmp/rateloop-protocol-agent-uncommitted.patch`,
and the three commits were reverted before this report was added. Before this
document was created, `git diff --stat b4094cc3..HEAD` was empty, so the code
tree was back to the pre-audit state.

## Verification

| Check | Result |
| --- | --- |
| `yarn base-sepolia:check` | Pass |
| `node scripts/run-node-tests.mjs packages/nextjs/config/nextConfigCsp.test.ts` | Pass, 2 tests |
| `node scripts/run-node-tests.mjs packages/nextjs/lib/questionRewardPools.test.ts packages/nextjs/lib/env/server.test.ts packages/nextjs/config/nextConfigCsp.test.ts` | Partial: CSP tests passed, the two direct Next.js lib tests failed to resolve `~~/...` aliases under this direct helper invocation |
| Source/dist grep for `confirmFeedbackBonusTransactions` | Confirmed source contains the Feedback Bonus confirmation path and committed `dist` does not |
| Prior open-item spot checks from `docs/repo-audit-2026-06-24.md` | Several older items are now closed or reduced; see non-findings |

## Findings

### H1 - Shipped `@rateloop/agents` dist skips Feedback Bonus funding

**Severity:** High (published CLI/package behavior diverges from source and docs)

**Status:** Open

**Paths:** `packages/agents/package.json:21-26`, `packages/agents/package.json:49-50`,
`packages/agents/src/localSigner.ts:3551-3608`,
`packages/agents/dist/esm/localSigner.js:1603-1634`,
`packages/agents/dist/cjs/localSigner.js:1625-1644`

The `@rateloop/agents` package ships and executes committed `dist` files: the
package bin points at `./dist/esm/cli.js`, `main`/`module` point at `dist`, and
`files` includes `dist`. The source local signer now detects a requested
Feedback Bonus after `confirmAskTransactions`, validates the returned Feedback
Bonus transaction plan, executes it with `plan: "feedback_bonus"`, and calls
`confirmFeedbackBonusTransactions`.

Committed `dist` still only validates/executes the primary ask transaction plan,
calls `confirmAskTransactions`, and returns. Grepping committed `dist` finds no
`confirmFeedbackBonusTransactions` implementation path. Because `dist/esm/cli.js`
imports `askHumansWithLocalSigner` from `./localSigner.js`, users of the shipped
`rateloop-agents` bin or package imports get the stale implementation.

**Impact:** Local-signer asks that request a Feedback Bonus can fund/confirm the
base ask but leave the Feedback Bonus at `awaiting_wallet_signature`, despite
source docs implying the second transaction plan is handled.

**Suggested fix:** Rebuild and commit `packages/agents/dist/{esm,cjs}` from the
current source, or stop committing/shipping stale generated dist. Add a CI drift
check after `yarn workspace @rateloop/agents build`, plus at least one dist-level
test that exercises a local-signer ask returning `feedbackBonus.status =
"awaiting_wallet_signature"`.

### M1 - Mobile landing E2E expects the app shell header on a public landing page

**Severity:** Medium (mobile suite can fail while checking the wrong header)

**Status:** Open

**Paths:** `packages/nextjs/e2e/tests/mobile.spec.ts:627-645`,
`packages/nextjs/components/PublicMobileHeader.tsx:49`,
`packages/nextjs/components/Header.tsx:811-812`,
`.github/workflows/e2e.yaml:262`

The mobile test `mobile header still hides on scroll down and returns on scroll
up on landing` navigates to `/?landing=1`, then locates
`[data-mobile-header="true"]` and expects its `data-visible` attribute to toggle.
The public landing header rendered by `PublicMobileHeader` does not set either
attribute; those attributes exist on the app shell `Header` component instead.

**Impact:** `yarn workspace @rateloop/nextjs e2e:mobile` can fail on the landing
header test even if the public landing page itself renders correctly. The test
is currently asserting app-shell behavior against a public page component.

**Suggested fix:** Decide whether the public landing header should share the
same scroll-hide behavior and data attributes as the app shell. If yes, add that
behavior to `PublicMobileHeader`; if no, update the test to assert the public
header contract instead of the app shell selector.

### L1 - Keeper unsupported-chain address override docs conflict with config

**Severity:** Low (operator docs drift for private or unsupported live chains)

**Status:** Open

**Paths:** `docs/env-parity.md:98`, `packages/keeper/README.md:27-29`,
`packages/keeper/.env.example:7-8`, `packages/keeper/src/config.ts:336-389`

The docs say package-specific address env vars override artifacts on local
`31337` or unsupported chains, and the Keeper env example calls live-chain
address vars "optional only for unsupported live chains." The config only honors
address env values as overrides for local `31337`. For non-local chains, it uses
shared deployment artifacts when present, rejects conflicting env values, and
errors when the shared artifact is missing even if a valid env address is set.

**Impact:** An operator following the current docs for a private or unsupported
live chain can provide valid `*_ADDRESS` env vars and still fail Keeper startup
with a missing shared artifact error.

**Suggested fix:** Pick one policy and align the other side. Either document
that all non-local Keeper deployments require shared `@rateloop/contracts`
artifacts, or implement and test an env-address fallback for unsupported
non-local chains.

### L2 - Responsive landing viewport test can race beta-banner hydration

**Severity:** Low (test flake risk around the mobile hero regression check)

**Status:** Open

**Paths:** `packages/nextjs/e2e/tests/responsive-layout.spec.ts:58-74`,
`packages/nextjs/components/BetaNoticeBanner.tsx:14-23`,
`packages/nextjs/e2e/tests/smoke.spec.ts:15-23`

The responsive layout test measures the landing hero heading immediately after
it becomes visible and asserts the heading fits within the initial 390 px-or-less
mobile viewport. `BetaNoticeBanner` starts hidden and then sets visibility in a
client `useEffect` after reading localStorage. The smoke suite explicitly
pre-dismisses the beta banner because it can render above the landing heading;
the responsive suite does not.

**Impact:** The new mobile viewport regression can measure the pre-hydration
layout, then the banner can appear and move content. This may produce flaky
signal around the landing hero fix.

**Suggested fix:** Pre-dismiss the beta banner in the responsive project, or wait
for the banner visibility state to settle before taking the heading measurement.

### L3 - Bug report template still uses stale Node and World Chain examples

**Severity:** Low (incoming bug reports can collect stale environment context)

**Status:** Open

**Paths:** `.github/ISSUE_TEMPLATE/bug_report.md:28-32`,
`package.json:114-116`, `README.md:8-10`

The bug report template asks for `Node.js version: [e.g. 20.18.3]` and network
examples of `World Chain Mainnet, World Chain Sepolia, Anvil localhost`.
Current engines require Node `>=24 <25`, and the README states the current
launch direction is Base Sepolia first and Base mainnet after testnet
verification.

**Impact:** New reports may omit the Base chain context or report against a Node
version the repo no longer supports.

**Suggested fix:** Update the examples to Node 24 and the current Base-first
network list, while keeping Anvil/localhost as the local development example.

## Non-findings and closed prior items

- Base Sepolia readiness is no longer blocked by a missing `84532` deployment
  artifact in this tree. `yarn base-sepolia:check` passed all offline readiness
  checks in this pass.
- The prior `/correlation/bundle-round-votes` unbounded scan finding appears
  closed in current source: the route now pages vote scans, probes after the
  scan budget, computes `truncated`, and returns it to the keeper-facing path.
- The prior generated-image handoff JSON-size mismatch appears closed: the
  agent body limit is now derived from four 10 MB images plus JSON slack via
  `getAgentGeneratedImagesJsonBudgetBytes()`.
- The prior browser public-USDC mismatch is no longer current: `getDefaultUsdcAddress`
  now rejects conflicting public USDC overrides, and `questionRewardPools.test.ts`
  includes mismatch coverage.
- The prior hardcoded keeper Ponder fetch timeout is reduced to a local alias of
  `PONDER_HTTP_FETCH_TIMEOUT_MS`, not an independent numeric constant.
- No issue was confirmed in the permissions-policy change from `b4094cc3`; the
  targeted CSP/config test passed.
