# RateLoop Repo Audit — Bugs & Inconsistencies (17 June 2026)

Multi-agent read-only audit of the RateLoop monorepo at HEAD `f9949dc5` (`Update World Chain Sepolia deployment artifacts`), following [`repo-audit-2026-06-16.md`](repo-audit-2026-06-16.md) and CI fixes landed on 15 June (`2e4c0a15`..`fefab6d8`).

Four agents audited disjoint subsystems in parallel (Solidity, Next.js/API, keeper/Ponder, cross-package consistency). Load-bearing findings were re-verified against source (grep, local contract-size check, Ponder tests, CI log review).

Scope: **bugs, inconsistencies, and drift** — not style, gas, or UX polish.

**No application code was changed for this audit** (documentation only).

---

## TL;DR

Since the 16 June audit, **three prior blockers are resolved**: `LaunchDistributionPool` is back under EIP-170 (24,571 B), Ponder voteability reads use `tryContractRead`, and the Sepolia readiness selector is updated to `0x80fb3870`. Unit Tests and most E2E suites are green on recent pushes.

The **dominant open blocker** is **E2E lifecycle** (`correlation-bounty-payout.spec.ts`): the 15 June canonical-JSON fix for file-mode correlation artifacts passes verification but **does not enrich epochs/snapshots with `artifactHash` / `artifactURI` before publish**, causing keeper proposal to throw `Cannot read properties of undefined (reading 'length')`.

**Cross-layer drift** remains in Ponder reveal-failed timing (1× vs on-chain 24× grace multiplier), x402 validation between server and local agents, and World Chain mainnet (480) wiring without shared deployment artifacts.

---

## Method

| Agent | Scope | Headline |
| --- | --- | --- |
| 1 | Solidity (`packages/foundry`) | Veto-window logic sound; operational liveness footguns on consumer/oracle rotation |
| 2 | Next.js / API | SEC remediations largely in place; E2E flag split, handoff prepare/sweep gaps |
| 3 | Keeper + Ponder | Reveal-failed grace mismatch; correlation publish races; file-mode artifact enrichment bug |
| 4 | Cross-package | Mainnet 480 gap; USDC env split; handoff vs EIP-3009 docs |

Prior audits: [`repo-audit-2026-06-15.md`](repo-audit-2026-06-15.md), [`repo-audit-2026-06-16.md`](repo-audit-2026-06-16.md).

---

## Verification snapshot (HEAD `f9949dc5`)

| Check | Result |
| --- | --- |
| `make check-contract-sizes DEPLOY_PROFILE=deploy` | **Pass** — `LaunchDistributionPool` 24,571 B (limit 24,576) |
| `packages/ponder` `yarn test` | **309 pass, 2 skip** (local) |
| Unit Tests @ `fefab6d8` / `8f569af9` | **success** |
| E2E @ `fefab6d8` / `8f569af9` | **failure** — lifecycle only; app/smoke/api/keeper/world-id **success** |
| E2E lifecycle error | `Correlation epoch snapshot proposal failed` → `Cannot read properties of undefined (reading 'length')` |
| `deployedContracts.ts` chains | `4801`, `31337` only (no `480`) |
| Sepolia readiness selector | `0x80fb3870` (`recordConfidentialityNexusForRegistry`) |
| `resolveRoundVoteabilityStateAtCommit` | Uses `tryContractRead` (no bare try/catch) |

---

## 1. High

### H1 — File-mode correlation artifacts omit `artifactHash` / `artifactURI` at publish time

**Severity:** High (CI + E2E lifecycle)  
**Status:** Open — regression from `fefab6d8`  
**New since 16 June audit**

Commit `fefab6d8` changed `build-correlation-artifact.ts` to write `built.canonicalJson` so file-mode verification passes. Canonical JSON stores epochs and round snapshots **without** per-entry `artifactHash` / `artifactURI` (those are injected in `buildSnapshotArtifactFromStoredPublicArtifact` for auto mode).

File-mode `loadConfiguredCorrelationSnapshotArtifact` returns the parsed canonical JSON directly and skips enrichment:

```295:305:packages/keeper/src/correlation-snapshots.ts
  const raw = await readFile(config.correlationSnapshots.artifactPath, "utf8");
  const verification = verifyCorrelationArtifact(JSON.parse(raw));
  // ...
  return JSON.parse(raw) as CorrelationSnapshotArtifactFile;
```

