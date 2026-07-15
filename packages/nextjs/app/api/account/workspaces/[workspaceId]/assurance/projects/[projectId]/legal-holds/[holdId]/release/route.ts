import { NextRequest, NextResponse } from "next/server";
import { requireBrowserSession } from "~~/lib/auth/request";
import { releaseLegalHold } from "~~/lib/privacy/lifecycle";
import { TokenlessServiceError, tokenlessErrorResponse } from "~~/lib/tokenless/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const NO_STORE = { "Cache-Control": "private, no-store, max-age=0" } as const;

type Context = { params: Promise<{ holdId: string; projectId: string; workspaceId: string }> };

export async function POST(request: NextRequest, context: Context) {
  try {
    const session = await requireBrowserSession(request, { mutation: true });
    const { holdId, projectId, workspaceId } = await context.params;
    let body: Record<string, unknown> | null;
    try {
      body = (await request.json()) as Record<string, unknown> | null;
    } catch {
      throw new TokenlessServiceError("Legal hold release body must be valid JSON.", 400, "invalid_legal_hold");
    }
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      throw new TokenlessServiceError("Legal hold release body must be an object.", 400, "invalid_legal_hold");
    }
    if (typeof body.reason !== "string" || !body.reason.trim() || body.reason.trim().length > 500) {
      throw new TokenlessServiceError("Legal hold release reason is invalid.", 400, "invalid_legal_hold");
    }
    await releaseLegalHold({
      accountAddress: session.principalId,
      holdId,
      projectId,
      reason: body.reason.trim(),
      workspaceId,
    });
    return NextResponse.json({ holdId, released: true }, { headers: NO_STORE });
  } catch (error) {
    const response = tokenlessErrorResponse(error);
    return NextResponse.json(response.body, { headers: NO_STORE, status: response.status });
  }
}
