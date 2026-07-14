import { NextRequest, NextResponse } from "next/server";
import { requireBrowserSession } from "~~/lib/auth/request";
import { type AgentVersionInput, createWorkspaceAgent, listWorkspaceAgents } from "~~/lib/tokenless/agentRegistry";
import { TokenlessServiceError, tokenlessErrorResponse } from "~~/lib/tokenless/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Context = { params: Promise<{ workspaceId: string }> };

type CreateAgentBody = AgentVersionInput & { externalId: string };

export async function GET(request: NextRequest, context: Context) {
  try {
    const session = await requireBrowserSession(request);
    const { workspaceId } = await context.params;
    return NextResponse.json(await listWorkspaceAgents({ accountAddress: session.address, workspaceId }), {
      headers: { "Cache-Control": "private, no-store, max-age=0" },
    });
  } catch (error) {
    const response = tokenlessErrorResponse(error);
    return NextResponse.json(response.body, {
      status: response.status,
      headers: { "Cache-Control": "private, no-store, max-age=0" },
    });
  }
}

export async function POST(request: NextRequest, context: Context) {
  try {
    const session = await requireBrowserSession(request, { mutation: true });
    const { workspaceId } = await context.params;
    const body = (await request.json()) as CreateAgentBody | null;
    if (!body || typeof body !== "object") {
      throw new TokenlessServiceError("Agent request body must be an object.", 400, "invalid_agent");
    }
    const agent = await createWorkspaceAgent({
      accountAddress: session.address,
      workspaceId,
      externalId: body.externalId,
      version: body,
    });
    return NextResponse.json({ agent }, { status: 201 });
  } catch (error) {
    const response = tokenlessErrorResponse(error);
    return NextResponse.json(response.body, { status: response.status });
  }
}
