import { NextResponse } from "next/server";
import type { apiErrorEnvelope } from "~~/lib/http/jsonBody";

type JsonRpcId = string | number | null | undefined;

export function jsonRpcApiError(
  id: JsonRpcId,
  envelope: ReturnType<typeof apiErrorEnvelope>,
  request: Request,
  corsHeaders: (request: Request) => Record<string, string>,
  jsonRpcCode = -32000,
) {
  return NextResponse.json(
    {
      error: {
        code: jsonRpcCode,
        data: {
          code: envelope.code,
          recoverWith: envelope.recoverWith,
          retryable: envelope.retryable,
          status: envelope.status,
        },
        message: envelope.message,
      },
      id: id ?? null,
      jsonrpc: "2.0",
    },
    { headers: corsHeaders(request), status: envelope.status },
  );
}
