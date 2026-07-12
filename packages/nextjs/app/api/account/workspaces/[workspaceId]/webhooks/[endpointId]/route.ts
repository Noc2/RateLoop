import { NextRequest, NextResponse } from "next/server";
import { requireBaseAccountRequest } from "~~/lib/base-account/request";
import { tokenlessErrorResponse } from "~~/lib/tokenless/server";
import { deactivateWorkspaceWebhook } from "~~/lib/tokenless/transparency";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ workspaceId: string; endpointId: string }> },
) {
  try {
    const session = await requireBaseAccountRequest(request, { mutation: true });
    const { workspaceId, endpointId } = await context.params;
    await deactivateWorkspaceWebhook({ accountAddress: session.address, workspaceId, endpointId });
    return NextResponse.json({ deactivated: true });
  } catch (error) {
    const response = tokenlessErrorResponse(error);
    return NextResponse.json(response.body, { status: response.status });
  }
}
