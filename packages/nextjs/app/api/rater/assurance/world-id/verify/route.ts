import { type NextRequest, NextResponse } from "next/server";
import { BoundedRequestBodyError, readBoundedRequestText } from "~~/lib/tokenless/boundedRequestBody";
import { requireRaterSession } from "~~/lib/tokenless/raterSession";
import { TokenlessServiceError, tokenlessErrorResponse } from "~~/lib/tokenless/server";
import { WORLD_ID_VERIFY_BODY_MAX_BYTES, verifyWorldIdAssurance } from "~~/lib/tokenless/worldIdAssurance";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function readWorldIdVerifyBody(request: Pick<Request, "body" | "headers">) {
  try {
    return await readBoundedRequestText(request, WORLD_ID_VERIFY_BODY_MAX_BYTES);
  } catch (error) {
    if (error instanceof BoundedRequestBodyError) {
      throw new TokenlessServiceError(
        error.reason === "body_too_large"
          ? "World ID result is too large."
          : error.reason === "invalid_content_length"
            ? "Content-Length is invalid."
            : "World ID result must be valid UTF-8 JSON.",
        error.reason === "body_too_large" ? 413 : 400,
        "invalid_world_id_result",
      );
    }
    throw error;
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await requireRaterSession(request, true);
    if (request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() !== "application/json") {
      throw new TokenlessServiceError("World ID result must use application/json.", 415, "invalid_world_id_result");
    }
    // Preserve the exact IDKit result bytes. The verifier library parses a
    // separate in-memory view but forwards this string to World unchanged.
    const rawBody = await readWorldIdVerifyBody(request);
    const result = await verifyWorldIdAssurance({ principalId: session.principalId, rawBody });
    return NextResponse.json(result, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const response = tokenlessErrorResponse(error);
    return NextResponse.json(response.body, { status: response.status, headers: { "Cache-Control": "no-store" } });
  }
}
