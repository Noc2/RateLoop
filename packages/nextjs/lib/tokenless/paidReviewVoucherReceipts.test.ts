import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, test } from "node:test";
import { __setDatabaseResourcesForTests, dbClient } from "~~/lib/db";
import { createMemoryDatabaseResources } from "~~/lib/db/testing/testMemory";
import {
  approveAgentPairing,
  authenticateAgentMcpPrincipal,
  createAgentPairing,
  submitAgentRegistration,
} from "~~/lib/tokenless/agentIntegrations";
import type { HumanReviewDerivedEconomics, HumanReviewPreparedRequest } from "~~/lib/tokenless/humanReviewApprovals";
import {
  type PaidReviewAudienceBinding,
  type PaidReviewEligibilitySnapshot,
  type PaidReviewVoucherLifecycle,
  type PreparePaidReviewVoucherIssuanceInput,
  __paidReviewVoucherReceiptTestUtils,
  completePaidReviewVoucherIssuance,
  consumePaidReviewVoucher,
  getPaidReviewVoucherLifecycle,
  paidEligibilityPreflightReference,
  preparePaidReviewVoucherIssuance,
} from "~~/lib/tokenless/paidReviewVoucherReceipts";
import { createAgentPublishingPolicy, createWorkspace } from "~~/lib/tokenless/productCore";
import { TokenlessServiceError } from "~~/lib/tokenless/server";
import { seedReadyHumanReviewBinding } from "~~/lib/tokenless/testing/humanReviewBindingFixture";

const OWNER = "0x1111111111111111111111111111111111111111";
const RATER = "0x2222222222222222222222222222222222222222";
const PANEL = "0x3333333333333333333333333333333333333333";
const CONTENT = `0x${"44".repeat(32)}`;
const ADMISSION = `0x${"55".repeat(32)}`;

