import { NextRequest, NextResponse } from "next/server";
import { gunzipSync } from "node:zlib";
import { BoundedRequestBodyError, readBoundedRequestBytes } from "~~/lib/tokenless/boundedRequestBody";
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

export async function readOtlpRequestBody(request: Pick<Request, "body" | "headers">): Promise<Buffer> {
  let compressed: Buffer;
  try {
    compressed = Buffer.from(await readBoundedRequestBytes(request, OTLP_INGEST_LIMITS.compressedBytes));
  } catch (error) {
    if (error instanceof BoundedRequestBodyError) {
      if (error.reason === "invalid_content_length") {
        throw new TokenlessServiceError("Content-Length is invalid.", 400, "invalid_otlp_request");
      }
      throw new TokenlessServiceError("OTLP request exceeds the compressed-size limit.", 413, "otlp_limit_exceeded");
    }
    throw error;
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
    const body = await readOtlpRequestBody(request);
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
