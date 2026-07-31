import { buildPopulationEstimateValidationReport } from "./population-estimate-validation";
import assert from "node:assert/strict";
import { test } from "node:test";

test("the operational estimator simulation is deterministic and keeps intervals gated", () => {
  const report = buildPopulationEstimateValidationReport();
  assert.deepEqual(report, buildPopulationEstimateValidationReport());
  assert.equal(report.intervalDecision, "withheld_pending_external_method_review");
  assert.equal(report.deterministicRunsPerScenario, 10_000);
  assert.equal(report.scenarios.length, 3);
  for (const scenario of report.scenarios) {
    assert.equal(scenario.gapRuns, 0);
    assert.ok(Number.isFinite(scenario.meanEstimateBps));
    assert.ok(Number.isFinite(scenario.rmseBps));
    assert.ok(Math.abs(scenario.signedBiasBps) <= 250, JSON.stringify(scenario));
  }
  assert.deepEqual(report.supportChecks, {
    zeroProbabilityReturnsGap: true,
    missingSelectedOutcomeReturnsGap: true,
    censusIsExact: true,
    orderingIsDeterministic: true,
  });
});
