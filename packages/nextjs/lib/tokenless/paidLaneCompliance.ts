import "server-only";
import { TokenlessServiceError } from "~~/lib/tokenless/server";

const HASH = /^sha256:[0-9a-f]{64}$/u;

export type PaidLaneComplianceApproval = {
  schemaVersion: "rateloop.paid-lane-compliance-approval.v1";
  dpiaApprovalReference: `sha256:${string}`;
  providerTransferInventoryReference: `sha256:${string}`;
  approvedAt: string;
};

export function paidLaneComplianceApproval(
  env: NodeJS.ProcessEnv = process.env,
  options: { force?: boolean; now?: Date } = {},
): PaidLaneComplianceApproval | null {
  if (!options.force && env.NODE_ENV !== "production") return null;
  const dpiaApprovalReference = env.TOKENLESS_PAID_LANES_DPIA_APPROVAL_REFERENCE?.trim();
  const providerTransferInventoryReference = env.TOKENLESS_PAID_LANES_TRANSFER_INVENTORY_APPROVAL_REFERENCE?.trim();
  const approvedAtValue = env.TOKENLESS_PAID_LANES_COMPLIANCE_APPROVED_AT?.trim();
  const approvedAt = approvedAtValue ? new Date(approvedAtValue) : new Date(Number.NaN);
  const now = options.now ?? new Date();
  if (
    !dpiaApprovalReference ||
    !HASH.test(dpiaApprovalReference) ||
    !providerTransferInventoryReference ||
    !HASH.test(providerTransferInventoryReference) ||
    !Number.isFinite(approvedAt.getTime()) ||
    approvedAt > now
  ) {
    throw new TokenlessServiceError(
      "Paid review is unavailable until the blockchain DPIA and provider-transfer inventory are approved.",
      503,
      "paid_lane_compliance_approval_required",
      true,
    );
  }
  return {
    schemaVersion: "rateloop.paid-lane-compliance-approval.v1",
    dpiaApprovalReference: dpiaApprovalReference as `sha256:${string}`,
    providerTransferInventoryReference: providerTransferInventoryReference as `sha256:${string}`,
    approvedAt: approvedAt.toISOString(),
  };
}

export function requirePaidLaneComplianceApproval(
  lane: "private_invited_paid" | "public_paid_network" | "hybrid_public_safe",
) {
  const approval = paidLaneComplianceApproval();
  if (process.env.NODE_ENV === "production" && !approval) {
    throw new TokenlessServiceError(
      `${lane} is unavailable until its compliance approval is configured.`,
      503,
      "paid_lane_compliance_approval_required",
      true,
    );
  }
  return approval;
}
