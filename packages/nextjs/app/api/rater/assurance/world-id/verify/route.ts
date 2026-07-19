import { type NextRequest, NextResponse } from "next/server";
import { requireRaterSession } from "~~/lib/tokenless/raterSession";
import { TokenlessServiceError, tokenlessErrorResponse } from "~~/lib/tokenless/server";
import { verifyWorldIdAssurance } from "~~/lib/tokenless/worldIdAssurance";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    const session = await requireRaterSession(request, true);
    if (request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() !== "application/json") {
      throw new TokenlessServiceError("World ID result must use application/json.", 415, "invalid_world_id_result");
    }
    // Preserve the exact IDKit result bytes. The verifier library parses a
    // separate in-memory view but forwards this string to World unchanged.
    const rawBody = await request.text();
    const result = await verifyWorldIdAssurance({ principalId: session.principalId, rawBody });
    return NextResponse.json(result, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const response = tokenlessErrorResponse(error);
    return NextResponse.json(response.body, { status: response.status, headers: { "Cache-Control": "no-store" } });
  }
}