function hash(value: string) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}` as `sha256:${string}`;
}

beforeEach(() => {
  __setDatabaseResourcesForTests(createMemoryDatabaseResources());
});

afterEach(() => {
  __setDatabaseResourcesForTests(null);
});

test("private issuance, voucher, and commit bridges bind one exact live panel identity", () => {
  const audienceBinding = {
    schemaVersion: "rateloop.paid-review-audience-binding.v1",
    profileAudience: "private_invited",
    reviewerSource: "customer_invited",
    audiencePolicyHash: hash("private-audience"),
    assignmentReference: "assignment_private_bridge",
    assignmentHash: hash("private-assignment"),
    selectionBatchId: null,
    integrityProvenanceHash: null,
  } as const;
  const snapshot = {
    schemaVersion: "rateloop.paid-review-eligibility-snapshot.v1",
    snapshotVersion: 1,
    workspaceId: "workspace_private_bridge",
    opportunity: {
      id: "opportunity_private_bridge",
      sourceEvidenceHash: hash("private-source"),
      suggestionCommitment: hash("private-suggestion"),
    },
    raterId: "rater_private_bridge",
    requestProfile: { id: "profile_private_bridge", version: 1, hash: hash("private-profile") },
    preparedRequestHash: hash("private-request"),
    audienceBinding,
    audienceBindingHash: hash("private-audience-binding"),
    economics: {
      schemaVersion: "rateloop.human-review-derived-economics.v1",
      compensationMode: "usdc",
      bountyPerSeatAtomic: "1000000",
      panelSize: 1,
      baseBountyAtomic: "1000000",
      feeBps: 500,
      feeAtomic: "50000",
      attemptReserveAtomic: "100000",
      maximumChargeAtomic: "1150000",
    },
    economicsHash: hash("private-economics"),
    paidEligibilityPreflight: {
      reference: "preflight_private_bridge",
      hash: hash("private-preflight"),
      verifiedAt: "2026-07-26T08:00:00.000Z",
      expiresAt: "2026-07-26T09:00:00.000Z",
    },
    capturedAt: "2026-07-26T08:00:00.000Z",
  } satisfies PaidReviewEligibilitySnapshot;
  const lifecycle = {
    issuanceId: "issuance_private_bridge",
    workspaceId: snapshot.workspaceId,
    opportunityId: snapshot.opportunity.id,
    raterId: snapshot.raterId,
    status: "prepared",
    snapshot,
  } as PaidReviewVoucherLifecycle;
  const row = {
    workspace_id: snapshot.workspaceId,
    rater_id: snapshot.raterId,
    principal_id: "rlp_private_bridge",
    assignment_id: audienceBinding.assignmentReference,
    audience_policy_hash: audienceBinding.audiencePolicyHash,
    lane: "private_invited_paid",
    operation_state: "round_bound",
    seat_state: "accepted",
    execution_state: "confirmed",
    voucher_round_status: "open",
    voucher_workspace_id: snapshot.workspaceId,
    deployment_key: "tokenless-v4:private-bridge",
    chain_id: 84532,
    panel_address: PANEL,
    round_id: "42",
    content_id: CONTENT,
    voucher_content_id: CONTENT,
    chain_admission_policy_hash: ADMISSION,
    voucher_admission_policy_hash: ADMISSION,
  };
  const bridge = __paidReviewVoucherReceiptTestUtils.projectPrivatePaidVoucherIssuanceBridge({
    issuanceId: lifecycle.issuanceId,
    lifecycle,
    row,
    persistedSnapshot: snapshot,
    policySource: "customer_invited",
  });
  assert.equal(bridge.assignmentId, audienceBinding.assignmentReference);
  assert.equal(bridge.panelAddress, PANEL);
  assert.equal(
    __paidReviewVoucherReceiptTestUtils.voucherMatchesPrivatePaidBridge(
      {
        voucher_chain_id: 84532,
        voucher_panel_address: PANEL,
        voucher_round_id: "42",
        voucher_content_id: CONTENT,
        voucher_admission_policy_hash: ADMISSION,
      },
      bridge,
    ),
    true,
  );
  assert.equal(
    __paidReviewVoucherReceiptTestUtils.voucherMatchesPrivatePaidBridge(
      {
        voucher_chain_id: 84532,
        voucher_panel_address: RATER,
        voucher_round_id: "42",
        voucher_content_id: CONTENT,
        voucher_admission_policy_hash: ADMISSION,
      },
      bridge,
    ),
    false,
  );
  assert.doesNotThrow(() =>
    __paidReviewVoucherReceiptTestUtils.projectPrivatePaidVoucherIssuanceBridge({
      issuanceId: lifecycle.issuanceId,
      lifecycle,
      row: { ...row, operation_state: "settling", voucher_round_status: "closed" },
      persistedSnapshot: snapshot,
      policySource: "customer_invited",
      phase: "consumption",
    }),
  );
  assert.throws(
    () =>
      __paidReviewVoucherReceiptTestUtils.projectPrivatePaidVoucherIssuanceBridge({
        issuanceId: lifecycle.issuanceId,
        lifecycle,
        row: { ...row, operation_state: "settling", voucher_round_status: "closed" },
        persistedSnapshot: snapshot,
        policySource: "customer_invited",
      }),
    (error: unknown) => error instanceof TokenlessServiceError && error.code === "paid_voucher_issuance_conflict",
  );
  assert.throws(
    () =>
      __paidReviewVoucherReceiptTestUtils.projectPrivatePaidVoucherIssuanceBridge({
        issuanceId: lifecycle.issuanceId,
        lifecycle,
        row: { ...row, voucher_workspace_id: "workspace_other" },
        persistedSnapshot: snapshot,
        policySource: "customer_invited",
      }),
    (error: unknown) => error instanceof TokenlessServiceError && error.code === "paid_voucher_issuance_conflict",
  );
});

test("production voucher and commit paths complete and consume the private issuance bridge", () => {
  const eligibilitySource = readFileSync(new URL("./paidEligibility.ts", import.meta.url), "utf8");
  const commitSource = readFileSync(new URL("./raterService.ts", import.meta.url), "utf8");
  assert.match(eligibilitySource, /completePaidReviewVoucherIssuance\(\{/u);
  assert.match(commitSource, /consumePrivatePaidReviewVoucherForCommit\(\{/u);
});

async function fixture(suffix: string) {
  const now = new Date("2026-07-16T08:00:00.000Z");
  const { workspaceId } = await createWorkspace({ name: `Paid voucher ${suffix}`, ownerAddress: OWNER });
  const publishing = await createAgentPublishingPolicy({
    accountAddress: OWNER,
    workspaceId,
    policy: {
      name: `Paid voucher ${suffix}`,
      allowedPaymentModes: ["prepaid"],
      maxPanelAtomic: "10000000",
      maxDailyAtomic: "100000000",
      maxMonthlyAtomic: "1000000000",
      maxPanelSize: 10,
      maxBountyAtomic: "10000000",
      maxFeeBps: 1_000,
      maxAttemptReserveAtomic: "5000000",
      allowedReviewerSources: ["rateloop_network"],
      allowedAdmissionPolicyHashes: [`0x${"11".repeat(32)}`],
      allowedDataClassifications: ["synthetic"],
    },
  });
  const issued = await createAgentPairing({
    accountAddress: OWNER,
    workspaceId,
    origin: "https://rateloop-tokenless.vercel.app",
  });
  const pairing = await authenticateAgentMcpPrincipal(`Bearer ${issued.secret}`);
  if (pairing.kind !== "pairing") throw new Error("Pairing principal expected.");
  await submitAgentRegistration({
    pairing,
    registration: {
      externalId: `paid-voucher-agent-${suffix}`,
      displayName: `Paid voucher agent ${suffix}`,
      provider: "OpenAI",
      model: "gpt-test",
      environment: "production",
      requestedWorkflowKeys: ["paid-review"],
    },
  });
  const approved = await approveAgentPairing({
    accountAddress: OWNER,
    workspaceId,
    pairingId: issued.pairing.pairingId,
    body: { publishingPolicyId: publishing.policyId, allowedWorkflowKeys: ["paid-review"] },
  });
  const frozen = await seedReadyHumanReviewBinding({
    workspaceId,
    agentId: approved.agent.agentId,
    agentVersionId: approved.agent.versionId,
    policyId: approved.integration.reviewPolicyId,
    actor: OWNER,
  });
  const audiencePolicyHash = hash(`audience-${suffix}`);
  const scopeId = `aesc_paid_${suffix}`;
  await dbClient.execute({
    sql: `INSERT INTO tokenless_agent_evaluation_scopes
          (scope_id,workspace_id,agent_id,agent_version_id,policy_id,policy_version,workflow_key,
           risk_tier,audience_policy_hash,partition_commitment,execution_profile_hash,
           execution_profile_json,human_review_binding_id,human_review_binding_version,
           request_profile_id,request_profile_version,request_profile_hash,stage,
           completed_comparable_cases,stable_cases_since_stage,unreviewed_since_last_sample,
           stage_entered_at,updated_at)
          VALUES (?,?,?,?,?,1,'paid-review','normal',?,?,?,'{}',?,1,?,1,?,'calibrating',0,0,0,?,?)`,
    args: [
      scopeId,
      workspaceId,
      approved.agent.agentId,
      approved.agent.versionId,
      approved.integration.reviewPolicyId,
      audiencePolicyHash,
      hash(`partition-${suffix}`),
      hash(`execution-profile-${suffix}`),
      frozen.bindingId,
      frozen.profileId,
      frozen.profileHash,
      now,
      now,
    ],
  });
  const executionId = `aex_paid_${suffix}`;
  await dbClient.execute({
    sql: `INSERT INTO tokenless_agent_executions
          (execution_id,workspace_id,agent_id,agent_version_id,integration_id,external_execution_id,
           status,metadata_source,model_call_count,primary_span_id,manifest_commitment,
           execution_profile_hash,execution_profile_json,created_at)
          VALUES (?,?,?,?,?,?,'completed','host_reported',1,'primary',?,?,?,?)`,
    args: [
      executionId,
      workspaceId,
      approved.agent.agentId,
      approved.agent.versionId,
      approved.integration.integrationId,
      `external-paid-${suffix}`,
      hash(`manifest-${suffix}`),
      hash(`execution-profile-${suffix}`),
      "{}",
      now,
    ],
  });
  const opportunityId = `aop_paid_${suffix}`;
  const sourceHash = hash(`source-${suffix}`);
  const suggestionHash = hash(`suggestion-${suffix}`);
  await dbClient.execute({
    sql: `INSERT INTO tokenless_agent_review_opportunities
          (opportunity_id,workspace_id,agent_id,agent_version_id,scope_id,policy_id,policy_version,
           external_opportunity_id,execution_id,suggestion_commitment,declared_confidence_bps,
           metadata_commitment,metadata_complete,critical_risk,decision,review_rate_bps,
           selection_probability_bps,sample_bucket,sampler_key_version,sampler_commitment,
           reason_codes_json,status,source_evidence_reference,source_evidence_hash,
           human_review_binding_id,human_review_binding_version,request_profile_id,
           request_profile_version,request_profile_hash,created_at,updated_at)
          VALUES (?,?,?,?,?,?,1,?,?,?,9000,?,true,false,'required',10000,10000,1,'paid-test-v1',?,
                  '["review_required"]','decided','paid/source',?,?,1,?,1,?,?,?)`,
    args: [
      opportunityId,
      workspaceId,
      approved.agent.agentId,
      approved.agent.versionId,
      scopeId,
      approved.integration.reviewPolicyId,
      `external-paid-${suffix}`,
      executionId,
      suggestionHash,
      hash(`metadata-${suffix}`),
      hash(`sampler-${suffix}`),
      sourceHash,
      frozen.bindingId,
      frozen.profileId,
      frozen.profileHash,
      now,
      now,
    ],
  });
  await dbClient.execute({
    sql: `INSERT INTO tokenless_agent_review_opportunity_lifecycles
          (workspace_id,opportunity_id,state,state_revision,reason_codes_json,state_entered_at,
           terminal_at,created_at,updated_at)
          VALUES (?,?,'request_ready',2,'["paid_request_ready"]',?,NULL,?,?)`,
    args: [workspaceId, opportunityId, now, now, now],
  });
  await dbClient.execute({
    sql: `INSERT INTO tokenless_principals (principal_id,status,created_at,updated_at)
          VALUES (?,'active',?,?);
          INSERT INTO tokenless_wallet_bindings
          (binding_id,principal_id,purpose,wallet_address,wallet_source,chain_id,proof_message_hash,created_at,last_used_at)
          VALUES (?,?, 'payout',?,'self_custodial',84532,'fixture',?,?);
          INSERT INTO tokenless_payout_wallet_ownership
          (wallet_address,principal_id,first_binding_id,first_bound_at)
          VALUES (?,?,?,?);
          INSERT INTO tokenless_rater_profiles
          (rater_id,principal_id,account_address,nullifier_seed_ciphertext,nullifier_key_version,nullifier_key_domain,
           created_at,updated_at)
          VALUES (?,?,?,'fixture','test-v1','vote_mapping',?,?)`,
    args: [
      `rlp_paid_${suffix}`,
      now,
      now,
      `binding_paid_${suffix}`,
      `rlp_paid_${suffix}`,
      RATER,
      now,
      now,
      RATER,
      `rlp_paid_${suffix}`,
      `binding_paid_${suffix}`,
      now,
      `rater_${suffix}`,
      `rlp_paid_${suffix}`,
      RATER,
      now,
      now,
    ],
  });

  const preparedRequest: HumanReviewPreparedRequest = {
    schemaVersion: "rateloop.human-review-prepared-request.v1",
    opportunityId,
    workflowKey: "paid-review",
    requestProfile: { id: frozen.profileId, version: 1, hash: frozen.profileHash },
    question: {
      criterion: "Is this output correct and safe to use",
      positiveLabel: "Approve",
      negativeLabel: "Reject",
      rationaleMode: "optional",
    },
    audience: {
      kind: "public_network",
      contentBoundary: "public_or_test",
      privateSensitivity: null,
      privateGroupId: null,
    },
    timing: { responseWindowSeconds: 1_200, expiresAt: "2026-07-16T09:00:00.000Z" },
    panel: { size: 3 },
    contentCommitments: { source: sourceHash, suggestion: suggestionHash },
    provenance: {
      agentId: approved.agent.agentId,
      agentVersionId: approved.agent.versionId,
      selectionPolicyId: approved.integration.reviewPolicyId,
      selectionPolicyVersion: 1,
    },
  };
  const economics: HumanReviewDerivedEconomics = {
    schemaVersion: "rateloop.human-review-derived-economics.v1",
    compensationMode: "usdc",
    bountyPerSeatAtomic: "1000000",
    panelSize: 3,
    baseBountyAtomic: "3000000",
    feeBps: 500,
    feeAtomic: "150000",
    attemptReserveAtomic: "500000",
    maximumChargeAtomic: "3650000",
  };
  const audienceBinding: PaidReviewAudienceBinding = {
    schemaVersion: "rateloop.paid-review-audience-binding.v1",
    profileAudience: "public_network",
    reviewerSource: "rateloop_network",
    audiencePolicyHash,
    assignmentReference: `assignment:${suffix}`,
    assignmentHash: hash(`assignment-${suffix}`),
    selectionBatchId: `selection:${suffix}`,
    integrityProvenanceHash: hash(`integrity-${suffix}`),
  };
  const request: PreparePaidReviewVoucherIssuanceInput = {
    workspaceId,
    opportunityId,
    raterId: `rater_${suffix}`,
    idempotencyKey: `voucher:${suffix}:0001`,
    preparedRequest,
    preparedRequestHash: __paidReviewVoucherReceiptTestUtils.sha256(preparedRequest),
    economics,
    economicsHash: __paidReviewVoucherReceiptTestUtils.sha256(economics),
    audienceBinding,
    paidEligibilityPreflight: paidEligibilityPreflightReference(
      {
        preflightId: `pef_${suffix}_version_1`,
        raterId: `rater_${suffix}`,
        eligibilityCommitment: hash(`paid-eligibility-${suffix}`),
        checkedAt: "2026-07-16T07:59:00.000Z",
        validUntil: "2026-07-16T10:00:00.000Z",
      },
      `rater_${suffix}`,
    ),
    now,
  };
  return { request, now };
}

async function seedVoucher(voucherId: string, raterId: string, now: Date) {
  await dbClient.execute({
    sql: `INSERT INTO tokenless_paid_vouchers
          (voucher_id,rater_id,request_idempotency_key,request_hash,chain_id,panel_address,
           issuer_address,issuer_epoch,signer_address,round_id,content_id,vote_key,nullifier,
           admission_policy_hash,assurance_snapshot_hash,expires_at,payout_account_snapshot,
           voucher_json,voucher_signature,status,issued_at)
          VALUES (?,?,?, ?,84532,?,?,1,?,1,?,?,?,?,?,?,?,?,?,'issued',?)`,
    args: [
      voucherId,
      raterId,
      `legacy:${voucherId}`,
      hash(`legacy-request-${voucherId}`),
      `0x${"11".repeat(20)}`,
      `0x${"22".repeat(20)}`,
      `0x${"33".repeat(20)}`,
      `0x${"44".repeat(32)}`,
      `0x${"55".repeat(20)}`,
      `0x${"66".repeat(32)}`,
      `0x${"77".repeat(32)}`,
      hash(`assurance-${voucherId}`),
      new Date("2026-07-16T09:00:00.000Z"),
      RATER,
      JSON.stringify({ roundId: "1", voucherId }),
      `0x${"99".repeat(65)}`,
      now,
    ],
  });
}

test("paid voucher preparation freezes exact preflight, opportunity, profile, audience, and economics once", async () => {
  const { request } = await fixture("freeze");
  const prepared = await preparePaidReviewVoucherIssuance(request);
  assert.equal(prepared.status, "prepared");
  assert.equal(prepared.frozen.eligibilitySnapshotVersion, 1);
  assert.equal(prepared.frozen.paidEligibilityPreflightRef, request.paidEligibilityPreflight.reference);
  assert.equal(prepared.frozen.paidEligibilityPreflightHash, request.paidEligibilityPreflight.hash);
  assert.equal(prepared.frozen.requestProfile.hash, request.preparedRequest.requestProfile.hash);
  assert.equal(prepared.snapshot.audienceBinding.assignmentReference, request.audienceBinding.assignmentReference);
  assert.equal(prepared.snapshot.economics.maximumChargeAtomic, "3650000");
  assert.deepEqual(prepared.receipts, []);

  const replay = await preparePaidReviewVoucherIssuance(request);
  assert.equal(replay.issuanceId, prepared.issuanceId);
  assert.equal(
    Number(
      (await dbClient.execute("SELECT COUNT(*) AS count FROM tokenless_paid_review_eligibility_snapshots")).rows[0]
        ?.count,
    ),
    1,
  );

  await assert.rejects(
    () =>
      preparePaidReviewVoucherIssuance({
        ...request,
        audienceBinding: { ...request.audienceBinding, assignmentReference: "assignment:conflict" },
      }),
    (error: unknown) => error instanceof TokenlessServiceError && error.code === "paid_voucher_issuance_conflict",
  );
});

test("issuance fails closed without exact live paid-eligibility preflight evidence", async () => {
  const { request, now } = await fixture("preflight");
  await assert.rejects(
    () =>
      preparePaidReviewVoucherIssuance({
        ...request,
        paidEligibilityPreflight: { ...request.paidEligibilityPreflight, reference: "" },
      }),
    (error: unknown) => error instanceof TokenlessServiceError && error.code === "invalid_paid_review_voucher_binding",
  );
  await assert.rejects(
    () =>
      preparePaidReviewVoucherIssuance({
        ...request,
        paidEligibilityPreflight: { ...request.paidEligibilityPreflight, expiresAt: now },
      }),
    (error: unknown) => error instanceof TokenlessServiceError && error.code === "paid_eligibility_preflight_required",
  );
  assert.equal(
    Number(
      (await dbClient.execute("SELECT COUNT(*) AS count FROM tokenless_paid_review_voucher_issuances")).rows[0]?.count,
    ),
    0,
  );
});

test("commit 46 preflight IDs and eligibility commitments bind through the narrow signer seam", () => {
  const reference = paidEligibilityPreflightReference(
    {
      preflightId: "pef_exact_eligibility_0001",
      raterId: "rater_exact",
      eligibilityCommitment: hash("exact-eligibility"),
      checkedAt: "2026-07-16T07:59:00.000Z",
      validUntil: "2026-07-16T10:00:00.000Z",
    },
    "rater_exact",
  );
  assert.equal(reference.reference, "pef_exact_eligibility_0001");
  assert.equal(reference.hash, hash("exact-eligibility"));
  assert.throws(
    () =>
      paidEligibilityPreflightReference(
        {
          preflightId: "pef_exact_eligibility_0001",
          raterId: "rater_other",
          eligibilityCommitment: hash("exact-eligibility"),
          checkedAt: "2026-07-16T07:59:00.000Z",
          validUntil: "2026-07-16T10:00:00.000Z",
        },
        "rater_exact",
      ),
    (error: unknown) => error instanceof TokenlessServiceError && error.code === "paid_eligibility_preflight_mismatch",
  );
});

test("voucher attachment and consumption are idempotent and project append-only receipts", async () => {
  const { request, now } = await fixture("lifecycle");
  const prepared = await preparePaidReviewVoucherIssuance(request);
  const voucherId = "vch_paid_lifecycle_0001";
  await seedVoucher(voucherId, request.raterId, now);

  const issued = await completePaidReviewVoucherIssuance({ issuanceId: prepared.issuanceId, voucherId, issuedAt: now });
  assert.equal(issued.status, "issued");
  assert.equal(issued.voucher?.voucherId, voucherId);
  assert.equal(issued.receipts[0]?.type, "voucher_issued");
  const issuedReplay = await completePaidReviewVoucherIssuance({
    issuanceId: prepared.issuanceId,
    voucherId,
    issuedAt: new Date("2026-07-16T08:01:00.000Z"),
  });
  assert.equal(issuedReplay.receipts.length, 1);

  const consumption = {
    issuanceId: prepared.issuanceId,
    idempotencyKey: "consume:lifecycle:0001",
    consumptionReference: "commit:lifecycle:0001",
    consumptionEvidenceHash: hash("commit-lifecycle"),
    consumedAt: new Date("2026-07-16T08:02:00.000Z"),
  };
  const consumed = await consumePaidReviewVoucher(consumption);
  assert.equal(consumed.status, "consumed");
  assert.equal(consumed.consumption?.reference, consumption.consumptionReference);
  assert.deepEqual(
    consumed.receipts.map(receipt => receipt.type),
    ["voucher_issued", "voucher_consumed"],
  );
  const consumedReplay = await consumePaidReviewVoucher({
    ...consumption,
    consumedAt: new Date("2026-07-16T08:03:00.000Z"),
  });
  assert.equal(consumedReplay.receipts.length, 2);
  await assert.rejects(
    () => consumePaidReviewVoucher({ ...consumption, consumptionEvidenceHash: hash("different-commit") }),
    (error: unknown) => error instanceof TokenlessServiceError && error.code === "paid_voucher_consumption_conflict",
  );

  const projected = await getPaidReviewVoucherLifecycle(prepared.issuanceId);
  assert.equal(projected.receipts.length, 2);
  assert.equal(
    Number(
      (await dbClient.execute("SELECT COUNT(*) AS count FROM tokenless_paid_review_voucher_receipts")).rows[0]?.count,
    ),
    2,
  );
});
