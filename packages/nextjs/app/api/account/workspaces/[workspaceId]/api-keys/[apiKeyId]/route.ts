import { NextRequest, NextResponse } from "next/server";
import { requireBaseAccountRequest } from "~~/lib/base-account/request";
import { revokeWorkspaceApiKey } from "~~/lib/tokenless/productCore";
import { tokenlessErrorResponse } from "~~/lib/tokenless/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ workspaceId: string; apiKeyId: string }> },
) {
  try {
    const session = await requireBaseAccountRequest(request, { mutation: true });
    const { workspaceId, apiKeyId } = await context.params;
    await revokeWorkspaceApiKey({ accountAddress: session.address, workspaceId, apiKeyId });
    return NextResponse.json({ revoked: true });
  } catch (error) {
    const response = tokenlessErrorResponse(error);
    return NextResponse.json(response.body, { status: response.status });
  }
}
