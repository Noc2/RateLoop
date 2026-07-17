import { NextRequest, NextResponse } from "next/server";
import { revokeWorkspaceScimConnection } from "~~/lib/auth/enterpriseIdentity";
import { requireBrowserSession } from "~~/lib/auth/request";
import { tokenlessErrorResponse } from "~~/lib/tokenless/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
type Context = { params: Promise<{ providerId: string; workspaceId: string }> };
const noStore = { "Cache-Control": "private, no-store, max-age=0" };

export async function DELETE(request: NextRequest, context: Context) {
  try {
    const session = await requireBrowserSession(request, { mutation: true });
    const { providerId, workspaceId } = await context.params;
    return NextResponse.json(
      await revokeWorkspaceScimConnection({
        accountAddress: session.principalId,
        headers: request.headers,
        providerId,
        workspaceId,
      }),
      { headers: noStore },
    );
  } catch (error) {
    const response = tokenlessErrorResponse(error);
    return NextResponse.json(response.body, { status: response.status, headers: noStore });
  }
}
