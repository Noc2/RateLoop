import { NextRequest, NextResponse } from "next/server";
import { requireBrowserSession } from "~~/lib/auth/request";
import { createPrepaidTopup, listPrepaidTopups } from "~~/lib/billing/prepaidTopups";
import { TokenlessServiceError, tokenlessErrorResponse } from "~~/lib/tokenless/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Context = { params: Promise<{ workspaceId: string }> };
const noStore = { "Cache-Control": "private, no-store, max-age=0" };

export async function GET(request: NextRequest, context: Context) {
  try {
    const session = await requireBrowserSession(request);
    const { workspaceId } = await context.params;
    return NextResponse.json(await listPrepaidTopups({ accountAddress: session.principalId, workspaceId }), {
      headers: noStore,
    });
  } catch (error) {
    const response = tokenlessErrorResponse(error);
    return NextResponse.json(response.body, { status: response.status, headers: noStore });
  }
}

export async function POST(request: NextRequest, context: Context) {
  try {
    const session = await requireBrowserSession(request, { mutation: true });
    const { workspaceId } = await context.params;
    let body: Record<string, unknown> | null;
    try {
      body = (await request.json()) as Record<string, unknown> | null;
    } catch {
      throw new TokenlessServiceError("Top-up body must be valid JSON.", 400, "invalid_topup_request");
    }
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      throw new TokenlessServiceError("Top-up body must be an object.", 400, "invalid_topup_request");
    }
    const topup = await createPrepaidTopup({
      accountAddress: session.principalId,
      amountAtomic: body.amountAtomic,
      idempotencyKey: body.idempotencyKey,
      workspaceId,
    });
    return NextResponse.json(topup, { status: topup.state === "draft" ? 202 : 201, headers: noStore });
  } catch (error) {
    const response = tokenlessErrorResponse(error);
    return NextResponse.json(response.body, { status: response.status, headers: noStore });
  }
}
