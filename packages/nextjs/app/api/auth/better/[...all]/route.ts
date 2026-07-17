import { NextResponse } from "next/server";
import { getBetterAuth } from "~~/lib/auth/betterAuth";
import {
  type ScimUserProjection,
  assertEnterpriseSignInAllowed,
  assertScimDeprovisionScope,
  scimProviderIdForUser,
  synchronizeScimUser,
} from "~~/lib/auth/enterpriseIdentityPolicy";
import { AuthError } from "~~/lib/auth/session";
import { appendSecurityAuditEvent } from "~~/lib/privacy/audit";

export const runtime = "nodejs";
const BLOCKED_MANAGEMENT_PATHS = new Set([
  "/sso/register",
  "/sso/providers",
  "/sso/get-provider",
  "/sso/update-provider",
  "/sso/delete-provider",
  "/sso/request-domain-verification",
  "/sso/verify-domain",
  "/scim/generate-token",
  "/scim/list-provider-connections",
  "/scim/get-provider-connection",
  "/scim/delete-provider-connection",
]);

function scimActiveMutation(body: Record<string, unknown> | null) {
  if (typeof body?.active === "boolean") return body.active;
  if (!Array.isArray(body?.Operations)) return null;
  for (const operation of body.Operations) {
    if (!operation || typeof operation !== "object") continue;
    const value = operation as { path?: unknown; value?: unknown };
    const path = String(value.path ?? "")
      .trim()
      .replace(/^\//u, "")
      .toLowerCase();
    if (path === "active" && typeof value.value === "boolean") return value.value;
    if (!path && value.value && typeof value.value === "object") {
      const active = (value.value as { active?: unknown }).active;
      if (typeof active === "boolean") return active;
    }
  }
  return null;
}

async function handler(
  request: Request,
  betterHandler: (request: Request) => Promise<Response> = value => getBetterAuth().handler(value),
) {
  try {
    const pathname = new URL(request.url).pathname;
    const relativePath = pathname.replace(/^\/api\/auth\/better/u, "") || "/";
    if (BLOCKED_MANAGEMENT_PATHS.has(relativePath)) {
      return NextResponse.json({ error: "Use workspace identity settings." }, { status: 404 });
    }
    if (relativePath === "/email-otp/send-verification-otp" || relativePath === "/sign-in/email-otp") {
      const body = (await request
        .clone()
        .json()
        .catch(() => null)) as { email?: unknown } | null;
      if (typeof body?.email === "string") await assertEnterpriseSignInAllowed(body.email, "email-otp");
    }
    const scimUserMatch = relativePath.match(/^\/scim\/v2\/Users\/([^/]+)$/u);
    const scimUserId = scimUserMatch ? decodeURIComponent(scimUserMatch[1]!) : null;
    const scimProviderId = scimUserId ? await scimProviderIdForUser(scimUserId) : null;
    let scimProjection: ScimUserProjection | null = null;
    let desiredScimActive: boolean | null = null;
    if (scimUserId && request.method === "DELETE") {
      desiredScimActive = false;
      scimProjection = await assertScimDeprovisionScope(scimUserId, scimProviderId);
    }
    if (scimUserId && ["PATCH", "PUT"].includes(request.method)) {
      const body = (await request
        .clone()
        .json()
        .catch(() => null)) as Record<string, unknown> | null;
      desiredScimActive = scimActiveMutation(body);
      if (desiredScimActive === false) {
        scimProjection = await assertScimDeprovisionScope(scimUserId, scimProviderId);
      }
    }
    const response = await betterHandler(request);
    if (response.ok && relativePath.startsWith("/scim/v2/Users")) {
      if (scimUserId && desiredScimActive !== null) {
        await synchronizeScimUser({
          active: desiredScimActive,
          betterAuthUserId: scimUserId,
          projection: scimProjection,
          providerId: scimProviderId ?? undefined,
        });
      } else if (["POST", "PUT", "PATCH"].includes(request.method)) {
        const resource = (await response
          .clone()
          .json()
          .catch(() => null)) as { id?: unknown; active?: unknown } | null;
        if (typeof resource?.id === "string") {
          await synchronizeScimUser({
            active: resource.active !== false,
            betterAuthUserId: resource.id,
            providerId: scimProviderId ?? undefined,
          });
        }
      }
    }
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
    return NextResponse.json(
      { error: message },
      { status: error instanceof AuthError ? error.status : 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}

async function routeHandler(request: Request) {
  return handler(request);
}

export const GET = routeHandler;
export const POST = routeHandler;
export const PATCH = routeHandler;
export const DELETE = routeHandler;

export const __enterpriseAuthRouteTestUtils = {
  blockedManagementPaths: BLOCKED_MANAGEMENT_PATHS,
  handle: handler,
  scimActiveMutation,
};
