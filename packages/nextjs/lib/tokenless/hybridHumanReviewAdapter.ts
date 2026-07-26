import { createHash } from "node:crypto";
import "server-only";
import { getAddress } from "viem";
import { isRateLoopPrincipalId } from "~~/lib/auth/accountSubject";
import { requirePaidLaneComplianceApproval } from "~~/lib/tokenless/paidLaneCompliance";
import {
  type PaidReviewEligibilityPreflight,
  requirePaidReviewEligibility,
} from "~~/lib/tokenless/paidReviewEligibilityPreflight";
import {
  type ReviewerExpertiseRequirement,
  normalizeReviewerExpertiseRequirementsSelection,
} from "~~/lib/tokenless/reviewerExpertiseOptions";
import { TokenlessServiceError } from "~~/lib/tokenless/server";

type Hash = `sha256:${string}`;

export type HybridReviewCandidate = {
  principalId: string;
  payoutAccount: string;
  assignmentReference: string;
  assignmentHash: Hash;
};

export type FrozenHybridReviewSplit = {
  schemaVersion: "rateloop.hybrid-review-split.v2";
  workspaceId: string;
  opportunityId: string;
  audiencePolicyHash: Hash;
  requestProfileHash: Hash;
  semanticProfile: {
    schemaVersion: "rateloop.review-request-profile.v4";
    audience: "hybrid";
    audiencePolicyHash: Hash;
    execution: "two_distinct_rounds";
    invited: HybridCohortSemanticProfile & { reviewerSource: "customer_invited" };
    network: HybridCohortSemanticProfile & { reviewerSource: "rateloop_network" };
  };
  contentCommitments: { source: Hash; suggestion: Hash };
  publication: {
    visibility: "public";
    dataClassification: "public" | "synthetic" | "redacted";
    confirmedNoSensitiveData: true;
    redactionSummary?: string;
  };
  economics: {
    asset: "USDC";
    invitedMaximumChargeAtomic: string;
    networkMaximumChargeAtomic: string;
  };
  invited: { requestedCount: number; candidates: HybridReviewCandidate[] };
  network: { requestedCount: number; candidates: HybridReviewCandidate[] };
};

export type HybridCohortSemanticProfile = {
  panelSize: number;
  admissionPolicyHash: Hash;
  economics: {
    asset: "USDC";
    bountyPerSeatAtomic: string;
    maximumChargeAtomic: string;
  };
  expertiseRequirements: ReviewerExpertiseRequirement[];
};

export type HybridRoundIdentity = {
  deploymentKey: string;
  chainId: number;
  panelAddress: string;
  roundId: string;
  admissionPolicyHash: Hash;
};

export type HybridSubpanelPreparation = {
  subpanelReference: string;
  bindingHash: Hash;
  round: HybridRoundIdentity;
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
  requireEligibility(input: {
    principalId: string;
    reviewerSource: "customer_invited" | "rateloop_network";
    workspaceId: string;
  }): Promise<PaidReviewEligibilityPreflight>;
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
const ATOMIC = /^(0|[1-9][0-9]*)$/u;
const POSITIVE_ATOMIC = /^[1-9][0-9]*$/u;
const ROUND_ID = /^(0|[1-9][0-9]*)$/u;

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
  let payoutAccount: string;
  try {
    payoutAccount = getAddress(value.payoutAccount).toLowerCase();
  } catch {
    throw new TokenlessServiceError(`${field} is invalid.`, 409, "hybrid_review_binding_invalid");
  }
  if (!isRateLoopPrincipalId(value.principalId) || !value.assignmentReference || !HASH.test(value.assignmentHash)) {
    throw new TokenlessServiceError(`${field} is invalid.`, 409, "hybrid_review_binding_invalid");
  }
  return {
    principalId: value.principalId,
    payoutAccount,
    assignmentReference: value.assignmentReference,
    assignmentHash: value.assignmentHash,
  };
}

function semanticCohort(
  value: HybridCohortSemanticProfile,
  input: { field: string; reviewerSource: "customer_invited" | "rateloop_network"; requestedCount: number },
) {
  let expertiseRequirements: ReviewerExpertiseRequirement[];
  try {
    expertiseRequirements = normalizeReviewerExpertiseRequirementsSelection(
      value.expertiseRequirements,
      input.requestedCount,
    );
  } catch {
    throw new TokenlessServiceError(
      `${input.field} specialist requirements are invalid.`,
      409,
      "hybrid_review_binding_invalid",
    );
  }
  if (
    value.panelSize !== input.requestedCount ||
    !HASH.test(value.admissionPolicyHash) ||
    value.economics.asset !== "USDC" ||
    !POSITIVE_ATOMIC.test(value.economics.bountyPerSeatAtomic) ||
    !POSITIVE_ATOMIC.test(value.economics.maximumChargeAtomic) ||
    BigInt(value.economics.maximumChargeAtomic) !==
      BigInt(value.economics.bountyPerSeatAtomic) * BigInt(input.requestedCount) ||
    expertiseRequirements.some(
      requirement =>
        requirement.sourceScope !== input.reviewerSource ||
        (input.reviewerSource === "rateloop_network" && requirement.minimumSeats !== input.requestedCount),
    )
  ) {
    throw new TokenlessServiceError(
      `${input.field} economics or expertise do not bind its exact reviewer cohort.`,
      409,
      "hybrid_review_binding_invalid",
    );
  }
  return expertiseRequirements;
}

