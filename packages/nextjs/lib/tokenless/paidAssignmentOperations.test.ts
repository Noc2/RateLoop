import assert from "node:assert/strict";
import test from "node:test";
import { freezeAdmissionPolicy } from "~~/lib/tokenless/admissionPolicy";
import {
  type PaidAssignmentOperation,
  type PaidAssignmentOperationRepository,
  type PaidAssignmentProductGateway,
  type PrivatePaidAssignmentOperationRequest,
  __paidAssignmentOperationsTestUtils,
  createPaidAssignmentOperationService,
} from "~~/lib/tokenless/paidAssignmentOperations";
import type { PreparedProductAsk } from "~~/lib/tokenless/productCore";
import { TokenlessServiceError } from "~~/lib/tokenless/server";

const NOW = new Date("2026-07-19T12:00:00.000Z");
const HASH = `sha256:${"ab".repeat(32)}` as const;

function admissionPolicy() {
  return {
    schemaVersion: "rateloop.human-assurance.v2" as const,
    policyId: "policy_paid_operation",
    version: 4,
    reviewerSource: "customer_invited" as const,
    compensation: "paid" as const,
    cohorts: [{ cohortId: "cohort_paid_operation", minimumReviewers: 3, maximumReviewers: 3 }],
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
    buyerPrivacy: { visibleFields: ["reviewer_source" as const], minimumAggregationSize: 3, suppressSmallCells: true },
    legalEligibilityRequired: true,
  };
}

const FROZEN_POLICY = freezeAdmissionPolicy(admissionPolicy());
const CHAIN_HASH = FROZEN_POLICY.admissionPolicyHash;
const PANEL = "0x1111111111111111111111111111111111111111";
const CONTENT = `0x${"22".repeat(32)}`;
const TERMS = `0x${"33".repeat(32)}`;

function request(): PrivatePaidAssignmentOperationRequest {
  const preparedRequest = {
    schemaVersion: "rateloop.human-review-prepared-request.v1" as const,
    opportunityId: "opportunity_paid_operation",
    workflowKey: "support-reply",
    requestProfile: { id: "profile_paid_operation", version: 4, hash: HASH },
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
      privateGroupId: "group_paid_operation",
    },
    timing: { responseWindowSeconds: 3_600, expiresAt: "2026-07-19T13:00:00.000Z" },
    panel: { size: 3 },
    contentCommitments: { source: HASH, suggestion: HASH },
    provenance: {
      agentId: "agent_paid_operation",
      agentVersionId: "agent_version_paid_operation",
      selectionPolicyId: "selection_paid_operation",
      selectionPolicyVersion: 7,
    },
  };
  const economics = {
    schemaVersion: "rateloop.human-review-derived-economics.v1" as const,
    compensationMode: "usdc" as const,
    bountyPerSeatAtomic: "1000000",
    panelSize: 3,
    baseBountyAtomic: "3000000",
    feeBps: 750,
    feeAtomic: "225000",
    attemptReserveAtomic: "2400000",
    maximumChargeAtomic: "5625000",
  };
  return {
    principal: {
      kind: "api_key",
      apiKeyId: "api_key_paid_operation",
      workspaceId: "workspace_paid_operation",
      role: "member",
      scopes: ["panel:publish", "payment:submit"],
      policyId: "policy_paid_operation",
    },
    appOrigin: "https://rateloop-tokenless.example",
    integrationId: "integration_paid_operation",
    opportunityId: preparedRequest.opportunityId,
    privateReviewId: "private_review_paid_operation",
    projectId: "project_paid_operation",
    cohortId: "cohort_paid_operation",
    privateGroup: { id: "group_paid_operation", policyVersion: 3, policyHash: HASH },
    reviewers: [1, 2, 3].map(index => ({
      principalId: `rlp_paid_operation_${index}`,
      raterId: `rater_paid_operation_${index}`,
      payoutAccount: `0x${String(index).repeat(40)}`,
    })),
    audiencePolicyHash: FROZEN_POLICY.policyHash,
    admissionPolicy: FROZEN_POLICY.policy,
    publishingPolicy: { id: "policy_paid_operation", version: 6 },
    preparedRequest,
    preparedRequestHash: __paidAssignmentOperationsTestUtils.sha256(preparedRequest),
    economics,
    economicsHash: __paidAssignmentOperationsTestUtils.sha256(economics),
    now: NOW,
  };
}

