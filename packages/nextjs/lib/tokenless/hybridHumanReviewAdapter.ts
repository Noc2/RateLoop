import { createHash } from "node:crypto";
import "server-only";
import type { PaidReviewEligibilityPreflight } from "~~/lib/tokenless/paidReviewEligibilityPreflight";
import { TokenlessServiceError } from "~~/lib/tokenless/server";

type Hash = `sha256:${string}`;

export type HybridReviewCandidate = {
  accountAddress: string;
  assignmentReference: string;
  assignmentHash: Hash;
};

export type FrozenHybridReviewSplit = {
  schemaVersion: "rateloop.hybrid-review-split.v1";
  opportunityId: string;
  audiencePolicyHash: Hash;
  requestProfileHash: Hash;
  contentCommitments: { source: Hash; suggestion: Hash };
  publication: {
    visibility: "public";
    dataClassification: "public" | "synthetic" | "redacted";
    confirmedNoSensitiveData: true;
  };
  economics: {
    asset: "USDC";
    invitedMaximumChargeAtomic: string;
    networkMaximumChargeAtomic: string;
  };
  invited: { requestedCount: number; candidates: HybridReviewCandidate[] };
  network: { requestedCount: number; candidates: HybridReviewCandidate[] };
};

export type HybridSubpanelPreparation = {
  subpanelReference: string;
  bindingHash: Hash;
  status: "ready";
  replayed: boolean;
};

export type HybridHumanReviewResult = {
  schemaVersion: "rateloop.hybrid-human-review.v1";
  opportunityId: string;
  lane: "hybrid_public_safe";
  deduplicationRule: "invited_wins";
  invited: HybridSubpanelPreparation & { reviewerCount: number };
  network: HybridSubpanelPreparation & { reviewerCount: number; removedDuplicateCount: number };
  splitBindingHash: Hash;
};

export type HybridHumanReviewDependencies = {
  requireEligibility(accountAddress: string): Promise<PaidReviewEligibilityPreflight>;
  prepareInvited(input: {
    split: FrozenHybridReviewSplit;
    candidates: readonly HybridReviewCandidate[];
    preflights: readonly PaidReviewEligibilityPreflight[];
  }): Promise<HybridSubpanelPreparation>;
  prepareNetwork(input: {
    split: FrozenHybridReviewSplit;
    candidates: readonly HybridReviewCandidate[];
    preflights: readonly PaidReviewEligibilityPreflight[];
  }): Promise<HybridSubpanelPreparation>;
};

const HASH = /^sha256:[0-9a-f]{64}$/u;
const ADDRESS = /^0x[0-9a-f]{40}$/u;
const ATOMIC = /^(0|[1-9][0-9]*)$/u;

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`)
      .join(",")}}`;
  }
  const encoded = JSON.stringify(value);
  if (encoded === undefined) throw new Error("Hybrid review input is not canonicalizable.");
  return encoded;
}

function sha256(value: unknown): Hash {
  return `sha256:${createHash("sha256").update(stableJson(value)).digest("hex")}`;
}

function candidate(value: HybridReviewCandidate, field: string): HybridReviewCandidate {
  const accountAddress = value.accountAddress.toLowerCase();
  if (!ADDRESS.test(accountAddress) || !value.assignmentReference || !HASH.test(value.assignmentHash)) {
    throw new TokenlessServiceError(`${field} is invalid.`, 409, "hybrid_review_binding_invalid");
  }
  return {
    accountAddress,
    assignmentReference: value.assignmentReference,
    assignmentHash: value.assignmentHash,
  };
}

function validate(split: FrozenHybridReviewSplit) {
  if (
    split.schemaVersion !== "rateloop.hybrid-review-split.v1" ||
    !split.opportunityId ||
    !HASH.test(split.audiencePolicyHash) ||
    !HASH.test(split.requestProfileHash) ||
    !HASH.test(split.contentCommitments.source) ||
    !HASH.test(split.contentCommitments.suggestion) ||
    split.publication.visibility !== "public" ||
    split.publication.confirmedNoSensitiveData !== true ||
    !["public", "synthetic", "redacted"].includes(split.publication.dataClassification) ||
    split.economics.asset !== "USDC" ||
    !ATOMIC.test(split.economics.invitedMaximumChargeAtomic) ||
    !ATOMIC.test(split.economics.networkMaximumChargeAtomic) ||
    BigInt(split.economics.invitedMaximumChargeAtomic) === 0n ||
    BigInt(split.economics.networkMaximumChargeAtomic) === 0n ||
    !Number.isSafeInteger(split.invited.requestedCount) ||
    !Number.isSafeInteger(split.network.requestedCount) ||
    split.invited.requestedCount < 1 ||
    split.network.requestedCount < 1 ||
    split.invited.candidates.length !== split.invited.requestedCount
  ) {
    throw new TokenlessServiceError(
      "Hybrid review requires an exact public-safe, USDC-paid two-subpanel split.",
      409,
      "hybrid_review_binding_invalid",
    );
  }
}

