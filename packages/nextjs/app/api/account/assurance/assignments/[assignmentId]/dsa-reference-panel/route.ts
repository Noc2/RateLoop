import { NextRequest, NextResponse } from "next/server";
import { requireBrowserSession } from "~~/lib/auth/request";
import { readApiJsonRequestBody, rethrowApiRequestBodyBoundaryError } from "~~/lib/tokenless/apiRequestBody";
import { acceptDsaNamedPanelAssignment } from "~~/lib/tokenless/dsaNamedReferencePanel";
import { TokenlessServiceError, tokenlessErrorResponse } from "~~/lib/tokenless/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
type Context = { params: Promise<{ assignmentId: string }> };

export async function POST(request: NextRequest, context: Context) {
  try {
    const session = await requireBrowserSession(request, { mutation: true });
    const { assignmentId } = await context.params;
    let body: Record<string, unknown>;
    try {
      const value = await readApiJsonRequestBody(request, 32 * 1_024);
      if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error();
      body = value as Record<string, unknown>;
    } catch (error) {
      rethrowApiRequestBodyBoundaryError(error);
      throw new TokenlessServiceError("Panel acceptance must be valid JSON.", 400, "invalid_dsa_named_panel_action");
    }
    const actual = Object.keys(body).sort();
    const expected = ["conflictDeclaration"];
    if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index]))
      throw new TokenlessServiceError(
        "Panel acceptance contains unsupported fields.",
        400,
        "invalid_dsa_named_panel_action",
      );
    const result = await acceptDsaNamedPanelAssignment({
      accountAddress: session.principalId,
      assignmentId,
      conflictDeclaration: body.conflictDeclaration as { hasConflict: boolean; relationships: readonly string[] },
    });
    return NextResponse.json(result, { status: 201, headers: { "Cache-Control": "private, no-store, max-age=0" } });
  } catch (error) {
    const response = tokenlessErrorResponse(error);
    return NextResponse.json(response.body, {
      status: response.status,
      headers: { "Cache-Control": "private, no-store, max-age=0" },
    });
  }
}
