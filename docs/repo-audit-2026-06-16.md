# RateLoop Repo Audit — Bugs & Inconsistencies (16 June 2026)

A multi-agent read-only audit of the RateLoop monorepo at HEAD `f4d886aa` (`Remove pending rating chip border`), following the June 15 audit ([`repo-audit-2026-06-15.md`](repo-audit-2026-06-15.md)) and UI-focused commits `807a28cb`..`f4d886aa`.

Four agents audited disjoint subsystems in parallel (Solidity, TypeScript integration, ABI/deployment/CI parity, test/CI verification). Load-bearing findings were re-verified against source (grep, local `yarn test` in ponder, CI log review).

Scope: **bugs, inconsistencies, and drift** — not style, gas, or UX polish.

**No code was changed for this audit.**

---

## TL;DR

Since the June 15 audit, **one prior High regression is fixed** (Ponder `CONFIDENTIALITY_FLAG_PRIVATE_FOREVER` mock — `7a200a39`). The **`typescript` Unit Tests job is green** (303 Ponder tests pass locally and in CI).

The **dominant new blocker** is CI **`contract-size`**: `LaunchDistributionPool` is **24,622 bytes** vs the **24,576** EIP-170 limit, failing Unit Tests on every recent push. The ABI parity step (`generate-abis-only`) never runs because the job fails earlier on size checks.

**Still open from June 15:**

- Ponder voteability RPC swallow (`resolveRoundVoteabilityStateAtCommit`)
- x402 local vs server parser drift (gated `detailsUrl`, missing moderation/tier checks locally)
- Stale `0x517fbf76` selector in worldchain live readiness probes
- Latent ABI gate issue: `generate-abis-only` needs `prettier` but `contract-size` does not run `yarn install`

**No stale TypeScript call sites** to removed contract functions were found. ABIs match compiled artifacts locally (19/19 `ABI_TARGETS`).

---

## Method

| Agent | Scope | Headline |
| --- | --- | --- |
| 1 | Solidity (`packages/foundry`) | No High contract bugs; engine-rotation footguns expanded |
| 2 | TS packages | Mock fixed; voteability swallow + x402 drift remain |
| 3 | ABI / CI / deployments | ABIs in sync; contract-size CI red; latent prettier gap |
| 4 | Test / CI verification | Ponder 303/303 pass; Unit Tests fail on contract size only |

Prior audit: [`repo-audit-2026-06-15.md`](repo-audit-2026-06-15.md).

---

## Verification snapshot (2026-06-15 / HEAD `f4d886aa`)

| Check | Result |
| --- | --- |
| `packages/ponder` `yarn test` | **303 pass, 0 fail, 2 skip** (local) |
| `packages/contracts` tests | **35/35 pass** (via `run-node-tests.mjs`) |
| GitHub Unit Tests @ `f4d886aa` | **failure** — only `contract-size` (LaunchDistributionPool oversize); **foundry**, **typescript**, **foundry-heavy** all **success** |
| ABI hash parity (agent) | **19/19** match `foundry/out` |
| `deployments/4801.json` | `deploymentComplete: "true"`; addresses match `deployedContracts.ts` |
| World Chain Readiness on push | **success** (offline checks) |
| World Chain Readiness on schedule | **failure** — live probes require env vars not set on cron |

---

## 1. High

### H1 — `LaunchDistributionPool` exceeds EIP-170 limit (CI blocker)

**Severity:** High (deployment + CI)  
**Status:** Open  
**New since June 15 audit**

Unit Tests job `contract-size` fails at `make check-contract-sizes DEPLOY_PROFILE=deploy`:

```
LaunchDistributionPool is 24622 bytes (limit 24576)
```

**Evidence:** CI run `27531439339`, job `contract-size`, step “Enforce EIP-170 contract size limit”. Forge compile warning at `LaunchDistributionPool.sol:49`.

**Impact:** Unit Tests workflow red on every push; pre-mainnet deploy of `LaunchDistributionPool` blocked under current optimizer profile. Downstream steps in the same job (storage layout check, ABI parity diff) do not run.

