import { NextRequest, NextResponse } from "next/server";
import { requireBrowserSession } from "~~/lib/auth/request";
import { readApiJsonRequestBody, rethrowApiRequestBodyBoundaryError } from "~~/lib/tokenless/apiRequestBody";
import { grantProjectAccountAccess, listProjectAuditorAccess } from "~~/lib/tokenless/projectAccess";
import { TokenlessServiceError, tokenlessErrorResponse } from "~~/lib/tokenless/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const NO_STORE = "private, no-store, max-age=0";
const GRANT_KEYS = new Set(["subjectReference", "expiresAt"]);
type Context = { params: Promise<{ projectId: string; workspaceId: string }> };

function jsonResponse(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": NO_STORE } });
}

export async function GET(request: NextRequest, context: Context) {
  try {
    const session = await requireBrowserSession(request);
    const { projectId, workspaceId } = await context.params;
    return jsonResponse({
      auditors: await listProjectAuditorAccess({
        listedBy: session.principalId,
        projectId,
        workspaceId,
      }),
    });
  } catch (error) {
    const response = tokenlessErrorResponse(error);
    return jsonResponse(response.body, response.status);
  }
}

export async function POST(request: NextRequest, context: Context) {
  try {
    const session = await requireBrowserSession(request, { mutation: true });
    let value: unknown;
    try {
      value = await readApiJsonRequestBody(request);
    } catch (requestBodyError) {
      rethrowApiRequestBodyBoundaryError(requestBodyError);
      throw new TokenlessServiceError("Auditor grant must be valid JSON.", 400, "invalid_auditor_grant");
    }
    if (
      !value ||
      typeof value !== "object" ||
      Array.isArray(value) ||
      Object.keys(value).some(key => !GRANT_KEYS.has(key))
    ) {
      throw new TokenlessServiceError("Auditor grant is invalid.", 400, "invalid_auditor_grant");
    }
    const body = value as Record<string, unknown>;
    if (
      typeof body.subjectReference !== "string" ||
      !body.subjectReference.trim() ||
      body.subjectReference.length > 255 ||
      (body.expiresAt !== undefined && body.expiresAt !== null && typeof body.expiresAt !== "string")
    ) {
      throw new TokenlessServiceError("Auditor account and expiry are invalid.", 400, "invalid_auditor_grant");
    }
    const expiresAt =
      typeof body.expiresAt === "string" && body.expiresAt.trim() ? new Date(body.expiresAt.trim()) : null;
    if (expiresAt && !Number.isFinite(expiresAt.getTime())) {
      throw new TokenlessServiceError("Auditor expiry must be a valid timestamp.", 400, "invalid_auditor_grant");
    }
    const { projectId, workspaceId } = await context.params;
    const granted = await grantProjectAccountAccess({
      accountAddress: body.subjectReference,
      expiresAt,
      grantedBy: session.principalId,
      projectId,
      reason: "project_auditor",
      role: "auditor",
      workspaceId,
    });
    return jsonResponse(granted, 201);
  } catch (error) {
    const response = tokenlessErrorResponse(error);
    return jsonResponse(response.body, response.status);
  }
}