`publishCorrelationSnapshotArtifact` then calls `proposeCorrelationEpoch` with `epoch.artifactHash` and `epoch.artifactURI` undefined → viem/encoding throws `Cannot read properties of undefined (reading 'length')`.

**Evidence:** CI E2E lifecycle @ `8f569af9` (run `27570175775`); keeper logs repeat the TypeError during epoch proposal.

**Impact:** E2E lifecycle red; any production file-mode correlation publish path fails the same way.

**Fix:** After verification in file mode, run `buildSnapshotArtifactFromStoredPublicArtifact` (or equivalent) using the stored hash/URI from the canonical payload / data-uri materialization — same as auto mode.

---

### H2 — Ponder reveal-failed deadline uses 1× grace, on-chain uses 24×

**Severity:** High (indexer/API vs chain); Medium for keeper (keeper re-checks on-chain)  
**Status:** Open (carry-over, re-verified)

**Location:** `packages/ponder/src/api/routes/keeper-routes.ts` (lines 63–71); same pattern in `content-routes.ts`.

Ponder SQL: `now >= … + revealGracePeriod`. On-chain and keeper: `revealGracePeriod * REVEAL_FAILED_GRACE_MULTIPLIER` where multiplier is **24** (`RoundCleanupLib.sol` line 46).

**Impact:** Ponder `/keeper/work` can mark rounds `reveal_failed`-eligible ~23 grace periods early. Keeper may ignore (on-chain gate) or act on stale Ponder hints depending on code path.

**Fix:** Multiply `revealGracePeriod` by 24 in Ponder SQL; add tests mirroring keeper/Solidity.

---

### H3 — Same-tick correlation artifacts can use stale Ponder vote data

**Severity:** High (wrong roots / rejections); Medium if Ponder is fast  
**Status:** Open

**Location:** `packages/keeper/src/index.ts` (settle/reveal then correlation publish in one tick); `correlation-artifact-builder.ts` (`fetchRoundVotes`).

After on-chain settlement/reveal, the keeper immediately builds correlation artifacts from Ponder vote endpoints with no “indexed through block N” guard.

**Impact:** Transient wrong `weightRoot` / artifact hash; epoch proposals rejected or challenged.

**Fix:** Defer correlation publish until Ponder reflects settlement block, or gate on vote-count / `RatingReviewPending` freshness.

---

## 2. Medium

### M1 — Ponder-scoped keeper discovery can skip content between reconciliations

**Severity:** High at scale (>500 active items); Medium with defaults  
**Status:** Open

Non-reconciliation ticks use Ponder candidate `contentIds` (capped at 500). Content outside that set waits until hourly chain reconciliation (~60 min at default 30s interval).

**Fix:** Merge Ponder candidates with bounded chain scan each tick, or reconcile more often. Document `KEEPER_WORK_DISCOVERY_MAX_CANDIDATES` liveness bounds.

---

### M2 — x402 gated-context rules: server stricter than local signer (carry-over)

**Severity:** Medium  
**Status:** Open

| Rule | Server | Local (`localSigner.ts`) |
| --- | --- | --- |
| Gated requires `detailsUrl` | Yes | No — `imageUrls` alone suffices |
| Moderation / tier / on-chain minimums | Yes | Partially missing |

**Impact:** `local-ask` can accept payloads MCP/server reject; hash / `operationKey` divergence risk.

---

### M3 — Agents local lint weaker than server attachment-origin validation

**Severity:** Medium  
**Status:** Open

`lintAgentAskRequest` checks URL shape only; server `parseX402QuestionRequest` requires RateLoop attachment **origin** allowlisting.

**Fix:** Share origin validation from `@rateloop/node-utils` or call server parser options in lint.

---

### M4 — Browser handoff rejects EIP-3009; agent docs prefer it

**Severity:** Medium (docs/operator confusion)  
**Status:** Open

Handoffs hard-require `paymentMode=wallet_calls` (`handoffs.ts`). Docs/skill.md steer agents toward `eip3009_usdc_authorization`.

**Fix:** Clarify docs: handoff = human wallet calls; EIP-3009 = MCP / local-ask only — or extend handoff prepare.

---

### M5 — Dual USDC override env vars can diverge

**Severity:** Medium  
**Status:** Open

