import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedAssuranceOpenMetrics } from "~~/lib/tokenless/assuranceMetrics";
import { tokenlessErrorResponse } from "~~/lib/tokenless/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const NO_STORE = "private, no-store, max-age=0";

export async function GET(request: NextRequest) {
  try {
    const body = await getAuthenticatedAssuranceOpenMetrics({
      authorization: request.headers.get("authorization"),
    });
    return new NextResponse(body, {
      headers: {
        "Cache-Control": NO_STORE,
        "Content-Type": "application/openmetrics-text; version=1.0.0; charset=utf-8",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    const response = tokenlessErrorResponse(error);
    return NextResponse.json(response.body, {
      headers: { "Cache-Control": NO_STORE, "X-Content-Type-Options": "nosniff" },
      status: response.status,
    });
  }
}
