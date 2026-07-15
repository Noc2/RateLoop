import { NextRequest, NextResponse } from "next/server";
import { requireBrowserSession } from "~~/lib/auth/request";
import { leavePrivateGroup } from "~~/lib/tokenless/privateGroups";
import { tokenlessErrorResponse } from "~~/lib/tokenless/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Context = { params: Promise<{ groupId: string }> };

export async function DELETE(request: NextRequest, context: Context) {
  try {
    const session = await requireBrowserSession(request, { mutation: true });
    const { groupId } = await context.params;
    const body = (await request.json().catch(() => ({}))) as { reason?: string };
    const membership = await leavePrivateGroup({
      accountAddress: session.principalId,
      groupId,
      reason: body.reason,
    });
    return NextResponse.json({ membership });
  } catch (error) {
    const response = tokenlessErrorResponse(error);
    return NextResponse.json(response.body, { status: response.status });
  }
}
