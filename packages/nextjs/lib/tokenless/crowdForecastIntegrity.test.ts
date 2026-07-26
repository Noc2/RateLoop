import {
  appendForecastCalibration,
  appendForecastPair,
  emptyForecastCalibrationAccumulator,
  emptyForecastPairAccumulator,
  evaluateForecastCalibration,
  evaluateForecastPair,
  forecastConsequence,
  workspaceHistogramExpectedExactMatchBps,
} from "./crowdForecastIntegrity";
import assert from "node:assert/strict";
import test from "node:test";

test("Brier skill rejects a constant reporter even when the base rate looks calibrated", () => {
  let accumulator = emptyForecastCalibrationAccumulator();
  for (let index = 0; index < 20; index += 1) {
    accumulator = appendForecastCalibration(accumulator, {
      predictedPositiveBps: 5_000,
      outcome: index % 2 === 0 ? 1 : 0,
      vote: index % 2 === 0 ? 1 : 0,
    });
  }
  const evaluation = evaluateForecastCalibration(accumulator);
  assert.equal(evaluation.brierSkillScoreBps, 0);
  assert.deepEqual(evaluation.reasonCodes, [
    "forecast_invariant",
    "forecast_discrimination_absent",
    "forecast_vote_decoupled",
  ]);
  assert.deepEqual(evaluation.softReasonCodes, ["forecast_vote_decoupled"]);
  assert.deepEqual(evaluation.limitationCodes, []);
});

test("inconclusive rounds still advance invariant and vote counters without manufacturing an outcome", () => {
  let accumulator = emptyForecastCalibrationAccumulator();
  for (let index = 0; index < 12; index += 1) {
    accumulator = appendForecastCalibration(accumulator, {
      predictedPositiveBps: 5_000,
      outcome: null,
      vote: index % 2 === 0 ? 1 : 0,
    });
  }
  const evaluation = evaluateForecastCalibration(accumulator);
  assert.equal(accumulator.outcomeObservationCount, 0n);
  assert.equal(evaluation.brierSkillScoreBps, null);
  assert.ok(evaluation.reasonCodes.includes("forecast_invariant"));
  assert.ok(!evaluation.reasonCodes.includes("forecast_discrimination_absent"));
});

test("an outcome-discriminating reporter has positive skill without false invariant flags", () => {
  let accumulator = emptyForecastCalibrationAccumulator();
  for (let index = 0; index < 20; index += 1) {
    const outcome = index % 2 === 0 ? 1 : 0;
    accumulator = appendForecastCalibration(accumulator, {
      predictedPositiveBps: outcome ? 8_000 : 2_000,
      outcome,
      vote: index % 3 === 0 ? 1 : 0,
    });
  }
  const evaluation = evaluateForecastCalibration(accumulator);
  assert.ok((evaluation.brierSkillScoreBps ?? 0) > 0);
  assert.equal(evaluation.outcomeDiscriminationBps, 6_000);
  assert.ok(!evaluation.reasonCodes.includes("forecast_invariant"));
  assert.ok(!evaluation.reasonCodes.includes("forecast_discrimination_absent"));
});

test("pair lockstep uses the workspace histogram null and low distance variance", () => {
  const concentrated: bigint[] = Array.from({ length: 99 }, (_, index) => (index === 49 ? 90n : 0n));
  concentrated[19] = 10n;
  assert.equal(workspaceHistogramExpectedExactMatchBps(concentrated), 8_200);

  let pair = emptyForecastPairAccumulator();
  for (let index = 0; index < 20; index += 1) {
    pair = appendForecastPair(pair, {
      leftForecastBps: 7_300,
      rightForecastBps: 7_300,
      expectedExactMatchBps: 1_000,
    });
  }
  const evaluation = evaluateForecastPair(pair);
  assert.equal(evaluation.observedExactMatchBps, 10_000);
  assert.deepEqual(evaluation.reasonCodes, ["forecast_pair_lockstep"]);
  assert.deepEqual(evaluation.limitationCodes, []);
});

test("only appeals covering every active hard finding suspend consequences", () => {
  const reasons = ["forecast_invariant", "forecast_discrimination_absent"];
  assert.equal(forecastConsequence({ reasonCodes: reasons }), "future_assignment_restriction");
  assert.equal(
    forecastConsequence({
      reasonCodes: reasons,
      activeHardFindingCount: 2,
      suspendedHardFindingCount: 1,
    }),
    "future_assignment_restriction",
  );
  assert.equal(
    forecastConsequence({
      reasonCodes: reasons,
      activeHardFindingCount: 2,
      suspendedHardFindingCount: 2,
    }),
    "suspended_by_open_appeal",
  );
  assert.deepEqual(reasons, ["forecast_invariant", "forecast_discrimination_absent"]);
  assert.equal(forecastConsequence({ reasonCodes: ["forecast_vote_decoupled"] }), "none");
});
