import type { HumanAssuranceAudiencePolicy, HumanAssurancePrivateReviewCreateResponse } from "@rateloop/sdk";
import { createHash } from "node:crypto";
import "server-only";
import { getAddress } from "viem";
import { isRateLoopPrincipalId } from "~~/lib/auth/accountSubject";
import { freezeAdmissionPolicy } from "~~/lib/tokenless/admissionPolicy";
import type { AgentMcpPrincipal } from "~~/lib/tokenless/agentIntegrations";
import type { FrozenBinaryReviewQuestion } from "~~/lib/tokenless/humanReviewQuestions";
import {
  hashPreparedHumanReviewValue,
  prepareHumanReviewRequest,
} from "~~/lib/tokenless/humanReviewRequestPreparation";
import {
  type HybridChildParentBinding,
  deriveHybridCohortEconomics,
  hashHybridCohortEconomics,
  hashHybridCohortExpertise,
} from "~~/lib/tokenless/hybridReviewChildBindings";
import {
  type HybridReviewChildSeed,
  type HybridReviewParentSeed,
  type PersistedHybridReviewChild,
  cancelHybridReviewBeforeLiability,
  completeHybridReviewPreparation,
  ensureHybridReviewOperation,
  recordHybridReviewChildReady,
} from "~~/lib/tokenless/hybridReviewOrchestration";
import { requirePaidLaneComplianceApproval } from "~~/lib/tokenless/paidLaneCompliance";
import {
  type PaidReviewEligibilityPreflight,
  type PaidReviewerBinding,
  requirePaidReviewEligibility,
} from "~~/lib/tokenless/paidReviewEligibilityPreflight";
import {
  type PrivatePaidHumanReviewDelivery,
  requestPrivatePaidHumanReview,
} from "~~/lib/tokenless/privatePaidHumanReviewAdapter";
import {
  releasePublicPaidNetworkChild,
  requestPublicPaidNetworkChild,
} from "~~/lib/tokenless/publicPaidHumanReviewAdapter";
import {
  type ReviewerExpertiseRequirement,
  normalizeReviewerExpertiseRequirementsSelection,
} from "~~/lib/tokenless/reviewerExpertiseOptions";
import { TokenlessServiceError } from "~~/lib/tokenless/server";

type Hash = `sha256:${string}`;
type IntegrationPrincipal = Extract<AgentMcpPrincipal, { kind: "integration" }>;

export type HybridReviewCandidate = {
  principalId: string;
  payoutAccount: string;
  assignmentReference: string;
  assignmentHash: Hash;
};

export type FrozenHybridReviewSplit = {
  schemaVersion: "rateloop.hybrid-review-split.v3";
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
  sourceOperationReference: string;
  sourceRunId: string;
  chainAdmissionPolicyHash: `0x${string}`;
  selectedSeatEvidenceHash: Hash;
  voucherPreparationHash: Hash;
  settlementBindingHash: Hash;
  round: HybridRoundIdentity;
  status: "ready";
  replayed: boolean;
};

export type HybridHumanReviewResult = {
  schemaVersion: "rateloop.hybrid-human-review.v1";
  hybridOperationId: string;
  opportunityId: string;
  lane: "hybrid_public_safe";
  deduplicationRule: "invited_wins";
  invited: HybridSubpanelPreparation & { reviewerCount: number };
  network: HybridSubpanelPreparation & { reviewerCount: number; removedDuplicateCount: number };
  splitBindingHash: Hash;
};

export type HybridHumanReviewRequest = {
  split: FrozenHybridReviewSplit;
  principal: IntegrationPrincipal;
  appOrigin: string;
  sourcePayload: string;
  suggestionPayload: string;
  effectiveQuestion: FrozenBinaryReviewQuestion;
  effectiveQuestionHash: Hash;
  invitedBinding: HybridInvitedPrivateBinding;
  now?: Date;
};

