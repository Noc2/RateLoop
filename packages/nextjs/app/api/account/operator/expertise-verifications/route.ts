import { NextRequest, NextResponse } from "next/server";
import { requireBrowserSession } from "~~/lib/auth/request";
import { listExpertiseVerificationQueue } from "~~/lib/tokenless/expertiseVerification";
import { tokenlessErrorResponse } from "~~/lib/tokenless/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    const session = await requireBrowserSession(request);
    const status = request.nextUrl.searchParams.get("status") ?? "pending";
    const queue = await listExpertiseVerificationQueue({
      accountAddress: session.principalId,
      status: status as "pending" | "verified" | "rejected" | "revoked",
    });
    return NextResponse.json({ queue }, { headers: { "Cache-Control": "private, no-store, max-age=0" } });
  } catch (error) {
    const response = tokenlessErrorResponse(error);
    return NextResponse.json(response.body, { status: response.status });
  }
}
