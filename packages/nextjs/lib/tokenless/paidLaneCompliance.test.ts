import assert from "node:assert/strict";
import test from "node:test";
import { paidLaneComplianceApproval } from "~~/lib/tokenless/paidLaneCompliance";
import { TokenlessServiceError } from "~~/lib/tokenless/server";

const HASH_A = `sha256:${"a".repeat(64)}`;
const HASH_B = `sha256:${"b".repeat(64)}`;

test("production paid lanes fail closed without DPIA and transfer-inventory approval", () => {
  assert.throws(
    () => paidLaneComplianceApproval({ NODE_ENV: "production" }, { force: true }),
    (error: unknown) =>
      error instanceof TokenlessServiceError &&
      error.code === "paid_lane_compliance_approval_required" &&
      error.retryable,
  );
});

test("paid lane approval contains only documented approval references", () => {
  assert.deepEqual(
    paidLaneComplianceApproval(
      {
        NODE_ENV: "production",
        TOKENLESS_PAID_LANES_DPIA_APPROVAL_REFERENCE: HASH_A,
        TOKENLESS_PAID_LANES_TRANSFER_INVENTORY_APPROVAL_REFERENCE: HASH_B,
        TOKENLESS_PAID_LANES_COMPLIANCE_APPROVED_AT: "2026-07-20T12:00:00.000Z",
      },
      { force: true, now: new Date("2026-07-26T12:00:00.000Z") },
    ),
    {
      schemaVersion: "rateloop.paid-lane-compliance-approval.v1",
      dpiaApprovalReference: HASH_A,
      providerTransferInventoryReference: HASH_B,
      approvedAt: "2026-07-20T12:00:00.000Z",
    },
  );
});

test("future-dated approvals are rejected", () => {
  assert.throws(
    () =>
      paidLaneComplianceApproval(
        {
          NODE_ENV: "production",
          TOKENLESS_PAID_LANES_DPIA_APPROVAL_REFERENCE: HASH_A,
          TOKENLESS_PAID_LANES_TRANSFER_INVENTORY_APPROVAL_REFERENCE: HASH_B,
          TOKENLESS_PAID_LANES_COMPLIANCE_APPROVED_AT: "2026-07-27T12:00:00.000Z",
        },
        { force: true, now: new Date("2026-07-26T12:00:00.000Z") },
      ),
    (error: unknown) =>
      error instanceof TokenlessServiceError && error.code === "paid_lane_compliance_approval_required",
  );
});
