import { createHash } from "node:crypto";
import type { TokenlessScheduledWorkKind } from "~~/lib/tokenless/scheduledWorkItems";

export type StripeRefundReversalIdentity =
  | { kind: "refund"; refundId: string }
  | { kind: "charge_running_total"; amountRefundedMinor: number; chargeId: string };

export function stripeRefundReversalKey(identity: StripeRefundReversalIdentity) {
  return identity.kind === "refund" ? identity.refundId : `${identity.chargeId}:${identity.amountRefundedMinor}`;
}

export function tokenlessScheduledWorkItemId(kind: TokenlessScheduledWorkKind, subjectKey: string) {
  return `swi_${createHash("sha256").update(`${kind}:${subjectKey}`).digest("hex").slice(0, 40)}`;
}

export function drataGrcSessionId(idempotencyKey: string) {
  return `rl_${createHash("sha256").update(idempotencyKey).digest("hex").slice(0, 40)}`;
}

export function vantaGrcDocumentFileName(bundleId: string) {
  return `rateloop-assurance-${bundleId}.json`;
}

export function artifactDeletionAuditKey(objectId: string) {
  return `artifact-retention:${objectId}`;
}

export function workspaceDeletionRetentionWorkItemKey(jobId: string, category: string) {
  return `${jobId}:${category}`;
}
