import { NextRequest, NextResponse } from "next/server";
import { requireBrowserSession } from "~~/lib/auth/request";
import { removePrivateGroupMember } from "~~/lib/tokenless/privateGroups";
import { tokenlessErrorResponse } from "~~/lib/tokenless/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Context = { params: Promise<{ workspaceId: string; groupId: string; principalAddress: string }> };

export async function DELETE(request: NextRequest, context: Context) {
  try {
    const session = await requireBrowserSession(request, { mutation: true });
    const { workspaceId, groupId, principalAddress } = await context.params;
    const body = (await request.json().catch(() => ({}))) as { reason?: string };
    const membership = await removePrivateGroupMember({
      accountAddress: session.principalId,
      workspaceId,
      groupId,
      principalAddress,
      reason: body.reason,
    });
    return NextResponse.json({ membership });
  } catch (error) {
    const response = tokenlessErrorResponse(error);
    return NextResponse.json(response.body, { status: response.status });
  }
}
