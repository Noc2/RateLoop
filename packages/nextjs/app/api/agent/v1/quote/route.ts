import { NextRequest, NextResponse } from "next/server";
import { TokenlessMcpHttpError } from "~~/lib/mcp/errors";
import { consumeMcpRateLimit } from "~~/lib/mcp/rateLimit";
import {
  authenticateProductPrincipal,
  getProductSessionToken,
  requireProductPrincipalScope,
} from "~~/lib/tokenless/productCore";
import { createTokenlessQuote, parseTokenlessQuoteRequest, tokenlessErrorResponse } from "~~/lib/tokenless/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const MAX_QUOTE_BODY_BYTES = 64 * 1024;

async function readQuoteBody(request: NextRequest) {
  const contentLength = request.headers.get("content-length");
  if (contentLength) {
    const parsedLength = Number(contentLength);
    if (!Number.isSafeInteger(parsedLength) || parsedLength < 0) {
      throw new TokenlessMcpHttpError("Content-Length is invalid.", 400, "invalid_content_length");
    }
    if (parsedLength > MAX_QUOTE_BODY_BYTES) {
      throw new TokenlessMcpHttpError("Quote request body exceeds 64 KiB.", 413, "request_too_large");
    }
  }
  const bytes = await request.arrayBuffer();
  if (bytes.byteLength > MAX_QUOTE_BODY_BYTES) {
    throw new TokenlessMcpHttpError("Quote request body exceeds 64 KiB.", 413, "request_too_large");
  }
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown;
  } catch {
    throw new TokenlessMcpHttpError("Quote body must be valid JSON.", 400, "parse_error");
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
    const body = parseTokenlessQuoteRequest(await readQuoteBody(request));
    if (body.visibility !== "public") {
      const principal = await authenticateProductPrincipal({
        authorization: request.headers.get("authorization"),
        sessionToken: getProductSessionToken(request),
      });
      requireProductPrincipalScope(principal, "quote:read");
    }
    return NextResponse.json(await createTokenlessQuote(body), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
