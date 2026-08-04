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
      limitations: ["internal limitation"],
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
  });
  assert.doesNotMatch(JSON.stringify(publicEvidenceSummary(packet)), /secret|limitation|reviewer-id/iu);
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
    },
  );
});
