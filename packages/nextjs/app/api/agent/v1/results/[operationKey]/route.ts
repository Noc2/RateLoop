import { NextRequest, NextResponse } from "next/server";
import { getTokenlessResult, tokenlessErrorResponse } from "~~/lib/tokenless/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(_request: NextRequest, context: { params: Promise<{ operationKey: string }> }) {
  try {
    const { operationKey } = await context.params;
    return NextResponse.json(await getTokenlessResult(operationKey));
  } catch (error) {
    const response = tokenlessErrorResponse(error);
    return NextResponse.json(response.body, { status: response.status });
  }
}
