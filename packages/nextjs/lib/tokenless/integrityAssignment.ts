import type { HumanAssuranceAudiencePolicy } from "@rateloop/sdk";
import { createHash } from "node:crypto";
import "server-only";
import { isOpaqueSubjectReference } from "~~/lib/tokenless/opaqueReferences";

export type IntegrityAssignmentConstraints = NonNullable<HumanAssuranceAudiencePolicy["integrity"]>;

export type IntegrityAssignmentCandidate = {
  reviewerAccountAddress: string;
  reviewerLookup: string;
  clusterPseudonym: string;
  riskBand: "low" | "medium" | "high";
  providerSubjectHashes: string[];
  activeCustomerAssignments: number;
  recentCoassignmentsByReviewerLookup: Record<string, number>;
};

export type DiversifiedIntegritySelection<T extends IntegrityAssignmentCandidate = IntegrityAssignmentCandidate> = {
  selected: T[];
  selectionSeedHash: `sha256:${string}`;
  selectionCommitment: `sha256:${string}`;
  aggregate: {
    selectedCount: number;
    independentClusterCount: number;
    largestClusterShareBps: number;
    riskBandCounts: Record<"low" | "medium" | "high", number>;
  };
};

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`)
      .join(",")}}`;
  }
  const result = JSON.stringify(value);
  if (result === undefined) throw new Error("Integrity selection evidence must be JSON serializable.");
  return result;
}

function sha256(value: string) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}` as const;
}

function ranking(seed: string, reviewerLookup: string) {
  return createHash("sha256").update(`rateloop-integrity-assignment-v1:${seed}:${reviewerLookup}`).digest("hex");
}

export function selectDiversifiedIntegrityPanel<T extends IntegrityAssignmentCandidate>(input: {
  candidates: T[];
  constraints: IntegrityAssignmentConstraints;
  targetCount: number;
  seed: string;
}): DiversifiedIntegritySelection<T> {
  if (!Number.isSafeInteger(input.targetCount) || input.targetCount < 1 || input.targetCount > 10_000) {
    throw new Error("Integrity assignment target count is invalid.");
  }
  if (!input.seed || input.seed.length > 1_000) throw new Error("Integrity assignment seed is invalid.");
  // A share cap that rounds below one member means the strictest achievable diversification —
  // one reviewer per correlation cluster — not an unsatisfiable panel. Rounding down to zero
  // rejected every network panel of four or fewer seats under the standard 2000 bps cap, at a
  // minimum panel size of three.
  const maximumClusterMembers = Math.max(
    1,
    Math.floor((input.targetCount * input.constraints.maxClusterShareBps) / 10_000),
  );
  const seenReviewers = new Set<string>();
  const ranked = input.candidates
    .map(candidate => {
      if (
        !candidate.reviewerLookup ||
        !candidate.clusterPseudonym ||
        !candidate.providerSubjectHashes.length ||
        candidate.providerSubjectHashes.some(value => !isOpaqueSubjectReference(value)) ||
        !Number.isSafeInteger(candidate.activeCustomerAssignments) ||
        candidate.activeCustomerAssignments < 0
      ) {
        throw new Error("Integrity assignment candidate is invalid.");
      }
      if (seenReviewers.has(candidate.reviewerLookup))
        throw new Error("Integrity assignment candidates are duplicated.");
      seenReviewers.add(candidate.reviewerLookup);
      return {
        ...candidate,
        providerSubjectHashes: [...new Set(candidate.providerSubjectHashes)].sort(),
        rank: ranking(input.seed, candidate.reviewerLookup),
      };
    })
    .filter(
      candidate =>
        input.constraints.allowedRiskBands.includes(candidate.riskBand) &&
        candidate.activeCustomerAssignments < input.constraints.maxPerCustomer,
    )
    .sort(
      (left, right) => left.rank.localeCompare(right.rank) || left.reviewerLookup.localeCompare(right.reviewerLookup),
    );

  const selected: Array<T & { rank: string; providerSubjectHashes: string[] }> = [];
  const clusterCounts = new Map<string, number>();
  const providerSubjects = new Set<string>();
  for (const candidate of ranked) {
    if ((clusterCounts.get(candidate.clusterPseudonym) ?? 0) >= maximumClusterMembers) continue;
    if (
      input.constraints.onePerProviderSubject &&
      candidate.providerSubjectHashes.some(subject => providerSubjects.has(subject))
    ) {
      continue;
    }
    if (
      selected.some(peer => {
        const recent = candidate.recentCoassignmentsByReviewerLookup[peer.reviewerLookup] ?? 0;
        const reciprocal = peer.recentCoassignmentsByReviewerLookup[candidate.reviewerLookup] ?? 0;
        return Math.max(recent, reciprocal) > input.constraints.maxRecentCoassignments;
      })
    ) {
      continue;
    }
    selected.push(candidate);
    clusterCounts.set(candidate.clusterPseudonym, (clusterCounts.get(candidate.clusterPseudonym) ?? 0) + 1);
    for (const subject of candidate.providerSubjectHashes) providerSubjects.add(subject);
    if (selected.length === input.targetCount) break;
  }
  if (selected.length !== input.targetCount) {
    throw new Error("Eligible supply cannot satisfy the frozen integrity assignment constraints.");
  }
  const largestCluster = Math.max(...clusterCounts.values());
  const largestClusterShareBps = Math.ceil((largestCluster * 10_000) / input.targetCount);
  // Checked against the same effective cap the selection loop applied. Comparing the reported
  // share against the raw bps instead would reject the one-per-cluster panels that a cap rounding
  // below a single seat is satisfied by.
  if (largestCluster > maximumClusterMembers) {
    throw new Error("Selected panel exceeds the frozen cluster-share cap.");
  }
  const riskBandCounts = { low: 0, medium: 0, high: 0 };
  for (const candidate of selected) riskBandCounts[candidate.riskBand] += 1;
  const selectionSeedHash = sha256(input.seed);
  const privateSelection = selected
    .map(candidate => ({
      reviewerLookup: candidate.reviewerLookup,
      clusterPseudonym: candidate.clusterPseudonym,
      riskBand: candidate.riskBand,
      providerSubjectHashes: candidate.providerSubjectHashes,
    }))
    .sort((left, right) => left.reviewerLookup.localeCompare(right.reviewerLookup));
  return {
    selected,
    selectionSeedHash,
    selectionCommitment: sha256(
      canonicalJson({
        schemaVersion: "rateloop-integrity-selection-commitment-v1",
        constraints: input.constraints,
        selectionSeedHash,
        selected: privateSelection,
      }),
    ),
    aggregate: {
      selectedCount: selected.length,
      independentClusterCount: clusterCounts.size,
      largestClusterShareBps,
      riskBandCounts,
    },
  };
}
