# One-Hour Payout Finality Plan

Scope: replace the current 7-day finalization veto launch posture with a max 1-hour happy-path wait from source-ready/public-verdict close to usable payout/finality across RBTS settlement, public rating, USDC bounty claims, bundle claims, launch credits, Feedback Bonus award windows, and frontend-operator fee withdrawals.

The target is not to remove the safety model. It is to launch with short challenge/veto timing, make every delay visible and monitored, and require evidence before governance later increases user wait time.

Implementation status, 2026-07-02: the fresh-deployment path now uses 15-minute oracle challenge windows, a 15-minute finalization veto window, readiness/keeper budget checks for the 1-hour healthy path, a Ponder `/correlation/finality-sla` endpoint, 1-hour Feedback Bonus award-decision timing, and 1-hour frontend fee withdrawals while preserving the 14-day frontend stake unbonding period. Remaining follow-up work should keep challenged, rejected, missing-proposer, and recovery cases visible as exceptional states rather than normal payout wait.

## Product Target

- Healthy, unchallenged path: every payout-root-backed consumer should be usable within 60 minutes of its source becoming ready.
- Included in the 60 minutes: correlation artifact build, correlation epoch and round payout proposal, challenge window, finalization, finalization veto window, keeper application/qualification/claim-readiness transaction, and normal indexing lag.
- Excluded from the 60-minute promise: roots that are actually challenged, rejected, missing because no proposer is authorized, blocked by source-data/indexer failure, or explicitly under a governance recovery runbook. These must appear as disputed or operator-action states, not as ordinary payout wait.
- Launch timing budget should be sequential-safe unless monitoring proves overlap: 15 minutes correlation-epoch challenge, 15 minutes round-payout challenge, 15 minutes finalization veto, and 15 minutes keeper/Ponder/indexing/application budget.
- If the keeper and readiness checks prove same-tick epoch and round-payout proposals, governance may use an overlap-optimized launch budget such as 30 minutes challenge, 20 minutes veto, and 10 minutes operations. Without that proof, readiness must use the conservative sequential formula.
- Governance can increase challenge or veto windows later, but the governance UI and runbook must require current monitoring evidence and show the UX impact before proposing longer timing.
- Non-payout-root payment waits should also launch at no more than 1 hour unless they are explicitly outside payment finality. That includes Feedback Bonus award decision time and frontend fee withdrawals; it does not include the 24-hour per-content vote cooldown, EIP-3009 authorization TTLs, private-session expiries, governance voting/timelock periods, or frontend stake unbonding.

## Contract Plan

1. Make the veto window configurable and proposal-scoped.
   - In `packages/foundry/contracts/ClusterPayoutOracle.sol`, replace the hard-coded `FINALIZATION_VETO_WINDOW = 7 days` launch behavior with:
     - `DEFAULT_CHALLENGE_WINDOW = 15 minutes`.
     - `DEFAULT_FINALIZATION_VETO_WINDOW = 15 minutes`.
     - `LAUNCH_PAYOUT_FINALITY_BUDGET = 1 hour`.
     - `MAX_FINALIZATION_VETO_WINDOW = 7 days`.
     - `uint64 public finalizationVetoWindow`.
   - Keep a compatibility getter named `FINALIZATION_VETO_WINDOW()` returning the current configured veto window while new code uses explicit deadline helpers.
   - Keep the existing `setOracleConfig(uint64,uint256,address)` for ABI and deployment-script compatibility. Add `setOracleTimingConfig(uint64 newChallengeWindow, uint64 newFinalizationVetoWindow)` or `setFinalizationVetoWindow(uint64)` for veto timing, and emit a new timing event.
   - Snapshot `finalizationVetoWindowAtProposal` on both `CorrelationEpochSnapshot` and `RoundPayoutProposal`, the same way `challengeWindowAtProposal` already works. Governance timing changes should affect future proposals only, not already proposed or finalized roots.
   - Define exact deadline semantics: a root is blocked before `finalizedAt + finalizationVetoWindowAtProposal` and usable at that timestamp. Avoid the current `<=` pattern that turns a configured 1-hour budget into "1 hour plus one second".
   - Add a deploy/readiness assertion that `2 * challengeWindow + finalizationVetoWindow + opsLagBudget <= LAUNCH_PAYOUT_FINALITY_BUDGET`, unless the deployment explicitly enables and proves overlapping epoch/round proposal timing.

