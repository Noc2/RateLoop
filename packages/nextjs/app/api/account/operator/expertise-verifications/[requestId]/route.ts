import { NextRequest, NextResponse } from "next/server";
import { requireBrowserSession } from "~~/lib/auth/request";
import {
  decideExpertiseVerificationRequest,
  revokeExpertiseVerificationRequest,
} from "~~/lib/tokenless/expertiseVerification";
import { tokenlessErrorResponse } from "~~/lib/tokenless/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
type Context = { params: Promise<{ requestId: string }> };

export async function PATCH(request: NextRequest, context: Context) {
  try {
    const session = await requireBrowserSession(request, { mutation: true });
    const { requestId } = await context.params;
    const body = (await request.json()) as Record<string, unknown>;
    const result =
      body.decision === "revoked"
        ? await revokeExpertiseVerificationRequest({
            accountAddress: session.principalId,
            requestId,
            reason: body.reason,
          })
        : await decideExpertiseVerificationRequest({
            accountAddress: session.principalId,
            requestId,
            decision: body.decision as "verified" | "rejected",
            reason: body.reason,
            expiresAt: typeof body.expiresAt === "string" ? body.expiresAt : null,
          });
    return NextResponse.json(result);
  } catch (error) {
    const response = tokenlessErrorResponse(error);
    return NextResponse.json(response.body, { status: response.status });
  }
}
