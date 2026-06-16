# RateLoop Repo Audit — Bugs & Inconsistencies (18 June 2026)

Multi-agent read-only audit of the RateLoop monorepo at HEAD `9c65d42a` (`Point services at Worldchain canary deployment`), following the [17 June audit](repo-audit-2026-06-17.md) remediation batch (`c8674922`..`78a111c0`) and subsequent foundry/canary work (`40cea868`, `4a533b81`, `9c65d42a`).

Four agents audited disjoint subsystems in parallel (Solidity, Next.js/API, keeper/Ponder, cross-package consistency). Load-bearing findings were re-verified against source (grep, contract-size check, Ponder tests).

Scope: **bugs, inconsistencies, and drift** — not style, gas, or UX polish.

**No application code was changed for this audit** (documentation only).

---

## TL;DR

The **June 17 remediation batch closed the dominant E2E lifecycle blocker** (file-mode correlation artifact enrichment), Ponder reveal-failed timing drift (24× grace), handoff prepare/sweep gaps, and most Next.js env/cron inconsistencies. Contract sizes pass EIP-170 locally; World Chain mainnet canary artifacts (`480.json`) are now in-repo.

**New dominant risks** are operational and cross-layer:

1. **Correlation artifacts** can still be built from stale Ponder vote data (defer-one-tick only) or published as **partial epochs** when `sawNextEpoch` is true.
2. **Public docs** say gated context can use `imageUrls` and/or `detailsUrl`; parsers **require** `detailsUrl` for gated visibility.
3. **Signing-intent prepare** repeats the empty-transaction-plan bug class that handoff prepare already fixed.
4. **Solidity carry-overs**: public-rating oracle not pinned on apply (M10), consumer-view revert liveness (M9), partial engine rotation footguns (M15).

No new High-severity fund-loss Solidity paths were found. Contracts are not on production mainnet yet.

---

## Method

| Agent | Scope | Headline |
| --- | --- | --- |
| 1 | Solidity (`packages/foundry`) | June oracle/governance fixes landed; rotation/liveness footguns remain |
| 2 | Next.js / API | June handoff fixes landed; signing-intent prepare gap; partial E2E-flag drift |
| 3 | Keeper + Ponder | June correlation/reveal fixes landed; freshness + partial-epoch risks remain |
| 4 | Cross-package | 480 canary artifacts committed; env naming + docs/parser drift |

Prior audit: [`repo-audit-2026-06-17.md`](repo-audit-2026-06-17.md).

---

## Verification snapshot (HEAD `9c65d42a`)

| Check | Result |
| --- | --- |
| `packages/foundry/scripts/check-contract-sizes.sh` | **Pass** — all contracts ≤ 24,576 B; `LaunchDistributionPool` 24,538 B |
| `packages/ponder` `yarn test` | **310 pass, 1 skip** (local) |
| `deployedContracts.ts` chains | `480`, `4801`, `31337` |
| Foundry deployments committed | `480.json` (mainnet-canary), `4801.json` (Sepolia); `31337.json` local/gitignored |
| File-mode correlation enrichment | `restoreConfiguredCorrelationSnapshotArtifactFromCanonicalJson` after verify |
| Ponder reveal-failed grace | `revealGracePeriod * REVEAL_FAILED_GRACE_MULTIPLIER` in keeper + content routes |
| Handoff sweep cron | `vercel.json` → `/api/agent-callbacks/sweep` hourly |

---

## 1. High

### H1 — Correlation build can still use stale Ponder vote data

**Severity:** High (wrong roots / rejections); Medium if Ponder is fast  
**Status:** Open (H3 mitigated, not closed)  
**New since 17 June audit (residual)**

After settle/reveal, the keeper defers artifact build for **one tick** when `roundsSettled > 0 || votesRevealed > 0` (`packages/keeper/src/index.ts`). There is no guard on Ponder block height, revealed vote count, or rating-review freshness. On the next tick (~30s default), the keeper can build `weightRoot` from votes Ponder has not indexed yet.

