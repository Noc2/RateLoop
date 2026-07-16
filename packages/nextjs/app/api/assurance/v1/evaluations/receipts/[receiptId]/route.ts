import { NextRequest, NextResponse } from "next/server";
import { authenticateAutomatedEvalPrincipal, getAutomatedEvalResult } from "~~/lib/tokenless/automatedEvalReceipts";
import { tokenlessErrorResponse } from "~~/lib/tokenless/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const HEADERS = {
  "Cache-Control": "private, no-store, max-age=0",
  "X-Content-Type-Options": "nosniff",
} as const;

type Context = { params: Promise<{ receiptId: string }> };

export async function GET(request: NextRequest, { params }: Context) {
  try {
    const principal = await authenticateAutomatedEvalPrincipal(request.headers.get("authorization"), "evaluation:read");
    const { receiptId } = await params;
    return NextResponse.json(await getAutomatedEvalResult({ principal, receiptId }), { headers: HEADERS });
  } catch (error) {
    const response = tokenlessErrorResponse(error);
    return NextResponse.json(response.body, {
      headers: HEADERS,
      status: response.status,
    });
  }
}
