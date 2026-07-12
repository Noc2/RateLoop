import { NextRequest, NextResponse } from "next/server";
import { TokenlessServiceError, tokenlessErrorResponse, waitForTokenlessAsk } from "~~/lib/tokenless/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest, context: { params: Promise<{ operationKey: string }> }) {
  try {
    const timeoutRaw = request.nextUrl.searchParams.get("timeoutMs") ?? "30000";
    if (!/^\d+$/.test(timeoutRaw) || Number(timeoutRaw) < 1_000 || Number(timeoutRaw) > 60_000) {
      throw new TokenlessServiceError("timeoutMs must be between 1000 and 60000.", 400, "invalid_wait_timeout");
    }
    const { operationKey } = await context.params;
    return NextResponse.json(await waitForTokenlessAsk(operationKey, request.nextUrl.origin));
  } catch (error) {
    const response = tokenlessErrorResponse(error);
    return NextResponse.json(response.body, { status: response.status });
  }
}
