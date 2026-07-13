import { createHash } from "node:crypto";

export const POST_ROUND_INTEGRITY_VERSION = "rateloop.post-round-integrity.v1" as const;

export type PostRoundIntegrityStatus = "pending" | "publishable" | "inconclusive" | "delisted";

export type PostRoundIntegrityPolicy = {
  minimumReports: number;
  minimumAssignmentCoverageBps: number;
  maximumClusterShareBps: number;
  maximumAnswerFingerprintShareBps: number;
  maximumCommitBurstShareBps: number;
  commitBurstWindowSeconds: number;
  maximumRecentCoassignments: number;
};

export type PostRoundIntegrityReport = {
  reviewerLookup: string;
  clusterPseudonym: string;
  providerSubjectHashes: string[];
  vote: 0 | 1;
  responseHash: string;
  committedAt: number;
  recentCoassignments: number;
  assignmentMatched: boolean;
};

export type PostRoundIntegrityEvaluation = {
  schemaVersion: typeof POST_ROUND_INTEGRITY_VERSION;
  evaluationHash: `sha256:${string}`;
  status: PostRoundIntegrityStatus;
  effect: "verdict_publication_and_future_eligibility_only";
  payoutEffect: "none";
  reasonCodes: string[];
  limitationCodes: string[];
  remediation: "none" | "wait_for_inputs" | "rerun_or_limit_claim" | "rerun_or_buyer_fee_review";
  aggregates: {
    reportCount: number;
    matchedAssignmentCount: number;
    assignmentCoverageBps: number;
    uniqueReviewerCount: number;
    independentClusterCount: number;
    largestClusterShareBps: number;
    largestAnswerFingerprintShareBps: number;
    largestCommitBurstShareBps: number;
    duplicateProviderSubjectCount: number;
    recentCoassignmentExcessCount: number;
  };
};

const BPS = 10_000;
const MAX_REPORTS = 500;
const HASH = /^(?:0x|sha256:)[0-9a-f]{64}$/u;
const PSEUDONYM = /^[A-Za-z0-9:_-]{8,256}$/u;
const LIMITATION = /^[a-z0-9_:-]{1,120}$/u;

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
      .join(",")}}`;
  }
  const encoded = JSON.stringify(value);
  if (encoded === undefined) throw new Error("Post-round integrity evidence must be JSON serializable.");
  return encoded;
}

function sha256(value: unknown) {
  return `sha256:${createHash("sha256").update(canonicalJson(value)).digest("hex")}` as const;
}

function integer(value: number, label: string, minimum: number, maximum: number) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${label} must be an integer from ${minimum} to ${maximum}.`);
  }
  return value;
}

function shareBps(count: number, total: number) {
  return total === 0 ? 0 : Math.ceil((count * BPS) / total);
}

function largestGroupShare(values: string[], total: number) {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return {
    groupCount: counts.size,
    shareBps: shareBps(Math.max(0, ...counts.values()), total),
  };
}

function validatePolicy(policy: PostRoundIntegrityPolicy) {
  return {
    minimumReports: integer(policy.minimumReports, "minimumReports", 3, MAX_REPORTS),
    minimumAssignmentCoverageBps: integer(policy.minimumAssignmentCoverageBps, "minimumAssignmentCoverageBps", 1, BPS),
    maximumClusterShareBps: integer(policy.maximumClusterShareBps, "maximumClusterShareBps", 1, BPS),
    maximumAnswerFingerprintShareBps: integer(
      policy.maximumAnswerFingerprintShareBps,
      "maximumAnswerFingerprintShareBps",
      1,
      BPS,
    ),
    maximumCommitBurstShareBps: integer(policy.maximumCommitBurstShareBps, "maximumCommitBurstShareBps", 1, BPS),
    commitBurstWindowSeconds: integer(policy.commitBurstWindowSeconds, "commitBurstWindowSeconds", 1, 3_600),
    maximumRecentCoassignments: integer(policy.maximumRecentCoassignments, "maximumRecentCoassignments", 0, 10_000),
  };
}

