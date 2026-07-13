import assert from "node:assert/strict";
import test from "node:test";
import { SURPRISE_SHADOW_VERSION, computeSurpriseShadowDiagnostic } from "~~/lib/tokenless/surpriseAnalytics";

test("surprise shadow refuses to interpret undersized panels", () => {
  const diagnostic = computeSurpriseShadowDiagnostic(
    [
      { vote: 1, predictedUpBps: 3_000 },
      { vote: 0, predictedUpBps: 7_000 },
      { vote: 1, predictedUpBps: 5_000 },
    ],
    4,
  );
  assert.deepEqual(
    {
      state: diagnostic.state,
      actualUpBps: diagnostic.actualUpBps,
      surprisinglyPopularOutcome: diagnostic.surprisinglyPopularOutcome,
      limitations: diagnostic.limitationCodes,
    },
    {
      state: "insufficient_sample",
      actualUpBps: null,
      surprisinglyPopularOutcome: null,
      limitations: ["minimum_sample_not_met", "shadow_only_not_validated"],
    },
  );
});

test("surprise shadow can identify a predicted-underestimated minority without changing payouts", () => {
  const reports = [
    ...Array.from({ length: 4 }, () => ({ vote: 1 as const, predictedUpBps: 2_000 })),
    ...Array.from({ length: 6 }, () => ({ vote: 0 as const, predictedUpBps: 2_000 })),
  ];
  const first = computeSurpriseShadowDiagnostic(reports);
  const second = computeSurpriseShadowDiagnostic([...reports].reverse());
  assert.equal(first.version, SURPRISE_SHADOW_VERSION);
  assert.equal(first.effect, "analytics_only");
  assert.equal(first.majorityOutcome, "down");
  assert.equal(first.surprisinglyPopularOutcome, "up");
  assert.equal(first.differsFromMajority, true);
  assert.equal(first.actualUpBps, 4_000);
  assert.equal(first.meanPredictedUpBps, 2_000);
  assert.equal(first.surpriseMarginUpBps, 2_000);
  assert.equal(first.evidenceHash, second.evidenceHash);
  assert.equal("payout" in first, false);
  assert.equal("verdict" in first, false);
});

test("surprise shadow validates the frozen prediction grid and sample bound", () => {
  assert.throws(
    () => computeSurpriseShadowDiagnostic([{ vote: 1, predictedUpBps: 3_333 }], 3),
    /one-percent prediction grid/,
  );
  assert.throws(() => computeSurpriseShadowDiagnostic([], 501), /integer from 3 to 500/);
});
