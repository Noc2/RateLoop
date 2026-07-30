import { NextRequest, NextResponse } from "next/server";
import { readApiRequestText } from "~~/lib/tokenless/apiRequestBody";
import { authenticateAutomatedEvalPrincipal, ingestAutomatedEvalReceipt } from "~~/lib/tokenless/automatedEvalReceipts";
import { TokenlessServiceError, tokenlessErrorResponse } from "~~/lib/tokenless/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const HEADERS = { "Cache-Control": "private, no-store, max-age=0", "X-Content-Type-Options": "nosniff" } as const;
export const MAX_AUTOMATED_EVAL_RECEIPT_BYTES = 64 * 1_024;

export async function readAutomatedEvalReceiptBody(request: Pick<Request, "body" | "headers">) {
  const contentType = request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
  if (contentType !== "application/json") {
    throw new TokenlessServiceError("Content-Type must be application/json.", 415, "invalid_automated_eval_receipt");
  }
  const body = await readApiRequestText(request, MAX_AUTOMATED_EVAL_RECEIPT_BYTES);
  try {
    return JSON.parse(body) as unknown;
  } catch {
    throw new TokenlessServiceError(
      "Automated-eval receipt must be valid JSON.",
      400,
      "invalid_automated_eval_receipt",
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const principal = await authenticateAutomatedEvalPrincipal(request.headers.get("authorization"), "telemetry:write");
    const result = await ingestAutomatedEvalReceipt({
      principal,
      idempotencyKey: request.headers.get("idempotency-key") ?? "",
      request: await readAutomatedEvalReceiptBody(request),
    });
    return NextResponse.json(result, { headers: HEADERS, status: result.replayed ? 200 : 201 });
  } catch (error) {
    const response = tokenlessErrorResponse(error);
    return NextResponse.json(response.body, { headers: HEADERS, status: response.status });
  }
}