**Locations:** `packages/keeper/src/index.ts` (~202–213); `correlation-artifact-builder.ts` (`fetchRoundVotes`); `correlation-snapshots.ts` (`deferPonderArtifactBuild`).

**Fix:** Gate builds on an explicit freshness signal (e.g. Ponder revealed count / last indexed block ≥ settlement block). Keep deferring across ticks until fresh.

---

### H2 — Partial correlation epochs can publish wrong cluster roots

**Severity:** High at scale  
**Status:** Open (L5 partially addressed)  
**Carry-over**

When the candidate window shows a **next** epoch (`sawNextEpoch`) but the current epoch has more rounds than `maxRoundsPerTick`, the builder **slices** to the limit and publishes a partial cluster root. On-chain `proposeCorrelationEpoch` expects the full epoch set.

Contrast: when no next epoch is visible, the builder correctly returns `[]` (skip). The partial path logs a warning and publishes anyway:

```579:588:packages/keeper/src/correlation-artifact-builder.ts
    logger.warn(
      "Processing partial automatic correlation epoch at maxRoundsPerTick",
      ...
    );
    return epochCandidates.slice(0, maxRoundsPerTick);
```

**Fix:** Never publish partial epochs — skip the entire epoch (same as the `!sawNextEpoch` branch), or paginate builds across ticks until complete. Add a test for the `sawNextEpoch=true` partial path.

---

### H3 — Public docs contradict gated-context parser rules

**Severity:** High for agent operators (integration failures, not fund loss)  
**Status:** Open  
**New**

`skill.md` and `how-it-works.md` say gated context can use hosted `imageUrls` **and/or** `detailsUrl`. The shared parser (`packages/agents/src/x402QuestionPayload.ts`) **requires** `detailsUrl` when `visibility === "gated"` and rejects external `contextUrl`/`videoUrl`.

**Impact:** Agents following docs alone may build gated asks with only `imageUrls`; server, MCP, and local-ask reject them.

**Fix:** Align docs with parser (require `detailsUrl` for gated), or relax parser if product intent is image-only gated context.

---

## 2. Medium

### M1 — Ponder-scoped keeper discovery liveness

**Severity:** High at scale (>500 active items); Medium with defaults  
**Status:** Open (carry-over)

Non-reconciliation ticks use Ponder `/keeper/work` candidates capped at **500**, ordered `asc(contentId), asc(roundId)`. Content outside that set waits until chain reconciliation (default **120 ticks × 30s ≈ 60 min**).

**Locations:** `packages/keeper/src/keeper.ts` (`discoverKeeperWorkCandidates`, `fetchKeeperWorkFromPonder`); `packages/ponder/src/api/routes/keeper-routes.ts`.

**Fix:** Merge bounded chain scan each tick, prioritize by urgency, or document `KEEPER_WORK_DISCOVERY_*` liveness bounds.

---

### M2 — `hasHumanVerifiedCommit` boolean ≠ on-chain HRC commit quorum

**Severity:** Medium  
**Status:** Open  
**New**

Ponder sets `hasHumanVerifiedCommit` true on **any** HRC commit (sticky OR). On-chain reveal-failed requires `roundHumanVerifiedCommitCount >= minVoters`. Keeper correctly gates via `isDormancyBlocked` (on-chain read); Ponder `/keeper/work` can surface `reveal_failed` candidates early.

**Locations:** `packages/ponder/src/RoundVotingEngine.ts` (~321–324, ~779–781); `keeper-routes.ts` (~80–84).

**Fix:** Index `humanVerifiedCommitCount` from commits; use `count >= greatest(minVoters, 3)` in SQL.

---

### M3 — Rating correlation votes lack identity-ban filtering

**Severity:** Medium  
**Status:** Open  
**New**

`/correlation/round-votes` and `/correlation/bundle-round-votes` filter bans via `loadActiveCorrelationIdentityBanState(now)`. `/correlation/rating-round-votes` returns all revealed votes with `excludedVotes: []` and no `now` param.