**Fix:** Contract size reduction (library split, optimizer tuning, surface trimming) — same class of issue flagged as M5 in June 15 audit, now **enforced red in CI**.

---

### H2 — Ponder voteability RPC failures persist silently (carry-over)

**Severity:** High (indexer fidelity)  
**Status:** Open (unchanged from June 15 H3)

`packages/ponder/src/RoundVotingEngine.ts` — `resolveRoundVoteabilityStateAtCommit` (~263–306) uses bare `try/catch` around `readContract`. On any error it returns indexed defaults (`lastCommitRevealableAfter: epochEnd`). Neighboring paths use `tryContractRead` (~92–110, ~423–434).

**Impact:** Wrong `round.lastCommitRevealableAfter` / `revealGracePeriod` after RPC blips → keeper settlement and reveal-failed SQL can disagree with chain state.

**Fix:** Refactor to `tryContractRead`; add negative test (none exists today).

---

## 2. Medium

### M1 — x402 gated-context rules: server stricter than local signer (carry-over)

**Severity:** Medium  
**Status:** Open

| Rule | Server (`questionPayload.ts` ~619–627) | Local (`localSigner.ts` ~1717–1737) |
| --- | --- | --- |
| Gated requires `detailsUrl` | **Yes** | **No** — `imageUrls` alone suffices |

Top-level allowlist is unified (`node-utils/x402QuestionFields.ts`); **~4k lines of normalization remain duplicated**.

**Impact:** `local-ask` can accept payloads the MCP/server rejects; canonical hash / `operationKey` divergence risk.

---

### M2 — x402 server validations absent in local parser / lint (carry-over)

**Severity:** Medium  
**Status:** Open

Missing locally: `requiredQuestionRewardParticipants` tier floor, `findBlockedContentTags`, `getContentTitleValidationError`, on-chain `minSubmissionUsdcPool` / `validateRoundConfig` (present in `questionSubmission.ts` ~1180–1242).

---

### M3 — Partial engine rotation footguns (Solidity)

**Severity:** Medium (governance)  
**Status:** Open

| Component | Issue |
| --- | --- |
| Escrows | Pin engine at init; `"Stale engine"` if registry rotates alone (`QuestionRewardPoolEscrow.sol` ~1382, `FeedbackBonusEscrow.sol` ~524) |
| `FeedbackRegistry` | **No** governed `setVotingEngine` — only set in `initialize` (`FeedbackRegistry.sol` ~52–62, internal `_setVotingEngine` only) |
| `FrontendRegistry` | `setVotingEngine` clears active `feeCreditor` until re-bound (`FrontendRegistry.sol` ~536–550) |

Tests document full-stack replacement requirement (`FeedbackBonusEscrow.t.sol`, `QuestionRewardPoolEscrow.t.sol`).

---

### M4 — `getEstimatedSettlementTime` ignores per-round `revealGracePeriod` (carry-over)

**Severity:** Medium (API timing)  
**Status:** Open

`packages/ponder/src/api/shared.ts` ~62–72 always uses global `DEFAULT_REVEAL_GRACE_PERIOD_SECONDS`. Per-round grace is indexed and used in keeper SQL but not in discover/for-you serializers.

---

### M5 — Stale selector in worldchain **live** readiness probes (carry-over)

**Severity:** Medium  
**Status:** Open

`scripts/check-worldchain-sepolia-readiness.mjs:90` expects `0x517fbf76` (`recordConfidentialityNexus(uint256,address)`). Current ABI exposes `recordConfidentialityNexusForRegistry` → `0x80fb3870`.

**Impact:** Offline push/PR checks **pass**; scheduled `--live --require-live-targets` probes would fail on ConfidentialityEscrow bytecode if RPC were configured with stale expectations.

---

### M6 — CI ABI parity gate still not reliably enforced (carry-over, latent)

**Severity:** Medium  
**Status:** Open (masked by H1)

