import { NextRequest, NextResponse } from "next/server";
import { requireBrowserSession } from "~~/lib/auth/request";
import { revokeAssuranceMetricsCredential } from "~~/lib/tokenless/assuranceMetrics";
import { tokenlessErrorResponse } from "~~/lib/tokenless/server";

export const runtime = "nodejs";
type Context = { params: Promise<{ workspaceId: string; credentialId: string }> };
const NO_STORE = "private, no-store, max-age=0";

export async function DELETE(request: NextRequest, context: Context) {
  try {
    const session = await requireBrowserSession(request, { mutation: true });
    const { workspaceId, credentialId } = await context.params;
    const credential = await revokeAssuranceMetricsCredential({
      accountAddress: session.principalId,
      workspaceId,
      credentialId,
    });
    return NextResponse.json({ credential }, { headers: { "Cache-Control": NO_STORE } });
  } catch (error) {
    const response = tokenlessErrorResponse(error);
    return NextResponse.json(response.body, { headers: { "Cache-Control": NO_STORE }, status: response.status });
  }
}