**Locations:** `packages/ponder/src/api/routes/correlation-routes.ts` (~940–1012); keeper `correlation-artifact-builder.ts` (rating vote fetch).

**Fix:** Apply the same ban loader + optional `now` param to rating-round-votes; pass `ponderNowSeconds` from keeper.

---

### M4 — Signing-intent prepare allows empty transaction plans

**Severity:** Medium  
**Status:** Open  
**New (M7 analog)**

Handoff prepare now fails when `transactionPlan.calls` is empty (`prepare/route.ts`). Signing-intent prepare (`lib/agent/signingIntents.ts` ~321–348) unconditionally sets `status: "prepared"` after MCP returns, with no `calls` check.

**Fix:** Mirror handoff logic: require non-empty `transactionPlan.calls` before `prepared`.

---

### M5 — Public rating apply uses live oracle, not pinned snapshot oracle

**Severity:** Medium (governance/liveness)  
**Status:** Open (carry-over M10)

`ContentRegistryRatingSnapshotLib.applyRatingPayoutSnapshot` reads `protocolConfig.clusterPayoutOracle()` at apply time. Pending settlements pin `votingEngine` only, not oracle. Contrast: `LaunchDistributionPool` pins oracle per pending credit; `QuestionRewardPoolEscrow` snapshotted per pool.

**Locations:** `ContentRegistryRatingSnapshotLib.sol` (~96–123); `ProtocolConfig.sol` (`setClusterPayoutOracle`).

**Fix:** Pin oracle in pending rating state; add governed repoint/rescue mirroring launch pool / QRPE patterns.

---

### M6 — Finalized snapshot slot stuck when consumer view reverts (post-veto)

**Severity:** Medium (governance/liveness)  
**Status:** Open (carry-over M9)

`ClusterPayoutOracle._rejectFinalizedRoundPayoutSnapshot`: post-veto, catch on `isRoundPayoutSnapshotConsumed` sets `consumed=true`. Reproposal with broken consumer and `!consumedKnown` hits `SnapshotExists` → slot frozen.

**Fix:** Post-veto: treat `!consumedKnown` as unknown-not-consumed for rejection; governance escape hatch; document arbiter 7-day SLA.

---

### M7 — Partial engine rotation footguns

**Severity:** Medium (governance/ops)  
**Status:** Open (carry-over M15)

Only `ContentRegistry` + `FrontendRegistry` expose `setVotingEngine`. `FeedbackRegistry`, `QuestionRewardPoolEscrow`, `FeedbackBonusEscrow` pin engine at init. `FrontendRegistry.setVotingEngine` clears fee creditor until re-bound.

**Fix:** Full replacement-stack runbook; governed `setVotingEngine` on escrows; or hard-disable rotation without redeploy.

---

### M8 — `setClusterPayoutOracle` does not validate public-rating consumer

**Severity:** Medium (governance fat-finger)  
**Status:** Open  
**New**

`ProtocolConfig._validateClusterPayoutOracle` checks launch-pool consumer when pool is set. No symmetric check that public-rating domain consumer == `ContentRegistry`.

**Fix:** Extend validation mirroring `LaunchDistributionPool._validateClusterPayoutOracle`.

---

### M9 — Ponder API wall clock vs keeper chain time (residual)

**Severity:** Medium  
**Status:** Open (M11 partially fixed)

Correlation ban checks align when keeper passes `ponderNowSeconds`. Bounty windows, vote cooldowns, discovery “settling soon”, and reward-pool summaries still default to `Date.now()` in several Ponder routes (`shared.ts`, `discovery-routes.ts`, `data-routes.ts`, `content-routes.ts`).

**Fix:** Optional `now` query param; default to latest indexed block timestamp where feasible.

---

### M10 — Historical cleanup discovery only on chain-reconciliation ticks

**Severity:** Medium  
**Status:** Open  
**New**

