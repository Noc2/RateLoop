import { NextRequest, NextResponse } from "next/server";
import { requireBrowserSession } from "~~/lib/auth/request";
import { submitExpertiseVerificationRequest } from "~~/lib/tokenless/expertiseVerification";
import { tokenlessErrorResponse } from "~~/lib/tokenless/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    const session = await requireBrowserSession(request, { mutation: true });
    const body = (await request.json()) as Record<string, unknown>;
    const result = await submitExpertiseVerificationRequest({
      principalId: session.principalId,
      expertiseKeys: body.expertiseKeys,
      evidenceReferenceHash: body.evidenceReferenceHash,
    });
    return NextResponse.json(result, { status: 202 });
  } catch (error) {
    const response = tokenlessErrorResponse(error);
    return NextResponse.json(response.body, { status: response.status });
  }
}
