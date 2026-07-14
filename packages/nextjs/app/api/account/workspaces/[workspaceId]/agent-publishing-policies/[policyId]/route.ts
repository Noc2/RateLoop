import { NextRequest, NextResponse } from "next/server";
import { requireBrowserSession } from "~~/lib/auth/request";
import { revokeAgentPublishingPolicy } from "~~/lib/tokenless/productCore";
import { tokenlessErrorResponse } from "~~/lib/tokenless/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Context = { params: Promise<{ policyId: string; workspaceId: string }> };

export async function DELETE(request: NextRequest, context: Context) {
  try {
    const session = await requireBrowserSession(request, { mutation: true });
    const { policyId, workspaceId } = await context.params;
    await revokeAgentPublishingPolicy({ accountAddress: session.address, workspaceId, policyId });
    return NextResponse.json({ revoked: true });
  } catch (error) {
    const response = tokenlessErrorResponse(error);
    return NextResponse.json(response.body, { status: response.status });
  }
}
