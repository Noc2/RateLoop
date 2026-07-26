import assert from "node:assert/strict";
import { test } from "node:test";
import {
  type FrozenHybridReviewSplit,
  type HybridHumanReviewDependencies,
  createHybridHumanReviewAdapter,
} from "~~/lib/tokenless/hybridHumanReviewAdapter";
import { hybridRequestForTest } from "~~/lib/tokenless/hybridHumanReviewTestFixtures";
import { TokenlessServiceError } from "~~/lib/tokenless/server";

const HASH = `sha256:${"7".repeat(64)}` as const;
const INVITED = "0x1111111111111111111111111111111111111111";
const NETWORK = "0x2222222222222222222222222222222222222222";

function candidate(payoutAccount: string, assignmentReference: string) {
  return {
    principalId: `rlp_${payoutAccount.slice(2, 26)}`,
    payoutAccount,
    assignmentReference,
    assignmentHash: HASH,
  };
}

function preparationEvidence(cohort: "invited" | "network") {
  return {
    sourceOperationReference: `${cohort}:operation`,
    sourceRunId: `${cohort}:run`,
    chainAdmissionPolicyHash: `0x${(cohort === "invited" ? "1" : "2").repeat(64)}` as `0x${string}`,
    selectedSeatEvidenceHash: HASH,
    voucherPreparationHash: HASH,
    settlementBindingHash: HASH,
  };
}

function orchestration() {
  return {
    ensure: async () =>
      ({
        operation: { hybridOperationId: "hybrid_security_test" },
        replayed: false,
      }) as any,
    recordReady: async () => ({ replayed: false }) as any,
    complete: async () => ({ replayed: false }) as any,
    cancel: async (input: any) => {
      await input.releaseChildren([]);
      return { replayed: false } as any;
    },
  };
}

function split(): FrozenHybridReviewSplit {
  return {
    schemaVersion: "rateloop.hybrid-review-split.v3",
    workspaceId: "ws_hybrid_security",
    opportunityId: "opportunity_hybrid_security",
    audiencePolicyHash: HASH,
    requestProfileHash: HASH,
    semanticProfile: {
      schemaVersion: "rateloop.review-request-profile.v4",
      audience: "hybrid",
      audiencePolicyHash: HASH,
      execution: "two_distinct_rounds",
      invited: {
        reviewerSource: "customer_invited",
        panelSize: 1,
        admissionPolicyHash: HASH,
        economics: { asset: "USDC", bountyPerSeatAtomic: "1000000", maximumChargeAtomic: "1900000" },
        expertiseRequirements: [],
      },
      network: {
        reviewerSource: "rateloop_network",
        panelSize: 1,
        admissionPolicyHash: HASH,
        economics: { asset: "USDC", bountyPerSeatAtomic: "1000000", maximumChargeAtomic: "1900000" },
        expertiseRequirements: [],
      },
    },
    contentCommitments: { source: HASH, suggestion: HASH },
    publication: {
      visibility: "public",
      dataClassification: "redacted",
      confirmedNoSensitiveData: true,
      redactionSummary: "Customer identifiers were removed from the public review copy.",
    },
    economics: { asset: "USDC", invitedMaximumChargeAtomic: "1900000", networkMaximumChargeAtomic: "1900000" },
    invited: {
      requestedCount: 1,
      candidates: [],
    },
    network: {
      requestedCount: 1,
      candidates: [],
    },
  };
}

function preflight(principalId: string) {
  const accountAddress = [INVITED, NETWORK].find(account => candidate(account, "unused").principalId === principalId)!;
  return {
    schemaVersion: "rateloop.paid-review-eligibility-preflight.v1" as const,
    preflightId: `pef_${accountAddress.slice(2)}` as `pef_${string}`,
    raterId: `rater_${accountAddress.slice(2)}` as `rater_${string}`,
    principalId,
    accountAddress,
    payoutAccount: accountAddress,
    identityAssertions: [],
    checkedAt: "2026-07-16T12:00:00.000Z",
    validUntil: "2026-07-16T13:00:00.000Z",
    eligibilityCommitment: HASH,
  };
}