2. Add oracle deadline helpers and route consumers through them.
   - Add `correlationEpochVetoDeadline(epochId)`, `roundPayoutSnapshotVetoDeadline(domain, rewardPoolId, contentId, roundId)`, and `isRoundPayoutSnapshotOutsideVetoWindow(...)`.
   - Update finalized-root rejection paths to use the proposal-scoped veto window:
     - `rejectFinalizedCorrelationEpoch`
     - `rejectFinalizedCorrelationEpochRoot`
     - `rejectFinalizedRoundPayoutSnapshot`
     - `rejectFinalizedRoundPayoutSnapshotRoot`
   - Update all consumers that currently compute `finalizedAt + oracle.FINALIZATION_VETO_WINDOW()`:
     - `packages/foundry/contracts/libraries/RoundRbtsSettlementSnapshotLib.sol`
     - `packages/foundry/contracts/libraries/ContentRegistryRatingSnapshotLib.sol`
     - `packages/foundry/contracts/libraries/QuestionRewardPoolEscrowQualificationLib.sol`
     - `packages/foundry/contracts/libraries/QuestionRewardPoolEscrowRecoveryLib.sol`
     - `packages/foundry/contracts/libraries/QuestionRewardPoolEscrowBundleActionsLib.sol`
     - `packages/foundry/contracts/libraries/QuestionRewardPoolEscrowBundleRecoveryLib.sol`
     - `packages/foundry/contracts/libraries/LaunchRaterRewardLib.sol`

3. Preserve concurrent challenge-window behavior.
   - The keeper should continue proposing round payout snapshots while the parent correlation epoch is `Proposed`, so the epoch and round challenge windows overlap.
   - Add a contract or keeper regression test proving the overlap when using an overlap-optimized timing budget. If this test fails or the keeper is configured to propose round snapshots only after epoch finalization, the readiness gate must use the sequential formula.

4. Shorten and harden the missing-snapshot RBTS fallback.
   - `packages/foundry/contracts/RoundVotingEngineRbtsSettlementModule.sol` currently has `RBTS_SETTLEMENT_SNAPSHOT_TIMEOUT = 14 days`.
   - Replace it with a 1-hour launch timeout or a governed module constant that matches the one-hour launch SLO.
   - Before returning stakes through the timeout branch, check that no live `Proposed`, `Challenged`, or finalized-but-not-yet-usable RBTS settlement snapshot exists for the round. The timeout must not create a gas race against a real snapshot that is about to become usable.
   - If a snapshot is challenged, keep the round in a disputed/operator-action state rather than silently timing out as ordinary UX.

5. Bring non-oracle payout waits into the same launch posture.
   - `packages/foundry/contracts/FeedbackBonusEscrow.sol` currently requires at least `MIN_FEEDBACK_AWARD_DECISION_SECONDS = 1 days` after settlement. Replace with a governed or redeploy-time launch default of 1 hour, with docs making clear that the question duration is still the feedback collection window.
   - `packages/foundry/contracts/FrontendRegistry.sol` currently uses `FEE_WITHDRAWAL_DELAY = 21 days`. Replace with a governed `feeWithdrawalDelay` or launch default of 1 hour for earned fee withdrawals while leaving the 14-day frontend stake unbonding period intact unless governance separately decides to change operator-exit security.
   - Keep 7-day bounty claim/refund grace periods out of this change unless they make an otherwise claimable payout wait; they are claimant-protection/refund windows rather than normal "wait to get paid" delays.

