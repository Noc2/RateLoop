import { NextRequest, NextResponse } from "next/server";
import { requireBrowserSession } from "~~/lib/auth/request";
import { approveAgentPairing } from "~~/lib/tokenless/agentIntegrations";
import { tokenlessErrorResponse } from "~~/lib/tokenless/server";

export const runtime = "nodejs";
type Context = { params: Promise<{ workspaceId: string; pairingId: string }> };
export async function POST(request: NextRequest, context: Context) {
  try {
    const session = await requireBrowserSession(request, { mutation: true });
    const { workspaceId, pairingId } = await context.params;
    return NextResponse.json(
      await approveAgentPairing({
        accountAddress: session.address,
        workspaceId,
        pairingId,
        body: await request.json(),
      }),
    );
  } catch (error) {
    const response = tokenlessErrorResponse(error);
    return NextResponse.json(response.body, { status: response.status });
  }
}
