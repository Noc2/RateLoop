# RateLoop Repo Audit — Bugs & Inconsistencies (15 June 2026)

A multi-agent read-only audit of the RateLoop monorepo at HEAD `1ec63789` (`fix(foundry): update bundle observer test slot`), following the June 13 post-cleanup remediation series (`7a3867bc`..`7467260d`) and subsequent foundry fixes (`a8afca13`, `1ec63789`).

Four agents audited disjoint subsystems in parallel (Solidity, TypeScript integration, ABI/deployment parity, test/CI verification). Load-bearing findings were re-verified against source by the compiler of this document (grep, targeted test runs, CI log review).

Scope: **bugs, inconsistencies, and drift** — not style, gas, or UX polish.

**No code was changed for this audit.**

---

## TL;DR

The June remediation **landed correctly** for its stated goals: stale ABIs were regenerated, `bonusPool` removed, x402 allowlists unified, protocol constants centralized, Ponder handler fixes committed, and test isolation improved. **No stale TypeScript call sites** to removed contract functions were found.

Three **actionable regressions** surfaced on current HEAD:

1. **CI ABI parity gate is broken** — `contract-size` job fails because `generate-abis-only` imports `prettier`, which is not installed in that workflow (only Foundry is set up).
2. **Ponder unit test failure** — `content-registry-handlers.test.ts` mocks `@rateloop/contracts/protocol` without `CONFIDENTIALITY_FLAG_PRIVATE_FOREVER`, introduced when handlers started importing it (`7467260d`). This fails `yarn test:ts` / Unit Tests `typescript` job.
3. **Ponder voteability RPC fallback** — `resolveRoundVoteabilityStateAtCommit` swallows all RPC errors and persists indexed defaults, unlike neighboring paths that use `tryContractRead`.

Secondary clusters: **x402 parser drift** between `localSigner.ts` and `questionPayload.ts`, **stale worldchain readiness selector**, dead pre-deploy storage, and remaining constant duplication.

---

## Method

| Agent | Scope | Headline |
| --- | --- | --- |
| 1 | Solidity (`packages/foundry`) | No High contract bugs; partial engine-rotation footgun; dead follow-counter storage |
| 2 | TS packages (nextjs, agents, ponder, keeper, contracts, sdk, node-utils) | No stale contract calls; x402 parser drift; Ponder RPC swallow |
| 3 | ABI / deployment parity | ABIs match compiled artifacts locally; CI gate env broken |
| 4 | Test / CI verification | Foundry 1707/1707 (agent run); Ponder 300/301 pass; contracts 35/35 |

Prior audit context: [`repo-post-cleanup-audit-2026-06.md`](repo-post-cleanup-audit-2026-06.md) (June 13). That document’s H1/M1/M2/M6/Ponder items were addressed in commits through `7467260d`. This audit covers **residual and newly introduced** issues.

---

## Verification snapshot (2026-06-15)

| Check | Result |
| --- | --- |
| `packages/ponder` `yarn test` | **300 pass, 1 fail, 2 skip** — deterministic mock gap (see H2) |
| `packages/contracts` `yarn test` | **35/35 pass** |
| `packages/foundry` `forge test --summary` | **1707/1707 pass** (reported by verification agent; full in-repo run not re-executed in this pass) |
| GitHub Unit Tests @ `1ec63789` | **failure** — `contract-size` (prettier) + `typescript` (Ponder test) |
| GitHub Foundry jobs @ `1ec63789` | **success** |
| ABI hash parity (agent) | **19/19** `ABI_TARGETS` match `foundry/out` |
| `deployments/4801.json` | `deploymentComplete: "true"`; addresses match `deployedContracts.ts` |

---

## 1. High

### H1 — CI ABI parity gate fails: `prettier` not available in `contract-size` job

**Severity:** High (CI regression; gate added in `30241ef0` never passes)  
**Status:** Open  
**Introduced by:** `.github/workflows/unit-tests.yaml` ABI diff step + `generateTsAbis.js --abis-only`

The `contract-size` job runs `make generate-abis-only` then `git diff --exit-code` on ABIs. That job uses `.github/actions/setup-foundry` only — **no `yarn install`**. `generateTsAbis.js` imports `prettier` (`packages/foundry/scripts-js/generateTsAbis.js:11`), which lives in `@rateloop/foundry` devDependencies but is not hoisted into the CI runner path.

**CI evidence (run `27525784035`):**

```
Error [ERR_MODULE_NOT_FOUND]: Cannot find package 'prettier' imported from .../generateTsAbis.js
make: *** [Makefile:56: generate-abis-only] Error 1
```

**Impact:** ABI parity is **not enforced in CI** despite the intended gate. Drift can reappear silently.

**Fix:** Run `yarn install --immutable` (or install foundry workspace deps) before `generate-abis-only` in `contract-size`, or remove the `prettier` hard dependency from the `--abis-only` write path.

---

### H2 — Ponder test mock missing `CONFIDENTIALITY_FLAG_PRIVATE_FOREVER`