6. Update contract artifacts and governance surfaces.
   - Regenerate ABIs/types after changing `ClusterPayoutOracle`.
   - Update any deployment/readiness scripts that call `setOracleConfig`, configure Feedback Bonus timing, or configure frontend fee withdrawal timing.
   - If storage layout checks cover `ClusterPayoutOracle` in the future, add expected layout. Existing checked layouts for `RoundVotingEngine`, `QuestionRewardPoolEscrow`, and `ContentRegistry` should still be reviewed because consumer ABI/interface changes can affect generated artifacts.

7. Add production readiness gates.
   - Update `scripts/readiness-core.mjs` and the Base/Base Sepolia readiness wrappers to read `ClusterPayoutOracle.challengeWindow()`, `ClusterPayoutOracle.FINALIZATION_VETO_WINDOW()` or the new deadline helper, and the configured ops lag budget.
   - Fail production readiness when `2 * challengeWindow + finalizationVetoWindow + opsLagBudget > 3600` unless a separate overlap proof flag is present and tested, in which case fail when `challengeWindow + finalizationVetoWindow + opsLagBudget > 3600`.
   - Include the exact budget calculation in readiness output so governance and operators see which phase consumes the hour.

## Keeper, Ponder, And Monitoring Plan

1. Make the keeper deadline-aware.
   - In `packages/keeper/src/correlation-snapshots.ts`, replace direct reads of `FINALIZATION_VETO_WINDOW` with oracle deadline helpers.
   - Keep proposing correlation epochs and all covered round payout snapshots in the same tick where possible.
   - After finalization, immediately re-check whether the veto deadline has elapsed and apply/qualify/record in the same or next tick.
   - Treat `Proposed`, `Challenged`, finalized-inside-veto, finalized-past-veto, consumed, rejected, and missing snapshots as separate states in logs and metrics.
   - Add a startup policy check in `packages/keeper/src/index.ts`: when correlation snapshots are enabled on production-like networks, log the SLA budget and fail startup or mark health degraded if the configured oracle windows exceed the launch policy.

2. Add correlation-finality SLA metrics before launch.
   - Extend `packages/keeper/src/metrics.ts` and the keeper loop to expose:
     - oldest source-ready root without a proposal
     - oldest proposed correlation epoch
     - oldest proposed round payout snapshot
     - oldest finalized root still inside veto
     - oldest finalized root past veto but not consumed/applied
     - counts of proposed, finalized, applied, qualified, and launch-credit-finalized snapshots per tick
     - count and oldest age of Feedback Bonus pools past settlement but still awardable
     - count and oldest age of pending frontend fee withdrawals
   - Add warning/critical alert thresholds:
     - source-ready but unproposed for more than 10 minutes
     - proposed but unfinalized after challenge window plus 5 minutes
     - finalized but still unapplied 5 minutes after veto deadline
     - any healthy unchallenged source older than 60 minutes without consumer-ready state
   - Add a dashboard panel showing the 60-minute budget as phases: source-ready, proposed, finalized, veto elapsed, consumed/applied.
   - Use explicit metric names so alerting can be wired without interpreting logs:
     - `keeper_correlation_epoch_proposed_total`
     - `keeper_correlation_epoch_finalized_total`
     - `keeper_round_payout_snapshot_proposed_total`
     - `keeper_round_payout_snapshot_finalized_total`
     - `keeper_rating_snapshot_applied_total`
     - `keeper_rbts_settlement_snapshot_applied_total`
     - `keeper_correlation_source_ready_backlog_oldest_seconds`
     - `keeper_correlation_epoch_finalization_backlog_oldest_seconds`
     - `keeper_round_payout_finalization_backlog_oldest_seconds`
     - `keeper_round_payout_apply_backlog_oldest_seconds`
     - `keeper_payout_finality_sla_breaches_total`
     - `keeper_artifact_cache_or_fetch_failure_total`
   - Alert policy:
     - warn when oldest normal-path phase age exceeds 30 minutes
     - page when oldest normal-path phase age exceeds 45 minutes
     - critical when any healthy unchallenged item reaches 60 minutes
     - page immediately on challenged or rejected snapshots
     - page when finalized snapshot proof/artifact data is unavailable for more than 5 minutes

