import { NextRequest, NextResponse } from "next/server";
import { requireBaseAccountRequest } from "~~/lib/base-account/request";
import { tokenlessErrorResponse } from "~~/lib/tokenless/server";
import { inspectWorkspaceTransparency } from "~~/lib/tokenless/transparency";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ workspaceId: string; operationKey: string }> },
) {
  try {
    const session = await requireBaseAccountRequest(request);
    const { workspaceId, operationKey } = await context.params;
    return NextResponse.json(
      await inspectWorkspaceTransparency({ accountAddress: session.address, workspaceId, operationKey }),
    );
  } catch (error) {
    const response = tokenlessErrorResponse(error);
    return NextResponse.json(response.body, { status: response.status });
  }
}
