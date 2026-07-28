import assert from "node:assert/strict";
import test from "node:test";
import {
  AGENT_REVIEW_QUALITY_MAX_HOTSPOTS_PER_DIMENSION,
  __agentReviewQualityTestUtils,
  projectAgentReviewQuality,
} from "~~/lib/tokenless/agentReviewQuality";

function timing(overrides: Partial<Parameters<typeof projectAgentReviewQuality>[0]["timing"]> = {}) {
  return {
    medianMilliseconds: 600_000,
    p95Milliseconds: 7_200_000,
    sampleSize: 10,
    buckets: {
      under5Minutes: 2,
      fiveTo15Minutes: 3,
      fifteenMinutesTo1Hour: 3,
      oneTo4Hours: 2,
      over4Hours: 0,
    },
    ...overrides,
  };
}

function nominalAlpha(overrides: Partial<Parameters<typeof projectAgentReviewQuality>[0]["nominalAlpha"]> = {}) {
  return {
    caseCount: 10,
    ratingCount: 30,
    baselineCount: 12,
    candidateCount: 12,
    tieCount: 6,
    observedDisagreementCoincidences: 12,
    ...overrides,
  };
}

test("review quality projects workspace consensus, split distribution, bounded hotspots, and decision time", () => {
  const quality = projectAgentReviewQuality({
    sourceCaseCount: 12,
    safeCaseCount: 10,
    unanimousCaseCount: 6,
    splitBuckets: { low: 1, moderate: 2, high: 1 },
    privacyThreshold: { minimum: 3, maximum: 5 },
    nominalAlpha: nominalAlpha(),
    hotspots: [
      {
        dimension: "workflow",
        key: "refund",
        label: "refund",
        caseCount: 5,
        splitCaseCount: 3,
        splitRateBps: 6_000,
        dissentRateBps: 2_500,
      },
      {
        dimension: "risk_tier",
        key: "high",
        label: "high",
        caseCount: 4,
        splitCaseCount: 2,
        splitRateBps: 5_000,
        dissentRateBps: 2_000,
      },
      {
        dimension: "case",
        key: "case-1",
        label: "Ambiguous refund",
        caseCount: 2,
        splitCaseCount: 2,
        splitRateBps: 10_000,
        dissentRateBps: 3_333,
      },
    ],
    timing: timing(),
  });

  assert.equal(quality.availability, "available");
  assert.deepEqual(quality.privacyThreshold, { minimum: 3, maximum: 5 });
  assert.deepEqual(quality.consensus, {
    available: true,
    unanimityRateBps: 6_000,
    unanimousCaseCount: 6,
    caseCount: 10,
    limitedSample: true,
  });
  assert.equal(quality.panelSplit.available, true);
  if (quality.panelSplit.available) {
    assert.equal(quality.panelSplit.splitCaseCount, 4);
    assert.deepEqual(
      quality.panelSplit.buckets.map(bucket => [bucket.key, bucket.caseCount, bucket.shareBps]),
      [
        ["unanimous", 6, 6_000],
        ["low", 1, 1_000],
        ["moderate", 2, 2_000],
        ["high", 1, 1_000],
      ],
    );
  }
  assert.deepEqual(quality.reviewerConsistency, {
    available: true,
    alphaMilli: 396,
    caseCount: 10,
    ratingCount: 30,
    limitedSample: true,
  });
  assert.equal(quality.hotspots.workflows[0]?.key, "refund");
  assert.equal(quality.hotspots.riskTiers[0]?.key, "high");
  assert.equal(quality.hotspots.cases[0]?.label, "Ambiguous refund");
  assert.equal(quality.decisionTime.available, true);
  if (quality.decisionTime.available) {
    assert.equal(quality.decisionTime.medianMilliseconds, 600_000);
    assert.equal(quality.decisionTime.p95Milliseconds, 7_200_000);
    assert.equal(quality.decisionTime.sampleSize, 10);
    assert.equal(quality.decisionTime.limitedSample, true);
    assert.equal(quality.decisionTime.buckets[1]?.shareBps, 3_000);
  }
  assert.doesNotMatch(JSON.stringify(quality), /reviewer(Id|Key|Email|Account)|reviewerPseudonym/u);
});

test("review quality suppresses every metric when cases miss their frozen privacy threshold", () => {
  const quality = projectAgentReviewQuality({
    sourceCaseCount: 4,
    safeCaseCount: 0,
    unanimousCaseCount: 0,
    splitBuckets: { low: 0, moderate: 0, high: 0 },
    privacyThreshold: { minimum: 3, maximum: 3 },
    nominalAlpha: nominalAlpha({
      caseCount: 0,
      ratingCount: 0,
      baselineCount: 0,
      candidateCount: 0,
      tieCount: 0,
      observedDisagreementCoincidences: null,
    }),
    hotspots: [],
    timing: timing({
      medianMilliseconds: null,
      p95Milliseconds: null,
      sampleSize: 0,
      buckets: {
        under5Minutes: 0,
        fiveTo15Minutes: 0,
        fifteenMinutesTo1Hour: 0,
        oneTo4Hours: 0,
        over4Hours: 0,
      },
    }),
  });

  assert.equal(quality.availability, "suppressed");
  assert.deepEqual(quality.hotspots, { workflows: [], riskTiers: [], cases: [] });
  assert.equal(quality.consensus.available, false);
  assert.equal(quality.panelSplit.available, false);
  assert.equal(quality.reviewerConsistency.available, false);
  assert.equal(quality.decisionTime.available, false);
  if (!quality.consensus.available) assert.match(quality.consensus.reason, /privacy threshold/u);
});