export type HybridInvitedPrivateBinding = {
  schemaVersion: "rateloop.hybrid-invited-private-binding.v1";
  bindingHash: Hash;
  integrationId: string;
  workflowKey: string;
  projectId: string;
  cohortId: string;
  privateGroup: { id: string; policyVersion: number; policyHash: Hash };
  reviewers: readonly PaidReviewerBinding[];
  foundation: HumanAssurancePrivateReviewCreateResponse;
  admissionPolicy: HumanAssuranceAudiencePolicy;
  selectionPolicy: { id: string; version: number };
  publishingPolicy: { id: string; version: number };
  requestProfile: { id: string; version: number; hash: Hash };
  agent: { id: string; versionId: string };
  responseWindowSeconds: number;
};

export type HybridHumanReviewOrchestrationDependencies = {
  ensure(seed: HybridReviewParentSeed, now: Date): ReturnType<typeof ensureHybridReviewOperation>;
  recordReady(
    input: Parameters<typeof recordHybridReviewChildReady>[0],
  ): ReturnType<typeof recordHybridReviewChildReady>;
  complete(
    input: Parameters<typeof completeHybridReviewPreparation>[0],
  ): ReturnType<typeof completeHybridReviewPreparation>;
  cancel(input: {
    hybridOperationId: string;
    reasonCode: string;
    releaseChildren: (children: readonly PersistedHybridReviewChild[]) => Promise<void>;
    now?: Date;
  }): ReturnType<typeof cancelHybridReviewBeforeLiability>;
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
    hybridParent: HybridChildParentBinding;
    request?: Omit<HybridHumanReviewRequest, "split">;
  }): Promise<HybridSubpanelPreparation>;
  prepareNetwork(input: {
    split: FrozenHybridReviewSplit;
    candidates: readonly HybridReviewCandidate[];
    preflights: readonly PaidReviewEligibilityPreflight[];
    hybridParent: HybridChildParentBinding;
    request?: Omit<HybridHumanReviewRequest, "split" | "invitedBinding">;
  }): Promise<HybridSubpanelPreparation>;
  releaseInvited(preparation: HybridSubpanelPreparation): Promise<void>;
  releaseNetwork(preparation: HybridSubpanelPreparation): Promise<void>;
  orchestration: HybridHumanReviewOrchestrationDependencies;
  clock?: () => Date;
};

const HASH = /^sha256:[0-9a-f]{64}$/u;
const ATOMIC = /^(0|[1-9][0-9]*)$/u;
const POSITIVE_ATOMIC = /^[1-9][0-9]*$/u;
const ROUND_ID = /^(0|[1-9][0-9]*)$/u;

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
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

export function hashHybridInvitedPrivateBinding(value: Omit<HybridInvitedPrivateBinding, "bindingHash">): Hash {
  return sha256({
    schemaVersion: "rateloop.hybrid-invited-private-binding.v1",
    integrationId: value.integrationId,
    workflowKey: value.workflowKey,
    projectId: value.projectId,
    cohortId: value.cohortId,
    privateGroup: value.privateGroup,
    reviewers: value.reviewers,
    foundation: {
      privateReviewId: value.foundation.privateReviewId,
      taskCommitment: value.foundation.task.commitment,
      bindingHash: value.foundation.bindings.bindingHash,
      project: value.foundation.bindings.project,
      requestProfile: value.foundation.bindings.requestProfile,
      privateGroup: value.foundation.bindings.privateGroup,
      cohort: value.foundation.bindings.cohort,
      artifacts: value.foundation.artifacts,
      responseDeadline: value.foundation.responseDeadline,
    },
    admissionPolicy: value.admissionPolicy,
    selectionPolicy: value.selectionPolicy,
    publishingPolicy: value.publishingPolicy,
    requestProfile: value.requestProfile,
    agent: value.agent,
    responseWindowSeconds: value.responseWindowSeconds,
  });
}

