import assert from "node:assert/strict";
import test from "node:test";
import {
  type PostRoundIntegrityReport,
  createPostRoundIntegrityAppeal,
  evaluatePostRoundIntegrity,
} from "~~/lib/tokenless/postRoundIntegrity";

const policy = {
  minimumReports: 5,
  minimumAssignmentCoverageBps: 10_000,
  maximumClusterShareBps: 4_000,
  maximumAnswerFingerprintShareBps: 4_000,
  maximumCommitBurstShareBps: 6_000,
  commitBurstWindowSeconds: 5,
  maximumRecentCoassignments: 1,
};

function report(index: number, overrides: Partial<PostRoundIntegrityReport> = {}): PostRoundIntegrityReport {
  return {
    reviewerLookup: `reviewer_${String(index).padStart(8, "0")}`,
    clusterPseudonym: `cluster_${String(index).padStart(8, "0")}`,
    providerSubjectHashes: [`sha256:${index.toString(16).padStart(64, "0")}`],
    vote: index % 2 === 0 ? 0 : 1,
    responseHash: `0x${(index + 100).toString(16).padStart(64, "0")}`,
    committedAt: index * 10,
    recentCoassignments: 0,
    assignmentMatched: true,
    ...overrides,
  };
}

test("post-round integrity publishes complete diverse evidence without exposing membership", () => {
  const evaluation = evaluatePostRoundIntegrity({
    policy,
    reports: [1, 2, 3, 4, 5].map(index => report(index)),
    inputsComplete: true,
  });
  assert.equal(evaluation.status, "publishable");
  assert.equal(evaluation.payoutEffect, "none");
  assert.equal(evaluation.aggregates.independentClusterCount, 5);
  assert.equal("reports" in evaluation, false);
  assert.match(evaluation.evaluationHash, /^sha256:[0-9a-f]{64}$/u);
});

test("post-round integrity distinguishes pending, inconclusive, and delisted states", () => {
  const reports = [1, 2, 3, 4, 5].map(index => report(index));
  assert.equal(evaluatePostRoundIntegrity({ policy, reports, inputsComplete: false }).status, "pending");
  assert.equal(
    evaluatePostRoundIntegrity({
      policy,
      reports: reports.slice(0, 3),
      inputsComplete: true,
      limitationCodes: ["assignment_source_partial"],
    }).status,
    "inconclusive",
  );
  const delisted = evaluatePostRoundIntegrity({
    policy,
    reports: reports.map((value, index) => ({
      ...value,
      clusterPseudonym: index < 3 ? "cluster_dominant" : value.clusterPseudonym,
    })),
    inputsComplete: true,
  });
  assert.equal(delisted.status, "delisted");
  assert.ok(delisted.reasonCodes.includes("identity_cluster_dominance"));
  assert.equal(delisted.remediation, "rerun_or_buyer_fee_review");
});

test("provider reuse, fingerprint rings, timing bursts, and coassignment rings are deterministic risk signals", () => {
  const sharedSubject = `sha256:${"f".repeat(64)}`;
  const reports = [1, 2, 3, 4, 5].map(
    (index): PostRoundIntegrityReport =>
      report(index, {
        providerSubjectHashes: index <= 2 ? [sharedSubject] : report(index).providerSubjectHashes,
        responseHash: index <= 3 ? `0x${"a".repeat(64)}` : report(index).responseHash,
        vote: 1,
        committedAt: index,
        recentCoassignments: index === 5 ? 2 : 0,
      }),
  );
  const first = evaluatePostRoundIntegrity({ policy, reports, inputsComplete: true });
  const second = evaluatePostRoundIntegrity({ policy, reports: [...reports].reverse(), inputsComplete: true });
  assert.equal(first.evaluationHash, second.evaluationHash);
  assert.equal(first.status, "delisted");
  assert.deepEqual(first.reasonCodes, [
    "answer_fingerprint_concentration",
    "commit_timing_burst",
    "provider_subject_reuse",
    "recent_coassignment_excess",
  ]);
});

test("appeals append to an immutable evaluation and cannot affect payout", () => {
  const evaluation = evaluatePostRoundIntegrity({
    policy,
    reports: [1, 2, 3, 4, 5].map(index => report(index)),
    inputsComplete: true,
  });
  const appeal = createPostRoundIntegrityAppeal({
    evaluationHash: evaluation.evaluationHash,
    appealId: "appeal_00000001",
    reasonCode: "cluster_false_positive",
    submittedAt: "2026-07-13T12:00:00.000Z",
  });
  assert.equal(appeal.originalEvaluationHash, evaluation.evaluationHash);
  assert.equal(appeal.effect, "append_only_review");
  assert.equal(appeal.payoutEffect, "none");
});
