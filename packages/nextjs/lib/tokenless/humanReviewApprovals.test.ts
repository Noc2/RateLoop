import assert from "node:assert/strict";
import test from "node:test";
import { __humanReviewApprovalTestUtils } from "~~/lib/tokenless/humanReviewApprovals";

const HASH = (character: string) => `sha256:${character.repeat(64)}`;

function fixture() {
  const expiresAt = "2026-07-16T13:00:00.000Z";
  const preparedRequest = {
    schemaVersion: "rateloop.human-review-prepared-request.v1",
    opportunityId: "aop_exact",
    workflowKey: "support-reply",
    requestProfile: { id: "rrp_exact", version: 2, hash: HASH("a") },
    question: {
      criterion: "Is this correct?",
      positiveLabel: "Approve",
      negativeLabel: "Reject",
      rationaleMode: "required",
    },
    audience: {
      kind: "private_invited",
      contentBoundary: "private_workspace",
      privateSensitivity: "confidential",
      privateGroupId: "pgrp_exact",
    },
    timing: { responseWindowSeconds: 3600, expiresAt },
    panel: { size: 2 },
    contentCommitments: { source: HASH("b"), suggestion: HASH("c") },
    provenance: {
      agentId: "agent_exact",
      agentVersionId: "version_exact",
      selectionPolicyId: "rpol_exact",
      selectionPolicyVersion: 3,
    },
  };
  const economics = {
    schemaVersion: "rateloop.human-review-derived-economics.v1",
    compensationMode: "usdc",
    bountyPerSeatAtomic: "1000000",
    panelSize: 2,
    baseBountyAtomic: "2000000",
    maxFeeBps: 750,
    feeAtomic: "150000",
    attemptReserveAtomic: "500000",
    maximumChargeAtomic: "2650000",
  };
  return {
    approval_id: "hrap_exact",
    opportunity_id: "aop_exact",
    revision: 1,
    request_profile_id: "rrp_exact",
    request_profile_version: 2,
    request_profile_hash: HASH("a"),
    source_evidence_hash: HASH("b"),
    suggestion_commitment: HASH("c"),
    prepared_request_json: JSON.stringify(preparedRequest),
    prepared_request_hash: __humanReviewApprovalTestUtils.sha256(preparedRequest),
    derived_economics_json: JSON.stringify(economics),
    derived_economics_hash: __humanReviewApprovalTestUtils.sha256(economics),
    maximum_charge_atomic: "2650000",
    status: "pending",
    lifecycle_state: "approval_required",
    lifecycle_revision: 4,
    created_at: "2026-07-16T12:00:00.000Z",
    expires_at: expiresAt,
  };
}

test("approval projection exposes the exact frozen request, economics, workflow, and provenance", () => {
  const approval = __humanReviewApprovalTestUtils.approvalFromRow(fixture());
  assert.equal(approval.preparedRequest.workflowKey, "support-reply");
  assert.equal(approval.preparedRequest.question.criterion, "Is this correct?");
  assert.equal(approval.preparedRequest.provenance.agentVersionId, "version_exact");
  assert.equal(approval.economics.maximumChargeAtomic, "2650000");
  assert.equal(approval.lifecycleRevision, 4);
});

test("approval projection fails closed on hash, binding, charge, or lifecycle drift", () => {
  for (const override of [
    { prepared_request_hash: HASH("f") },
    { source_evidence_hash: HASH("f") },
    { maximum_charge_atomic: "2650001" },
    { lifecycle_state: "blocked" },
  ]) {
    assert.throws(() => __humanReviewApprovalTestUtils.approvalFromRow({ ...fixture(), ...override }));
  }
});

test("approval projection rejects inconsistent audience, panel, and economics terms", () => {
  const cases = [
    (row: ReturnType<typeof fixture>) => {
      const prepared = JSON.parse(row.prepared_request_json);
      prepared.audience.privateGroupId = null;
      return {
        ...row,
        prepared_request_json: JSON.stringify(prepared),
        prepared_request_hash: __humanReviewApprovalTestUtils.sha256(prepared),
      };
    },
    (row: ReturnType<typeof fixture>) => {
      const prepared = JSON.parse(row.prepared_request_json);
      prepared.panel.size = 101;
      return {
        ...row,
        prepared_request_json: JSON.stringify(prepared),
        prepared_request_hash: __humanReviewApprovalTestUtils.sha256(prepared),
      };
    },
    (row: ReturnType<typeof fixture>) => {
      const economics = JSON.parse(row.derived_economics_json);
      economics.feeAtomic = "149999";
      return {
        ...row,
        derived_economics_json: JSON.stringify(economics),
        derived_economics_hash: __humanReviewApprovalTestUtils.sha256(economics),
      };
    },
  ];
  for (const mutate of cases) {
    assert.throws(() => __humanReviewApprovalTestUtils.approvalFromRow(mutate(fixture())));
  }
});