function harness() {
  let operation: PaidAssignmentOperation | null = null;
  let roundCandidate: ReturnType<typeof confirmedRound> | null = null;
  let ensureCalls = 0;
  let quoteCalls = 0;
  let prepareCalls = 0;
  let askCalls = 0;
  let attachCalls = 0;
  let bindCalls = 0;
  const repository: PaidAssignmentOperationRepository = {
    async ensure(seed) {
      ensureCalls += 1;
      if (!operation) {
        operation = {
          operationId: seed.operationId,
          workspaceId: seed.workspaceId,
          opportunityId: seed.opportunityId,
          requestIdempotencyKey: seed.requestIdempotencyKey,
          requestHash: seed.requestHash,
          preparedRequestHash: seed.preparedRequestHash,
          economicsHash: seed.economicsHash,
          reviewerSetHash: seed.reviewerSetHash,
          audiencePolicyHash: seed.audiencePolicyHash,
          chainAdmissionPolicyHash: seed.chainAdmissionPolicyHash,
          admissionPolicyJson: seed.admissionPolicyJson,
          artifactCommitmentsJson: seed.artifactCommitmentsJson,
          artifactBindingHash: seed.artifactBindingHash,
          expectedAmountAtomic: seed.expectedAmountAtomic,
          state: "prepared",
          transitionRevision: 1,
          quoteId: null,
          quoteExpiresAt: null,
          askOperationKey: null,
          prepaidReservationId: null,
          policyReservationId: null,
          round: null,
        };
        return { operation, replayed: false };
      }
      if (operation.requestHash !== seed.requestHash) throw new Error("conflict");
      return { operation, replayed: true };
    },
    async claimActivation() {
      return { operation: operation!, acquired: true };
    },
    async recoverExpired() {
      operation = { ...operation!, state: "prepared", quoteId: null, quoteExpiresAt: null };
      return operation!;
    },
    async attachQuote(_operationId: string, _owner: string, quoteId: string, quoteExpiresAt: Date) {
      operation = { ...operation!, state: "quote_created", quoteId, quoteExpiresAt };
      return operation!;
    },
    async attachPreparedAsk(
      _operationId: string,
      _owner: string,
      value: { prepaidReservationId: string; policyReservationId: string },
    ) {
      operation = {
        ...operation!,
        state: "ask_prepared",
        prepaidReservationId: value.prepaidReservationId,
        policyReservationId: value.policyReservationId,
      };
      return operation!;
    },
    async attachAsk(_operationId: string, _owner: string, value: Record<string, string>) {
      operation = {
        ...operation!,
        state: "ask_attached",
        askOperationKey: value.askOperationKey,
        prepaidReservationId: value.prepaidReservationId,
        policyReservationId: value.policyReservationId,
      };
      return operation!;
    },
    async failActivation() {},
    async bindExactRound() {
      if (!roundCandidate) return operation!;
      if (roundCandidate.voucherAdmissionPolicyHash !== operation!.chainAdmissionPolicyHash) {
        throw new TokenlessServiceError("round conflict", 409, "paid_assignment_round_conflict");
      }
      bindCalls += 1;
      operation = {
        ...operation!,
        state: "round_bound",
        round: {
          deploymentKey: roundCandidate.deploymentKey,
          chainId: roundCandidate.chainId,
          panelAddress: roundCandidate.panelAddress,
          roundId: roundCandidate.executionRoundId,
          contentId: roundCandidate.contentId,
          termsHash: roundCandidate.termsHash,
          roundTermsHash: HASH,
          paymentMode: "prepaid",
          paymentReference: "reservation_paid_operation",
          commitDeadline: roundCandidate.voucherDeadline,
          confirmedAt: roundCandidate.confirmedAt,
          boundAt: NOW,
        },
      };
      return operation!;
    },
    async revalidateExactRound() {
      if (!roundCandidate || roundCandidate.executionState !== "confirmed") {
        throw new TokenlessServiceError("round not live", 409, "paid_assignment_round_not_live", true);
      }
      return operation!;
    },
  };
  const preparedAsk: PreparedProductAsk = {
    amountAtomic: "5625000",
    createdPayment: true,
    idempotencyKey: "paid-assignment:test",
    idempotencyScope: "workspace:workspace_paid_operation:api_key:api_key_paid_operation",
    ownerAccountAddress: null,
    apiKeyId: "api_key_paid_operation",
    paymentMode: "prepaid",
    paymentReference: "reservation_paid_operation",
    paymentState: "reserved",
    policyId: "policy_paid_operation",
    policyVersion: 6,
    policyReservationId: "policy_reservation_paid_operation",
    createdPolicyReservation: true,
    quoteId: "quote_paid_operation",
    requestHash: "request_hash",
    quoteRequest: {},
    quote: {} as never,
    questionId: "question_paid_operation",
    workspaceId: "workspace_paid_operation",
  };
  const product: PaidAssignmentProductGateway = {
    async createQuote(value) {
      quoteCalls += 1;
      assert.equal(value.visibility, "private");
      assert.equal(value.audience.source, "customer_invited");
      assert.equal(value.audience.admissionPolicyHash, CHAIN_HASH);
      return { quoteId: "quote_paid_operation", expiresAt: "2026-07-19T13:00:00.000Z" };
    },
    async prepareAsk() {
      prepareCalls += 1;
      return preparedAsk;
    },
    async createAsk(value) {
      askCalls += 1;
      assert.match(value.idempotencyKey, /^paid-assignment:[0-9a-f]{64}$/u);
      return {
        schemaVersion: "rateloop.tokenless.v2",
        idempotencyKey: value.idempotencyKey,
        operationKey: "ask_paid_operation",
        roundId: null,
        status: "awaiting_payment",
        responseWindowSeconds: 3_600,
        commitDeadline: null,
        requestProfile: null,
        reviewEconomics: null,
        continuation: {
          cursor: "1",
          expiresAt: "2026-07-19T13:00:00.000Z",
          pollUrl: "https://rateloop-tokenless.example/wait",
          retryAfterMs: 1_000,
        },
      };
    },
    async attachAsk() {
      attachCalls += 1;
    },
    async releaseAsk() {},
  };
  return {
    service: createPaidAssignmentOperationService({
      repository: repository as unknown as PaidAssignmentOperationRepository,
      product,
      authorize: async () => {},
      chainIdentity: () => ({ deploymentKey: "deployment_paid_operation", chainId: 84532, panelAddress: PANEL }),
    }),
    setRoundCandidate(value: typeof roundCandidate) {
      roundCandidate = value;
    },
    counts() {
      return { ensureCalls, quoteCalls, prepareCalls, askCalls, attachCalls, bindCalls };
    },
  };
}

