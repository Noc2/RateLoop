import assert from "node:assert/strict";
import test from "node:test";
import { effectiveClusterMemberCap } from "~~/lib/tokenless/clusterShareCap";
import {
  type IntegrityAssignmentCandidate,
  type IntegrityAssignmentConstraints,
  selectDiversifiedIntegrityPanel,
} from "~~/lib/tokenless/integrityAssignment";
import {
  type PostRoundIntegrityPolicy,
  type PostRoundIntegrityReport,
  evaluatePostRoundIntegrity,
} from "~~/lib/tokenless/postRoundIntegrity";

function subject(index: number) {
  return `sha256:${index.toString(16).padStart(64, "0")}`;
}

function assignmentCandidate(index: number, largestClusterMembers: number): IntegrityAssignmentCandidate {
  return {
    reviewerAccountAddress: `0x${index.toString(16).padStart(40, "0")}`,
    reviewerLookup: `reviewer_${String(index).padStart(8, "0")}`,
    clusterPseudonym: index < largestClusterMembers ? "cluster_shared" : `cluster_${String(index).padStart(8, "0")}`,
    riskBand: "low",
    providerSubjectHashes: [subject(index)],
    activeCustomerAssignments: 0,
    recentCoassignmentsByReviewerLookup: {},
  };
}

function postRoundReport(index: number, largestClusterMembers: number): PostRoundIntegrityReport {
  return {
    reviewerLookup: `reviewer_${String(index).padStart(8, "0")}`,
    clusterPseudonym: index < largestClusterMembers ? "cluster_shared" : `cluster_${String(index).padStart(8, "0")}`,
    providerSubjectHashes: [subject(index)],
    vote: index % 2 === 0 ? 0 : 1,
    responseHash: `0x${(index + 100).toString(16).padStart(64, "0")}`,
    committedAt: index * 10,
    recentCoassignments: 0,
    assignmentMatched: true,
  };
}

test("assignment and post-round evaluation share the effective cluster member cap", () => {
  // Exhaust every whole cluster size for panels of three through eight and every five-percentage-point
  // cap, plus the minimum legal cap that exercises the below-one-seat rule.
  const capGrid = [1, ...Array.from({ length: 20 }, (_value, index) => (index + 1) * 500)];

  for (let panelSize = 3; panelSize <= 8; panelSize += 1) {
    for (const maximumClusterShareBps of capGrid) {
      const expectedCap = Math.max(1, Math.floor((panelSize * maximumClusterShareBps) / 10_000));
      assert.equal(effectiveClusterMemberCap(panelSize, maximumClusterShareBps), expectedCap);

      const assignmentPolicy: IntegrityAssignmentConstraints = {
        schemaVersion: "rateloop.integrity-assignment.v1",
        epochId: "integrity:2026-07-29:invariant",
        epochManifestHash: `sha256:${"a".repeat(64)}`,
        maxClusterShareBps: maximumClusterShareBps,
        allowedRiskBands: ["low"],
        recentCoassignmentWindowSeconds: 2_592_000,
        maxRecentCoassignments: 0,
        maxPerCustomer: 1,
        onePerProviderSubject: true,
      };
      const postRoundPolicy: PostRoundIntegrityPolicy = {
        minimumReports: 3,
        minimumAssignmentCoverageBps: 10_000,
        maximumClusterShareBps,
        maximumAnswerFingerprintShareBps: 10_000,
        maximumCommitBurstShareBps: 10_000,
        commitBurstWindowSeconds: 1,
        maximumRecentCoassignments: 0,
      };

      for (let largestClusterMembers = 1; largestClusterMembers <= panelSize; largestClusterMembers += 1) {
        const exceedsCap = largestClusterMembers > expectedCap;
        const candidates = Array.from({ length: panelSize }, (_value, index) =>
          assignmentCandidate(index, largestClusterMembers),
        );
        if (exceedsCap) {
          assert.throws(
            () =>
              selectDiversifiedIntegrityPanel({
                candidates,
                constraints: assignmentPolicy,
                targetCount: panelSize,
                seed: `cluster-cap:${panelSize}:${maximumClusterShareBps}:${largestClusterMembers}`,
              }),
            /cannot satisfy/,
          );
        } else {
          assert.equal(
            selectDiversifiedIntegrityPanel({
              candidates,
              constraints: assignmentPolicy,
              targetCount: panelSize,
              seed: `cluster-cap:${panelSize}:${maximumClusterShareBps}:${largestClusterMembers}`,
            }).aggregate.selectedCount,
            panelSize,
          );
        }

        const evaluation = evaluatePostRoundIntegrity({
          policy: postRoundPolicy,
          reports: Array.from({ length: panelSize }, (_value, index) => postRoundReport(index, largestClusterMembers)),
          inputsComplete: true,
        });
        assert.equal(evaluation.reasonCodes.includes("identity_cluster_dominance"), exceedsCap);
      }
    }
  }
});
