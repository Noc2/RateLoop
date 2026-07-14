import assert from "node:assert/strict";
import test from "node:test";
import { decideAdaptiveReview, nextAdaptiveStage } from "~~/lib/tokenless/adaptiveReview";

const policy = {
  policyVersion: 4,
  agreementThresholdBps: 7_000,
  productionFloorBps: 1_000,
  maximumUnreviewedGap: 20,
};

const passingWindow = {
  comparable: 15,
  agreements: 15,
  completionGatePassed: true,
  humanAgreementGatePassed: true,
  latencyGatePassed: true,
  driftGatePassed: true,
  severeDisagreementOpen: false,
};

test("adaptive stages require two independent calibration windows and stable evidence", () => {
  const calibration = nextAdaptiveStage({
    policy,
    state: {
      stage: "calibrating",
      completedComparableCases: 30,
      stableCasesSinceStage: 30,
      unreviewedSinceLastSample: 0,
    },
    previousWindow: passingWindow,
    latestWindow: passingWindow,
  });
  assert.equal(calibration.stage, "high_coverage");
  assert.equal(calibration.reviewRateBps, 5_000);

  const medium = nextAdaptiveStage({
    policy,
    state: {
      stage: "high_coverage",
      completedComparableCases: 80,
      stableCasesSinceStage: 50,
      unreviewedSinceLastSample: 0,
    },
    latestWindow: passingWindow,
  });
  assert.equal(medium.stage, "medium_coverage");

  const monitoring = nextAdaptiveStage({
    policy,
    state: {
      stage: "medium_coverage",
      completedComparableCases: 180,
      stableCasesSinceStage: 100,
      unreviewedSinceLastSample: 0,
    },
    latestWindow: passingWindow,
  });
  assert.deepEqual(monitoring, { stage: "monitoring", reviewRateBps: 1_000, reason: "one_hundred_stable_cases" });
});

test("quality failures and reset reasons cannot reduce review", () => {
  const weak = { ...passingWindow, agreements: 10 };
  const held = nextAdaptiveStage({
    policy,
    state: {
      stage: "high_coverage",
      completedComparableCases: 120,
      stableCasesSinceStage: 90,
      unreviewedSinceLastSample: 0,
    },
    latestWindow: weak,
  });
  assert.equal(held.stage, "high_coverage");
  assert.equal(held.reviewRateBps, 5_000);

  const reset = nextAdaptiveStage({
    policy,
    state: {
      stage: "monitoring",
      completedComparableCases: 500,
      stableCasesSinceStage: 300,
      unreviewedSinceLastSample: 0,
    },
    latestWindow: passingWindow,
    resetReason: "model_version_changed",
  });
  assert.deepEqual(reset, { stage: "calibrating", reviewRateBps: 10_000, reason: "model_version_changed" });
});

test("sampling is deterministic and forced by risk, missing metadata, or maximum gap", () => {
  const base = {
    samplerKey: Buffer.alloc(32, 7),
    samplerKeyVersion: "sampler-v1",
    opportunityId: "opp_customer_reply_001",
    scopeId: "scope_agent_workflow_risk_audience",
    policy,
    state: {
      stage: "monitoring" as const,
      completedComparableCases: 500,
      stableCasesSinceStage: 200,
      unreviewedSinceLastSample: 0,
    },
    criticalRisk: false,
    metadataComplete: true,
  };
  const first = decideAdaptiveReview(base);
  const replay = decideAdaptiveReview(base);
  assert.deepEqual(first, replay);
  assert.equal(first.reviewRateBps, 1_000);

  for (const forced of [
    { ...base, criticalRisk: true },
    { ...base, metadataComplete: false },
    { ...base, state: { ...base.state, unreviewedSinceLastSample: 20 } },
  ]) {
    assert.equal(decideAdaptiveReview(forced).required, true);
  }
});