function confirmedRound(admissionPolicyHash = CHAIN_HASH) {
  return {
    askOperationKey: "ask_paid_operation",
    askQuoteId: "quote_paid_operation",
    askRoundId: "42",
    executionState: "confirmed",
    deploymentKey: "deployment_paid_operation",
    chainId: 84532,
    panelAddress: PANEL,
    executionRoundId: "42",
    contentId: CONTENT,
    termsHash: TERMS,
    roundTermsJson: JSON.stringify({
      bountyAmount: "3000000",
      feeAmount: "225000",
      attemptReserve: "2400000",
      maximumCommits: 3,
      admissionPolicyHash,
      contentId: CONTENT,
      termsHash: TERMS,
    }),
    totalFundedAtomic: "5625000",
    confirmedAt: NOW,
    voucherContentId: CONTENT,
    voucherAdmissionPolicyHash: admissionPolicyHash,
    voucherMaximumCommits: 3,
    voucherNotBefore: new Date("2026-07-19T11:59:00.000Z"),
    voucherDeadline: new Date("2026-07-19T13:00:00.000Z"),
    voucherStatus: "open",
  };
}

test("persists exact seats and idempotently attaches one private quote and ask", async () => {
  const values = harness();
  const first = await values.service(request());
  assert.equal(first.state, "ask_attached");
  assert.equal(first.readyForAssignment, false);
  assert.deepEqual(values.counts(), {
    ensureCalls: 1,
    quoteCalls: 1,
    prepareCalls: 1,
    askCalls: 1,
    attachCalls: 1,
    bindCalls: 0,
  });

  const replay = await values.service(request());
  assert.equal(replay.state, "ask_attached");
  assert.equal(replay.replayed, true);
  assert.deepEqual(values.counts(), {
    ensureCalls: 2,
    quoteCalls: 1,
    prepareCalls: 1,
    askCalls: 1,
    attachCalls: 1,
    bindCalls: 0,
  });
});

test("freezes the exact private group, project, cohort, and reviewer roster before funding", () => {
  const seed = __paidAssignmentOperationsTestUtils.operationSeed(request());
  const artifacts = JSON.parse(seed.artifactCommitmentsJson) as {
    membership: {
      projectId: string;
      cohortId: string;
      privateGroup: { id: string; policyVersion: number; policyHash: string };
      reviewerSetHash: string;
    };
  };
  assert.deepEqual(artifacts.membership, {
    projectId: "project_paid_operation",
    cohortId: "cohort_paid_operation",
    privateGroup: { id: "group_paid_operation", policyVersion: 3, policyHash: HASH },
    reviewerSetHash: seed.reviewerSetHash,
  });
});

test("advances only after the exact confirmed execution and voucher round exist", async () => {
  const values = harness();
  await values.service(request());
  values.setRoundCandidate(confirmedRound());

  const bound = await values.service(request());
  assert.equal(bound.state, "round_bound");
  assert.equal(bound.readyForAssignment, true);
  assert.equal(bound.round?.roundId, "42");
  assert.equal(bound.round?.contentId, CONTENT);
  assert.equal(values.counts().bindCalls, 1);

  const replay = await values.service(request());
  assert.equal(replay.state, "round_bound");
  assert.equal(values.counts().bindCalls, 1);
});

test("rejects a confirmed round whose admission policy differs from the frozen operation", async () => {
  const values = harness();
  await values.service(request());
  values.setRoundCandidate(confirmedRound(`0x${"cd".repeat(32)}` as const));
  await assert.rejects(
    values.service(request()),
    (error: unknown) => error instanceof TokenlessServiceError && error.code === "paid_assignment_round_conflict",
  );
  assert.equal(values.counts().bindCalls, 0);
});
