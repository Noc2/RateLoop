# RateLoop Repo Re-Audit - Bugs & Inconsistencies (18 June 2026, latest recheck)

Read-only re-audit of the RateLoop monorepo at HEAD `fd650820`
(`Keep oracle wiring guard within size limit`). Application code was not
changed for this audit; this document is the only intended repository change.

Scope: bugs, inconsistencies, stale Base rollout surfaces, path-prefix support,
readiness checks, public/legal copy drift, and contract/governance regressions.

Three explorer agents reviewed independent slices in parallel:

- Solidity/foundry governance, oracle wiring, rewards, deployment artifacts, and size/storage guards
- Keeper/Ponder/readiness/ops, including Base deployment wiring and URL handling
- Next.js frontend/docs/legal/SDK surfaces, including stale network and World ID copy

Load-bearing findings below were re-checked in the main workspace against source
and command output. The audit also applied the repository `AGENTS.md` guidance:
Base Sepolia is the next live rollout gate, Base mainnet remains gated until a
deliberate promotion, and optimistic oracle challenge-bond / reveal-grace
parameters were not treated as findings.

## TL;DR

No new High-severity contract or fund-loss issue was confirmed.

The strongest confirmed issues are:

1. Keeper automatic correlation snapshot fetching still drops path prefixes
   from `PONDER_BASE_URL`, even though Ponder path prefixes are documented and
   already supported by the shared Keeper helper.
2. Base live readiness app probes drop path prefixes from `BASE_SEPOLIA_APP_URL`
   / `BASE_APP_URL`, so path-mounted deployments can be probed at the wrong
   routes.
3. E2E Ponder preflights drop path prefixes from `NEXT_PUBLIC_PONDER_URL`,
   despite `docs/env-parity.md` documenting path-prefixed Ponder URLs.
4. Several public-facing surfaces still say World Chain or imply mandatory
   World ID verification, which is stale against the Base Sepolia rollout and
   optional-credential model.

Base Sepolia offline readiness remains green. Base mainnet remains
intentionally blocked until `packages/foundry/deployments/8453.json` exists.

## Verification Snapshot

| Check | Result |
| --- | --- |
| `node scripts/check-base-sepolia-readiness.mjs --json` | Pass |
| `node scripts/check-base-mainnet-readiness.mjs --json` | Expected fail: missing `packages/foundry/deployments/8453.json` |
| `node scripts/check-worldchain-sepolia-readiness.mjs --json` | Pass |
| `node scripts/check-worldchain-mainnet-readiness.mjs --production --json` | Expected/manual legacy fail: `.env.production` intentionally targets Base Sepolia (`84532`) |
| `yarn workspace @rateloop/foundry check:sizes` | Pass; all checked deploy-profile bytecode under EIP-170 |
| `node scripts/run-node-tests.mjs scripts/check-worldchain-sepolia-readiness.test.mjs scripts/check-worldchain-mainnet-readiness.test.mjs scripts/dev-stack.test.mjs scripts/dev-stack-keeper.test.mjs` | Pass, 65 tests |
| Contracts/governance explorer | No strong findings; size/storage guards passed, with size check using existing Foundry artifacts |

## High

None confirmed.

## Medium

### M1 - Keeper correlation snapshot auto mode drops Ponder path prefixes

**Severity:** Medium (path-mounted Ponder deployments can break automatic
correlation artifact construction and oracle proposal preparation)

`docs/env-parity.md:55` says E2E and `yarn dev:stack` should point
`NEXT_PUBLIC_PONDER_URL` and `PONDER_BASE_URL` at the same Ponder base URL,
including any path prefix, for example `https://example.com/ponder`.

Most Keeper code now has a helper that preserves this shape:
`packages/keeper/src/ponder-url.ts:1-4` normalizes the base with a trailing slash
and strips leading slashes from the appended path. Its test at
`packages/keeper/src/__tests__/ponder-url.test.ts:12-18` asserts that
`https://ponder.example.test/ponder` plus `/keeper/work` becomes
`https://ponder.example.test/ponder/keeper/work`.

The automatic correlation artifact builder does not use that helper:

- `packages/keeper/src/correlation-artifact-builder.ts:542-550` uses
  `new URL(pathname, ponderBaseUrl)` for `/correlation/round-candidates`,
  `/correlation/bundle-round-candidates`, and
  `/correlation/rating-round-candidates`.
