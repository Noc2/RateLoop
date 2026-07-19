import assert from "node:assert/strict";
import { test } from "node:test";
import { freezeAdmissionPolicy } from "~~/lib/tokenless/admissionPolicy";
import {
  type PrivatePaidHumanReviewRequest,
  __privatePaidHumanReviewAdapterTestUtils,
  createPrivatePaidHumanReviewAdapter,
} from "~~/lib/tokenless/privatePaidHumanReviewAdapter";
import { TokenlessServiceError } from "~~/lib/tokenless/server";

const NOW = new Date("2026-07-16T12:00:00.000Z");
const HASH = `sha256:${"ab".repeat(32)}` as const;
const REVIEWERS = ["0x1111111111111111111111111111111111111111", "0x2222222222222222222222222222222222222222"] as const;
const REVIEWER_BINDINGS = REVIEWERS.map(payoutAccount => ({
  principalId: `rlp_${payoutAccount.slice(2, 26)}`,
  payoutAccount,
}));

function admissionPolicy() {
  return {
    schemaVersion: "rateloop.human-assurance.v2" as const,
    policyId: "policy_review_private_paid",
    version: 7,
    reviewerSource: "customer_invited" as const,
    compensation: "paid" as const,
    cohorts: [{ cohortId: "cohort_private_paid", minimumReviewers: 2, maximumReviewers: 2 }],
    selection: "customer_named" as const,
    fallbacks: { allowed: false, sources: [] },
    requiredQualifications: [],
    assurance: {
      requirements: [
        {
          capability: "customer_invitation" as const,
          reviewerSources: ["customer_invited" as const],
          allowedProviders: ["workspace-invitation"],
        },
      ],
    },
    buyerPrivacy: { visibleFields: ["reviewer_source" as const], minimumAggregationSize: 2, suppressSmallCells: true },
    legalEligibilityRequired: true,
  };
}

function request(): PrivatePaidHumanReviewRequest {
  const preparedRequest = {
    schemaVersion: "rateloop.human-review-prepared-request.v1" as const,
    opportunityId: "opportunity_private_paid",
    workflowKey: "support-reply",
    requestProfile: { id: "profile_private_paid", version: 4, hash: HASH },
    question: {
      criterion: "Is this reply accurate?",
      positiveLabel: "Accurate",
      negativeLabel: "Needs changes",
      rationaleMode: "required" as const,
    },
    audience: {
      kind: "private_invited" as const,
      contentBoundary: "private_workspace" as const,
      privateSensitivity: "confidential" as const,
      privateGroupId: "group_private_paid",
    },
    timing: { responseWindowSeconds: 3_600, expiresAt: "2026-07-16T13:00:00.000Z" },
    panel: { size: 2 },
    contentCommitments: { source: HASH, suggestion: HASH },
    provenance: {
      agentId: "agent_private_paid",
      agentVersionId: "agent_version_private_paid",
      selectionPolicyId: "policy_review_private_paid",
      selectionPolicyVersion: 7,
    },
  };
  const economics = {
    schemaVersion: "rateloop.human-review-derived-economics.v1" as const,
    compensationMode: "usdc" as const,
    bountyPerSeatAtomic: "1000000",
    panelSize: 2,
    baseBountyAtomic: "2000000",
    feeBps: 750,
    feeAtomic: "150000",
    attemptReserveAtomic: "400000",
    maximumChargeAtomic: "2550000",
  };
  const frozenPolicy = freezeAdmissionPolicy(admissionPolicy());
  return {
    principal: {
      kind: "api_key",
      apiKeyId: "api_key_private_paid",
      workspaceId: "workspace_private_paid",
      role: "member",
      scopes: ["panel:publish", "payment:submit"],
      policyId: "policy_publish_private_paid",
    },
    appOrigin: "https://rateloop-tokenless.example",
    integrationId: "integration_private_paid",
    opportunityId: preparedRequest.opportunityId,
    privateReviewId: "private_review_private_paid",
    projectId: "project_private_paid",
    cohortId: "cohort_private_paid",
    privateGroup: { id: "group_private_paid", policyVersion: 3, policyHash: HASH },
    reviewers: REVIEWER_BINDINGS,
    audiencePolicyHash: frozenPolicy.policyHash,
    admissionPolicy: frozenPolicy.policy,
    publishingPolicy: { id: "policy_publish_private_paid", version: 6 },
    preparedRequest,
    preparedRequestHash: __privatePaidHumanReviewAdapterTestUtils.sha256(preparedRequest),
    economics,
    economicsHash: __privatePaidHumanReviewAdapterTestUtils.sha256(economics),
    now: NOW,
  };
}