test("hybrid callbacks receive only the canonical public-safe split and candidate fields", async () => {
  const leakedSecret = "private-client-source-must-never-cross-the-hybrid-seam";
  const input = structuredClone(split()) as unknown as Record<string, any>;
  input.privateSourcePayload = leakedSecret;
  input.contentCommitments.privateSourcePayload = leakedSecret;
  input.publication.privateSuggestionPayload = leakedSecret;
  input.economics.privateBillingNote = leakedSecret;
  input.invited.privateAssignmentPayload = leakedSecret;
  input.network.privatePublicationPayload = leakedSecret;

  const callbackInputs: unknown[] = [];
  const dependencies: HybridHumanReviewDependencies = {
    requireCompliance() {},
    requireEligibility: async ({ principalId }) => preflight(principalId),
    prepareInvited: async value => {
      callbackInputs.push(value);
      return {
        subpanelReference: "hybrid:invited",
        bindingHash: HASH,
        ...preparationEvidence("invited"),
        round: {
          deploymentKey: "base-sepolia",
          chainId: 84532,
          panelAddress: "0x4444444444444444444444444444444444444444",
          roundId: "1",
          admissionPolicyHash: value.hybridParent.admissionPolicyHash,
        },
        status: "ready",
        replayed: false,
      };
    },
    prepareNetwork: async value => {
      callbackInputs.push(value);
      return {
        subpanelReference: "hybrid:network",
        bindingHash: HASH,
        ...preparationEvidence("network"),
        round: {
          deploymentKey: "base-sepolia",
          chainId: 84532,
          panelAddress: "0x4444444444444444444444444444444444444444",
          roundId: "2",
          admissionPolicyHash: value.hybridParent.admissionPolicyHash,
        },
        status: "ready",
        replayed: false,
      };
    },
    releaseInvited: async () => undefined,
    releaseNetwork: async () => undefined,
    orchestration: orchestration(),
  };

  const result = await createHybridHumanReviewAdapter(dependencies)(
    hybridRequestForTest(input as FrozenHybridReviewSplit, [INVITED]),
  );
  assert.equal(callbackInputs.length, 2);
  assert.equal(JSON.stringify(callbackInputs).includes(leakedSecret), false);
  assert.equal(JSON.stringify(result).includes(leakedSecret), false);
  const callbacks = callbackInputs as Array<Record<string, any>>;
  for (const callback of callbacks) {
    assert.deepEqual(Object.keys(callback.split).sort(), [
      "audiencePolicyHash",
      "contentCommitments",
      "economics",
      "invited",
      "network",
      "opportunityId",
      "publication",
      "requestProfileHash",
      "schemaVersion",
      "semanticProfile",
      "workspaceId",
    ]);
  }
  assert.deepEqual(Object.keys(callbacks[0]!.candidates[0]).sort(), [
    "assignmentHash",
    "assignmentReference",
    "payoutAccount",
    "principalId",
  ]);
  assert.deepEqual(callbacks[1]!.candidates, []);
  assert.deepEqual(callbacks[1]!.preflights, []);
  assert.deepEqual(callbacks[1]!.hybridParent.excludedReviewers, [
    { principalId: candidate(INVITED, "unused").principalId, payoutAccount: INVITED.toLowerCase() },
  ]);
});

test("v3 rejects caller-supplied invited candidates before any callback", async () => {
  let sideEffects = 0;
  const dependencies: HybridHumanReviewDependencies = {
    requireCompliance() {},
    requireEligibility: async ({ principalId }) => {
      sideEffects += 1;
      return preflight(principalId);
    },
    prepareInvited: async () => {
      sideEffects += 1;
      throw new Error("must not run");
    },
    prepareNetwork: async () => {
      sideEffects += 1;
      throw new Error("must not run");
    },
    releaseInvited: async () => undefined,
    releaseNetwork: async () => undefined,
    orchestration: orchestration(),
  };
  const input = split();
  input.invited.candidates = [candidate(INVITED, "caller-injected")];
  await assert.rejects(
    createHybridHumanReviewAdapter(dependencies)(input),
    (error: unknown) => error instanceof TokenlessServiceError && error.code === "hybrid_review_binding_invalid",
  );
  assert.equal(sideEffects, 0);
});

test("v3 rejects caller-supplied network candidates before any callback", async () => {
  let sideEffects = 0;
  const dependencies: HybridHumanReviewDependencies = {
    requireCompliance() {},
    requireEligibility: async ({ principalId }) => {
      sideEffects += 1;
      return preflight(principalId);
    },
    prepareInvited: async () => {
      sideEffects += 1;
      throw new Error("must not run");
    },
    prepareNetwork: async () => {
      sideEffects += 1;
      throw new Error("must not run");
    },
    releaseInvited: async () => undefined,
    releaseNetwork: async () => undefined,
    orchestration: orchestration(),
  };
  const input = split();
  input.network.candidates = [candidate(NETWORK, "caller-injected")];
  await assert.rejects(
    createHybridHumanReviewAdapter(dependencies)(input),
    (error: unknown) => error instanceof TokenlessServiceError && error.code === "hybrid_review_binding_invalid",
  );
  assert.equal(sideEffects, 0);
});

test("hybrid publication still fails closed for a private declaration before any callback", async () => {
  let sideEffects = 0;
  const dependencies: HybridHumanReviewDependencies = {
    requireCompliance() {},
    requireEligibility: async ({ principalId }) => {
      sideEffects += 1;
      return preflight(principalId);
    },
    prepareInvited: async () => {
      sideEffects += 1;
      throw new Error("must not run");
    },
    prepareNetwork: async () => {
      sideEffects += 1;
      throw new Error("must not run");
    },
    releaseInvited: async () => undefined,
    releaseNetwork: async () => undefined,
    orchestration: orchestration(),
  };
  const input = structuredClone(split()) as unknown as Record<string, any>;
  input.publication.visibility = "private";
  await assert.rejects(
    createHybridHumanReviewAdapter(dependencies)(input as FrozenHybridReviewSplit),
    (error: unknown) => error instanceof TokenlessServiceError && error.code === "hybrid_review_binding_invalid",
  );
  assert.equal(sideEffects, 0);
});
