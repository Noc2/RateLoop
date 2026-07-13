import { NextRequest, NextResponse } from "next/server";
import { requireBaseAccountRequest } from "~~/lib/base-account/request";
import { getAssuranceClientDecision, recordAssuranceClientDecision } from "~~/lib/tokenless/evidencePackets";
import { TokenlessServiceError, tokenlessErrorResponse } from "~~/lib/tokenless/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Context = { params: Promise<{ runId: string; workspaceId: string }> };

export async function GET(request: NextRequest, context: Context) {
  try {
    const session = await requireBaseAccountRequest(request);
    const { runId, workspaceId } = await context.params;
    return NextResponse.json(
      { decision: await getAssuranceClientDecision({ accountAddress: session.address, workspaceId, runId }) },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    const response = tokenlessErrorResponse(error);
    return NextResponse.json(response.body, { status: response.status });
  }
}

export async function POST(request: NextRequest, context: Context) {
  try {
    const session = await requireBaseAccountRequest(request, { mutation: true });
    let body: { decision?: "go" | "revise" | "stop"; note?: string | null };
    try {
      body = (await request.json()) as typeof body;
    } catch {
      throw new TokenlessServiceError("Decision request must be valid JSON.", 400, "invalid_assurance_decision");
    }
    if (
      !body ||
      typeof body !== "object" ||
      Array.isArray(body) ||
      Object.keys(body).some(key => key !== "decision" && key !== "note")
    ) {
      throw new TokenlessServiceError(
        "Only a go, revise, or stop sign-off and its note may be supplied.",
        400,
        "invalid_assurance_decision",
      );
    }
    const { runId, workspaceId } = await context.params;
    return NextResponse.json(
      await recordAssuranceClientDecision({
        accountAddress: session.address,
        workspaceId,
        runId,
        decision: body.decision as "go" | "revise" | "stop",
        note: body.note,
      }),
      { status: 201, headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    const response = tokenlessErrorResponse(error);
    return NextResponse.json(response.body, { status: response.status });
  }
}