- `packages/keeper/src/correlation-artifact-builder.ts:628-631` uses
  `new URL(correlationVotesPathForDomain(...), ponderBaseUrl)` for vote pages.

For a configured base of `https://example.com/ponder`, those root-absolute paths
resolve to `https://example.com/correlation/...` instead of
`https://example.com/ponder/correlation/...`.

**Impact:** a path-mounted Ponder deployment can make automatic correlation
snapshot generation query the wrong route or service. That can block Keeper
correlation artifacts and downstream `ClusterPayoutOracle` proposal work even
though the same deployment shape is documented and supported elsewhere.

**Suggested fix/test:** import and use `buildPonderUrl` in
`correlation-artifact-builder.ts`. Add coverage with
`PONDER_BASE_URL=https://ponder.example.test/indexer` asserting requests hit:

- `/indexer/correlation/round-candidates`
- `/indexer/correlation/bundle-round-candidates`
- `/indexer/correlation/rating-round-candidates`
- `/indexer/correlation/round-votes`

### M2 - Live readiness app probes drop app path prefixes

**Severity:** Medium (Base live checks can false-fail or false-pass for
path-mounted app deployments)

The shared live readiness probe loops over app paths and calls:

```js
new URL(path, appUrl)
```

at `scripts/check-worldchain-sepolia-readiness.mjs:829-833`. Base readiness uses
that helper:

- `scripts/check-base-sepolia-readiness.mjs:64-68` passes
  `BASE_SEPOLIA_APP_URL` into `validateLiveReadiness`.
- `scripts/check-base-mainnet-readiness.mjs:115-119` passes `BASE_APP_URL` into
  `validateLiveReadiness`.

The same root-absolute behavior exists in the manual World Chain mainnet live
probe at `scripts/check-worldchain-mainnet-readiness.mjs:390-394`.

Main-workspace reproduction:

```sh
node -e "console.log(new URL('/ask','https://example.com/base-sepolia').toString())"
```

Output:

```text
https://example.com/ask
```

**Impact:** if the Base Sepolia app is exposed at a path-mounted URL such as
`https://edge.example/base-sepolia`, `base-sepolia:check -- --live` probes
`https://edge.example/ask` instead of
`https://edge.example/base-sepolia/ask`. That can report a healthy deployment as
broken, or accidentally probe another app mounted at the origin root.

**Suggested fix/test:** add a path-preserving app URL helper analogous to
Keeper's `buildPonderUrl`, use it in all live app probes, and add tests proving
`https://app.example.test/rateloop` resolves probes under `/rateloop/...`.

### M3 - Bounty UI still tells users funds are on World Chain

**Severity:** Medium (user-facing funding/network copy is wrong for the Base
Sepolia rollout)

`packages/nextjs/components/shared/VotingQuestionCard.tsx:64-69` hardcodes:

- `USDC on World Chain`
- `LREP on World Chain`
- `multiple assets on World Chain`

These strings are shown in reward/bounty tooltip copy. On Base Sepolia, they
are directly wrong for users inspecting how a question is funded.

**Impact:** users can be told a Base Sepolia bounty is backed or funded on
World Chain. That is confusing during the live rollout and risky around wallet
approval expectations.

**Suggested fix/test:** use neutral copy such as "the active network" or derive
the display network name from the active target network. Add/render a Base
Sepolia question card and assert the reward tooltip does not contain
`World Chain`.

### M4 - Public landing copy implies World ID is required for humans

**Severity:** Medium (public product copy contradicts the optional-credential
model)

`packages/nextjs/app/(public)/page.tsx:24-28` says:

```text
Verified Humans and agents answer privately...
```

`packages/nextjs/app/(public)/page.tsx:59-62` says:

```text
Humans are verified through World ID zero-knowledge proof-of-human...
```

That reads as mandatory World ID verification for all human raters. The current
model is optional credentialing, not a hard World ID requirement.

**Impact:** the first public page can mislead new users and integrators about
who can participate and what identity proof is required.

**Suggested fix/test:** change the landing copy to "human and agent raters" and
"humans can optionally verify" or equivalent. Smoke-test the landing page copy
and any related docs anchors.

