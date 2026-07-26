import { freezeAdmissionPolicy } from "~~/lib/tokenless/admissionPolicy";
import {
  type FrozenHybridReviewSplit,
  type HybridHumanReviewRequest,
  type HybridInvitedPrivateBinding,
  hashHybridInvitedPrivateBinding,
} from "~~/lib/tokenless/hybridHumanReviewAdapter";

export function hybridInvitedTestPolicy(panelSize: number) {
  return freezeAdmissionPolicy({
    schemaVersion: "rateloop.human-assurance.v2",
    policyId: "policy_hybrid_invited_test",
    version: 1,
    reviewerSource: "customer_invited",
    compensation: "paid",
    cohorts: [{ cohortId: "cohort_hybrid_invited_test", minimumReviewers: panelSize, maximumReviewers: panelSize }],
    selection: "customer_named",
    fallbacks: { allowed: false, sources: [] },
    requiredQualifications: [],
    assurance: {
      requirements: [
        {
          capability: "customer_invitation",
          reviewerSources: ["customer_invited"],
          allowedProviders: ["rateloop:invitation"],
        },
      ],
    },
    buyerPrivacy: {
      visibleFields: ["reviewer_source"],
      minimumAggregationSize: Math.max(2, panelSize),
      suppressSmallCells: true,
    },
    legalEligibilityRequired: true,
  });
}

export function hybridRequestForTest(
  split: FrozenHybridReviewSplit,
  reviewerAccounts: readonly string[],
): HybridHumanReviewRequest {
  const admission = hybridInvitedTestPolicy(reviewerAccounts.length);
  split.semanticProfile.invited.admissionPolicyHash = admission.policyHash;
  split.invited.candidates = [];
  const reviewers = reviewerAccounts.map(payoutAccount => ({
    principalId: `rlp_${payoutAccount.slice(2, 26)}`,
    payoutAccount: payoutAccount.toLowerCase(),
  }));
  const foundation = {
    schemaVersion: "rateloop.human-assurance.v2" as const,
    privateReviewId: "private_review_hybrid_test",
    status: "ready_for_assignment" as const,
    lane: "private" as const,
    task: { kind: "binary_review" as const, commitment: split.contentCommitments.source },
    bindings: {
      bindingHash: split.requestProfileHash,
      project: { projectId: "project_hybrid_test", hash: split.requestProfileHash },
      requestProfile: { id: "profile_hybrid_test", version: 1, hash: split.requestProfileHash },
      privateGroup: {
        groupId: "group_hybrid_test",
        policyVersion: 1,
        policyHash: split.requestProfileHash,
        allowlistHash: split.requestProfileHash,
        allowlistStatus: "allowed" as const,
      },
      cohort: { cohortId: "cohort_hybrid_invited_test", hash: split.requestProfileHash },
    },
    artifacts: {
      sourceArtifactId: "artifact_source_hybrid_test",
      suggestionArtifactId: "artifact_suggestion_hybrid_test",
    },
    responseWindowSeconds: 3_600,
    responseDeadline: "2026-07-16T13:00:00.000Z",
  };
  const seed: Omit<HybridInvitedPrivateBinding, "bindingHash"> = {
    schemaVersion: "rateloop.hybrid-invited-private-binding.v1",
    integrationId: "integration_hybrid_test",
    workflowKey: "hybrid-test",
    projectId: foundation.bindings.project.projectId,
    cohortId: foundation.bindings.cohort.cohortId,
    privateGroup: {
      id: foundation.bindings.privateGroup.groupId,
      policyVersion: foundation.bindings.privateGroup.policyVersion,
      policyHash: foundation.bindings.privateGroup.policyHash,
    },
    reviewers,
    foundation,
    admissionPolicy: admission.policy,
    selectionPolicy: { id: "selection_hybrid_test", version: 1 },
    publishingPolicy: { id: "publishing_hybrid_test", version: 1 },
    requestProfile: foundation.bindings.requestProfile,
    agent: { id: "agent_hybrid_test", versionId: "agent_version_hybrid_test" },
    responseWindowSeconds: 3_600,
  };
  return {
    split,
    principal: {
      kind: "integration",
      principal: {
        kind: "api_key",
        apiKeyId: "api_key_hybrid_test",
        workspaceId: split.workspaceId,
        role: "owner",
      },
      integration: {
        integrationId: seed.integrationId,
        workspaceId: split.workspaceId,
        agentId: seed.agent.id,
        agentVersionId: seed.agent.versionId,
      },
    } as HybridHumanReviewRequest["principal"],
    appOrigin: "https://rateloop-tokenless.vercel.app",
    sourcePayload: "Public-safe source.",
    suggestionPayload: "Public-safe suggestion.",
    effectiveQuestion: {
      schemaVersion: "rateloop.binary-review-question.v1",
      kind: "binary",
      prompt: "Is this suggestion appropriate?",
      positiveLabel: "Yes",
      negativeLabel: "No",
      rationaleMode: "optional",
      questionAuthority: "owner_fixed",
      resultSemantics: "assurance",
    },
    effectiveQuestionHash: split.requestProfileHash,
    invitedBinding: {
      ...seed,
      bindingHash: hashHybridInvitedPrivateBinding(seed),
    },
    now: new Date("2026-07-16T12:00:00.000Z"),
  };
}
