import { NextRequest, NextResponse } from "next/server";
import { FEEDBACK_KEEPER_RATE_LIMIT, authorizeFeedbackKeeperRequest } from "../auth";
import {
  recordContentFeedbackRevealFailure,
  recordContentFeedbackRevealSuccess,
} from "~~/lib/feedback/contentFeedback";
import { isJsonObjectBody, jsonBodyErrorResponse, parseJsonBody } from "~~/lib/http/jsonBody";
import { checkRateLimit } from "~~/utils/rateLimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function parseJobId(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : Number.parseInt(String(value ?? ""), 10);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

export async function POST(request: NextRequest) {
  const authFailure = authorizeFeedbackKeeperRequest(request);
  if (authFailure) return authFailure;

  const limited = await checkRateLimit(request, FEEDBACK_KEEPER_RATE_LIMIT, {
    allowOnStoreUnavailable: true,
    extraKeyParts: ["feedback-reveal-result"],
  });
  if (limited) return limited;

  try {
    const parsedBody = await parseJsonBody(request);
    if (!isJsonObjectBody(parsedBody)) return jsonBodyErrorResponse(parsedBody, "Invalid JSON body");
    const body = parsedBody as {
      id?: unknown;
      status?: unknown;
      txHash?: unknown;
      error?: unknown;
      retryable?: unknown;
    };
    const id = parseJobId(body.id);
    if (!id) {
      return NextResponse.json({ error: "Missing or invalid feedback reveal job id" }, { status: 400 });
    }

    if (body.status === "revealed") {
      const updated = await recordContentFeedbackRevealSuccess({
        id,
        txHash: typeof body.txHash === "string" ? body.txHash : null,
      });
      return NextResponse.json({ ok: true, updated });
    }

    if (body.status === "failed") {
      const result = await recordContentFeedbackRevealFailure({
        id,
        error: typeof body.error === "string" && body.error.trim() ? body.error : "Feedback reveal failed",
        retryable: body.retryable === true,
        txHash: typeof body.txHash === "string" ? body.txHash : null,
      });
      return NextResponse.json({ ok: true, ...result });
    }

    return NextResponse.json({ error: "Unsupported feedback reveal result status" }, { status: 400 });
  } catch (error) {
    console.error("Error recording feedback reveal result:", error);
    return NextResponse.json({ error: "Failed to record feedback reveal result" }, { status: 500 });
  }
}