**Severity:** High (CI / `yarn test:ts` failure)  
**Status:** Open  
**Introduced by:** `7467260d` — handlers import constant from `@rateloop/contracts/protocol`; test mock not updated

`packages/ponder/src/ContentRegistry.ts` uses `CONFIDENTIALITY_FLAG_PRIVATE_FOREVER` in `confidentialityDisclosurePolicyFromFlags` (~100–103). `packages/ponder/tests/content-registry-handlers.test.ts` mocks protocol with only `DEFAULT_ROUND_CONFIG`, `USER_PREDICTION_*`, and `ROUND_STATE` (~96–106) — **no confidentiality flag**.

**Failure:** `applies confidentiality config that was indexed before content submission` — Vitest: `No "CONFIDENTIALITY_FLAG_PRIVATE_FOREVER" export is defined on the "@rateloop/contracts/protocol" mock`.

**Impact:** Unit Tests `typescript` job red on every push to main.

**Fix:** Extend mock with `CONFIDENTIALITY_FLAG_PRIVATE_FOREVER: 1`, or use `vi.mock(..., importOriginal)` partial mock.

---

### H3 — Ponder voteability reads swallow transient RPC failures

**Severity:** High (indexer fidelity under RPC blips)  
**Status:** Open (carry-over pattern; neighboring paths fixed)

`packages/ponder/src/RoundVotingEngine.ts` — `resolveRoundVoteabilityStateAtCommit` (~263–306):

- Uses bare `try/catch` around `readContract` for `advisoryRoundContext` / `roundLifecycleState`.
- On **any** error, returns indexed defaults (`lastCommitRevealableAfter: epochEnd`, indexed grace period).

Contrast: `resolveCommitIdentityAtCommit` (~92–110) and `loadRbtsCommitWeights` (~423–434) use `tryContractRead`, which retries transient failures and fails loudly otherwise.

**Impact:** Wrong `lastCommitRevealableAfter` / `revealGracePeriod` on `round` rows after RPC errors → keeper SQL and content routes for reveal-failed / settlement eligibility can disagree with chain state. Data persists silently instead of triggering Ponder retry.

**Fix:** Refactor to `tryContractRead`; rethrow non-deterministic failures.

---

## 2. Medium

### M1 — x402 parser drift: gated-question rules differ (server vs local signer)

**Severity:** Medium  
**Status:** Open

| Rule | Server (`questionPayload.ts` ~619–627) | Local (`localSigner.ts` ~1717–1734) |
| --- | --- | --- |
| Gated requires `detailsUrl` | **Yes** — mandatory hosted details URL | **No** — allows imageUrls-only |

Shared top-level allowlist (`x402QuestionFields.ts`) fixed field-name drift; **normalization logic remains ~4k lines duplicated** across the two parsers.

**Impact:** `local-ask` can accept payloads the server rejects, or produce different canonical hashes vs `toCanonicalQuestionPayload` (operationKey / payloadHash verification at ~3932–3949 in `localSigner.ts`).

---

### M2 — x402 parser drift: server validations absent in local parser / lint

**Severity:** Medium  
**Status:** Open

| Check | Server | Local / `lint.ts` |
| --- | --- | --- |
| `requiredQuestionRewardParticipants` tier floor | Yes | **No** |
| `findBlockedContentTags` | Yes | **No** |
| `getContentTitleValidationError` | Yes | **No** (non-empty only) |
| On-chain min pool / `validateRoundConfig` | Yes (`questionSubmission.ts`) | **No** |

**Impact:** Agents see locally “valid” payloads that MCP/server rejects; subtle canonical JSON differences from tag/title normalization.

---

### M3 — `getEstimatedSettlementTime` ignores per-round `revealGracePeriod`

**Severity:** Medium (API / discover timing)  
**Status:** Open

`packages/ponder/src/api/shared.ts` `getEstimatedSettlementTime` (~62–72) uses global `DEFAULT_REVEAL_GRACE_PERIOD_SECONDS`. Per-round `revealGracePeriod` is indexed and used in keeper-oriented SQL (`content-routes.ts`, `keeper-routes.ts`) but not in discover / for-you serializers that call this helper.

**Impact:** Wrong “settling soon” estimates when on-chain grace differs from protocol default.

---

### M4 — Partial engine rotation leaves pinned escrows stale

**Severity:** Medium (governance footgun)  
**Status:** Open (by design; easy to mis-run)

`ContentRegistry.setVotingEngine` rotates the registry pointer, but escrows pin engine at `initialize` and gate with `"Stale engine"` (`QuestionRewardPoolEscrow.sol` ~1382–1388, `FeedbackBonusEscrow.sol` ~524). Tests require full replacement stack (`FeedbackBonusEscrow.t.sol` ~312–421).

**Impact:** Governance calling only `setVotingEngine` breaks new submissions until escrows/registries are redeployed and rewired.

---

### M5 — Stale selector in worldchain readiness script

**Severity:** Medium (live readiness false negatives)  
**Status:** Open

