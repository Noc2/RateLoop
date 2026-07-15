import { NextResponse } from "next/server";
import { getBetterAuth } from "~~/lib/auth/betterAuth";
import { appendSecurityAuditEvent } from "~~/lib/privacy/audit";

export const runtime = "nodejs";

async function handler(request: Request) {
  try {
    const response = await getBetterAuth().handler(request);
    if (request.method !== "GET" && response.status >= 400) {
      await appendSecurityAuditEvent({
        action: "auth.provider_request_denied",
        actorKind: "system",
        actorReference: "anonymous",
        assuranceMethod: "better_auth",
        metadata: { method: request.method, path: new URL(request.url).pathname, status: response.status },
        purpose: "account_access",
        reason: "provider_request_rejected",
        requestCorrelation: request.headers.get("x-request-id"),
        result: "denied",
        scopeId: "authentication",
        scopeKind: "system",
        targetId: "better_auth",
        targetKind: "identity_provider",
      }).catch(() => undefined);
    }
    return response;
  } catch (error) {
    await appendSecurityAuditEvent({
      action: "auth.provider_unavailable",
      actorKind: "system",
      actorReference: "system:better_auth",
      assuranceMethod: "service_configuration",
      purpose: "account_access",
      reason: "provider_unavailable",
      requestCorrelation: request.headers.get("x-request-id"),
      result: "failure",
      scopeId: "authentication",
      scopeKind: "system",
      targetId: "better_auth",
      targetKind: "identity_provider",
    }).catch(() => undefined);
    const message = error instanceof Error ? error.message : "Better Auth is not configured.";
    return NextResponse.json({ error: message }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}

export const GET = handler;
export const POST = handler;
export const PATCH = handler;
export const DELETE = handler;
