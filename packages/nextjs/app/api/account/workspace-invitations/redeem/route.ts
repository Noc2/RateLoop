import { NextRequest, NextResponse } from "next/server";
import { requireBrowserSession } from "~~/lib/auth/request";
import { apiRequestBodyFallback, readApiJsonRequestBody } from "~~/lib/tokenless/apiRequestBody";
import { TokenlessServiceError, tokenlessErrorResponse } from "~~/lib/tokenless/server";
import { redeemWorkspaceMemberInvite } from "~~/lib/tokenless/workspaceGovernance";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const noStore = { "Cache-Control": "private, no-store, max-age=0" };

export async function POST(request: NextRequest) {
  try {
    const session = await requireBrowserSession(request, { mutation: true });
    const body = (await readApiJsonRequestBody(request).catch(error => apiRequestBodyFallback(error, null))) as Record<
      string,
      unknown
    > | null;
    if (!body || Array.isArray(body) || typeof body.token !== "string") {
      throw new TokenlessServiceError("Invitation token is required.", 400, "invalid_invite", false, "token");
    }
    return NextResponse.json(
      await redeemWorkspaceMemberInvite({ token: body.token, accountAddress: session.principalId }),
      { headers: noStore },
    );
  } catch (error) {
    const response = tokenlessErrorResponse(error);
    return NextResponse.json(response.body, { status: response.status, headers: noStore });
  }
}