`discoverCleanupCandidate` runs only when `discovery.source === "chain"`. Ponder ticks rely on capped `/keeper/work` cleanup hints.

**Fix:** Run bounded cleanup discovery on Ponder ticks too, or widen chain scan.

---

### M11 — Mainnet 480: canary vs production readiness profile

**Severity:** Medium (ops)  
**Status:** Open (M13 evolved)

`deployments/480.json` has `deploymentProfile: "mainnet-canary"`. Default `yarn worldchain:check` expects `--production`; docs use `--canary`. No CI workflow runs mainnet readiness (Sepolia only).

**Fix:** Add offline CI job for `yarn worldchain:check --canary`; document production-profile promotion path.

---

### M12 — x402 validation parity gaps (submit-time economics)

**Severity:** Medium  
**Status:** Partial (M2/M3 improved)

Server + `localSigner` share `@rateloop/agents/x402-question-payload` with gated `detailsUrl` and attachment-origin checks. **Still divergent at submit time:** on-chain `minSubmissionUsdcPool`, coverage minimum vs `maxVoters`, image moderation status — enforced in `questionSubmission.ts` but not in `lintAgentAskRequest` or offline local-ask.

**Fix:** Extend lint with off-chain mirrors of submit checks, or document as submit-only gates.

---

### M13 — USDC / env naming fragmentation

**Severity:** Medium  
**Status:** Partial (M5 improved)

Three USDC env names across browser/server/agents. Next.js throws when **both** `NEXT_PUBLIC_USDC_ADDRESS` and `RATELOOP_X402_USDC_ADDRESS` are set and differ (lazy, not at startup). Contract addresses use 3–4 prefixes per package (keeper `VOTING_ENGINE_ADDRESS` vs Ponder `PONDER_ROUND_VOTING_ENGINE_ADDRESS`, etc.).

**Fix:** Document parity matrix; optional startup guards across packages.

---

## 3. Low

### L1 — E2E production flag not fully centralized

`questionDetails.ts` and `LocalTestWalletBridge.tsx` still read `NEXT_PUBLIC_RATELOOP_E2E_PRODUCTION_BUILD` directly instead of `isLocalE2EProductionBuildEnabled()`. Agents parser defaults also only check `NEXT_PUBLIC_*`.

### L2 — Mixed error envelopes on agent API surface

Handoff/signing-intent thrown errors use normalized envelopes via `handlePublicAgentRoute`. Policy routes and some inline validation still return `{ error: string }`.

### L3 — Agent read routes fail-open on rate-limit store outage

Several `app/api/agent/**` read routes use `allowOnStoreUnavailable: true` while handoffs, MCP, and confidentiality crons fail closed.

### L4 — Handoff idempotent prepare skips plan re-validation

Legacy rows with `status: "prepared"` and empty `transactionPlan.calls` return 200 on re-prepare without re-checking calls.

### L5 — `getEstimatedSettlementTime` uses 1× grace only

Discovery “settling soon” uses `revealGracePeriod` once; reveal-failed recovery uses 24× on-chain.

### L6 — E2E helper still uses raw round state literals

`e2e/helpers/keeper.ts` polls with `s === 1 || s === 3`; most specs already use `ROUND_STATE`.

### L7 — Ponder dormant pre-filter vs on-chain `markDormant`

Ponder SQL pre-filter is tighter than before (bundleId, open-round guards) but keeper still re-reads chain; benign extra attempts.

### L8 — Dead `RaterRegistry` follow counters / interface drift

`followingCount` / `followerCount` unused; partial interfaces vs implementations (carry-over L11).

### L9 — EIP-170 margin tight on several contracts

`LaunchDistributionPool` 24,538 B (38 B headroom); `RoundVotingEngine` 24,562 B (14 B); `RaterRegistry` 24,540 B (36 B).

### L10 — SDK / docs chain ID examples drift

SDK README examples use `4801`; SDK unit tests and MCP dry-run defaults often use `480`.