Browser: `NEXT_PUBLIC_USDC_ADDRESS`. Server x402: `RATELOOP_X402_USDC_ADDRESS`. Agents: `RATELOOP_LOCAL_SIGNER_USDC_ADDRESS` + x402 alias.

**Fix:** Document required parity; optionally fail startup on mismatch.

---

### M6 — E2E production flag checked inconsistently

**Severity:** Medium  
**Status:** Open

`lib/env/server.ts` and `questionDetails.ts` honor both `RATELOOP_E2E_PRODUCTION_BUILD` and `NEXT_PUBLIC_RATELOOP_E2E_PRODUCTION_BUILD`. `questionPayload.ts`, `services/ponder/client.ts`, and `imageAttachmentUrls.ts` only check `NEXT_PUBLIC_*`.

**Fix:** Centralize on `isLocalE2EProductionBuildEnabled()`.

---

### M7 — Handoff prepare marks `prepared` without validating transaction plan

**Severity:** Medium  
**Status:** Open

`prepare/route.ts` sets `status: "prepared"` even when `transactionPlan.calls` is empty. UI blocks execution; API state is misleading for pollers.

**Fix:** Require non-empty `calls` before `prepared`, else `failed`.

---

### M8 — Expired handoff cleanup has no Vercel cron

**Severity:** Medium  
**Status:** Open

`sweepExpiredHandoffIntents` runs via `/api/agent-callbacks/sweep` with secret. `vercel.json` only schedules confidentiality crons — no handoff sweep.

**Fix:** Add cron or document required external scheduler.

---

### M9 — Finalized snapshot slot can stick if consumer view reverts after veto window

**Severity:** Medium (governance/liveness)  
**Status:** Open

`ClusterPayoutOracle._rejectFinalizedRoundPayoutSnapshot`: post-veto, catch on `isRoundPayoutSnapshotConsumed` treats failure as `consumed = true`, blocking rejection and reproposal.

**Fix:** Governance escape hatch or softer catch when `consumedKnown == false`; document arbiter veto-window SLA.

---

### M10 — Oracle rotation orphans in-flight public rating settlements

**Severity:** Medium (operations)  
**Status:** Open

`applyRatingPayoutSnapshot` reads **current** `protocolConfig.clusterPayoutOracle()`. Pending settlements on `ContentRegistry` reference snapshots on the old oracle.

**Fix:** Drain pending ratings before rotation; or pin oracle address in pending state.

---

### M11 — Identity-ban checks use wall clock in Ponder, chain time in keeper

**Severity:** Medium  
**Status:** Open

`/correlation/*-votes` uses `Date.now()` for ban expiry; keeper uses block timestamp.

**Fix:** Optional `now` query param from latest indexed block; keeper passes `runContext.blockTimestamp`.

---

### M12 — Rating snapshot apply lacks veto-window / cleanup preflight

**Severity:** Medium (operational noise)  
**Status:** Open

Keeper calls `applyRatingPayoutSnapshot` as soon as oracle status is `Finalized`. On-chain requires `block.timestamp > finalizedAt + FINALIZATION_VETO_WINDOW` (7 days) and `cleanupRemaining == 0`.

**Fix:** Preflight both gates before submit (gas estimation already prevents spend, but logs noise remains).

---

### M13 — World Chain mainnet (480) wired without shared deployment artifacts

**Severity:** Medium  
**Status:** Open

Ponder and Next.js support chain `480`; `deployedContracts.ts` and `deployments/` have `4801` and `31337` only. `scripts/check-worldchain-mainnet-readiness.mjs` expects `480.json`.

**Fix:** Deploy and commit artifacts, or hard-disable `480` until ready.

---

### M14 — Scheduled Sepolia live readiness fails on partial secrets (carry-over)

**Severity:** Medium (CI hygiene)  
**Status:** Open

Cron runs live probes when `WORLDCHAIN_SEPOLIA_RPC_URL` alone is set, even if Ponder/app URLs missing → failing cron without product regression.

**Fix:** Require all three env vars for scheduled live probes.

---

### M15 — Partial engine rotation footguns (carry-over)

**Severity:** Medium (governance)  
**Status:** Open

Escrows pin engine at init; `FeedbackRegistry` has no governed `setVotingEngine`; `FrontendRegistry.setVotingEngine` clears fee creditor until re-bound.

---

## 3. Low

### L1 — Mixed error envelopes on public handoff routes

Some paths return `{ error: string }`; others use normalized `{ code, message, recoverWith, retryable, status }`.