`unit-tests.yaml` runs `make generate-abis-only` then `git diff` on ABIs. `generateTsAbis.js` imports `prettier`; `contract-size` job has no `yarn install`. On June 15 CI this failed with `ERR_MODULE_NOT_FOUND`; on current HEAD the job **never reaches** that step because H1 fails first.

**Fix:** Add `yarn install` to `contract-size`, or remove prettier from `--abis-only` write path; **and** resolve H1 so the gate actually runs.

---

### M7 — Constant / origin allowlist duplication (carry-over)

**Severity:** Medium (drift risk)  
**Status:** Open

Remaining duplicates: `WORLD_CHAIN_USDC_BY_CHAIN_ID` in `questionRewardPools.ts`; payout domain literals in ponder/keeper routes; `RoundState` enum in `keeper/contract-reads.ts`; production attachment origins in 4+ nextjs/agents files.

---

### M8 — Scheduled World Chain Readiness fails when live env unset

**Severity:** Medium (CI hygiene)  
**Status:** Open  
**New observation**

Cron workflow (`worldchain-sepolia-readiness.yaml` schedule) runs `--live --require-live-targets`. Scheduled runs fail with “live RPC/Ponder/app probe skipped because … unset” (run `27534122192`). Push/PR offline path **passes**.

**Impact:** Weekly readiness cron is red without indicating a product regression — noise vs signal.

**Fix:** Skip live step on schedule unless secrets/vars configured, or split scheduled vs push workflows.

---

## 3. Low

### L1 — Dead `RaterRegistry` follow-counter storage (carry-over)

`followingCount` / `followerCount` private mappings never read/written; still in storage layout JSON.

### L2 — Interface drift

- `IRoundRewardDistributor` omits `claimReward` and `confiscateBannedReward`
- `RaterRegistry` does not declare `implements IRaterRegistryStatus`
- `IFeedbackRegistry` is view-only subset

### L3 — Inert placeholders

`eligibilityDataHash()` always zero; `RatingLib.RatingConfig` unread fields.

### L4 — `RaterRegistryConfidentialityAbi.ts` outside `--abis-only` loop

Hand-maintained; aligned today; future drift risk.

### L5 — E2e raw round state literals

Tests use `state === 1/3` instead of `ROUND_STATE` constants.

---

## 4. Fixed since June 15 audit

| Item | Fix |
| --- | --- |
| Ponder mock missing `CONFIDENTIALITY_FLAG_PRIVATE_FOREVER` | **Fixed** in `7a200a39` — mock at `content-registry-handlers.test.ts:97` |
| Unit Tests `typescript` job | **Green** @ `f4d886aa` (Ponder 303 pass) |
| Stale ABIs vs Solidity | **Still in sync** (19/19) |
| `deploymentComplete` on 4801 | **Still `"true"`** |

---

## 5. Remediation priority

| Priority | Item | Effort |
| --- | --- | --- |
| 1 | H1 — Reduce `LaunchDistributionPool` below 24,576 bytes | Medium |
| 2 | H2 — `tryContractRead` in voteability resolver + test | Small |
| 3 | M1/M2 — Align gated x402 rules; share validation module | Medium |
| 4 | M5 — Update readiness selector to `0x80fb3870` | Trivial |
| 5 | M6 — Fix ABI gate env (`yarn install` or drop prettier dep) | Small |
| 6 | M8 — Fix scheduled readiness workflow expectations | Small |
| 7 | M3 — Document / guard full-stack engine migration | Docs |

---

## 6. Notes

- **Working tree:** Uncommitted edits to `QuestionRewardPoolEscrowBundleActionsLib.sol` and `QuestionRewardPoolEscrowBundleRecoveryLib.sol` at audit time — not evaluated in this pass; may affect contract size when committed.
- **Other CI failures @ HEAD:** E2E and Certora failed on recent runs (not deep-dived in this audit). Lint run showed orphan-process termination warnings; root cause not confirmed.
- **June 15 doc** remains valid background for remediation history; this document supersedes its open-item status where noted above.
