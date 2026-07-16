import { describe, expect, it } from "vitest";
import { recordRun, renderMetrics } from "../metrics.js";
import type { TokenlessKeeperResult } from "../tokenless-types.js";

describe("tokenless keeper liveness metrics", () => {
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
  });
});
