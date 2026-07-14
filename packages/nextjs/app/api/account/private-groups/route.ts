import { NextRequest, NextResponse } from "next/server";
import { requireBrowserSession } from "~~/lib/auth/request";
import { listPrivateGroupMemberships } from "~~/lib/tokenless/privateGroups";
import { tokenlessErrorResponse } from "~~/lib/tokenless/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    const session = await requireBrowserSession(request);
    const memberships = await listPrivateGroupMemberships({ accountAddress: session.address });
    return NextResponse.json({ memberships }, { headers: { "Cache-Control": "private, no-store, max-age=0" } });
  } catch (error) {
    const response = tokenlessErrorResponse(error);
    return NextResponse.json(response.body, { status: response.status });
  }
}
