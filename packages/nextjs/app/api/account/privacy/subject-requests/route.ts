import { NextRequest, NextResponse } from "next/server";
import { requireBrowserSession } from "~~/lib/auth/request";
import { SUBJECT_REQUEST_TYPES, type SubjectRequestType, createSubjectRequest } from "~~/lib/privacy/lifecycle";
import { scopeAssuranceSessionToWorkspace } from "~~/lib/tokenless/humanAssurance";
import { TokenlessServiceError, tokenlessErrorResponse } from "~~/lib/tokenless/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const NO_STORE = { "Cache-Control": "private, no-store, max-age=0" } as const;
const MAX_SCOPE_BYTES = 16 * 1024;

function parseScope(value: unknown) {
  if (value === undefined) return { account: true };
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TokenlessServiceError("Subject request scope must be an object.", 400, "invalid_privacy_request");
  }
  let encoded: string;
  try {
    encoded = JSON.stringify(value);
  } catch {
    throw new TokenlessServiceError("Subject request scope is invalid.", 400, "invalid_privacy_request");
  }
  if (Buffer.byteLength(encoded, "utf8") > MAX_SCOPE_BYTES) {
    throw new TokenlessServiceError("Subject request scope is too large.", 413, "privacy_request_too_large");
  }
  return value as Record<string, unknown>;
}

export async function POST(request: NextRequest) {
  try {
    const session = await requireBrowserSession(request, { mutation: true });
    let body: Record<string, unknown> | null;
    try {
      body = (await request.json()) as Record<string, unknown> | null;
    } catch {
      throw new TokenlessServiceError("Subject request body must be valid JSON.", 400, "invalid_privacy_request");
    }
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      throw new TokenlessServiceError("Subject request body must be an object.", 400, "invalid_privacy_request");
    }
    if (
      typeof body.requestType !== "string" ||
      !SUBJECT_REQUEST_TYPES.includes(body.requestType as SubjectRequestType)
    ) {
      throw new TokenlessServiceError("Subject request type is invalid.", 400, "invalid_privacy_request");
    }
    if (
      body.workspaceId !== undefined &&
      (typeof body.workspaceId !== "string" || !body.workspaceId.trim() || body.workspaceId.length > 160)
    ) {
      throw new TokenlessServiceError("Subject request workspace is invalid.", 400, "invalid_privacy_request");
    }
    const workspaceId = typeof body.workspaceId === "string" ? body.workspaceId.trim() : null;
    if (workspaceId) {
      await scopeAssuranceSessionToWorkspace({ accountAddress: session.principalId, workspaceId });
    }
    const created = await createSubjectRequest({
      identityAssurance: session.authProvider,
      principalId: session.principalId,
      requestType: body.requestType as SubjectRequestType,
      scope: parseScope(body.scope),
      workspaceId,
    });
    return NextResponse.json(created, { headers: NO_STORE, status: 202 });
  } catch (error) {
    const response = tokenlessErrorResponse(error);
    return NextResponse.json(response.body, { headers: NO_STORE, status: response.status });
  }
}
