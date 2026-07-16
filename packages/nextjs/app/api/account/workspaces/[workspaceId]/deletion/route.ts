import { NextRequest, NextResponse } from "next/server";
import { requireBrowserSession } from "~~/lib/auth/request";
import { getWorkspaceDeletionPreview, requestWorkspaceDeletion } from "~~/lib/privacy/workspaceDeletion";
import { TokenlessServiceError, tokenlessErrorResponse } from "~~/lib/tokenless/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const PRIVATE_NO_STORE = { "Cache-Control": "private, no-store, max-age=0" };

type Context = { params: Promise<{ workspaceId: string }> };

export async function GET(request: NextRequest, context: Context) {
  try {
    const session = await requireBrowserSession(request);
    const { workspaceId } = await context.params;
    return NextResponse.json(await getWorkspaceDeletionPreview({ accountAddress: session.principalId, workspaceId }), {
      headers: PRIVATE_NO_STORE,
    });
  } catch (error) {
    const response = tokenlessErrorResponse(error);
    return NextResponse.json(response.body, { status: response.status, headers: PRIVATE_NO_STORE });
  }
}

export async function POST(request: NextRequest, context: Context) {
  try {
    const session = await requireBrowserSession(request, { mutation: true });
    const { workspaceId } = await context.params;
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      throw new TokenlessServiceError("Workspace deletion body must be valid JSON.", 400, "invalid_workspace_deletion");
    }
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      throw new TokenlessServiceError("Workspace deletion body must be an object.", 400, "invalid_workspace_deletion");
    }
    return NextResponse.json(
      await requestWorkspaceDeletion({
        accountAddress: session.principalId,
        confirmationName: String((body as Record<string, unknown>).confirmationName ?? ""),
        identityAssurance: session.authProvider,
        workspaceId,
      }),
      { status: 202, headers: PRIVATE_NO_STORE },
    );
  } catch (error) {
    const response = tokenlessErrorResponse(error);
    return NextResponse.json(response.body, { status: response.status, headers: PRIVATE_NO_STORE });
  }
}
