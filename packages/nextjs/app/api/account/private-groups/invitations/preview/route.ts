import { NextRequest, NextResponse } from "next/server";
import { requireBrowserSession } from "~~/lib/auth/request";
import { previewPrivateGroupInvitation } from "~~/lib/tokenless/privateGroups";
import { tokenlessErrorResponse } from "~~/lib/tokenless/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    const session = await requireBrowserSession(request, { mutation: true });
    const body = (await request.json()) as { token: string };
    const invitation = await previewPrivateGroupInvitation({ accountAddress: session.principalId, token: body.token });
    return NextResponse.json({ invitation }, { headers: { "Cache-Control": "private, no-store, max-age=0" } });
  } catch (error) {
    const response = tokenlessErrorResponse(error);
    return NextResponse.json(response.body, { status: response.status });
  }
}
