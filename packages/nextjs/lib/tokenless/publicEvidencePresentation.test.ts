import assert from "node:assert/strict";
import test from "node:test";
import { publicEvidenceSummary } from "~~/lib/tokenless/publicEvidencePresentation";

test("verified evidence presentation exposes only a bounded decision summary", () => {
  const packet = {
    payload: {
      schemaVersion: "rateloop.human-assurance.evidence.v4",
      packetId: "secret-packet-id",
      runId: "secret-run-id",
      generatedAt: "2026-08-04T08:00:00.000Z",
      frozen: {
        suiteManifest: {
          rubric: { prompt: "  Is this answer supported?\n" },
          ownerNote: "never expose this note",
        },
      },
      aggregation: {
        suite: { outcome: "pass" },
        judgmentCoverage: { caseCount: 2, validJudgmentCount: 5 },
        reviewerCoverage: { respondingReviewerCount: 3 },
      },
      limitations: [
        { code: "minimum_aggregation_not_met", message: "secret customer detail" },
        { code: "no_onchain_settlement", message: "another private implementation detail" },
        { code: "unknown_future_code", message: "must stay hidden" },
      ],
      recomputation: { reviewerIds: ["reviewer-secret"] },
    },
  };

  assert.deepEqual(publicEvidenceSummary(packet), {
    question: "Is this answer supported?",
    outcome: "pass",
    generatedAt: "2026-08-04T08:00:00.000Z",
    caseCount: 2,
    respondingReviewerCount: 3,
    validJudgmentCount: 5,
    limitations: ["minimum_aggregation_not_met", "no_onchain_settlement"],
  });
  assert.doesNotMatch(
    JSON.stringify(publicEvidenceSummary(packet)),
    /secret customer detail|private implementation detail|must stay hidden|reviewer-secret/iu,
  );
});

test("evidence presentation rejects unsupported packets and omits malformed fields", () => {
  assert.equal(publicEvidenceSummary({ payload: { schemaVersion: "future-evidence.v99" } }), null);
  assert.deepEqual(
    publicEvidenceSummary({
      payload: {
        schemaVersion: "rateloop.human-assurance.evidence.v4",
        generatedAt: "not-a-date",
        frozen: { suiteManifest: { rubric: { prompt: "x".repeat(501) } } },
        aggregation: {
          suite: { outcome: "unknown" },
          judgmentCoverage: { caseCount: -1, validJudgmentCount: 10_000_001 },
          reviewerCoverage: { respondingReviewerCount: 1.5 },
        },
      },
    }),
    {
      question: null,
      outcome: null,
      generatedAt: null,
      caseCount: null,
      respondingReviewerCount: null,
      validJudgmentCount: null,
      limitations: [],
    },
  );
});
