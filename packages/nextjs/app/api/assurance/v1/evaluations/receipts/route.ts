import { NextRequest, NextResponse } from "next/server";
import { authenticateAutomatedEvalPrincipal, ingestAutomatedEvalReceipt } from "~~/lib/tokenless/automatedEvalReceipts";
import { TokenlessServiceError, tokenlessErrorResponse } from "~~/lib/tokenless/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const HEADERS = { "Cache-Control": "private, no-store, max-age=0", "X-Content-Type-Options": "nosniff" } as const;
const MAX_RECEIPT_BYTES = 65_536;

async function parseBody(request: NextRequest) {
  const contentType = request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
  if (contentType !== "application/json") {
    throw new TokenlessServiceError("Content-Type must be application/json.", 415, "invalid_automated_eval_receipt");
  }
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_RECEIPT_BYTES) {
    throw new TokenlessServiceError("Automated-eval receipt exceeds 64 KiB.", 413, "automated_eval_receipt_too_large");
  }
  const body = await request.text();
  if (Buffer.byteLength(body, "utf8") > MAX_RECEIPT_BYTES) {
    throw new TokenlessServiceError("Automated-eval receipt exceeds 64 KiB.", 413, "automated_eval_receipt_too_large");
  }
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
      request: await parseBody(request),
    });
    return NextResponse.json(result, { headers: HEADERS, status: result.replayed ? 200 : 201 });
  } catch (error) {
    const response = tokenlessErrorResponse(error);
    return NextResponse.json(response.body, { headers: HEADERS, status: response.status });
  }
}
