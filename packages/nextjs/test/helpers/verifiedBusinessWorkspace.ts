import { recordOperatorBusinessVerification } from "~~/lib/billing/businessCustomerEligibility";
import { updateWorkspaceBillingProfile } from "~~/lib/billing/workspaceBilling";

const BUSINESS_VERIFICATION_EVIDENCE_HASH = "f".repeat(64);

export async function verifyBusinessWorkspaceForTest(input: {
  accountAddress: string;
  workspaceId: string;
  now?: Date;
}) {
  const now = input.now ?? new Date();
  await updateWorkspaceBillingProfile({
    accountAddress: input.accountAddress,
    workspaceId: input.workspaceId,
    legalName: "RateLoop Test Customer GmbH",
    registeredAddress: "Teststrasse 1, 10115 Berlin",
  });
  return recordOperatorBusinessVerification({
    workspaceId: input.workspaceId,
    operatorReference: "operator:test-legal-ops",
    verificationMethod: "commercial_register",
    verificationReferenceHash: BUSINESS_VERIFICATION_EVIDENCE_HASH,
    verifiedAt: now,
    verificationExpiresAt: new Date(now.getTime() + 365 * 24 * 60 * 60 * 1_000),
    reason: "Test fixture matched the billing profile to retained commercial-register evidence.",
  });
}
