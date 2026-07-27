import assert from "node:assert/strict";
import test from "node:test";
import {
  type IntegrityAssignmentCandidate,
  selectDiversifiedIntegrityPanel,
} from "~~/lib/tokenless/integrityAssignment";

const constraints = {
  schemaVersion: "rateloop.integrity-assignment.v1" as const,
  epochId: "integrity:2026-07-13:001",
  epochManifestHash: `sha256:${"a".repeat(64)}` as const,
  maxClusterShareBps: 2_000,
  allowedRiskBands: ["low", "medium"] as Array<"low" | "medium">,
  recentCoassignmentWindowSeconds: 2_592_000,
  maxRecentCoassignments: 0,
  maxPerCustomer: 2,
  onePerProviderSubject: true as const,
};

function worldSubject(index: number) {
  return `hmac-sha256:hmac-v1:${index.toString(16).padStart(64, "0")}`;
}

function candidate(index: number, overrides: Partial<IntegrityAssignmentCandidate> = {}): IntegrityAssignmentCandidate {
  return {
    reviewerAccountAddress: `0x${index.toString(16).padStart(40, "0")}`,
    reviewerLookup: `reviewer_${index}`,
    clusterPseudonym: `cluster_${index}`,
    riskBand: "low",
    providerSubjectHashes: [worldSubject(index)],
    activeCustomerAssignments: 0,
    recentCoassignmentsByReviewerLookup: {},
    ...overrides,
  };
}

test("selection is deterministic and enforces clusters, provider subjects, risk, customer, and recent-pair caps", () => {
  const candidates = [
    candidate(1, { clusterPseudonym: "cluster_shared" }),
    candidate(2, { clusterPseudonym: "cluster_shared" }),
    candidate(3, { riskBand: "high" }),
    candidate(4, { providerSubjectHashes: [worldSubject(1)] }),
    candidate(5, { activeCustomerAssignments: 2 }),
    candidate(6),
    candidate(7),
    candidate(8),
    candidate(9),
    candidate(10),
  ];
  const first = selectDiversifiedIntegrityPanel({ candidates, constraints, targetCount: 5, seed: "seed-1" });
  const second = selectDiversifiedIntegrityPanel({
    candidates: [...candidates].reverse(),
    constraints,
    targetCount: 5,
    seed: "seed-1",
  });
  assert.deepEqual(
    first.selected.map(value => value.reviewerLookup),
    second.selected.map(value => value.reviewerLookup),
  );
  assert.equal(first.selectionCommitment, second.selectionCommitment);
  assert.equal(first.aggregate.selectedCount, 5);
  assert.equal(first.aggregate.largestClusterShareBps, 2_000);
  assert.equal(
    first.selected.some(value => value.riskBand === "high"),
    false,
  );
  assert.equal(
    first.selected.some(value => value.activeCustomerAssignments >= 2),
    false,
  );
  assert.equal(new Set(first.selected.flatMap(value => value.providerSubjectHashes)).size, 5);
});

test("selection fails closed instead of weakening frozen independence constraints", () => {
  assert.throws(
    () =>
      selectDiversifiedIntegrityPanel({
        candidates: [candidate(1, { clusterPseudonym: "ring" }), candidate(2, { clusterPseudonym: "ring" })],
        constraints: { ...constraints, maxClusterShareBps: 5_000 },
        targetCount: 2,
        seed: "seed-2",
      }),
    /cannot satisfy/,
  );
  assert.throws(
    () => selectDiversifiedIntegrityPanel({ candidates: [candidate(1)], constraints, targetCount: 4, seed: "seed-3" }),
    /cannot satisfy/,
  );
});

test("a share cap that rounds below one seat admits one reviewer per cluster", () => {
  // The standard 2000 bps cap floors to zero for every panel of four or fewer seats, and three is
  // the minimum network panel size. Those panels must still be selectable, at the strictest
  // possible diversification rather than not at all.
  for (const targetCount of [1, 2, 3, 4]) {
    const candidates = Array.from({ length: targetCount }, (_value, index) => candidate(index + 1));
    const selection = selectDiversifiedIntegrityPanel({
      candidates,
      constraints,
      targetCount,
      seed: `seed-small-${targetCount}`,
    });
    assert.equal(selection.aggregate.selectedCount, targetCount);
    assert.equal(selection.aggregate.independentClusterCount, targetCount);
  }

  // One reviewer per cluster stays the ceiling: a second member of an existing cluster is refused
  // rather than admitted to fill the panel.
  assert.throws(
    () =>
      selectDiversifiedIntegrityPanel({
        candidates: [
          candidate(1, { clusterPseudonym: "ring" }),
          candidate(2, { clusterPseudonym: "ring" }),
          candidate(3, { clusterPseudonym: "ring" }),
        ],
        constraints,
        targetCount: 3,
        seed: "seed-small-ring",
      }),
    /cannot satisfy/,
  );
});