function exactPreparation(value: HybridSubpanelPreparation, field: string) {
  if (!value.subpanelReference || !HASH.test(value.bindingHash) || value.status !== "ready") {
    throw new TokenlessServiceError(`${field} did not reach an exact ready state.`, 409, "hybrid_subpanel_not_ready");
  }
  return value;
}

function canonicalSplit(split: FrozenHybridReviewSplit): FrozenHybridReviewSplit {
  return {
    schemaVersion: "rateloop.hybrid-review-split.v1",
    opportunityId: split.opportunityId,
    audiencePolicyHash: split.audiencePolicyHash,
    requestProfileHash: split.requestProfileHash,
    contentCommitments: {
      source: split.contentCommitments.source,
      suggestion: split.contentCommitments.suggestion,
    },
    publication: {
      visibility: "public",
      dataClassification: split.publication.dataClassification,
      confirmedNoSensitiveData: true,
    },
    economics: {
      asset: "USDC",
      invitedMaximumChargeAtomic: split.economics.invitedMaximumChargeAtomic,
      networkMaximumChargeAtomic: split.economics.networkMaximumChargeAtomic,
    },
    invited: {
      requestedCount: split.invited.requestedCount,
      candidates: split.invited.candidates.map((value, index) => candidate(value, `Invited candidate ${index + 1}`)),
    },
    network: {
      requestedCount: split.network.requestedCount,
      candidates: split.network.candidates.map((value, index) => candidate(value, `Network candidate ${index + 1}`)),
    },
  };
}

export function createHybridHumanReviewAdapter(dependencies: HybridHumanReviewDependencies) {
  return async function requestHybridHumanReview(split: FrozenHybridReviewSplit): Promise<HybridHumanReviewResult> {
    validate(split);
    const frozenSplit = canonicalSplit(split);
    const invited = frozenSplit.invited.candidates;
    const invitedAccounts = new Set(invited.map(value => value.accountAddress));
    const normalizedNetwork = frozenSplit.network.candidates;
    const network = normalizedNetwork.filter(value => !invitedAccounts.has(value.accountAddress));
    const duplicateCount = normalizedNetwork.length - network.length;
    if (network.length !== split.network.requestedCount) {
      throw new TokenlessServiceError(
        "The frozen network subpanel has too few unique reviewers after invited-first deduplication.",
        409,
        "hybrid_subpanel_underfilled",
      );
    }
    const finalCandidates = [...invited, ...network];
    const accountSet = new Set(finalCandidates.map(value => value.accountAddress));
    if (accountSet.size !== finalCandidates.length) {
      throw new TokenlessServiceError("Hybrid reviewers must be unique.", 409, "hybrid_review_duplicate_reviewer");
    }
    const preflightEntries = await Promise.all(
      [...accountSet]
        .sort()
        .map(async accountAddress => [accountAddress, await dependencies.requireEligibility(accountAddress)] as const),
    );
    const preflightByAccount = new Map(preflightEntries);
    const invitedPreparation = exactPreparation(
      await dependencies.prepareInvited({
        split: frozenSplit,
        candidates: invited,
        preflights: invited.map(value => preflightByAccount.get(value.accountAddress)!),
      }),
      "Invited subpanel",
    );
    const networkPreparation = exactPreparation(
      await dependencies.prepareNetwork({
        split: frozenSplit,
        candidates: network,
        preflights: network.map(value => preflightByAccount.get(value.accountAddress)!),
      }),
      "Network subpanel",
    );
    const splitBindingHash = sha256({
      split: frozenSplit,
      deduplicationRule: "invited_wins",
      invited: { candidates: invited, preparation: invitedPreparation },
      network: { candidates: network, preparation: networkPreparation, removedDuplicateCount: duplicateCount },
      eligibility: preflightEntries.map(([accountAddress, value]) => ({
        accountAddress,
        preflightId: value.preflightId,
        commitment: value.eligibilityCommitment,
      })),
    });
    return {
      schemaVersion: "rateloop.hybrid-human-review.v1",
      opportunityId: split.opportunityId,
      lane: "hybrid_public_safe",
      deduplicationRule: "invited_wins",
      invited: { ...invitedPreparation, reviewerCount: invited.length },
      network: { ...networkPreparation, reviewerCount: network.length, removedDuplicateCount: duplicateCount },
      splitBindingHash,
    };
  };
}

export const __hybridHumanReviewAdapterTestUtils = { sha256 };
