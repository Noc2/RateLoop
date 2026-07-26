import assert from "node:assert/strict";
import test from "node:test";
import { derivePaidLaneActivationReference } from "~~/lib/tokenless/paidLaneActivation";
import { paidLaneComplianceApproval, requirePaidLaneComplianceApproval } from "~~/lib/tokenless/paidLaneCompliance";
import { TokenlessServiceError } from "~~/lib/tokenless/server";

const HASH_A = `sha256:${"a".repeat(64)}`;
const HASH_B = `sha256:${"b".repeat(64)}`;
const HASH_C = `sha256:${"c".repeat(64)}`;

test("paid lanes fail closed without DPIA and transfer-inventory approval in every environment", () => {
  assert.throws(
    () => paidLaneComplianceApproval({ NODE_ENV: "test" }),
    (error: unknown) =>
      error instanceof TokenlessServiceError &&
      error.code === "paid_lane_compliance_approval_required" &&
      error.retryable,
  );
});

test("the runtime gate rejects a forged activation reference outside production", () => {
  const activation: NodeJS.ProcessEnv = {
    NODE_ENV: "test",
    TOKENLESS_PRIVATE_PAID_REVIEWS_ENABLED: "true",
    TOKENLESS_NETWORK_PANELS_ENABLED: "false",
    TOKENLESS_HYBRID_REVIEWS_ENABLED: "false",
    NEXT_PUBLIC_TOKENLESS_PRIVATE_PAID_REVIEWS_ENABLED: "true",
    NEXT_PUBLIC_TOKENLESS_NETWORK_PANELS_ENABLED: "false",
    NEXT_PUBLIC_TOKENLESS_HYBRID_REVIEWS_ENABLED: "false",
    TOKENLESS_PAID_LANES_DPIA_APPROVAL_REFERENCE: HASH_A,
    TOKENLESS_PAID_LANES_TRANSFER_INVENTORY_APPROVAL_REFERENCE: HASH_B,
    TOKENLESS_PAID_LANES_FUNDING_VALIDATION_REFERENCE: HASH_C,
    TOKENLESS_INVITED_PAID_ADULTHOOD_APPROVAL_REFERENCE: `sha256:${"d".repeat(64)}`,
    TOKENLESS_PAID_LANES_COMPLIANCE_APPROVED_AT: "2026-07-20T12:00:00.000Z",
    NEXT_PUBLIC_TOKENLESS_PAID_LANES_ACTIVATION_REFERENCE: `sha256:${"f".repeat(64)}`,
  };
  const names = Object.keys(activation);
  const previous = new Map(names.map(name => [name, process.env[name]]));
  try {
    Object.assign(process.env, activation);
    assert.throws(
      () => requirePaidLaneComplianceApproval("private_invited_paid"),
      (error: unknown) => error instanceof TokenlessServiceError && error.code === "paid_lane_activation_required",
    );
    process.env.NEXT_PUBLIC_TOKENLESS_PAID_LANES_ACTIVATION_REFERENCE = derivePaidLaneActivationReference(process.env);
    assert.equal(requirePaidLaneComplianceApproval("private_invited_paid")?.approvedAt, "2026-07-20T12:00:00.000Z");
  } finally {
    for (const name of names) {
      const value = previous.get(name);
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
});

test("paid lane approval contains only documented approval references", () => {
  assert.deepEqual(
    paidLaneComplianceApproval(
      {
        NODE_ENV: "production",
        TOKENLESS_PAID_LANES_DPIA_APPROVAL_REFERENCE: HASH_A,
        TOKENLESS_PAID_LANES_TRANSFER_INVENTORY_APPROVAL_REFERENCE: HASH_B,
        TOKENLESS_PAID_LANES_FUNDING_VALIDATION_REFERENCE: HASH_C,
        TOKENLESS_PAID_LANES_COMPLIANCE_APPROVED_AT: "2026-07-20T12:00:00.000Z",
      },
      { force: true, now: new Date("2026-07-26T12:00:00.000Z") },
    ),
    {
      schemaVersion: "rateloop.paid-lane-compliance-approval.v1",
      dpiaApprovalReference: HASH_A,
      providerTransferInventoryReference: HASH_B,
      fundedDeploymentReference: HASH_C,
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
          TOKENLESS_PAID_LANES_FUNDING_VALIDATION_REFERENCE: HASH_C,
          TOKENLESS_PAID_LANES_COMPLIANCE_APPROVED_AT: "2026-07-27T12:00:00.000Z",
        },
        { force: true, now: new Date("2026-07-26T12:00:00.000Z") },
      ),
    (error: unknown) =>
      error instanceof TokenlessServiceError && error.code === "paid_lane_compliance_approval_required",
  );
});
