import { NextRequest, NextResponse } from "next/server";
import { TokenlessMcpHttpError } from "~~/lib/mcp/errors";
import { consumeMcpRateLimit } from "~~/lib/mcp/rateLimit";
import { JsonRequestBodyError, readJsonRequestBody } from "~~/lib/mcp/requestBody";
import {
  TokenlessServiceError,
  createTokenlessQuote,
  parseTokenlessQuoteRequest,
  tokenlessErrorResponse,
} from "~~/lib/tokenless/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

async function readQuoteBody(request: NextRequest) {
  try {
    return await readJsonRequestBody(request);
  } catch (error) {
    if (error instanceof JsonRequestBodyError) {
      throw new TokenlessMcpHttpError("Quote body must be valid JSON.", 400, "parse_error");
    }
    throw error;
  }
}

function errorResponse(error: unknown) {
  if (error instanceof TokenlessMcpHttpError) {
    return NextResponse.json({ code: error.code, message: error.message, retryable: false }, { status: error.status });
  }
  const response = tokenlessErrorResponse(error);
  return NextResponse.json(response.body, { status: response.status });
}

export async function POST(request: NextRequest) {
  try {
    const rateLimit = await consumeMcpRateLimit(request.headers);
    if (!rateLimit.allowed) {
      const response = NextResponse.json(
        { code: "rate_limit_exceeded", message: "Quote rate limit exceeded.", retryable: true },
        { status: 429 },
      );
      response.headers.set("Retry-After", String(rateLimit.retryAfterSeconds));
      return response;
    }
    const rawBody = await readQuoteBody(request);
    if (
      !rawBody ||
      typeof rawBody !== "object" ||
      Array.isArray(rawBody) ||
      (rawBody as Record<string, unknown>).visibility !== "public"
    ) {
      throw new TokenlessServiceError(
        "Private quotes are created only by the internal encrypted-review workflow.",
        409,
        "private_quote_internal_only",
      );
    }
    const body = parseTokenlessQuoteRequest(rawBody);
    return NextResponse.json(await createTokenlessQuote(body), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
