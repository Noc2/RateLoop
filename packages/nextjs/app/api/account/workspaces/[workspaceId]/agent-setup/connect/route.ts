import { NextRequest, NextResponse } from "next/server";
import { requireBrowserSession } from "~~/lib/auth/request";
import { TokenlessServiceError, tokenlessErrorResponse } from "~~/lib/tokenless/server";
import { createWorkspaceAgentSetupConnection } from "~~/lib/tokenless/workspaceAgentSetup";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Context = { params: Promise<{ workspaceId: string }> };

export async function POST(request: NextRequest, context: Context) {
  try {
    const session = await requireBrowserSession(request, { mutation: true });
    const { workspaceId } = await context.params;
    const body = (await request.json()) as Record<string, unknown>;
    if (!body || Array.isArray(body) || Object.keys(body).some(key => key !== "revision")) {
      throw new TokenlessServiceError("Connection request is invalid.", 400, "invalid_agent_setup");
    }
    return NextResponse.json(
      await createWorkspaceAgentSetupConnection({
        accountAddress: session.principalId,
        workspaceId,
        origin: request.nextUrl.origin,
        revision: body.revision,
      }),
      { status: 201, headers: { "Cache-Control": "private, no-store, max-age=0" } },
    );
  } catch (error) {
    const response = tokenlessErrorResponse(error);
    return NextResponse.json(response.body, {
      status: response.status,
      headers: { "Cache-Control": "private, no-store, max-age=0" },
    });
  }
}
