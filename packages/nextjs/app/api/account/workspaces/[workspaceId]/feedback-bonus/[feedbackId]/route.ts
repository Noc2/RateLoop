import { NextRequest, NextResponse } from "next/server";
import { requireBrowserSession } from "~~/lib/auth/request";
import {
  confirmFeedbackBonusAwardForHuman,
  prepareFeedbackBonusAwardForHuman,
} from "~~/lib/tokenless/feedbackBonusAwards";
import { tokenlessErrorResponse } from "~~/lib/tokenless/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const NO_STORE = { "Cache-Control": "private, no-store, max-age=0" } as const;
type Context = { params: Promise<{ workspaceId: string; feedbackId: string }> };

export async function POST(request: NextRequest, context: Context) {
  try {
    const session = await requireBrowserSession(request, { mutation: true });
    const { workspaceId, feedbackId } = await context.params;
    const body = (await request.json()) as Record<string, unknown>;
    return NextResponse.json(
      await prepareFeedbackBonusAwardForHuman({
        accountAddress: session.principalId,
        workspaceId,
        feedbackId,
        amountAtomic: String(body.amountAtomic ?? ""),
        idempotencyKey: String(body.idempotencyKey ?? ""),
      }),
      { headers: NO_STORE },
    );
  } catch (error) {
    const response = tokenlessErrorResponse(error);
    return NextResponse.json(response.body, { status: response.status, headers: NO_STORE });
  }
}

export async function PUT(request: NextRequest, context: Context) {
  try {
    const session = await requireBrowserSession(request, { mutation: true });
    const { workspaceId, feedbackId } = await context.params;
    const body = (await request.json()) as Record<string, unknown>;
    return NextResponse.json(
      await confirmFeedbackBonusAwardForHuman({
        accountAddress: session.principalId,
        workspaceId,
        feedbackId,
        amountAtomic: String(body.amountAtomic ?? ""),
        idempotencyKey: String(body.idempotencyKey ?? ""),
        transactionHash: String(body.transactionHash ?? ""),
      }),
      { headers: NO_STORE },
    );
  } catch (error) {
    const response = tokenlessErrorResponse(error);
    return NextResponse.json(response.body, { status: response.status, headers: NO_STORE });
  }
}