`scripts/check-worldchain-sepolia-readiness.mjs:90` expects `0x517fbf76` (`recordConfidentialityNexus(uint256,address)`). Current Solidity/ABI expose **`recordConfidentialityNexusForRegistry`** (`0x80fb3870`). Live `--live` probes would fail; offline CI path skips RPC selector checks, which is why World Chain Sepolia Readiness still passes on push.

---

### M6 — Protocol constant duplication (partial centralization)

**Severity:** Medium (drift risk)  
**Status:** Open

`protocol.ts` now exports confidentiality, USDC, and bounty-eligibility flags, but copies remain in:

| Constant | Still duplicated in |
| --- | --- |
| `WORLD_CHAIN_USDC_BY_CHAIN_ID` | `questionRewardPools.ts` |
| Min voters / default bounty / frontend BPS | `questionPayload.ts`, `localSigner.ts`, `questionRewardPools.ts` |
| `ROUND_STATE` | `keeper/src/contract-reads.ts` |
| Payout domains 1/3/4 | `correlation-routes.ts`, `data-routes.ts`, `keeper/correlation-snapshots.ts` |
| Production attachment origins | Four nextjs files + `localSigner.ts` |

---

### M7 — `RaterRegistryConfidentialityAbi.ts` outside `--abis-only` loop

**Severity:** Medium (future drift)  
**Status:** Open (currently aligned)

Hand-maintained subset ABI exported from `packages/contracts/src/abis/index.ts` but not in `ABI_TARGETS`. Subset matches full `RaterRegistry` artifact today; future confidentiality API changes could leave it stale.

---

## 3. Low

### L1 — Dead follow-counter storage in `RaterRegistry`

**Severity:** Low  
**Status:** Open (deferred pre-deploy)

`followingCount` / `followerCount` private mappings (`RaterRegistry.sol:119–121`) never read/written; still pinned in storage layout JSON.

---

### L2 — `IRoundRewardDistributor` omits `confiscateBannedReward`

**Severity:** Low  
**Status:** Open

Implementation and ABI expose `confiscateBannedReward` (`RoundRewardDistributor.sol:245`); interface ends at `confiscateFrontendFee`. Integrators using only the interface miss the banned-reward path.

---

### L3 — Inert protocol placeholders

**Severity:** Low  
**Status:** Deferred

- `QuestionRewardPoolEscrowEligibilityLib.eligibilityDataHash()` always `bytes32(0)`.
- `RatingLib.RatingConfig` has seven explicitly unread fields.

---

### L4 — E2e tests use raw round state integers

**Severity:** Low  
**Status:** Open

Tests compare `state === 1` / `state === 3` instead of `ROUND_STATE` constants.

---

## 4. Fixed since June 13 audit (verified)

| Item | Status |
| --- | --- |
| H1 stale ABIs (`setBonusPool`, removed `setVotingEngine` stubs, `proposerBond`, etc.) | **Fixed** (`30241ef0`) |
| M1 `ContentRegistry.bonusPool` slot | **Fixed** (`b8672529`) |
| M2 x402 top-level allowlist drift | **Fixed** (`744b22f7`) |
| M3/M4 partial constant / identity centralization | **Partially fixed** (`7467260d`) |
| M6 test order-dependent flakiness | **Fixed** (`15349a01`) |
| Ponder refund labeling, replay guards, revocation provider | **Fixed** (`8ed6e00c`) |
| `deployments/4801.json` `deploymentComplete` | **Fixed** (`a8afca13`) — now `"true"` |
| ClusterPayoutOracle live snapshot-proposer challenge censorship | **Fixed** (prior) |
| Advisory cooldown survives recorder rotation | **Fixed** (prior) |

---

## 5. Remediation priority

| Priority | Item | Effort |
| --- | --- | --- |
| 1 | H1 — Fix CI `contract-size` job (`yarn install` or drop prettier dep in abis-only path) | Small |
| 2 | H2 — Extend Ponder protocol mock | Trivial |
| 3 | H3 — `tryContractRead` in voteability resolver | Small |
| 4 | M5 — Update readiness selector to `recordConfidentialityNexusForRegistry` | Trivial |
| 5 | M1/M2 — Shared x402 normalization module + golden tests | Medium |
| 6 | M3 — Per-round grace in settlement estimates | Small |
| 7 | M4 — Document / guard full-stack engine migration | Docs / optional on-chain guard |
| 8 | L1/L2 — Pre-mainnet storage/interface cleanup | Small |

---

## 6. Notes

- **Working tree:** Five `docs/*.md` files show as deleted locally (including prior audit docs). Not part of this audit commit; restore or remove intentionally before the next unrelated commit.
- **Contract size:** EIP-170 pressure on `QuestionRewardPoolEscrow` / `LaunchDistributionPool` remains; CI `check-contract-sizes` enforces limits — deferred from June audit as pre-mainnet deploy work.
- **M5 contract size warnings:** Unchanged from prior audits; not re-evaluated in this pass.