3. Add Ponder/API fields for user-facing countdowns.
   - Index or derive `challengeEndsAt`, `finalizedAt`, `vetoEndsAt`, `consumedAt`, and `disputed/rejected` status for round payout snapshots.
   - Expose these through the existing data routes used by vote cards, result packages, claim screens, and docs status components.
   - Keep actual challenge/rejection states distinct from normal waiting states.
   - Add a compact Ponder SLA endpoint such as `GET /correlation/finality-sla`, backed by `correlationEpochSnapshot`, `roundPayoutSnapshot`, and `payoutArtifactCache`, returning count, oldest age, p95 age, and status by domain and phase.
   - Include the SLA summary in `/health/indexer` so the app and deployment checks can distinguish an indexing problem from an on-chain dispute.

4. Update E2E helpers.
   - In `packages/nextjs/e2e/helpers/correlation.ts`, include helper methods to advance through challenge and proposal-scoped veto deadlines.
   - Add a full healthy-path E2E that starts from a settled/pending round and verifies final claim/result readiness within the configured 1-hour budget.

5. Launch keeper configuration.
   - Use aggressive but ordinary polling for launch:
     - `KEEPER_INTERVAL_MS=15000`
     - `KEEPER_STARTUP_JITTER_MS=30000`
     - `KEEPER_CORRELATION_SNAPSHOTS_ENABLED=true`
     - `KEEPER_CORRELATION_SNAPSHOT_MODE=auto`
     - `KEEPER_CORRELATION_SNAPSHOT_MAX_ROUNDS_PER_TICK=20`
     - `KEEPER_WORK_DISCOVERY_PONDER_ENABLED=true`
     - `KEEPER_WORK_DISCOVERY_RECONCILE_EVERY_TICKS=60`
     - `KEEPER_MAIN_LOOP_LOCK_REQUIRED=true`
     - `KEEPER_CORRELATION_SNAPSHOT_LOCK_REQUIRED=true`
   - Run one primary keeper and one standby keeper with DB-backed locks.
   - Keep artifact publication file-backed with HTTPS public URLs and keep `PAYOUT_ARTIFACT_HTTPS_ALLOWLIST` / `KEEPER_ARTIFACT_HTTPS_ALLOWLIST` in parity.

## Frontend, Docs, Agents, And Governance UX Plan

1. Replace stale payout timing copy.
   - Update `packages/nextjs/lib/docs/protocolFacts.ts` from the 2-4 hour claim to a launch target such as: "On the healthy unchallenged path, reward and result finality normally completes within 1 hour after the public verdict/source becomes ready, including oracle challenge, finalization, veto, keeper/application transactions, and indexing. Disputed or missing payout roots require governance/operator recovery and take longer."
   - Update matching text in:
     - `packages/nextjs/app/(public)/docs/how-it-works/page.tsx`
     - `packages/nextjs/app/(public)/docs/tech-stack/page.tsx`
     - `packages/nextjs/app/(public)/docs/governance/page.tsx`
     - `packages/nextjs/app/(public)/docs/smart-contracts/page.tsx`
     - `packages/nextjs/public/docs/how-it-works.md`
     - `packages/nextjs/public/docs/ai.md`
     - `packages/nextjs/public/docs/sdk.md`
     - `packages/nextjs/public/skill.md`
     - `packages/nextjs/public/llms.txt`
     - `packages/nextjs/lib/agent/installSnippets.ts`
     - `packages/agents/README.md`
     - `packages/agents/examples/README.md`
     - `README.md`
     - `docs/ux-impact-audit-2026-07-02.md`
     - `docs/design-review-2026-07.md` with a status note rather than rewriting the historical finding

