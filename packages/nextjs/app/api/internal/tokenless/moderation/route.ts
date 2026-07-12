import { NextRequest, NextResponse } from "next/server";
import { getTokenlessModerationState, moderateTokenlessOperation } from "~~/lib/tokenless/moderation";
import { TokenlessServiceError, tokenlessErrorResponse } from "~~/lib/tokenless/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function authorize(request: NextRequest) {
  const token = process.env.TOKENLESS_PIPELINE_TOKEN?.trim();
  if (!token) throw new TokenlessServiceError("Moderation pipeline is not configured.", 503, "pipeline_unavailable");
  if (request.headers.get("authorization") !== `Bearer ${token}`) {
    throw new TokenlessServiceError("Invalid pipeline credential.", 401, "invalid_pipeline_credential");
  }
}

export async function POST(request: NextRequest) {
  try {
    authorize(request);
    const body = (await request.json()) as { operationKey?: unknown; decision?: unknown; reasonCode?: unknown };
    if (
      typeof body.operationKey !== "string" ||
      (body.decision !== "approved" && body.decision !== "rejected" && body.decision !== "delisted") ||
      typeof body.reasonCode !== "string"
    ) {
      throw new TokenlessServiceError("Moderation request is invalid.", 400, "invalid_moderation_request");
    }
    return NextResponse.json(
      await moderateTokenlessOperation({
        operationKey: body.operationKey,
        decision: body.decision,
        reasonCode: body.reasonCode,
      }),
    );
  } catch (error) {
    const response = tokenlessErrorResponse(error);
    return NextResponse.json(response.body, { status: response.status });
  }
}

export async function GET(request: NextRequest) {
  try {
    authorize(request);
    const operationKey = request.nextUrl.searchParams.get("operationKey");
    if (!operationKey) throw new TokenlessServiceError("operationKey is required.", 400, "invalid_moderation_request");
    return NextResponse.json(await getTokenlessModerationState(operationKey));
  } catch (error) {
    const response = tokenlessErrorResponse(error);
    return NextResponse.json(response.body, { status: response.status });
  }
}
