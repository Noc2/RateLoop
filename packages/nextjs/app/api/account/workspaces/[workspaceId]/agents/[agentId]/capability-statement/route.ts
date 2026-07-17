import { NextRequest, NextResponse } from "next/server";
import { requireBrowserSession } from "~~/lib/auth/request";
import { updateWorkspaceAgentCapabilityStatement } from "~~/lib/tokenless/agentRegistry";
import { TokenlessServiceError, tokenlessErrorResponse } from "~~/lib/tokenless/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Context = { params: Promise<{ workspaceId: string; agentId: string }> };

export async function PUT(request: NextRequest, context: Context) {
  try {
    const session = await requireBrowserSession(request, { mutation: true });
    let body: { statement?: unknown };
    try {
      body = (await request.json()) as typeof body;
    } catch {
      throw new TokenlessServiceError("Capability statement must be valid JSON.", 400, "invalid_capability_statement");
    }
    const { workspaceId, agentId } = await context.params;
    const agent = await updateWorkspaceAgentCapabilityStatement({
      accountAddress: session.principalId,
      workspaceId,
      agentId,
      statement: (body?.statement ?? {}) as Record<string, unknown>,
    });
    return NextResponse.json({ agent }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    const response = tokenlessErrorResponse(error);
    return NextResponse.json(response.body, { status: response.status });
  }
}