### L11 — Undocumented `RATELOOP_X402_QUESTION_SUBMITTER_ADDRESS` alias

Present in agents `.env.example` and `localSigner.ts`; missing from `agents/README.md`.

---

## 4. Fixed since 17 June audit

| ID (17 Jun) | Title | Fix evidence |
| --- | --- | --- |
| H1 | File-mode correlation artifact enrichment | `correlation-snapshots.ts` → `restoreConfiguredCorrelationSnapshotArtifactFromCanonicalJson` |
| H2 | Ponder 1× reveal-failed grace | `REVEAL_FAILED_GRACE_MULTIPLIER` in keeper + content routes |
| H3 | Same-tick stale Ponder votes | Defer-one-tick + main-loop lock (residual → **H1** above) |
| M4 | Handoff vs EIP-3009 docs | `skill.md` clarifies payment paths |
| M5 | USDC env divergence | `getX402UsdcAddressOverride` mismatch throw (partial → **M13**) |
| M6 | E2E flag split | `isLocalE2EProductionBuildEnabled()` in core server paths (partial → **L1**) |
| M7 | Handoff prepare empty plan | `prepare/route.ts` guards empty `calls` |
| M8 | No handoff sweep cron | `vercel.json` + `CRON_SECRET` on sweep route |
| M11 | Ban checks wall clock | Optional `?now=` on correlation vote routes; keeper passes chain time |
| M12 | Rating apply veto preflight | `applyFinalizedRatingSnapshotsFromArtifact` preflight |
| M13 | 480 without artifacts | `480.json` + `deployedContracts.ts` chain `480` |
| M14 | Sepolia readiness partial secrets | Workflow requires all three env vars |
| L1–L4, L6–L7, L9–L10, L12 | Various | Handoff errors, confidentiality fail-closed, newline, dormant filter, env docs, Timelock keys, ROUND_STATE in E2E |
| F-SOL (new) | Challenger censorship, advisory cooldown, veto on public rating, launch/QRPE oracle pinning | Commits `410687d0`, `87ff90c0`, `ec2082af`, `1aed8d4c` |

---

## 5. Test coverage gaps (signal real bugs)

| Gap | Risk |
| --- | --- |
| No test for partial epoch publish (`sawNextEpoch=true`) | **H2** |
| No test for multi-tick Ponder freshness after defer | **H1** |
| No test for rating-round-votes ban exclusion | **M3** |
| No test for public-rating apply after oracle rotation | **M5** |
| No test for reverting `isRoundPayoutSnapshotConsumed` post-veto | **M6** |
| No integration test for discovery cap / reconciliation | **M1** |
| Signing-intent empty-plan regression test missing | **M4** |

---

## 6. Remediation priority

| Priority | Item | Effort |
| --- | --- | --- |
| 1 | **H2** — Never publish partial correlation epochs | Small |
| 2 | **H1** — Ponder freshness gate for correlation builds | Medium |
| 3 | **H3** — Align gated-context docs with parser | Small |
| 4 | **M4** — Signing-intent empty-plan guard | Small |
| 5 | **M3** — Rating vote ban filtering | Small |
| 6 | **M2** — HRC commit count in Ponder index | Medium |
| 7 | **M1** — Keeper discovery liveness | Medium |
| 8 | **M5/M6/M7** — Solidity rotation/liveness (pre-mainnet) | Medium–large |
| 9 | **M12/M13** — Lint/submit parity + env docs | Small–medium |
| 10 | **L1–L6** — Hygiene | Small |

---

## 7. Notes

- **Working tree:** Clean at audit time except this document.
- **Trust model:** Optimistic oracle model per `AGENTS.md` (challenge bonds anti-spam, 60-minute reveal grace, 7-day arbiter veto).
- **Canary vs production:** `480.json` is mainnet-canary; operators must not treat it as production-profile until promoted.
- **June 17 doc** remains valid background; this document supersedes open-item status where noted above.