### L2 — Chain misconfiguration: handoff wraps config errors as 400 vs MCP 503

`assertHandoffChainSubmitReady` wraps `X402QuestionConfigError` (503) into default 400 `AgentAskHandoffError`.

### L3 — Confidentiality cron routes fail-open when rate-limit store is down

`allowOnStoreUnavailable: true` on reconcile/publish routes — diverges from handoff/MCP fail-closed posture.

### L4 — Correlation publish outside main-loop advisory lock

Multi-keeper: instance A settles while B publishes from pre-settlement Ponder data.

### L5 — Large correlation epochs skipped entirely at `maxRoundsPerTick`

`selectCompleteEpochCandidates` returns `[]` when epoch round count > limit (default 20).

### L6 — Canonical artifact files include trailing newline

Hash is over canonical bytes without newline; external verifiers hashing raw HTTP body will mismatch.

### L7 — Ponder dormant candidates over-inclusive vs on-chain dormancy guards

### L8 — Fragmented contract/RPC env naming across packages

### L9 — Undocumented `RATELOOP_X402_QUESTION_SUBMITTER_ADDRESS` alias in agents local signer

### L10 — `PONDER_TIMELOCK_*` env keys generated but Ponder never indexes Timelock

### L11 — Interface / storage drift (carry-over)

Dead `RaterRegistry` follow counters; partial interfaces (`IRoundRewardDistributor`, `IFeedbackRegistry`).

### L12 — E2E tests use raw round state literals (`state === 1/3`) instead of shared constants

---

## 4. Fixed since 16 June audit

| Item | Fix |
| --- | --- |
| `LaunchDistributionPool` EIP-170 oversize (24,622 B) | **Fixed** — now 24,571 B @ HEAD |
| Ponder voteability silent RPC swallow | **Fixed** — `tryContractRead` in `resolveRoundVoteabilityStateAtCommit` |
| Stale ConfidentialityEscrow selector `0x517fbf76` | **Fixed** — `0x80fb3870` in readiness script + tests |
| CI ABI parity gate missing `yarn install` | **Fixed** — `unit-tests.yaml` contract-size job installs deps |
| `FINALIZATION_VETO_WINDOW` ABI inheritedFunctions drift | **Fixed** — `2e4c0a15` |
| x402 handoffs on Anvil 31337 | **Fixed** — MockERC20 fallback in `resolveX402QuestionConfig` (`21e9de7b`) |
| E2E handoff / app suite | **Green** @ `fefab6d8`+ |
| Ponder mock `CONFIDENTIALITY_FLAG_PRIVATE_FOREVER` | **Fixed** (`7a200a39`, prior audit) |

---

## 5. Partial fix — correlation file mode (needs follow-up)

| Step | Commit | Status |
| --- | --- | --- |
| Write canonical JSON (passes verifier) | `fefab6d8` | Done |
| Enrich with `artifactHash` / `artifactURI` before publish | — | **Missing** → H1 |

---

## 6. Remediation priority

| Priority | Item | Effort |
| --- | --- | --- |
| 1 | **H1** — Enrich file-mode artifacts before publish | Small |
| 2 | **H2** — Ponder 24× reveal-failed grace | Small |
| 3 | **H3** — Correlation publish / Ponder freshness gate | Medium |
| 4 | M1 — Keeper discovery liveness at scale | Medium |
| 5 | M2/M3 — Unify x402 validation (server + local + lint) | Medium |
| 6 | M4/M5 — Docs + USDC env parity | Small |
| 7 | M6 — E2E flag centralization | Small |
| 8 | M7/M8 — Handoff prepare validation + sweep cron | Small |
| 9 | M13 — Mainnet 480 deployment or hard-disable | Ops |
| 10 | M9/M10 — Oracle/consumer rotation runbooks | Docs + optional guards |

---

## 7. Notes

- **Working tree:** Clean at audit time except this document.
- **CI @ `f9949dc5`:** Unit Tests / Lint / Static Analysis / Sepolia Readiness queued or in progress at audit time; lifecycle failure pattern confirmed on prior green Unit Test commits.
- **Trust model:** Findings assume the documented optimistic-oracle model (challenge bonds as anti-spam, 60-minute reveal grace as accepted parameter) per `AGENTS.md`.
- **June 16 doc** remains valid background; this document supersedes open-item status where noted above.
