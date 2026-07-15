import { NextRequest, NextResponse } from "next/server";
import { requireBrowserSession } from "~~/lib/auth/request";
import { cancelAgentConnectionIntent } from "~~/lib/tokenless/agentConnectionIntents";
import { tokenlessErrorResponse } from "~~/lib/tokenless/server";

export const runtime = "nodejs";

type Context = { params: Promise<{ intentId: string; workspaceId: string }> };

export async function DELETE(request: NextRequest, context: Context) {
  try {
    const session = await requireBrowserSession(request, { mutation: true });
    const { intentId, workspaceId } = await context.params;
    return NextResponse.json(
      await cancelAgentConnectionIntent({ accountAddress: session.principalId, intentId, workspaceId }),
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    const response = tokenlessErrorResponse(error);
    return NextResponse.json(response.body, { status: response.status });
  }
}
