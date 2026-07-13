import { NextRequest, NextResponse } from "next/server";
import { createHash, timingSafeEqual } from "node:crypto";
import { TokenlessServiceError, tokenlessErrorResponse } from "~~/lib/tokenless/server";
import {
  appendFinalizedRoundEvidence,
  deliverPendingWebhooks,
  reviewAndPublishResult,
} from "~~/lib/tokenless/transparency";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const OPERATION_KEY = /^[A-Za-z0-9._:-]{8,160}$/;
const ACTIONS = new Set(["publish_finalized_round", "deliver_webhooks"]);

function authorize(request: NextRequest) {
  const token = process.env.TOKENLESS_PIPELINE_TOKEN?.trim();
  if (!token) throw new TokenlessServiceError("Pipeline is not configured.", 503, "pipeline_unavailable");
  const expected = createHash("sha256").update(`Bearer ${token}`).digest();
  const supplied = createHash("sha256")
    .update(request.headers.get("authorization") ?? "")
    .digest();
  if (!timingSafeEqual(supplied, expected)) {
    throw new TokenlessServiceError("Invalid pipeline credential.", 401, "invalid_pipeline_credential");
  }
}

export async function POST(request: NextRequest) {
  try {
    authorize(request);
    let raw: unknown;
    try {
      raw = (await request.json()) as unknown;
    } catch {
      throw new TokenlessServiceError("Pipeline request is invalid.", 400, "invalid_pipeline_request");
    }
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      throw new TokenlessServiceError("Pipeline request is invalid.", 400, "invalid_pipeline_request");
    }
    const body = raw as Record<string, unknown>;
    if (
      Object.keys(body).some(key => key !== "action" && key !== "operationKey") ||
      typeof body.action !== "string" ||
      !ACTIONS.has(body.action) ||
      typeof body.operationKey !== "string" ||
      !OPERATION_KEY.test(body.operationKey)
    ) {
      throw new TokenlessServiceError("Pipeline request is invalid.", 400, "invalid_pipeline_request");
    }
    if (body.action === "deliver_webhooks") {
      return NextResponse.json({ deliveries: await deliverPendingWebhooks({ operationKey: body.operationKey }) });
    }
    await appendFinalizedRoundEvidence({ operationKey: body.operationKey });
    return NextResponse.json(
      await reviewAndPublishResult({
        operationKey: body.operationKey,
        appOrigin: request.nextUrl.origin,
      }),
    );
  } catch (error) {
    const response = tokenlessErrorResponse(error);
    return NextResponse.json(response.body, { status: response.status });
  }
}
