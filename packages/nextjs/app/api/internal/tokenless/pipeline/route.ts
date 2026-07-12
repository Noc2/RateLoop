import { NextRequest, NextResponse } from "next/server";
import { TokenlessServiceError, tokenlessErrorResponse } from "~~/lib/tokenless/server";
import {
  type AnalyticsMetrics,
  type IndexedFinalizedEvidence,
  appendFinalizedRoundEvidence,
  deliverPendingWebhooks,
  reviewAndPublishResult,
} from "~~/lib/tokenless/transparency";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function authorize(request: NextRequest) {
  const token = process.env.TOKENLESS_PIPELINE_TOKEN?.trim();
  if (!token) throw new TokenlessServiceError("Pipeline is not configured.", 503, "pipeline_unavailable");
  if (request.headers.get("authorization") !== `Bearer ${token}`) {
    throw new TokenlessServiceError("Invalid pipeline credential.", 401, "invalid_pipeline_credential");
  }
}

export async function POST(request: NextRequest) {
  try {
    authorize(request);
    const body = (await request.json()) as {
      action?: unknown;
      operationKey?: unknown;
      evidence?: IndexedFinalizedEvidence;
      metrics?: AnalyticsMetrics;
      occurredAt?: unknown;
    };
    if (body.action === "deliver_webhooks") {
      return NextResponse.json({ deliveries: await deliverPendingWebhooks() });
    }
    if (
      body.action !== "publish_finalized_round" ||
      typeof body.operationKey !== "string" ||
      !body.evidence ||
      !body.metrics ||
      typeof body.occurredAt !== "string" ||
      Number.isNaN(Date.parse(body.occurredAt))
    ) {
      throw new TokenlessServiceError("Pipeline request is invalid.", 400, "invalid_pipeline_request");
    }
    await appendFinalizedRoundEvidence({
      operationKey: body.operationKey,
      evidence: body.evidence,
      occurredAt: new Date(body.occurredAt),
    });
    return NextResponse.json(
      await reviewAndPublishResult({
        operationKey: body.operationKey,
        metrics: body.metrics,
        appOrigin: request.nextUrl.origin,
      }),
    );
  } catch (error) {
    const response = tokenlessErrorResponse(error);
    return NextResponse.json(response.body, { status: response.status });
  }
}
