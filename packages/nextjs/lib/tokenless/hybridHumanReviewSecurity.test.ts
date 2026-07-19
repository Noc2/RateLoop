import assert from "node:assert/strict";
import { test } from "node:test";
import {
  type FrozenHybridReviewSplit,
  type HybridHumanReviewDependencies,
  createHybridHumanReviewAdapter,
} from "~~/lib/tokenless/hybridHumanReviewAdapter";
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

function split(): FrozenHybridReviewSplit {
  return {
    schemaVersion: "rateloop.hybrid-review-split.v1",
    opportunityId: "opportunity_hybrid_security",
    audiencePolicyHash: HASH,
    requestProfileHash: HASH,
    contentCommitments: { source: HASH, suggestion: HASH },
    publication: {
      visibility: "public",
      dataClassification: "redacted",
      confirmedNoSensitiveData: true,
      redactionSummary: "Customer identifiers were removed from the public review copy.",
    },
    economics: { asset: "USDC", invitedMaximumChargeAtomic: "1000000", networkMaximumChargeAtomic: "1000000" },
    invited: {
      requestedCount: 1,
      candidates: [candidate(INVITED, "assignment:invited")],
    },
    network: {
      requestedCount: 1,
      candidates: [candidate(NETWORK, "assignment:network")],
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
  input.invited.candidates[0].privateReviewerNote = leakedSecret;
  input.network.privatePublicationPayload = leakedSecret;
  input.network.candidates[0].privateReviewerNote = leakedSecret;

  const callbackInputs: unknown[] = [];
  const dependencies: HybridHumanReviewDependencies = {
    requireEligibility: async principalId => preflight(principalId),
    prepareInvited: async value => {
      callbackInputs.push(value);
      return { subpanelReference: "hybrid:invited", bindingHash: HASH, status: "ready", replayed: false };
    },
    prepareNetwork: async value => {
      callbackInputs.push(value);
      return { subpanelReference: "hybrid:network", bindingHash: HASH, status: "ready", replayed: false };
    },
  };

  const result = await createHybridHumanReviewAdapter(dependencies)(input as FrozenHybridReviewSplit);
  assert.equal(callbackInputs.length, 2);
  assert.equal(JSON.stringify(callbackInputs).includes(leakedSecret), false);
  assert.equal(JSON.stringify(result).includes(leakedSecret), false);
  for (const callback of callbackInputs as Array<Record<string, any>>) {
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
    ]);
    assert.deepEqual(Object.keys(callback.candidates[0]).sort(), [
      "assignmentHash",
      "assignmentReference",
      "payoutAccount",
      "principalId",
    ]);
  }
});

test("hybrid publication still fails closed for a private declaration before any callback", async () => {
  let sideEffects = 0;
  const dependencies: HybridHumanReviewDependencies = {
    requireEligibility: async principalId => {
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
  };
  const input = structuredClone(split()) as unknown as Record<string, any>;
  input.publication.visibility = "private";
  await assert.rejects(
    createHybridHumanReviewAdapter(dependencies)(input as FrozenHybridReviewSplit),
    (error: unknown) => error instanceof TokenlessServiceError && error.code === "hybrid_review_binding_invalid",
  );
  assert.equal(sideEffects, 0);
});