function exactInvitedBinding(
  split: FrozenHybridReviewSplit,
  request: HybridHumanReviewRequest | undefined,
): {
  binding: HybridInvitedPrivateBinding;
  candidates: HybridReviewCandidate[];
} {
  const binding = request?.invitedBinding;
  if (!binding) {
    throw new TokenlessServiceError(
      "Hybrid invited review requires a server-derived private binding.",
      409,
      "hybrid_review_binding_invalid",
    );
  }
  const foundation = binding.foundation;
  const frozen = freezeAdmissionPolicy(binding.admissionPolicy);
  const { bindingHash: _bindingHash, ...hashInput } = binding;
  if (
    binding.schemaVersion !== "rateloop.hybrid-invited-private-binding.v1" ||
    binding.bindingHash !== hashHybridInvitedPrivateBinding(hashInput) ||
    binding.integrationId !== request.principal.integration.integrationId ||
    binding.reviewers.length !== split.invited.requestedCount ||
    foundation.status !== "ready_for_assignment" ||
    foundation.bindings.project.projectId !== binding.projectId ||
    foundation.bindings.cohort.cohortId !== binding.cohortId ||
    foundation.bindings.privateGroup.groupId !== binding.privateGroup.id ||
    foundation.bindings.privateGroup.policyVersion !== binding.privateGroup.policyVersion ||
    foundation.bindings.privateGroup.policyHash !== binding.privateGroup.policyHash ||
    foundation.bindings.requestProfile.id !== binding.requestProfile.id ||
    foundation.bindings.requestProfile.version !== binding.requestProfile.version ||
    foundation.bindings.requestProfile.hash !== binding.requestProfile.hash ||
    frozen.policyHash !== split.semanticProfile.invited.admissionPolicyHash ||
    binding.responseWindowSeconds < 1
  ) {
    throw new TokenlessServiceError(
      "Hybrid invited review does not match its exact server-derived private foundation.",
      409,
      "hybrid_review_binding_invalid",
    );
  }
  const normalized = binding.reviewers
    .map((reviewer, index) => {
      let payoutAccount: string;
      try {
        payoutAccount = getAddress(reviewer.payoutAccount).toLowerCase();
      } catch {
        throw new TokenlessServiceError(
          `Invited reviewer ${index + 1} is invalid.`,
          409,
          "hybrid_review_binding_invalid",
        );
      }
      if (!isRateLoopPrincipalId(reviewer.principalId)) {
        throw new TokenlessServiceError(
          `Invited reviewer ${index + 1} is invalid.`,
          409,
          "hybrid_review_binding_invalid",
        );
      }
      return { principalId: reviewer.principalId, payoutAccount };
    })
    .sort((left, right) => left.payoutAccount.localeCompare(right.payoutAccount));
  if (
    new Set(normalized.map(value => value.principalId)).size !== normalized.length ||
    new Set(normalized.map(value => value.payoutAccount)).size !== normalized.length
  ) {
    throw new TokenlessServiceError("Hybrid invited reviewers must be unique.", 409, "hybrid_review_binding_invalid");
  }
  return {
    binding,
    candidates: normalized.map(reviewer => ({
      ...reviewer,
      assignmentReference: `${foundation.privateReviewId}:${reviewer.principalId}`,
      assignmentHash: sha256({
        schemaVersion: "rateloop.hybrid-invited-reviewer.v1",
        bindingHash: binding.bindingHash,
        principalId: reviewer.principalId,
        payoutAccount: reviewer.payoutAccount,
      }),
    })),
  };
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
  let derivedEconomics;
  try {
    derivedEconomics = deriveHybridCohortEconomics(value.economics.bountyPerSeatAtomic, input.requestedCount);
  } catch {
    throw new TokenlessServiceError(
      `${input.field} economics or expertise do not bind its exact reviewer cohort.`,
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
    value.economics.maximumChargeAtomic !== derivedEconomics.maximumChargeAtomic ||
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
    split.schemaVersion !== "rateloop.hybrid-review-split.v3" ||
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
    split.invited.candidates.length !== 0 ||
    split.network.candidates.length !== 0
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

function exactPreparation(
  value: HybridSubpanelPreparation,
  input: {
    field: string;
    admissionPolicyHash: Hash;
    sourceKind: "private_paid_assignment" | "public_network_assignment";
  },
) {
  let panelAddress: string;
  try {
    panelAddress = getAddress(value.round.panelAddress).toLowerCase();
  } catch {
    throw new TokenlessServiceError(`${input.field} round identity is invalid.`, 409, "hybrid_subpanel_not_ready");
  }
  if (
    !value.round ||
    !value.subpanelReference ||
    !value.sourceOperationReference ||
    !value.sourceRunId ||
    !HASH.test(value.bindingHash) ||
    !/^0x[0-9a-f]{64}$/u.test(value.chainAdmissionPolicyHash) ||
    !HASH.test(value.selectedSeatEvidenceHash) ||
    !HASH.test(value.voucherPreparationHash) ||
    !HASH.test(value.settlementBindingHash) ||
    value.status !== "ready" ||
    !value.round.deploymentKey ||
    !Number.isSafeInteger(value.round.chainId) ||
    value.round.chainId < 1 ||
    !ROUND_ID.test(value.round.roundId) ||
    value.round.admissionPolicyHash !== input.admissionPolicyHash
  ) {
    throw new TokenlessServiceError(
      `${input.field} did not reach an exact ready state.`,
      409,
      "hybrid_subpanel_not_ready",
    );
  }
  return { ...value, round: { ...value.round, panelAddress } };
}

function canonicalSplit(
  split: FrozenHybridReviewSplit,
  invitedCandidates: readonly HybridReviewCandidate[],
): FrozenHybridReviewSplit {
  return {
    schemaVersion: "rateloop.hybrid-review-split.v3",
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
      candidates: invitedCandidates.map((value, index) => candidate(value, `Invited candidate ${index + 1}`)),
    },
    network: {
      requestedCount: split.network.requestedCount,
      candidates: split.network.candidates.map((value, index) => candidate(value, `Network candidate ${index + 1}`)),
    },
  };
}

function childSeed(
  cohort: "invited" | "network",
  split: FrozenHybridReviewSplit,
  candidates: readonly HybridReviewCandidate[],
  excludedReviewers: readonly HybridReviewCandidate[] = [],
): HybridReviewChildSeed {
  const profile = split.semanticProfile[cohort];
  return {
    cohort,
    childBindingHash: sha256({
      schemaVersion: "rateloop.hybrid-child-binding.v1",
      workspaceId: split.workspaceId,
      opportunityId: split.opportunityId,
      cohort,
      candidates,
      excludedReviewers: excludedReviewers.map(value => ({
        principalId: value.principalId,
        payoutAccount: value.payoutAccount,
      })),
      admissionPolicyHash: profile.admissionPolicyHash,
      economics: profile.economics,
      expertiseRequirements: profile.expertiseRequirements,
    }),
    economicsHash: hashHybridCohortEconomics(profile.economics.bountyPerSeatAtomic, profile.panelSize),
    expertiseHash: hashHybridCohortExpertise(cohort, profile.expertiseRequirements),
    admissionPolicyHash: profile.admissionPolicyHash,
    expectedAmountAtomic: profile.economics.maximumChargeAtomic,
    assignmentCount: profile.panelSize,
  };
}

function parentBinding(
  child: HybridReviewChildSeed,
  hybridOperationId: string,
  profile: HybridCohortSemanticProfile,
  excludedReviewers: readonly HybridReviewCandidate[] = [],
): HybridChildParentBinding {
  return {
    hybridOperationId,
    cohortBindingHash: child.childBindingHash,
    economicsHash: child.economicsHash,
    expertiseHash: child.expertiseHash,
    requestedCount: child.assignmentCount,
    admissionPolicyHash: child.admissionPolicyHash,
    expertiseRequirements: profile.expertiseRequirements,
    excludedReviewers: excludedReviewers.map(value => ({
      principalId: value.principalId,
      payoutAccount: value.payoutAccount,
    })),
  };
}

function retryable(error: unknown) {
  return error instanceof TokenlessServiceError && error.retryable;
}

function preparationBinding(preparation: HybridSubpanelPreparation) {
  return {
    subpanelReference: preparation.subpanelReference,
    bindingHash: preparation.bindingHash,
    sourceOperationReference: preparation.sourceOperationReference,
    sourceRunId: preparation.sourceRunId,
    chainAdmissionPolicyHash: preparation.chainAdmissionPolicyHash,
    selectedSeatEvidenceHash: preparation.selectedSeatEvidenceHash,
    voucherPreparationHash: preparation.voucherPreparationHash,
    settlementBindingHash: preparation.settlementBindingHash,
    round: preparation.round,
    status: preparation.status,
  };
}

function invitedPreparation(
  delivery: PrivatePaidHumanReviewDelivery,
  parent: HybridChildParentBinding,
): HybridSubpanelPreparation {
  const assignmentEvidence = delivery.encryptedDelivery.assignments.map(assignment => ({
    assignmentId: assignment.assignmentId,
    reviewerAccountAddress: assignment.reviewerAccountAddress.toLowerCase(),
    reservationExpiresAt: assignment.reservationExpiresAt,
  }));
  const vouchers = delivery.vouchers.map(value => ({
    assignmentId: value.assignmentId,
    reviewerAccountAddress: value.reviewerAccountAddress.toLowerCase(),
    issuanceId: value.issuance.issuanceId,
    eligibilitySnapshotHash: value.issuance.frozen.eligibilitySnapshotHash,
    audienceBindingHash: value.issuance.frozen.audienceBindingHash,
  }));
  return {
    subpanelReference: delivery.encryptedDelivery.deliveryId,
    bindingHash: parent.cohortBindingHash,
    sourceOperationReference: delivery.funding.operationId,
    sourceRunId: delivery.encryptedDelivery.deliveryId,
    chainAdmissionPolicyHash: `0x${parent.admissionPolicyHash.slice("sha256:".length)}`,
    selectedSeatEvidenceHash: sha256({
      schemaVersion: "rateloop.hybrid-invited-seat-evidence.v1",
      privateReviewId: delivery.privateReviewId,
      deliveryId: delivery.encryptedDelivery.deliveryId,
      membershipSnapshotHash: delivery.encryptedDelivery.membershipSnapshotHash,
      assignments: assignmentEvidence,
    }),
    voucherPreparationHash: sha256({
      schemaVersion: "rateloop.hybrid-invited-voucher-evidence.v1",
      operationId: delivery.funding.operationId,
      vouchers,
    }),
    settlementBindingHash: sha256({
      schemaVersion: "rateloop.hybrid-invited-settlement-binding.v1",
      operationId: delivery.funding.operationId,
      operationReference: delivery.funding.operationReference,
      funding: {
        prepaidReservationId: delivery.funding.prepaidReservationId,
        policyReservationId: delivery.funding.policyReservationId,
        amountAtomic: delivery.funding.amountAtomic,
      },
      deliveryId: delivery.encryptedDelivery.deliveryId,
      assignments: assignmentEvidence,
      vouchers,
    }),
    round: {
      ...delivery.funding.round,
      admissionPolicyHash: parent.admissionPolicyHash,
    },
    status: "ready",
    replayed: delivery.funding.replayed,
  };
}

function adapterInput(input: FrozenHybridReviewSplit | HybridHumanReviewRequest) {
  if ("split" in input) return { split: input.split, request: input };
  return { split: input, request: undefined };
}

function publicChildRequest(
  request: HybridHumanReviewRequest,
): Omit<HybridHumanReviewRequest, "split" | "invitedBinding"> {
  const { split: _split, invitedBinding: _invitedBinding, ...publicRequest } = request;
  return publicRequest;
}

function privateChildRequest(request: HybridHumanReviewRequest): Omit<HybridHumanReviewRequest, "split"> {
  const { split: _split, ...privateRequest } = request;
  return privateRequest;
}

export function createHybridHumanReviewAdapter(dependencies: HybridHumanReviewDependencies) {
  return async function requestHybridHumanReview(
    input: FrozenHybridReviewSplit | HybridHumanReviewRequest,
  ): Promise<HybridHumanReviewResult> {
    const { split, request } = adapterInput(input);
    requirePaidLaneComplianceApproval("hybrid_public_safe");
    validate(split);
    const exactInvited = exactInvitedBinding(split, request);
    const frozenSplit = canonicalSplit(split, exactInvited.candidates);
    const invited = frozenSplit.invited.candidates;
    const invitedPrincipals = new Set(invited.map(value => value.principalId));
    const network: HybridReviewCandidate[] = [];
    const duplicateCount = 0;
    const finalCandidates = invited;
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
    const invitedSeed = childSeed("invited", frozenSplit, invited);
    const networkSeed = childSeed("network", frozenSplit, network, invited);
    const now = request?.now ?? dependencies.clock?.() ?? new Date();
    const parentSeed: HybridReviewParentSeed = {
      workspaceId: frozenSplit.workspaceId,
      opportunityId: frozenSplit.opportunityId,
      parentBindingHash: sha256({
        schemaVersion: "rateloop.hybrid-parent-binding.v1",
        split: frozenSplit,
        deduplicationRule: "invited_wins",
        invited: invitedSeed,
        network: networkSeed,
      }),
      requestProfileHash: frozenSplit.requestProfileHash,
      audiencePolicyHash: frozenSplit.audiencePolicyHash,
      sourceCommitment: frozenSplit.contentCommitments.source,
      suggestionCommitment: frozenSplit.contentCommitments.suggestion,
      children: [invitedSeed, networkSeed],
    };
    const ensured = await dependencies.orchestration.ensure(parentSeed, now);
    let invitedPreparation: HybridSubpanelPreparation | undefined;
    let networkPreparation: HybridSubpanelPreparation | undefined;
    const cancelPrepared = (reasonCode: string) =>
      dependencies.orchestration.cancel({
        hybridOperationId: ensured.operation.hybridOperationId,
        reasonCode,
        releaseChildren: async () => {
          await Promise.all([
            ...(invitedPreparation ? [dependencies.releaseInvited(invitedPreparation)] : []),
            ...(networkPreparation ? [dependencies.releaseNetwork(networkPreparation)] : []),
          ]);
        },
        now,
      });
    try {
      invitedPreparation = exactPreparation(
        await dependencies.prepareInvited({
          split: frozenSplit,
          candidates: invited,
          preflights: invited.map(value => preflightByPrincipal.get(value.principalId)!),
          hybridParent: parentBinding(
            invitedSeed,
            ensured.operation.hybridOperationId,
            frozenSplit.semanticProfile.invited,
          ),
          ...(request ? { request: privateChildRequest(request) } : {}),
        }),
        {
          field: "Invited subpanel",
          admissionPolicyHash: frozenSplit.semanticProfile.invited.admissionPolicyHash,
          sourceKind: "private_paid_assignment",
        },
      );
      await dependencies.orchestration.recordReady({
        hybridOperationId: ensured.operation.hybridOperationId,
        cohort: "invited",
        evidence: {
          sourceKind: "private_paid_assignment",
          sourceOperationReference: invitedPreparation.sourceOperationReference,
          sourceRunId: invitedPreparation.sourceRunId,
          deploymentKey: invitedPreparation.round.deploymentKey,
          chainId: invitedPreparation.round.chainId,
          panelAddress: invitedPreparation.round.panelAddress,
          roundId: invitedPreparation.round.roundId,
          chainAdmissionPolicyHash: invitedPreparation.chainAdmissionPolicyHash,
          assignmentEvidenceHash: invitedPreparation.selectedSeatEvidenceHash,
          voucherPreparationHash: invitedPreparation.voucherPreparationHash,
          settlementBindingHash: invitedPreparation.settlementBindingHash,
        },
        now,
      });
      networkPreparation = exactPreparation(
        await dependencies.prepareNetwork({
          split: frozenSplit,
          candidates: network,
          preflights: network.map(value => preflightByPrincipal.get(value.principalId)!),
          hybridParent: parentBinding(
            networkSeed,
            ensured.operation.hybridOperationId,
            frozenSplit.semanticProfile.network,
            invited,
          ),
          ...(request ? { request: publicChildRequest(request) } : {}),
        }),
        {
          field: "Network subpanel",
          admissionPolicyHash: frozenSplit.semanticProfile.network.admissionPolicyHash,
          sourceKind: "public_network_assignment",
        },
      );
      await dependencies.orchestration.recordReady({
        hybridOperationId: ensured.operation.hybridOperationId,
        cohort: "network",
        evidence: {
          sourceKind: "public_network_assignment",
          sourceOperationReference: networkPreparation.sourceOperationReference,
          sourceRunId: networkPreparation.sourceRunId,
          deploymentKey: networkPreparation.round.deploymentKey,
          chainId: networkPreparation.round.chainId,
          panelAddress: networkPreparation.round.panelAddress,
          roundId: networkPreparation.round.roundId,
          chainAdmissionPolicyHash: networkPreparation.chainAdmissionPolicyHash,
          assignmentEvidenceHash: networkPreparation.selectedSeatEvidenceHash,
          voucherPreparationHash: networkPreparation.voucherPreparationHash,
          settlementBindingHash: networkPreparation.settlementBindingHash,
        },
        now,
      });
    } catch (error) {
      if (invitedPreparation || networkPreparation) {
        throw new TokenlessServiceError(
          "A funded hybrid child is waiting for exact retryable sibling preparation.",
          409,
          "hybrid_child_preparation_pending",
          true,
        );
      }
      if (!retryable(error)) await cancelPrepared("child_preparation_failed");
      throw error;
    }
    if (!invitedPreparation || !networkPreparation) {
      throw new Error("Hybrid child preparation completed without exact child evidence.");
    }
    if (
      invitedPreparation.round.deploymentKey === networkPreparation.round.deploymentKey &&
      invitedPreparation.round.chainId === networkPreparation.round.chainId &&
      invitedPreparation.round.panelAddress === networkPreparation.round.panelAddress &&
      invitedPreparation.round.roundId === networkPreparation.round.roundId
    ) {
      const error = new TokenlessServiceError(
        "Hybrid cohorts must bind two distinct paid rounds.",
        409,
        "hybrid_round_identity_conflict",
      );
      await cancelPrepared("round_identity_conflict");
      throw error;
    }
    const splitBindingHash = sha256({
      split: frozenSplit,
      deduplicationRule: "invited_wins",
      invited: { candidates: invited, preparation: preparationBinding(invitedPreparation) },
      network: {
        candidates: network,
        preparation: preparationBinding(networkPreparation),
        removedDuplicateCount: duplicateCount,
      },
      eligibility: preflightEntries.map(([principalId, value]) => ({
        principalId,
        payoutAccount: value.payoutAccount,
        preflightId: value.preflightId,
        commitment: value.eligibilityCommitment,
      })),
    });
    await dependencies.orchestration.complete({
      hybridOperationId: ensured.operation.hybridOperationId,
      preparationEvidenceHash: splitBindingHash,
      now,
    });
    return {
      schemaVersion: "rateloop.hybrid-human-review.v1",
      hybridOperationId: ensured.operation.hybridOperationId,
      opportunityId: split.opportunityId,
      lane: "hybrid_public_safe",
      deduplicationRule: "invited_wins",
      invited: { ...invitedPreparation, reviewerCount: invited.length },
      network: {
        ...networkPreparation,
        reviewerCount: frozenSplit.network.requestedCount,
        removedDuplicateCount: duplicateCount,
      },
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
  async prepareInvited({ split, hybridParent, request }) {
    const binding = request?.invitedBinding;
    if (!request || !binding) {
      throw new TokenlessServiceError(
        "Hybrid invited-round request context is unavailable.",
        503,
        "hybrid_two_round_settlement_unavailable",
        true,
      );
    }
    const preparedAt = request.now ?? new Date();
    const prepared = prepareHumanReviewRequest({
      opportunityId: split.opportunityId,
      workflowKey: binding.workflowKey,
      requestProfile: {
        id: binding.requestProfile.id,
        version: binding.requestProfile.version,
        hash: binding.requestProfile.hash,
        agentId: binding.agent.id,
        agentVersionId: binding.agent.versionId,
        questionAuthority: request.effectiveQuestion.questionAuthority,
        resultSemantics: request.effectiveQuestion.resultSemantics,
        criterion: request.effectiveQuestion.prompt,
        positiveLabel: request.effectiveQuestion.positiveLabel,
        negativeLabel: request.effectiveQuestion.negativeLabel,
        rationaleMode: request.effectiveQuestion.rationaleMode,
        audience: "private_invited",
        contentBoundary: "private_workspace",
        privateSensitivity: "internal",
        privateGroupId: binding.privateGroup.id,
        requiredExpertiseKeys: [],
        expertiseRequirements: hybridParent.expertiseRequirements,
        responseWindowSeconds: binding.responseWindowSeconds,
        panelSize: hybridParent.requestedCount,
        compensationMode: "usdc",
        bountyPerSeatAtomic: split.semanticProfile.invited.economics.bountyPerSeatAtomic,
      },
      selectionPolicy: binding.selectionPolicy,
      contentCommitments: split.contentCommitments,
      preparedAt,
      expiresAt: new Date(preparedAt.getTime() + binding.responseWindowSeconds * 1_000),
      sourcePayload: request.sourcePayload,
      suggestionPayload: request.suggestionPayload,
      effectiveQuestion: request.effectiveQuestion,
      effectiveQuestionHash: request.effectiveQuestionHash,
    });
    if (
      prepared.preparedRequestHash !== hashPreparedHumanReviewValue(prepared.preparedRequest) ||
      prepared.derivedEconomicsHash !== hybridParent.economicsHash
    ) {
      throw new TokenlessServiceError(
        "Hybrid invited economics do not match the frozen child tuple.",
        409,
        "hybrid_review_child_conflict",
      );
    }
    return invitedPreparation(
      await requestPrivatePaidHumanReview({
        principal: request.principal.principal,
        appOrigin: request.appOrigin,
        integrationId: binding.integrationId,
        opportunityId: split.opportunityId,
        privateReviewId: binding.foundation.privateReviewId,
        projectId: binding.projectId,
        cohortId: binding.cohortId,
        privateGroup: binding.privateGroup,
        reviewers: binding.reviewers,
        audiencePolicyHash: hybridParent.admissionPolicyHash,
        admissionPolicy: binding.admissionPolicy,
        publishingPolicy: binding.publishingPolicy,
        preparedRequest: prepared.preparedRequest,
        preparedRequestHash: prepared.preparedRequestHash,
        economics: prepared.derivedEconomics,
        economicsHash: prepared.derivedEconomicsHash,
        now: preparedAt,
      }),
      hybridParent,
    );
  },
  async prepareNetwork({ split, hybridParent, request }) {
    if (!request) {
      throw new TokenlessServiceError(
        "Hybrid network-round request context is unavailable.",
        503,
        "hybrid_two_round_settlement_unavailable",
        true,
      );
    }
    return requestPublicPaidNetworkChild({
      principal: request.principal,
      opportunityId: split.opportunityId,
      sourcePayload: request.sourcePayload,
      suggestionPayload: request.suggestionPayload,
      publication: split.publication,
      appOrigin: request.appOrigin,
      effectiveQuestion: request.effectiveQuestion,
      effectiveQuestionHash: request.effectiveQuestionHash,
      hybridParent,
    });
  },
  async releaseInvited() {
    throw new TokenlessServiceError(
      "A funded invited child remains pending until its protocol round reaches a terminal settlement.",
      409,
      "hybrid_invited_child_release_pending",
      true,
    );
  },
  async releaseNetwork(preparation) {
    await releasePublicPaidNetworkChild(preparation);
  },
  orchestration: {
    ensure: ensureHybridReviewOperation,
    recordReady: recordHybridReviewChildReady,
    complete: completeHybridReviewPreparation,
    cancel: cancelHybridReviewBeforeLiability,
  },
};

const hybridHumanReviewAdapter = createHybridHumanReviewAdapter(DEFAULT_DEPENDENCIES);

export function requestHybridHumanReview(input: HybridHumanReviewRequest) {
  return hybridHumanReviewAdapter(input);
}

export const __hybridHumanReviewAdapterTestUtils = { sha256 };