2. Show the wait as a countdown, not a vague pending state.
   - Update `RoundProgress`, result-package rendering, claim screens, and vote-card pending reward copy to show:
     - "Challenge window ends in ..."
     - "Finalization veto ends in ..."
     - "Ready for keeper application"
     - "Disputed: governance review required"
   - Add `estimatedReadyAt`/`blockedReason` to agent result packages so agents can tell users whether they are waiting on normal finality, a challenge, missing proposer authorization, or recovery.
   - Add result-package fields such as `finalityStatus`, `normalMaxDelaySeconds: 3600`, `includesVetoWindow: true`, and `stalled: true` when pending age exceeds 1 hour.
   - Extend claim/reward notifications, including `packages/nextjs/lib/notifications/claimRewards.ts` and `SettlementNotifier`, so pending rewards are tracked for at least 70-75 minutes instead of expiring before the normal one-hour path can complete.

3. Update governance action UX.
   - In `packages/nextjs/components/governance/GovernanceActionComposer.tsx`, add finalization veto window as a first-class field when composing oracle config changes.
   - Show the derived healthy-path wait: `max(challengeWindow, overlapping round challenge window) + finalizationVetoWindow + keeper budget`.
   - Warn if a proposal increases the launch healthy-path budget above 1 hour, and require the proposal description to reference monitoring evidence.
   - Add equivalent warnings for Feedback Bonus award decision windows and frontend fee withdrawal timing.

4. Keep unrelated waits out of the copy migration.
   - Do not change or reword the 24-hour vote cooldown, EIP-3009 authorization TTL, governance proposal/timelock periods, private-session expiry, image upload cleanup TTLs, or frontend stake unbonding unless the copy specifically claims they are payout/finality waits.

## Test Plan

1. Foundry tests.
   - `ClusterPayoutOracle.t.sol`: default challenge is 15 minutes, default veto is 15 minutes, max veto is 7 days, config updates emit the new event, and proposal-scoped terms do not change retroactively after governance updates config.
   - `ClusterPayoutOracle.t.sol`: finalized roots are rejectable until their proposal-scoped veto deadline and pinned after that deadline once consumed.
   - `RoundVotingEngineBranches.t.sol` / `SelectiveRevelationTest.t.sol`: RBTS settlement reverts before the deadline and succeeds immediately after it.
   - `RoundVotingEngineBranches.t.sol`: RBTS snapshot timeout falls back at the one-hour launch timeout only when no live/proposed/challenged/finalized snapshot path exists.
   - `QuestionRewardPoolEscrow.t.sol`: question reward, bundle reward, recovery, rejected-snapshot, and snapshotless flows use the deadline helper and pass after the 15-minute veto.
   - `LaunchDistributionPool.t.sol`: pending launch-credit finalization uses the same one-hour policy.
   - `FeedbackBonusEscrow.t.sol`: award decision deadline defaults to 1 hour after settlement when that is later than the requested feedback close.
   - `FrontendRegistry.t.sol`: fee withdrawal delay uses the launch default or governed setting and does not shorten frontend stake unbonding.
   - Shared helpers should expose `warpPastVeto(snapshot)` instead of hard-coding `oracle.FINALIZATION_VETO_WINDOW()`.