test("review-quality SQL is time-bounded, aggregate-only, and caps every hotspot dimension", () => {
  const { qualitySql, timingSql } = __agentReviewQualityTestUtils;
  assert.equal(qualitySql.match(/\?/gu)?.length, 5);
  assert.equal(timingSql.match(/\?/gu)?.length, 9);
  for (const sql of [qualitySql, timingSql]) {
    assert.match(sql, /project\.workspace_id=\?/u);
    assert.match(sql, /run\.updated_at>=\? AND run\.updated_at<=\?/u);
    assert.match(sql, /run\.completed_at>=\? AND run\.completed_at<=\?/u);
    assert.match(sql, /valid_response_count>=privacy_minimum/u);
    assert.match(sql, /gold\.case_id IS NULL/u);
    assert.doesNotMatch(sql, /reviewer_key|rationale_ciphertext|qualification_keys_json/u);
  }
  assert.match(qualitySql, new RegExp(`dimension_rank<=${AGENT_REVIEW_QUALITY_MAX_HOTSPOTS_PER_DIMENSION}`, "u"));
  assert.match(qualitySql, /HAVING SUM\(dissent_count\)>0/u);
  assert.match(qualitySql, /alpha_observed_disagreement_coincidences/u);
  assert.match(qualitySql, /response\.choice IN \('baseline','candidate','tie'\)/u);
  assert.doesNotMatch(qualitySql, /failure_tag_keys_json/u);
  assert.match(timingSql, /PERCENTILE_CONT\(0\.5\)/u);
  assert.match(timingSql, /PERCENTILE_CONT\(0\.95\)/u);
});

test("nominal Krippendorff alpha is computed from aggregate category counts without a reviewer axis", () => {
  const quality = projectAgentReviewQuality({
    sourceCaseCount: 3,
    safeCaseCount: 3,
    unanimousCaseCount: 2,
    splitBuckets: { low: 0, moderate: 0, high: 1 },
    privacyThreshold: { minimum: 2, maximum: 2 },
    nominalAlpha: nominalAlpha({
      caseCount: 3,
      ratingCount: 6,
      baselineCount: 3,
      candidateCount: 3,
      tieCount: 0,
      observedDisagreementCoincidences: 2,
    }),
    hotspots: [],
    timing: timing({
      medianMilliseconds: null,
      p95Milliseconds: null,
      sampleSize: 0,
      buckets: {
        under5Minutes: 0,
        fiveTo15Minutes: 0,
        fifteenMinutesTo1Hour: 0,
        oneTo4Hours: 0,
        over4Hours: 0,
      },
    }),
  });

  assert.deepEqual(quality.reviewerConsistency, {
    available: true,
    alphaMilli: 444,
    caseCount: 3,
    ratingCount: 6,
    limitedSample: true,
  });
});

test("nominal Krippendorff alpha is unavailable when chance disagreement is undefined", () => {
  const quality = projectAgentReviewQuality({
    sourceCaseCount: 2,
    safeCaseCount: 2,
    unanimousCaseCount: 2,
    splitBuckets: { low: 0, moderate: 0, high: 0 },
    privacyThreshold: { minimum: 3, maximum: 3 },
    nominalAlpha: nominalAlpha({
      caseCount: 2,
      ratingCount: 6,
      baselineCount: 6,
      candidateCount: 0,
      tieCount: 0,
      observedDisagreementCoincidences: 0,
    }),
    hotspots: [],
    timing: timing({
      sampleSize: 0,
      medianMilliseconds: null,
      p95Milliseconds: null,
      buckets: {
        under5Minutes: 0,
        fiveTo15Minutes: 0,
        fifteenMinutesTo1Hour: 0,
        oneTo4Hours: 0,
        over4Hours: 0,
      },
    }),
  });

  assert.equal(quality.reviewerConsistency.available, false);
  if (!quality.reviewerConsistency.available) {
    assert.match(quality.reviewerConsistency.reason, /every eligible response used the same choice/u);
  }
});

test("review quality rejects internally inconsistent aggregate rows", () => {
  assert.throws(
    () =>
      projectAgentReviewQuality({
        sourceCaseCount: 2,
        safeCaseCount: 2,
        unanimousCaseCount: 2,
        splitBuckets: { low: 1, moderate: 0, high: 0 },
        privacyThreshold: { minimum: 3, maximum: 3 },
        nominalAlpha: nominalAlpha(),
        hotspots: [],
        timing: timing(),
      }),
    /panel-split counts are inconsistent/u,
  );
});
