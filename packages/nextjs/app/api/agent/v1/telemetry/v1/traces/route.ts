import { NextRequest, NextResponse } from "next/server";
import { gunzipSync } from "node:zlib";
import {
  OTLP_INGEST_LIMITS,
  authenticateOtlpTracePrincipal,
  ingestOtlpTraces,
  parseOtlpTraceBody,
} from "~~/lib/tokenless/otlpTraceIngest";
import { encodeOtlpTraceProtobufResponse } from "~~/lib/tokenless/otlpTraceProtobuf";
import { TokenlessServiceError, tokenlessErrorResponse } from "~~/lib/tokenless/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const PRIVATE_HEADERS = { "Cache-Control": "private, no-store, max-age=0" } as const;

async function requestBody(request: NextRequest): Promise<Buffer> {
  const declaredLength = request.headers.get("content-length");
  if (declaredLength !== null) {
    const parsed = Number(declaredLength);
    if (!Number.isSafeInteger(parsed) || parsed < 0) {
      throw new TokenlessServiceError("Content-Length is invalid.", 400, "invalid_otlp_request");
    }
    if (parsed > OTLP_INGEST_LIMITS.compressedBytes) {
      throw new TokenlessServiceError("OTLP request exceeds the compressed-size limit.", 413, "otlp_limit_exceeded");
    }
  }
  const compressed = Buffer.from(await request.arrayBuffer());
  if (compressed.length > OTLP_INGEST_LIMITS.compressedBytes) {
    throw new TokenlessServiceError("OTLP request exceeds the compressed-size limit.", 413, "otlp_limit_exceeded");
  }
  const encoding = (request.headers.get("content-encoding") ?? "identity").trim().toLowerCase();
  if (encoding === "identity" || encoding === "none") return compressed;
  if (encoding !== "gzip") {
    throw new TokenlessServiceError(
      "OTLP ingest supports only identity or gzip encoding.",
      415,
      "unsupported_otlp_encoding",
    );
  }
  try {
    return gunzipSync(compressed, { maxOutputLength: OTLP_INGEST_LIMITS.decompressedBytes });
  } catch {
    throw new TokenlessServiceError("OTLP gzip payload is invalid or too large.", 400, "invalid_otlp_gzip");
  }
}

export async function POST(request: NextRequest) {
  try {
    const principal = await authenticateOtlpTracePrincipal(request.headers.get("authorization"));
    const body = await requestBody(request);
    if (body.length > OTLP_INGEST_LIMITS.decompressedBytes) {
      throw new TokenlessServiceError("OTLP request exceeds the decompressed-size limit.", 413, "otlp_limit_exceeded");
    }
    const parsed = parseOtlpTraceBody(request.headers.get("content-type"), body);
    const result = await ingestOtlpTraces({ principal, request: parsed.request });
    if (parsed.format === "protobuf") {
      return new NextResponse(encodeOtlpTraceProtobufResponse(result.rejectedSpans, result.errorMessage), {
        headers: { ...PRIVATE_HEADERS, "Content-Type": "application/x-protobuf" },
        status: 200,
      });
    }
    return NextResponse.json(
      result.rejectedSpans === 0
        ? {}
        : {
            partialSuccess: {
              rejectedSpans: String(result.rejectedSpans),
              errorMessage: result.errorMessage,
            },
          },
      { headers: PRIVATE_HEADERS, status: 200 },
    );
  } catch (error) {
    const response = tokenlessErrorResponse(error);
    return NextResponse.json(response.body, { headers: PRIVATE_HEADERS, status: response.status });
  }
}
