import { NextRequest, NextResponse } from "next/server";
import { requireBrowserSession } from "~~/lib/auth/request";
import { rotateAgentIntegration } from "~~/lib/tokenless/agentIntegrations";
import { tokenlessErrorResponse } from "~~/lib/tokenless/server";

export const runtime = "nodejs";
type Context = { params: Promise<{ workspaceId: string; integrationId: string }> };
export async function POST(request: NextRequest, context: Context) {
  try {
    const session = await requireBrowserSession(request, { mutation: true });
    const { workspaceId, integrationId } = await context.params;
    return NextResponse.json(
      await rotateAgentIntegration({
        accountAddress: session.principalId,
        workspaceId,
        integrationId,
        origin: request.nextUrl.origin,
      }),
    );
  } catch (error) {
    const response = tokenlessErrorResponse(error);
    return NextResponse.json(response.body, { status: response.status });
  }
}
