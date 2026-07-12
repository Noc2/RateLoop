import { NextRequest, NextResponse } from "next/server";
import { createTokenlessQuote, tokenlessErrorResponse } from "~~/lib/tokenless/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    return NextResponse.json(await createTokenlessQuote(await request.json()));
  } catch (error) {
    const response = tokenlessErrorResponse(error);
    return NextResponse.json(response.body, { status: response.status });
  }
}
