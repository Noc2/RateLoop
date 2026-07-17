import { NextRequest, NextResponse } from "next/server";
import { createWorkspaceScimConnection } from "~~/lib/auth/enterpriseIdentity";
import { requireBrowserSession } from "~~/lib/auth/request";
import { tokenlessErrorResponse } from "~~/lib/tokenless/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
type Context = { params: Promise<{ workspaceId: string }> };
const noStore = { "Cache-Control": "private, no-store, max-age=0" };

export async function POST(request: NextRequest, context: Context) {
  try {
    const session = await requireBrowserSession(request, { mutation: true });
    const { workspaceId } = await context.params;
    return NextResponse.json(
      await createWorkspaceScimConnection({
        accountAddress: session.principalId,
        headers: request.headers,
        workspaceId,
      }),
      { status: 201, headers: noStore },
    );
  } catch (error) {
    const response = tokenlessErrorResponse(error);
    return NextResponse.json(response.body, { status: response.status, headers: noStore });
  }
}
