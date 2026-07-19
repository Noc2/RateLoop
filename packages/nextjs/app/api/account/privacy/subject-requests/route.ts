import { NextRequest, NextResponse } from "next/server";
import { requireBrowserSession } from "~~/lib/auth/request";
import { dbClient } from "~~/lib/db";
import { SUBJECT_REQUEST_TYPES, type SubjectRequestType, createSubjectRequest } from "~~/lib/privacy/lifecycle";
import { TokenlessServiceError, tokenlessErrorResponse } from "~~/lib/tokenless/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const NO_STORE = { "Cache-Control": "private, no-store, max-age=0" } as const;

function optionalWorkspaceId(value: unknown) {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string" || !/^ws_[A-Za-z0-9_-]{8,120}$/u.test(value)) {
    throw new TokenlessServiceError("Subject request workspace is invalid.", 400, "invalid_privacy_request");
  }
  return value;
}

async function requireWorkspaceMembership(principalId: string, workspaceId: string) {
  const membership = await dbClient.execute({
    sql: `SELECT m.workspace_id FROM tokenless_workspace_members m
          JOIN tokenless_workspaces w ON w.workspace_id = m.workspace_id
          WHERE m.workspace_id = ? AND m.account_address = ? AND w.status = 'active' LIMIT 1`,
    args: [workspaceId, principalId],
  });
  if (membership.rowCount !== 1) {
    throw new TokenlessServiceError("Workspace not found.", 404, "workspace_not_found");
  }
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
    const workspaceId = optionalWorkspaceId(body.workspaceId);
    if (workspaceId) await requireWorkspaceMembership(session.principalId, workspaceId);
    const receipt = await createSubjectRequest({
      identityAssurance: session.authProvider,
      principalId: session.principalId,
      requestType: body.requestType as SubjectRequestType,
      scope: {
        principal: true,
        ...(workspaceId ? { workspaceId } : {}),
      },
      workspaceId,
    });
    return NextResponse.json(receipt, { headers: NO_STORE, status: 202 });
  } catch (error) {
    const response = tokenlessErrorResponse(error);
    return NextResponse.json(response.body, { headers: NO_STORE, status: response.status });
  }
}