## Low

### L1 - E2E Ponder preflights drop Ponder path prefixes

**Severity:** Low (E2E/prod-style checks can fail against a documented Ponder
deployment shape)

`docs/env-parity.md:55` documents that `NEXT_PUBLIC_PONDER_URL` and
`PONDER_BASE_URL` may include a path prefix. The E2E preflights still build
their Ponder probe with a root-absolute URL:

- `packages/nextjs/e2e/global-setup.cts:24-27`
- `packages/nextjs/e2e/scripts/preflight.mjs:27-30`

Both use:

```ts
new URL("/content?limit=1", PONDER_URL).toString()
```

Main-workspace reproduction:

```sh
node -e "console.log(new URL('/content?limit=1','https://example.com/ponder').toString())"
```

Output:

```text
https://example.com/content?limit=1
```

**Impact:** E2E tests pointed at `https://host/ponder` probe
`https://host/content?limit=1`, so path-mounted Ponder environments can fail
preflight even though runtime code and docs support the configuration.

**Suggested fix/test:** add a small E2E Ponder URL helper, or reuse an equivalent
normalization pattern, and cover `https://host/ponder` resolving to
`https://host/ponder/content?limit=1`.

### L2 - Legal Terms still say bounties are funded on World Chain

**Severity:** Low (legal/product copy drift)

`packages/nextjs/app/(public)/legal/terms/page.tsx:201-203` says submissions
must attach a non-refundable bounty funded in LREP or USDC on World Chain.

**Impact:** the legal terms contradict the current Base Sepolia rollout and can
publish stale network expectations for bounty funding.

**Suggested fix/test:** use "the configured supported network" or explicitly
describe Base Sepolia during the test rollout and Base mainnet after promotion.
Smoke-test the rendered legal page.

### L3 - Mobile protocol docs still label protocol state as World Chain

**Severity:** Low (mobile-only docs drift)

`packages/nextjs/components/docs/ProtocolPiecesDiagram.tsx:32-33` labels a
mobile diagram node:

```text
Protocol state on World Chain
```

The same conceptual docs should now be network-neutral for the Base rollout.

**Impact:** mobile docs users can see stale World Chain architecture copy while
desktop docs and deployment guidance have moved toward Base.

**Suggested fix/test:** change the mobile label to the existing generic wording,
for example `On-chain protocol state`, and verify `/docs/tech-stack` at a mobile
viewport.

### L4 - Legacy World Chain Sepolia readiness still runs on push/PR/schedule

**Severity:** Low (CI signal drift, not currently blocking)

`.github/workflows/worldchain-sepolia-readiness.yaml:3-12` still enables the
World Chain Sepolia readiness workflow on `push`, `pull_request`, weekly
`schedule`, and manual dispatch. The job runs the offline check at
`.github/workflows/worldchain-sepolia-readiness.yaml:42-43` and live probes on
schedule when all legacy live target variables are configured at
`.github/workflows/worldchain-sepolia-readiness.yaml:45-47`.

The offline command passes today, so this is not a current push blocker. The
inconsistency is that Base Sepolia is now the live rollout gate, while the
legacy World Chain Sepolia workflow still produces active PR/push/scheduled
signals.

**Impact:** future PRs can spend CI time on a legacy rollout, and a future
World Chain specific drift could look like a current-release blocker even when
Base Sepolia is the intended gate.

**Suggested fix/test:** make the legacy World Chain Sepolia workflow
manual-only, or rename/annotate it as a legacy compatibility signal. Keep Base
Sepolia readiness on push/PR.

## Checked But Not Treated As Findings

- Base mainnet readiness failing on missing
  `packages/foundry/deployments/8453.json` is expected until promotion.
- World Chain mainnet production readiness failing because `.env.production`
  targets Base Sepolia is expected for the current rollout; that workflow is
  manual-only.
- Contracts/governance review found no strong regression in config rotation
  guards, oracle consumer wiring, reward claim/recovery invariants, recovered
  round preview parity, Base Sepolia artifact presence, storage-layout guards,
  or deploy-profile bytecode size.
- The audit intentionally did not flag `ClusterPayoutOracle` challenge-bond
  size or the 60-minute reveal grace period because the repository trust model
  documents both as accepted design parameters.
