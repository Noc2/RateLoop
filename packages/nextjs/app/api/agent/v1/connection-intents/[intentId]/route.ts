import { NextRequest, NextResponse } from "next/server";
import { getPublicAgentConnectionIntent } from "~~/lib/tokenless/agentConnectionIntents";
import { tokenlessErrorResponse } from "~~/lib/tokenless/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Context = { params: Promise<{ intentId: string }> };

export async function GET(request: NextRequest, context: Context) {
  try {
    const { intentId } = await context.params;
    const intent = await getPublicAgentConnectionIntent(intentId);
    const origin = request.nextUrl.origin;
    return NextResponse.json(
      {
        schemaVersion: "2026-07-17",
        kind: "rateloop.agent-connection-handoff",
        intent,
        canonicalUrl: `${origin}/connect/${intentId}`,
        mcpResource: `${origin}/api/agent/v1/mcp`,
        connect: {
          tool: "rateloop_connect_workspace",
          input: "Pass the complete original connection URL, including its local fragment, as connectionUrl.",
          success: "Require connected=true and follow the returned context and nextAction.",
        },
        claim: {
          tool: "rateloop_claim_connection_intent",
          input: "Pass the complete original connection URL, including its local fragment, as connectionUrl.",
        },
        next: ["rateloop_get_agent_context", "rateloop_verify_connection"],
        recovery: {
          documentation: `${origin}/docs/agent-connection.md`,
          rule: "Preserve and resume the original connection URL; never ask the owner to paste it again.",
        },
      },
      {
        headers: {
          "Cache-Control": "public, no-store, max-age=0",
          "Referrer-Policy": "no-referrer",
          "X-Content-Type-Options": "nosniff",
        },
      },
    );
  } catch (error) {
    const response = tokenlessErrorResponse(error);
    return NextResponse.json(response.body, {
      headers: { "Cache-Control": "public, no-store, max-age=0" },
      status: response.status,
    });
  }
}
