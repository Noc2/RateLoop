import { NextRequest, NextResponse } from "next/server";
import { createTokenlessAsk, tokenlessErrorResponse } from "~~/lib/tokenless/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    const response = await createTokenlessAsk(
      await request.json(),
      request.headers.get("idempotency-key"),
      request.nextUrl.origin,
    );
    return NextResponse.json(response);
  } catch (error) {
    const response = tokenlessErrorResponse(error);
    return NextResponse.json(response.body, { status: response.status });
  }
}