function dependencies(options?: { failReviewer?: string; activateOperation?: "pending"; clock?: () => Date }) {
  const order: string[] = [];
  const voucherInputs: unknown[] = [];
  const adapter = createPrivatePaidHumanReviewAdapter({
    clock: options?.clock ?? (() => NOW),
    requireEligibility: async principalId => {
      const reviewer = REVIEWER_BINDINGS.find(value => value.principalId === principalId)!;
      order.push(`eligibility:${principalId}`);
      if (principalId === options?.failReviewer) {
        throw new TokenlessServiceError("not eligible", 403, "paid_eligibility_required");
      }
      return {
        schemaVersion: "rateloop.paid-review-eligibility-preflight.v1",
        preflightId: `pef_${reviewer.payoutAccount.slice(2, 18)}`,
        raterId: `rater_${reviewer.payoutAccount.slice(2, 18)}`,
        principalId,
        accountAddress: reviewer.payoutAccount,
        payoutAccount: reviewer.payoutAccount,
        identityAssertions: [
          {
            assertionId: `assertion_${reviewer.payoutAccount.slice(2, 10)}`,
            bindingId: `binding_${reviewer.payoutAccount.slice(2, 10)}`,
            providerId: "provider",
            providerNamespace: "provider.test",
            capabilities: ["account_control", "minimum_age"],
          },
        ],
        checkedAt: NOW.toISOString(),
        validUntil: "2026-07-16T13:00:00.000Z",
        eligibilityCommitment: HASH,
      };
    },
    activateOperation: async () => {
      order.push("activate_operation");
      return {
        operationId: "paid_operation_private_paid",
        requestIdempotencyKey: "paid-assignment:test-funding",
        askOperationKey: "ask_private_paid",
        prepaidReservationId: "res_private_paid",
        policyReservationId: "agres_private_paid",
        expectedAmountAtomic: "2550000",
        readyForAssignment: options?.activateOperation !== "pending",
        replayed: false,
      } as never;
    },
    revalidateOperation: async () => {
      order.push("revalidate_operation");
      return {} as never;
    },
    assignEncrypted: async () => {
      order.push("assign_encrypted");
      return {
        schemaVersion: "rateloop.private-paid-review-delivery.v1",
        deliveryId: "delivery_private_paid",
        opportunityId: "opportunity_private_paid",
        privateReviewId: "private_review_private_paid",
        operationHash: HASH,
        membershipSnapshotHash: HASH,
        responseDeadline: "2026-07-16T13:00:00.000Z",
        status: "pending",
        replayed: false,
        assignments: REVIEWERS.map((reviewer, index) => ({
          assignmentId: `assignment_private_paid_${index + 1}`,
          reviewerAccountAddress: reviewer,
          reservationExpiresAt: "2026-07-16T12:15:00.000Z",
          status: "reserved" as const,
        })),
      };
    },
    bindSeats: async () => {
      order.push("bind_seats");
    },
    prepareVoucher: async input => {
      order.push(`voucher:${input.raterId}`);
      voucherInputs.push(input);
      return {
        issuanceId: `issuance_${input.raterId}`,
        workspaceId: input.workspaceId,
        opportunityId: input.opportunityId,
        raterId: input.raterId,
        status: "prepared",
      } as never;
    },
  });
  return { adapter, order, voucherInputs };
}

test("preflights every named human before funding, assignment, or voucher preparation", async () => {
  const { adapter, order, voucherInputs } = dependencies();
  const result = await adapter(request());
  assert.deepEqual(order, [
    `eligibility:${REVIEWER_BINDINGS[0]!.principalId}`,
    `eligibility:${REVIEWER_BINDINGS[1]!.principalId}`,
    "activate_operation",
    "revalidate_operation",
    "assign_encrypted",
    "revalidate_operation",
    `voucher:rater_${REVIEWERS[0].slice(2, 18)}`,
    "revalidate_operation",
    `voucher:rater_${REVIEWERS[1].slice(2, 18)}`,
    "revalidate_operation",
    "bind_seats",
  ]);
  assert.equal(result.lane, "private_invited_paid");
  assert.equal(result.funding.amountAtomic, "2550000");
  assert.equal(result.acceptedWorkLiability, "reserved_until_assignment_acceptance");
  assert.equal(result.vouchers.length, 2);
  for (const value of voucherInputs) {
    const input = value as {
      audienceBinding: {
        profileAudience: string;
        reviewerSource: string;
        selectionBatchId: string | null;
        integrityProvenanceHash: string | null;
      };
    };
    assert.deepEqual(input.audienceBinding, {
      ...input.audienceBinding,
      profileAudience: "private_invited",
      reviewerSource: "customer_invited",
      selectionBatchId: null,
      integrityProvenanceHash: null,
    });
  }
});

test("one ineligible invited human fails closed before any paid or private side effect", async () => {
  const { adapter, order } = dependencies({ failReviewer: REVIEWER_BINDINGS[1]!.principalId });
  await assert.rejects(
    adapter(request()),
    (error: unknown) => error instanceof TokenlessServiceError && error.code === "paid_eligibility_required",
  );
  assert.deepEqual(order, [
    `eligibility:${REVIEWER_BINDINGS[0]!.principalId}`,
    `eligibility:${REVIEWER_BINDINGS[1]!.principalId}`,
  ]);
});

