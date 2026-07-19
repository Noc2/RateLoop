import { type NextRequest, NextResponse } from "next/server";
import { requireRaterSession } from "~~/lib/tokenless/raterSession";
import { tokenlessErrorResponse } from "~~/lib/tokenless/server";
import { getWorldIdAssuranceStatus } from "~~/lib/tokenless/worldIdAssurance";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    const session = await requireRaterSession(request, false);
    return NextResponse.json(await getWorldIdAssuranceStatus(session.principalId), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    const response = tokenlessErrorResponse(error);
    return NextResponse.json(response.body, {
      status: response.status,
      headers: { "Cache-Control": "no-store" },
    });
  }
}
