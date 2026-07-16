import { NextRequest, NextResponse } from "next/server";
import { requireBrowserSession } from "~~/lib/auth/request";
import { configureAssuranceWormDestination, getAssuranceWormDestination } from "~~/lib/tokenless/assuranceWormExports";
import { TokenlessServiceError, tokenlessErrorResponse } from "~~/lib/tokenless/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const NO_STORE = { "Cache-Control": "private, no-store, max-age=0" } as const;
type Context = { params: Promise<{ workspaceId: string }> };

export async function GET(request: NextRequest, context: Context) {
  try {
    const session = await requireBrowserSession(request);
    const { workspaceId } = await context.params;
    return NextResponse.json(await getAssuranceWormDestination({ accountAddress: session.principalId, workspaceId }), {
      headers: NO_STORE,
    });
  } catch (error) {
    const response = tokenlessErrorResponse(error);
    return NextResponse.json(response.body, { status: response.status, headers: NO_STORE });
  }
}

export async function PUT(request: NextRequest, context: Context) {
  try {
    const session = await requireBrowserSession(request, { mutation: true });
    const { workspaceId } = await context.params;
    const body = await request.json().catch(() => null);
    if (body === null) {
      throw new TokenlessServiceError("Destination settings are invalid.", 400, "invalid_worm_destination");
    }
    return NextResponse.json(
      await configureAssuranceWormDestination({ accountAddress: session.principalId, workspaceId, body }),
      { status: 201, headers: NO_STORE },
    );
  } catch (error) {
    const response = tokenlessErrorResponse(error);
    return NextResponse.json(response.body, { status: response.status, headers: NO_STORE });
  }
}
