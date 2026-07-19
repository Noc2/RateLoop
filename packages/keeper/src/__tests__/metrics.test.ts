import { beforeEach, describe, expect, it } from "vitest";
import {
  __resetMetricsForTests,
  operationalHealthSnapshot,
  recordError,
  recordRun,
  renderMetrics,
  setHealthThreshold,
  setMinimumWalletBalanceWei,
  setWalletBalanceWei,
} from "../metrics.js";
import type { TokenlessKeeperResult } from "../tokenless-types.js";

describe("tokenless keeper liveness metrics", () => {
  beforeEach(() => __resetMetricsForTests());

  it("publishes pending self-reveals and rounds waiting for beacon failure", () => {
    const result: TokenlessKeeperResult = {
      roundsScanned: 4,
      revealWindowsOpened: 0,
      votesRevealed: 0,
      settlementsBegun: 0,
      aggregateBatchesProcessed: 0,
      scoringSeedsFinalized: 1,
      scoreBatchesProcessed: 2,
      roundsFinalized: 0,
      terminalRoundsAdvanced: 0,
      claimsExecuted: 0,
      staleReturnsExecuted: 0,
      feedbackBonusRefundsExecuted: 1,
      selfRevealFallbacksPending: 3,
      roundsAwaitingBeaconFailure: 2,
      roundsAwaitingScoringEntropy: 1,
    };

    recordRun(result, 250);
    const metrics = renderMetrics();

    expect(metrics).toContain("keeper_rounds_scanned 4");
    expect(metrics).toContain("keeper_self_reveal_fallbacks_pending 3");
    expect(metrics).toContain("keeper_rounds_awaiting_beacon_failure 2");
    expect(metrics).toContain("keeper_rounds_awaiting_scoring_entropy 1");
    expect(metrics).toContain("keeper_scoring_seeds_finalized_total 1");
    expect(metrics).toContain("keeper_score_batches_processed_total 2");
    expect(metrics).toContain("keeper_feedback_bonus_refunds_executed_total 1");
    expect(metrics).toMatch(/keeper_last_progress_timestamp [1-9]/u);
    expect(metrics).toMatch(/keeper_last_work_observed_timestamp [1-9]/u);
  });

  it("degrades readiness for a stale run, consecutive errors, or low gas", () => {
    setHealthThreshold(1_000);
    setMinimumWalletBalanceWei(100n);
    expect(operationalHealthSnapshot()).toMatchObject({
      status: "degraded",
      reasons: ["keeper_run_stale", "wallet_balance_unknown"],
    });

    setWalletBalanceWei(99n);
    recordRun(
      {
        roundsScanned: 0,
        revealWindowsOpened: 0,
        votesRevealed: 0,
        settlementsBegun: 0,
        aggregateBatchesProcessed: 0,
        scoringSeedsFinalized: 0,
        scoreBatchesProcessed: 0,
        roundsFinalized: 0,
        terminalRoundsAdvanced: 0,
        claimsExecuted: 0,
        staleReturnsExecuted: 0,
        feedbackBonusRefundsExecuted: 0,
        selfRevealFallbacksPending: 0,
        roundsAwaitingBeaconFailure: 0,
        roundsAwaitingScoringEntropy: 0,
      },
      10,
    );
    expect(operationalHealthSnapshot()).toMatchObject({
      status: "degraded",
      reasons: ["gas_balance_low"],
      walletBalanceWei: "99",
      minimumWalletBalanceWei: "100",
    });

    setWalletBalanceWei(100n);
    recordError();
    recordError();
    recordError();
    expect(operationalHealthSnapshot()).toMatchObject({
      status: "degraded",
      reasons: ["consecutive_errors"],
    });
  });
});