2. Keeper/Ponder tests.
   - `packages/keeper/src/__tests__/correlation-snapshots.test.ts`: keeper reads deadline helpers, does not wait on a stale global veto value, and applies RBTS/rating snapshots immediately after the proposal-scoped deadline.
   - `packages/keeper/src/__tests__/resolve-rounds.test.ts`: "Cluster snapshot pending" transitions to claimable once veto has elapsed.
   - `packages/keeper/src/__tests__/metrics.test.ts`: Prometheus output, SLA gauges/counters, and health degradation.
   - `packages/keeper/src/__tests__/config.test.ts`: SLA env parsing, production validation, and fail-closed startup policy.
   - Ponder handler tests should cover indexed `vetoEndsAt`, consumed state, disputed/rejected state, and proposed/finalized timestamp buckets.
   - Add a Ponder route test for `/correlation/finality-sla`.
   - Payout-proof tests should distinguish proof/cache fetch failures from normal pending finality.

3. Next.js and agent tests.
   - `packages/nextjs/lib/docs/protocolFacts` tests or snapshots for 1-hour wording.
   - Result-package tests for `SettlementPending` should include an ETA and normal/disputed distinction.
   - Claim notification tests should cover a normal one-hour finality window.
   - Governance composer tests for the new veto field and >1-hour warning.
   - Agent docs/lint examples should stop promising 2-4 hour payouts.

4. Verification commands.
   - `forge test --offline --match-contract 'ClusterPayoutOracleTest|RoundVotingEngineBranches|QuestionRewardPoolEscrowTest|LaunchDistributionPoolTest|SecondPassRatingSnapshotOrderingTest'`
   - `yarn workspace @rateloop/keeper test`
   - `yarn workspace @rateloop/ponder test`
   - `yarn workspace @rateloop/nextjs test`
   - `yarn workspace @rateloop/agents test`
   - `yarn next:check-types && yarn keeper:check-types && yarn ponder:check-types && yarn agents:check-types`
   - Run the settlement/keeper E2E once the local stack is healthy: `REQUIRE_E2E_KEEPER=1 yarn workspace @rateloop/nextjs e2e:ci:keeper`
   - Add and run a correlation-specific SLA E2E, for example `packages/nextjs/e2e/tests/correlation-finality-sla.spec.ts`, covering RBTS settlement, public rating, question rewards, bundle rewards, and launch-credit readiness.

## Rollout Order

1. Policy and constants: merge the plan, agree on the sequential-safe 15-minute challenge, 15-minute veto, 15-minute ops budget, and define the 60-minute SLO as a healthy-path promise.
2. Contracts: implement configurable proposal-scoped veto windows, deadline helpers, RBTS timeout hardening, Feedback Bonus and frontend-fee timing changes, consumer rewiring, ABIs, and Foundry tests.
3. Keeper and monitoring: implement deadline helper reads, SLA metrics, alerts, and dashboard before relying on the shorter window.
4. Ponder/API: expose challenge/veto/consumed/disputed state for UI and agents.
5. Frontend/docs/agents: update timing copy and visible countdown/status surfaces.
6. Full verification: Foundry, keeper, Ponder, Next.js, agents, and settlement keeper E2E.
7. Deployment readiness: update Base/Base Sepolia readiness scripts to fail if the configured launch finality budget exceeds 1 hour without an explicit override and governance rationale.

## Governance Escalation Rule

Governance should not increase normal wait time just because the shorter launch window feels uncomfortable. First establish:

- at least two independent operators or auditors can recompute artifacts inside the configured launch challenge window,
- readiness and keeper startup checks prove the deployed timing budget is within 60 minutes,
- alerts fire before any unchallenged source reaches 60 minutes,
- the dashboard shows no recurring source-ready/proposal/finalization/application backlog,
- challenged roots are rare, explainable, and handled through a documented runbook,
- any proposed timing increase includes observed failure data, expected UX impact, and an alternative monitoring or operator-remediation option.

Suggested evidence threshold before increasing normal wait: 7-14 days or at least 100 payout snapshots with zero 60-minute SLO breaches, p95 source-ready-to-user-visible-finality under 30 minutes, p99 under 45 minutes, no recurring artifact fetch/cache failures, no unexplained challenges/rejections, and healthy keeper/Ponder freshness throughout.

Only after those checks should governance consider increasing challenge or veto timing.
