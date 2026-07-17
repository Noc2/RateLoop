import { NextRequest, NextResponse } from "next/server";
import { requireBrowserSession } from "~~/lib/auth/request";
import { listAssuranceOverrideDecisions, recordAssuranceOverrideDecision } from "~~/lib/tokenless/evidencePackets";
import { TokenlessServiceError, tokenlessErrorResponse } from "~~/lib/tokenless/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Context = { params: Promise<{ runId: string; workspaceId: string }> };

const POST_KEYS = new Set(["outcome", "reasons", "correctiveAction"]);

export async function GET(request: NextRequest, context: Context) {
  try {
    const session = await requireBrowserSession(request);
    const { runId, workspaceId } = await context.params;
    return NextResponse.json(
      { overrides: await listAssuranceOverrideDecisions({ accountAddress: session.principalId, workspaceId, runId }) },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    const response = tokenlessErrorResponse(error);
    return NextResponse.json(response.body, { status: response.status });
  }
}

export async function POST(request: NextRequest, context: Context) {
  try {
    const session = await requireBrowserSession(request, { mutation: true });
    let body: Record<string, unknown>;
    try {
      body = (await request.json()) as Record<string, unknown>;
    } catch {
      throw new TokenlessServiceError("Override record must be valid JSON.", 400, "invalid_override_decision");
    }
    if (
      !body ||
      typeof body !== "object" ||
      Array.isArray(body) ||
      Object.keys(body).some(key => !POST_KEYS.has(key))
    ) {
      throw new TokenlessServiceError(
        "Only an outcome, reasons, and optional corrective action may be supplied.",
        400,
        "invalid_override_decision",
      );
    }
    const { runId, workspaceId } = await context.params;
    return NextResponse.json(
      {
        override: await recordAssuranceOverrideDecision({
          accountAddress: session.principalId,
          workspaceId,
          runId,
          outcome: body.outcome,
          reasons: body.reasons,
          correctiveAction: body.correctiveAction,
        }),
      },
      { status: 201, headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    const response = tokenlessErrorResponse(error);
    return NextResponse.json(response.body, { status: response.status });
  }
}
