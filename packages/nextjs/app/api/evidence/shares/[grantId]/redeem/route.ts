import { NextRequest, NextResponse } from "next/server";
import { TokenlessMcpHttpError } from "~~/lib/mcp/errors";
import { consumeEvidenceShareRateLimit } from "~~/lib/mcp/rateLimit";
import { JsonRequestBodyError, readJsonRequestBody } from "~~/lib/mcp/requestBody";
import { redeemEvidenceShareGrant } from "~~/lib/tokenless/evidenceShareGrants";
import { TokenlessServiceError, tokenlessErrorResponse } from "~~/lib/tokenless/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const REDEMPTION_BODY_BYTES = 1_024;
const SECURITY_HEADERS = {
  "Cache-Control": "private, no-store, max-age=0",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
  "X-Robots-Tag": "noindex, nofollow, noarchive",
} as const;
type Context = { params: Promise<{ grantId: string }> };

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return NextResponse.json(body, { status, headers: { ...SECURITY_HEADERS, ...headers } });
}

function assertSameOrigin(request: NextRequest) {
  const origin = request.headers.get("origin");
  if (!origin || origin !== request.nextUrl.origin) {
    throw new TokenlessServiceError("Evidence share request is not allowed.", 403, "evidence_share_origin_forbidden");
  }
}

export async function POST(request: NextRequest, context: Context) {
  try {
    assertSameOrigin(request);
    if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
      throw new TokenlessServiceError("Evidence share request must use JSON.", 415, "invalid_evidence_share_request");
    }
    const rateLimit = await consumeEvidenceShareRateLimit(request.headers);
    if (!rateLimit.allowed) {
      return jsonResponse(
        { code: "rate_limit_exceeded", message: "Too many evidence share requests.", retryable: true },
        429,
        {
          "RateLimit-Limit": String(rateLimit.limit),
          "RateLimit-Remaining": String(rateLimit.remaining),
          "Retry-After": String(rateLimit.retryAfterSeconds),
        },
      );
    }
    let value: unknown;
    try {
      value = await readJsonRequestBody(request, REDEMPTION_BODY_BYTES);
    } catch (error) {
      if (!(error instanceof JsonRequestBodyError)) throw error;
      throw new TokenlessServiceError(
        "Evidence share request must be valid JSON.",
        400,
        "invalid_evidence_share_request",
      );
    }
    if (
      !value ||
      typeof value !== "object" ||
      Array.isArray(value) ||
      Object.keys(value).length !== 1 ||
      typeof (value as Record<string, unknown>).secret !== "string"
    ) {
      throw new TokenlessServiceError(
        "Evidence share request requires only secret.",
        400,
        "invalid_evidence_share_request",
      );
    }
    const { grantId } = await context.params;
    const packet = await redeemEvidenceShareGrant({
      bearerSecret: String((value as Record<string, unknown>).secret),
      grantId,
    });
    return jsonResponse(packet, 200, {
      "RateLimit-Limit": String(rateLimit.limit),
      "RateLimit-Remaining": String(rateLimit.remaining),
    });
  } catch (error) {
    if (error instanceof TokenlessMcpHttpError) {
      return jsonResponse(
        { code: error.code, message: "Evidence share is temporarily unavailable.", retryable: error.status >= 500 },
        error.status,
      );
    }
    const response = tokenlessErrorResponse(error);
    return jsonResponse(response.body, response.status);
  }
}