export function evaluatePostRoundIntegrity(input: {
  policy: PostRoundIntegrityPolicy;
  reports: PostRoundIntegrityReport[];
  inputsComplete: boolean;
  limitationCodes?: string[];
}): PostRoundIntegrityEvaluation {
  const policy = validatePolicy(input.policy);
  if (input.reports.length > MAX_REPORTS) throw new Error("Post-round integrity report count exceeds 500.");
  const limitationCodes = [...new Set(input.limitationCodes ?? [])].sort();
  if (limitationCodes.some(code => !LIMITATION.test(code))) {
    throw new Error("Post-round integrity limitation code is invalid.");
  }

  const reviewerLookups: string[] = [];
  const clusters: string[] = [];
  const fingerprints: string[] = [];
  const commitBuckets: string[] = [];
  const providerSubjectCounts = new Map<string, number>();
  let matchedAssignmentCount = 0;
  let recentCoassignmentExcessCount = 0;
  for (const report of input.reports) {
    if (
      !PSEUDONYM.test(report.reviewerLookup) ||
      !PSEUDONYM.test(report.clusterPseudonym) ||
      !HASH.test(report.responseHash) ||
      (report.vote !== 0 && report.vote !== 1) ||
      !Number.isSafeInteger(report.committedAt) ||
      report.committedAt < 0 ||
      !Number.isSafeInteger(report.recentCoassignments) ||
      report.recentCoassignments < 0 ||
      report.providerSubjectHashes.length === 0 ||
      report.providerSubjectHashes.some(subject => !HASH.test(subject))
    ) {
      throw new Error("Post-round integrity report is malformed.");
    }
    reviewerLookups.push(report.reviewerLookup);
    clusters.push(report.clusterPseudonym);
    fingerprints.push(`${report.vote}:${report.responseHash.toLowerCase()}`);
    commitBuckets.push(String(Math.floor(report.committedAt / policy.commitBurstWindowSeconds)));
    if (report.assignmentMatched) matchedAssignmentCount += 1;
    if (report.recentCoassignments > policy.maximumRecentCoassignments) recentCoassignmentExcessCount += 1;
    for (const subject of new Set(report.providerSubjectHashes.map(value => value.toLowerCase()))) {
      providerSubjectCounts.set(subject, (providerSubjectCounts.get(subject) ?? 0) + 1);
    }
  }

  const reportCount = input.reports.length;
  const reviewers = largestGroupShare(reviewerLookups, reportCount);
  const clusterGroups = largestGroupShare(clusters, reportCount);
  const fingerprintsGroups = largestGroupShare(fingerprints, reportCount);
  const commitBurstGroups = largestGroupShare(commitBuckets, reportCount);
  const duplicateProviderSubjectCount = [...providerSubjectCounts.values()].filter(count => count > 1).length;
  const assignmentCoverageBps = reportCount === 0 ? 0 : Math.floor((matchedAssignmentCount * BPS) / reportCount);
  const aggregates = {
    reportCount,
    matchedAssignmentCount,
    assignmentCoverageBps,
    uniqueReviewerCount: reviewers.groupCount,
    independentClusterCount: clusterGroups.groupCount,
    largestClusterShareBps: clusterGroups.shareBps,
    largestAnswerFingerprintShareBps: fingerprintsGroups.shareBps,
    largestCommitBurstShareBps: commitBurstGroups.shareBps,
    duplicateProviderSubjectCount,
    recentCoassignmentExcessCount,
  };

  const reasonCodes: string[] = [];
  if (reviewers.groupCount !== reportCount) reasonCodes.push("reviewer_lookup_reuse");
  if (duplicateProviderSubjectCount > 0) reasonCodes.push("provider_subject_reuse");
  if (clusterGroups.shareBps > policy.maximumClusterShareBps) reasonCodes.push("identity_cluster_dominance");
  if (fingerprintsGroups.shareBps > policy.maximumAnswerFingerprintShareBps) {
    reasonCodes.push("answer_fingerprint_concentration");
  }
  if (commitBurstGroups.shareBps > policy.maximumCommitBurstShareBps) reasonCodes.push("commit_timing_burst");
  if (recentCoassignmentExcessCount > 0) reasonCodes.push("recent_coassignment_excess");
  if (reportCount < policy.minimumReports) reasonCodes.push("sample_below_policy_minimum");
  if (assignmentCoverageBps < policy.minimumAssignmentCoverageBps) {
    reasonCodes.push("assignment_coverage_insufficient");
  }

  const hardRisk = reasonCodes.some(code =>
    [
      "reviewer_lookup_reuse",
      "provider_subject_reuse",
      "identity_cluster_dominance",
      "answer_fingerprint_concentration",
      "commit_timing_burst",
      "recent_coassignment_excess",
    ].includes(code),
  );
  const insufficient =
    reasonCodes.includes("sample_below_policy_minimum") ||
    reasonCodes.includes("assignment_coverage_insufficient") ||
    limitationCodes.length > 0;
  const status: PostRoundIntegrityStatus = !input.inputsComplete
    ? "pending"
    : hardRisk
      ? "delisted"
      : insufficient
        ? "inconclusive"
        : "publishable";
  const remediation =
    status === "pending"
      ? "wait_for_inputs"
      : status === "inconclusive"
        ? "rerun_or_limit_claim"
        : status === "delisted"
          ? "rerun_or_buyer_fee_review"
          : "none";
  const hashInput = {
    schemaVersion: POST_ROUND_INTEGRITY_VERSION,
    status,
    reasonCodes: [...reasonCodes].sort(),
    limitationCodes,
    policy,
    aggregates,
  };
  return {
    schemaVersion: POST_ROUND_INTEGRITY_VERSION,
    evaluationHash: sha256(hashInput),
    status,
    effect: "verdict_publication_and_future_eligibility_only",
    payoutEffect: "none",
    reasonCodes: [...reasonCodes].sort(),
    limitationCodes,
    remediation,
    aggregates,
  };
}

export function createPostRoundIntegrityAppeal(input: {
  evaluationHash: string;
  appealId: string;
  reasonCode: string;
  submittedAt: string;
}) {
  if (!/^sha256:[0-9a-f]{64}$/u.test(input.evaluationHash) || !PSEUDONYM.test(input.appealId)) {
    throw new Error("Post-round integrity appeal binding is invalid.");
  }
  if (!LIMITATION.test(input.reasonCode) || !Number.isFinite(Date.parse(input.submittedAt))) {
    throw new Error("Post-round integrity appeal details are invalid.");
  }
  const appeal = {
    schemaVersion: "rateloop.post-round-integrity-appeal.v1" as const,
    appealId: input.appealId,
    originalEvaluationHash: input.evaluationHash,
    reasonCode: input.reasonCode,
    submittedAt: new Date(input.submittedAt).toISOString(),
    effect: "append_only_review" as const,
    payoutEffect: "none" as const,
  };
  return { ...appeal, appealHash: sha256(appeal) };
}
