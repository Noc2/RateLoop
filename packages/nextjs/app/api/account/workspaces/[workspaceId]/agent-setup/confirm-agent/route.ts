import { NextRequest, NextResponse } from "next/server";
import { requireBrowserSession } from "~~/lib/auth/request";
import { TokenlessServiceError, tokenlessErrorResponse } from "~~/lib/tokenless/server";
import { confirmWorkspaceSetupAgent } from "~~/lib/tokenless/workspaceAgentSetup";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Context = { params: Promise<{ workspaceId: string }> };

export async function POST(request: NextRequest, context: Context) {
  try {
    const session = await requireBrowserSession(request, { mutation: true });
    const { workspaceId } = await context.params;
    const body = (await request.json()) as Record<string, unknown>;
    if (
      !body ||
      Array.isArray(body) ||
      Object.keys(body).some(key => !["revision", "agent"].includes(key)) ||
      !body.agent ||
      typeof body.agent !== "object" ||
      Array.isArray(body.agent)
    ) {
      throw new TokenlessServiceError("Agent confirmation is invalid.", 400, "invalid_agent_setup");
    }
    const agent = body.agent as Record<string, unknown>;
    const allowedAgentFields = new Set([
      "displayName",
      "description",
      "provider",
      "model",
      "modelVersion",
      "environment",
    ]);
    if (Object.keys(agent).some(key => !allowedAgentFields.has(key))) {
      throw new TokenlessServiceError("Agent confirmation contains unsupported fields.", 400, "invalid_agent_setup");
    }
    return NextResponse.json(
      await confirmWorkspaceSetupAgent({
        accountAddress: session.principalId,
        workspaceId,
        revision: body.revision,
        agent: agent as {
          displayName: string;
          description?: string | null;
          provider?: string | null;
          model?: string | null;
          modelVersion?: string | null;
          environment?: "staging" | "production";
        },
      }),
      { headers: { "Cache-Control": "private, no-store, max-age=0" } },
    );
  } catch (error) {
    const response = tokenlessErrorResponse(error);
    return NextResponse.json(response.body, {
      status: response.status,
      headers: { "Cache-Control": "private, no-store, max-age=0" },
    });
  }
}
