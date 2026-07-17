import { NextRequest, NextResponse } from "next/server";
import { listWorkspaceIdentity, registerWorkspaceIdentityProvider } from "~~/lib/auth/enterpriseIdentity";
import { requireBrowserSession } from "~~/lib/auth/request";
import { TokenlessServiceError, tokenlessErrorResponse } from "~~/lib/tokenless/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
type Context = { params: Promise<{ workspaceId: string }> };
const noStore = { "Cache-Control": "private, no-store, max-age=0" };

async function objectBody(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new TokenlessServiceError("Identity provider body must be an object.", 400, "invalid_identity_provider");
  }
  return body;
}

export async function GET(request: NextRequest, context: Context) {
  try {
    const session = await requireBrowserSession(request);
    const { workspaceId } = await context.params;
    return NextResponse.json(
      await listWorkspaceIdentity({ accountAddress: session.principalId, headers: request.headers, workspaceId }),
      { headers: noStore },
    );
  } catch (error) {
    const response = tokenlessErrorResponse(error);
    return NextResponse.json(response.body, { status: response.status, headers: noStore });
  }
}

export async function POST(request: NextRequest, context: Context) {
  try {
    const session = await requireBrowserSession(request, { mutation: true });
    const { workspaceId } = await context.params;
    return NextResponse.json(
      await registerWorkspaceIdentityProvider({
        accountAddress: session.principalId,
        body: await objectBody(request),
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
