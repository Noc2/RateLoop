import { NextRequest, NextResponse } from "next/server";
import {
  deleteWorkspaceIdentityProvider,
  setWorkspaceSsoEnforcement,
  updateWorkspaceIdentityProvider,
} from "~~/lib/auth/enterpriseIdentity";
import { requireBrowserSession } from "~~/lib/auth/request";
import { TokenlessServiceError, tokenlessErrorResponse } from "~~/lib/tokenless/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
type Context = { params: Promise<{ providerId: string; workspaceId: string }> };
const noStore = { "Cache-Control": "private, no-store, max-age=0" };

async function objectBody(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new TokenlessServiceError("Identity provider body must be an object.", 400, "invalid_identity_provider");
  }
  return body;
}

export async function PATCH(request: NextRequest, context: Context) {
  try {
    const session = await requireBrowserSession(request, { mutation: true });
    const { providerId, workspaceId } = await context.params;
    const body = await objectBody(request);
    const result = Object.keys(body).every(key => key === "enforceSso")
      ? await setWorkspaceSsoEnforcement({
          accountAddress: session.principalId,
          enabled: body.enforceSso,
          headers: request.headers,
          providerId,
          workspaceId,
        })
      : await updateWorkspaceIdentityProvider({
          accountAddress: session.principalId,
          body,
          headers: request.headers,
          providerId,
          workspaceId,
        });
    return NextResponse.json(result, { headers: noStore });
  } catch (error) {
    const response = tokenlessErrorResponse(error);
    return NextResponse.json(response.body, { status: response.status, headers: noStore });
  }
}

export async function DELETE(request: NextRequest, context: Context) {
  try {
    const session = await requireBrowserSession(request, { mutation: true });
    const { providerId, workspaceId } = await context.params;
    return NextResponse.json(
      await deleteWorkspaceIdentityProvider({
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