function validate(split: FrozenHybridReviewSplit) {
  if (
    split.schemaVersion !== "rateloop.hybrid-review-split.v2" ||
    !split.workspaceId ||
    !split.opportunityId ||
    !HASH.test(split.audiencePolicyHash) ||
    !HASH.test(split.requestProfileHash) ||
    !HASH.test(split.contentCommitments.source) ||
    !HASH.test(split.contentCommitments.suggestion) ||
    split.publication.visibility !== "public" ||
    split.publication.confirmedNoSensitiveData !== true ||
    !["public", "synthetic", "redacted"].includes(split.publication.dataClassification) ||
    (split.publication.redactionSummary !== undefined &&
      (typeof split.publication.redactionSummary !== "string" || split.publication.redactionSummary.length > 1_000)) ||
    (split.publication.dataClassification === "redacted" &&
      (typeof split.publication.redactionSummary !== "string" ||
        split.publication.redactionSummary.trim().length < 10)) ||
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
  if (
    !split.semanticProfile ||
    split.semanticProfile.schemaVersion !== "rateloop.review-request-profile.v4" ||
    split.semanticProfile.audience !== "hybrid" ||
    split.semanticProfile.audiencePolicyHash !== split.audiencePolicyHash ||
    split.semanticProfile.execution !== "two_distinct_rounds" ||
    split.semanticProfile.invited.reviewerSource !== "customer_invited" ||
    split.semanticProfile.network.reviewerSource !== "rateloop_network"
  ) {
    throw new TokenlessServiceError(
      "Hybrid review requires v4 two-round request-profile semantics.",
      409,
      "hybrid_review_binding_invalid",
    );
  }
  semanticCohort(split.semanticProfile.invited, {
    field: "Invited cohort",
    reviewerSource: "customer_invited",
    requestedCount: split.invited.requestedCount,
  });
  semanticCohort(split.semanticProfile.network, {
    field: "Network cohort",
    reviewerSource: "rateloop_network",
    requestedCount: split.network.requestedCount,
  });
  if (
    split.economics.invitedMaximumChargeAtomic !== split.semanticProfile.invited.economics.maximumChargeAtomic ||
    split.economics.networkMaximumChargeAtomic !== split.semanticProfile.network.economics.maximumChargeAtomic
  ) {
    throw new TokenlessServiceError(
      "Hybrid review maximum charges do not match its v4 cohort economics.",
      409,
      "hybrid_review_binding_invalid",
    );
  }
}

function exactPreparation(value: HybridSubpanelPreparation, field: string, admissionPolicyHash: Hash) {
  let panelAddress: string;
  try {
    panelAddress = getAddress(value.round.panelAddress).toLowerCase();
  } catch {
    throw new TokenlessServiceError(`${field} round identity is invalid.`, 409, "hybrid_subpanel_not_ready");
  }
  if (
    !value.round ||
    !value.subpanelReference ||
    !HASH.test(value.bindingHash) ||
    value.status !== "ready" ||
    !value.round.deploymentKey ||
    !Number.isSafeInteger(value.round.chainId) ||
    value.round.chainId < 1 ||
    !ROUND_ID.test(value.round.roundId) ||
    value.round.admissionPolicyHash !== admissionPolicyHash
  ) {
    throw new TokenlessServiceError(`${field} did not reach an exact ready state.`, 409, "hybrid_subpanel_not_ready");
  }
  return { ...value, round: { ...value.round, panelAddress } };
}

function canonicalSplit(split: FrozenHybridReviewSplit): FrozenHybridReviewSplit {
  return {
    schemaVersion: "rateloop.hybrid-review-split.v2",
    workspaceId: split.workspaceId,
    opportunityId: split.opportunityId,
    audiencePolicyHash: split.audiencePolicyHash,
    requestProfileHash: split.requestProfileHash,
    semanticProfile: {
      schemaVersion: "rateloop.review-request-profile.v4",
      audience: "hybrid",
      audiencePolicyHash: split.semanticProfile.audiencePolicyHash,
      execution: "two_distinct_rounds",
      invited: {
        reviewerSource: "customer_invited",
        panelSize: split.semanticProfile.invited.panelSize,
        admissionPolicyHash: split.semanticProfile.invited.admissionPolicyHash,
        economics: { ...split.semanticProfile.invited.economics },
        expertiseRequirements: semanticCohort(split.semanticProfile.invited, {
          field: "Invited cohort",
          reviewerSource: "customer_invited",
          requestedCount: split.invited.requestedCount,
        }),
      },
      network: {
        reviewerSource: "rateloop_network",
        panelSize: split.semanticProfile.network.panelSize,
        admissionPolicyHash: split.semanticProfile.network.admissionPolicyHash,
        economics: { ...split.semanticProfile.network.economics },
        expertiseRequirements: semanticCohort(split.semanticProfile.network, {
          field: "Network cohort",
          reviewerSource: "rateloop_network",
          requestedCount: split.network.requestedCount,
        }),
      },
    },
    contentCommitments: {
      source: split.contentCommitments.source,
      suggestion: split.contentCommitments.suggestion,
    },
    publication: {
      visibility: "public",
      dataClassification: split.publication.dataClassification,
      confirmedNoSensitiveData: true,
      ...(typeof split.publication.redactionSummary === "string"
        ? { redactionSummary: split.publication.redactionSummary.trim() }
        : {}),
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
    requirePaidLaneComplianceApproval("hybrid_public_safe");
    validate(split);
    const frozenSplit = canonicalSplit(split);
    const invited = frozenSplit.invited.candidates;
    const invitedPrincipals = new Set(invited.map(value => value.principalId));
    const normalizedNetwork = frozenSplit.network.candidates;
    const network = normalizedNetwork.filter(value => !invitedPrincipals.has(value.principalId));
    const duplicateCount = normalizedNetwork.length - network.length;
    if (network.length !== split.network.requestedCount) {
      throw new TokenlessServiceError(
        "The frozen network subpanel has too few unique reviewers after invited-first deduplication.",
        409,
        "hybrid_subpanel_underfilled",
      );
    }
    const finalCandidates = [...invited, ...network];
    const principalSet = new Set(finalCandidates.map(value => value.principalId));
    const payoutSet = new Set(finalCandidates.map(value => value.payoutAccount));
    if (principalSet.size !== finalCandidates.length || payoutSet.size !== finalCandidates.length) {
      throw new TokenlessServiceError("Hybrid reviewers must be unique.", 409, "hybrid_review_duplicate_reviewer");
    }
    const preflightEntries = await Promise.all(
      finalCandidates
        .toSorted((left, right) => left.principalId.localeCompare(right.principalId))
        .map(async reviewer => {
          const reviewerSource = invitedPrincipals.has(reviewer.principalId) ? "customer_invited" : "rateloop_network";
          const preflight = await dependencies.requireEligibility({
            principalId: reviewer.principalId,
            reviewerSource,
            workspaceId: frozenSplit.workspaceId,
          });
          if (
            preflight.principalId !== reviewer.principalId ||
            preflight.payoutAccount.toLowerCase() !== reviewer.payoutAccount
          ) {
            throw new TokenlessServiceError(
              "Paid eligibility does not match the frozen hybrid reviewer.",
              409,
              "hybrid_review_binding_invalid",
            );
          }
          return [reviewer.principalId, preflight] as const;
        }),
    );
    const preflightByPrincipal = new Map(preflightEntries);
    const invitedPreparation = exactPreparation(
      await dependencies.prepareInvited({
        split: frozenSplit,
        candidates: invited,
        preflights: invited.map(value => preflightByPrincipal.get(value.principalId)!),
      }),
      "Invited subpanel",
      frozenSplit.semanticProfile.invited.admissionPolicyHash,
    );
    const networkPreparation = exactPreparation(
      await dependencies.prepareNetwork({
        split: frozenSplit,
        candidates: network,
        preflights: network.map(value => preflightByPrincipal.get(value.principalId)!),
      }),
      "Network subpanel",
      frozenSplit.semanticProfile.network.admissionPolicyHash,
    );
    if (
      invitedPreparation.round.chainId === networkPreparation.round.chainId &&
      invitedPreparation.round.panelAddress === networkPreparation.round.panelAddress &&
      invitedPreparation.round.roundId === networkPreparation.round.roundId
    ) {
      throw new TokenlessServiceError(
        "Hybrid cohorts must bind two distinct paid rounds.",
        409,
        "hybrid_round_identity_conflict",
      );
    }
    const splitBindingHash = sha256({
      split: frozenSplit,
      deduplicationRule: "invited_wins",
      invited: { candidates: invited, preparation: invitedPreparation },
      network: { candidates: network, preparation: networkPreparation, removedDuplicateCount: duplicateCount },
      eligibility: preflightEntries.map(([principalId, value]) => ({
        principalId,
        payoutAccount: value.payoutAccount,
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

const DEFAULT_DEPENDENCIES: HybridHumanReviewDependencies = {
  requireEligibility: input =>
    requirePaidReviewEligibility(input.principalId, new Date(), {
      reviewerSource: input.reviewerSource,
      ...(input.reviewerSource === "customer_invited" ? { workspaceId: input.workspaceId } : {}),
    }),
  async prepareInvited() {
    throw new TokenlessServiceError(
      "Hybrid invited-round settlement is not deployed.",
      503,
      "hybrid_two_round_settlement_unavailable",
      true,
    );
  },
  async prepareNetwork() {
    throw new TokenlessServiceError(
      "Hybrid network-round settlement is not deployed.",
      503,
      "hybrid_two_round_settlement_unavailable",
      true,
    );
  },
};

export const requestHybridHumanReview = createHybridHumanReviewAdapter(DEFAULT_DEPENDENCIES);

export const __hybridHumanReviewAdapterTestUtils = { sha256 };