test("production operation activation waits for an exact round before encrypted delivery", async () => {
  const { adapter, order } = dependencies({ activateOperation: "pending" });
  const input = request();
  input.appOrigin = "https://rateloop-tokenless.example";
  await assert.rejects(
    adapter(input),
    (error: unknown) => error instanceof TokenlessServiceError && error.code === "private_paid_round_pending",
  );
  assert.deepEqual(order, [
    `eligibility:${REVIEWER_BINDINGS[0]!.principalId}`,
    `eligibility:${REVIEWER_BINDINGS[1]!.principalId}`,
    "activate_operation",
  ]);
});

test("the adapter rejects unpaid economics instead of falling back to the private unpaid lane", async () => {
  const { adapter, order } = dependencies();
  const input = request();
  input.economics = { ...input.economics, compensationMode: "unpaid" };
  input.economicsHash = __privatePaidHumanReviewAdapterTestUtils.sha256(input.economics);
  await assert.rejects(
    adapter(input),
    (error: unknown) => error instanceof TokenlessServiceError && error.code === "private_paid_review_binding_conflict",
  );
  assert.deepEqual(order, []);
});

test("fresh time stops expired eligibility before voucher preparation", async () => {
  let reads = 0;
  const { adapter, order, voucherInputs } = dependencies({
    clock: () => {
      reads += 1;
      return reads >= 5 ? new Date("2026-07-16T13:00:00.000Z") : NOW;
    },
  });
  await assert.rejects(
    adapter(request()),
    (error: unknown) => error instanceof TokenlessServiceError && error.code === "paid_eligibility_expired",
  );
  assert.deepEqual(order, [
    `eligibility:${REVIEWER_BINDINGS[0]!.principalId}`,
    `eligibility:${REVIEWER_BINDINGS[1]!.principalId}`,
    "activate_operation",
    "revalidate_operation",
    "assign_encrypted",
  ]);
  assert.equal(voucherInputs.length, 0);
});

test("the prepared voucher binds the exact encrypted assignment and membership snapshot without plaintext", async () => {
  const { adapter, voucherInputs } = dependencies();
  await adapter(request());
  const serialized = JSON.stringify(voucherInputs);
  assert.match(serialized, /assignment_private_paid_1/u);
  assert.ok(serialized.includes(HASH));
  assert.doesNotMatch(serialized, /private source|private suggestion|bytesBase64|sourcePayload|suggestionPayload/u);
});

test("a partial voucher-preparation interruption returns no success and an idempotent retry completes", async () => {
  let interrupted = false;
  let voucherCalls = 0;
  const retrying = createPrivatePaidHumanReviewAdapter({
    clock: () => NOW,
    requireEligibility: async principalId => {
      const reviewer = REVIEWER_BINDINGS.find(value => value.principalId === principalId)!;
      const raterId = `rater_${reviewer.payoutAccount.slice(2, 18)}`;
      return {
        schemaVersion: "rateloop.paid-review-eligibility-preflight.v1",
        preflightId: `pef_${reviewer.payoutAccount.slice(2, 18)}`,
        raterId,
        principalId,
        accountAddress: reviewer.payoutAccount,
        payoutAccount: reviewer.payoutAccount,
        identityAssertions: [],
        checkedAt: NOW.toISOString(),
        validUntil: "2026-07-16T13:00:00.000Z",
        eligibilityCommitment: HASH,
      };
    },
    activateOperation: async () =>
      ({
        operationId: "paid_operation_retry",
        requestIdempotencyKey: "paid-assignment:retry-funding",
        askOperationKey: "ask_retry",
        prepaidReservationId: "res_retry",
        policyReservationId: "agres_retry",
        expectedAmountAtomic: "2550000",
        readyForAssignment: true,
        replayed: voucherCalls > 0,
      }) as never,
    revalidateOperation: async () => ({}) as never,
    assignEncrypted: async () => ({
      schemaVersion: "rateloop.private-paid-review-delivery.v1",
      deliveryId: "delivery_retry",
      opportunityId: "opportunity_private_paid",
      privateReviewId: "private_review_private_paid",
      operationHash: HASH,
      membershipSnapshotHash: HASH,
      responseDeadline: "2026-07-16T13:00:00.000Z",
      status: "pending",
      replayed: voucherCalls > 0,
      assignments: REVIEWERS.map((reviewer, index) => ({
        assignmentId: `assignment_retry_${index + 1}`,
        reviewerAccountAddress: reviewer,
        reservationExpiresAt: "2026-07-16T12:15:00.000Z",
        status: "reserved" as const,
      })),
    }),
    bindSeats: async () => {},
    prepareVoucher: async input => {
      voucherCalls += 1;
      if (!interrupted && input.raterId.endsWith(REVIEWERS[1].slice(2, 18))) {
        interrupted = true;
        throw new Error("simulated voucher snapshot interruption");
      }
      return {
        issuanceId: `issuance_${input.raterId}`,
        workspaceId: input.workspaceId,
        opportunityId: input.opportunityId,
        raterId: input.raterId,
        status: "prepared",
      } as never;
    },
  });
  await assert.rejects(retrying(request()), /simulated voucher snapshot interruption/u);
  const recovered = await retrying(request());
  assert.equal(recovered.vouchers.length, REVIEWERS.length);
  assert.equal(recovered.acceptedWorkLiability, "reserved_until_assignment_acceptance");
});
