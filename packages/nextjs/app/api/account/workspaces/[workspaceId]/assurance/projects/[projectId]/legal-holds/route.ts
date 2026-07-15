import { NextRequest, NextResponse } from "next/server";
import { requireBrowserSession } from "~~/lib/auth/request";
import { createLegalHold } from "~~/lib/privacy/lifecycle";
import { TokenlessServiceError, tokenlessErrorResponse } from "~~/lib/tokenless/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const NO_STORE = { "Cache-Control": "private, no-store, max-age=0" } as const;

type Context = { params: Promise<{ projectId: string; workspaceId: string }> };

function requiredText(value: unknown, field: string, max: number) {
  if (typeof value !== "string" || !value.trim() || value.trim().length > max) {
    throw new TokenlessServiceError(`${field} is invalid.`, 400, "invalid_legal_hold");
  }
  return value.trim();
}

export async function POST(request: NextRequest, context: Context) {
  try {
    const session = await requireBrowserSession(request, { mutation: true });
    const { projectId, workspaceId } = await context.params;
    let body: Record<string, unknown> | null;
    try {
      body = (await request.json()) as Record<string, unknown> | null;
    } catch {
      throw new TokenlessServiceError("Legal hold body must be valid JSON.", 400, "invalid_legal_hold");
    }
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      throw new TokenlessServiceError("Legal hold body must be an object.", 400, "invalid_legal_hold");
    }
    const reviewAtValue = requiredText(body.reviewAt, "Legal hold review date", 64);
    const reviewAt = new Date(reviewAtValue);
    if (!Number.isFinite(reviewAt.getTime())) {
      throw new TokenlessServiceError("Legal hold review date is invalid.", 400, "invalid_legal_hold");
    }
    const created = await createLegalHold({
      accountAddress: session.principalId,
      projectId,
      reason: requiredText(body.reason, "Legal hold reason", 500),
      reviewAt,
      scope: body.scope === undefined ? undefined : requiredText(body.scope, "Legal hold scope", 120),
      workspaceId,
    });
    return NextResponse.json(created, { headers: NO_STORE, status: 201 });
  } catch (error) {
    const response = tokenlessErrorResponse(error);
    return NextResponse.json(response.body, { headers: NO_STORE, status: response.status });
  }
}
