import assert from "node:assert/strict";
import { test } from "node:test";
import { decideAdaptiveReview } from "~~/lib/tokenless/adaptiveReview";
import { FIXED_REVIEW_SAMPLER_DOMAIN, decideFixedReview } from "~~/lib/tokenless/fixedReview";

const KEY = Buffer.from("42".repeat(32), "hex");

function decision(
  fixedRateBps: number,
  opportunityId: string,
  overrides: Partial<Parameters<typeof decideFixedReview>[0]> = {},
) {
  return decideFixedReview({
    samplerKey: KEY,
    samplerKeyVersion: "fixed-test-v1",
    opportunityId,
    scopeId: "scope-fixed-test",
    policy: { policyVersion: 3, fixedRateBps, maximumUnreviewedGap: 20 },
    state: { unreviewedSinceLastSample: 0 },
    criticalRisk: false,
    metadataComplete: true,
    confidenceBelowMinimum: false,
    ...overrides,
  });
}

test("fixed sampling is deterministic, domain separated, and honors 1/5000/10000 basis-point boundaries", () => {
  const one = decision(1, "fixed-boundary-one");
  const half = decision(5_000, "fixed-boundary-half");
  const all = decision(10_000, "fixed-boundary-all");

  assert.deepEqual(decision(5_000, "fixed-boundary-half"), half);
  assert.equal(one.required, one.sampleBucket < 1);
  assert.equal(one.reviewRateBps, 1);
  assert.equal(one.selectionProbabilityBps, 1);
  assert.equal(half.required, half.sampleBucket < 5_000);
  assert.equal(half.reviewRateBps, 5_000);
  assert.equal(half.selectionProbabilityBps, 5_000);
  assert.equal(all.required, true);
  assert.equal(all.reviewRateBps, 10_000);
  assert.equal(all.selectionProbabilityBps, 10_000);
  assert.notEqual(
    half.samplerCommitment,
    decideAdaptiveReview({
      samplerKey: KEY,
      samplerKeyVersion: "fixed-test-v1",
      opportunityId: "fixed-boundary-half",
      scopeId: "scope-fixed-test",
      policy: {
        policyVersion: 3,
        agreementThresholdBps: 7_000,
        productionFloorBps: 0,
        maximumUnreviewedGap: 20,
      },
      state: {
        stage: "high_coverage",
        completedComparableCases: 30,
        stableCasesSinceStage: 0,
        unreviewedSinceLastSample: 0,
      },
      criticalRisk: false,
      metadataComplete: true,
    }).samplerCommitment,
  );
  assert.equal(FIXED_REVIEW_SAMPLER_DOMAIN, "rateloop-fixed-sample-v1");
});

test("fixed sampling forces safety overrides without changing the configured base rate", () => {
  const forced = decision(1, "fixed-forced", {
    criticalRisk: true,
    metadataComplete: false,
    confidenceBelowMinimum: true,
    state: { unreviewedSinceLastSample: 20 },
  });

  assert.equal(forced.required, true);
  assert.equal(forced.reviewRateBps, 1);
  assert.equal(forced.selectionProbabilityBps, 10_000);
  assert.deepEqual(forced.reasonCodes, ["critical_risk", "missing_metadata", "low_confidence", "maximum_gap"]);
});

test("the maximum gap forces the next fixed opportunity", () => {
  const beforeGap = decision(1, "fixed-before-gap", { state: { unreviewedSinceLastSample: 19 } });
  const atGap = decision(1, "fixed-at-gap", { state: { unreviewedSinceLastSample: 20 } });

  assert.equal(beforeGap.reasonCodes.includes("maximum_gap"), false);
  assert.equal(atGap.required, true);
  assert.equal(atGap.reviewRateBps, 1);
  assert.equal(atGap.selectionProbabilityBps, 10_000);
  assert.deepEqual(atGap.reasonCodes, ["maximum_gap"]);
});

test("fixed sampling rejects zero and out-of-range rates", () => {
  assert.throws(() => decision(0, "fixed-zero"), /policy is invalid/);
  assert.throws(() => decision(10_001, "fixed-overflow"), /policy is invalid/);
});
