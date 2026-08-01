import { sha256Rfc8785 } from "@rateloop/node-utils/jcs";
import "server-only";
import { TokenlessServiceError } from "~~/lib/tokenless/server";

const IDEMPOTENCY_KEY = /^[A-Za-z0-9][A-Za-z0-9_.:-]{7,159}$/u;

export type CapabilityIssuanceKind = "project_window_compliance_share" | "benchmark_research_grant";

export function deriveCapabilityIssuanceIdempotency(input: {
  capabilityKind: CapabilityIssuanceKind;
  actorPrincipalId: string;
  workspaceId: string;
  projectId: string;
  idempotencyKey: string;
  request: unknown;
}) {
  if (!IDEMPOTENCY_KEY.test(input.idempotencyKey)) {
    throw new TokenlessServiceError(
      "Issuance idempotency key is invalid.",
      400,
      "invalid_capability_issuance_idempotency_key",
      false,
      "idempotencyKey",
    );
  }
  const scope = {
    capabilityKind: input.capabilityKind,
    actorPrincipalId: input.actorPrincipalId,
    workspaceId: input.workspaceId,
    projectId: input.projectId,
  } as const;
  return {
    idempotencyKeyDigest: sha256Rfc8785({
      domain: "rateloop.capability-issuance-idempotency.v1",
      ...scope,
      idempotencyKey: input.idempotencyKey,
    }),
    requestBindingHash: sha256Rfc8785({
      domain: "rateloop.capability-issuance-request.v1",
      ...scope,
      request: input.request,
    }),
  } as const;
}
