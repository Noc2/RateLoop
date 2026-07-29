import { NextRequest, NextResponse } from "next/server";
import { requireBrowserSession } from "~~/lib/auth/request";
import { getOptionalAppUrl } from "~~/lib/env/server";
import { JsonRequestBodyError, readJsonRequestBody } from "~~/lib/mcp/requestBody";
import { createEvidenceShareGrant, listEvidenceShareGrants } from "~~/lib/tokenless/evidenceShareGrants";
import { TokenlessServiceError, tokenlessErrorResponse } from "~~/lib/tokenless/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const NO_STORE = "private, no-store, max-age=0";
const SHARE_BODY_BYTES = 4 * 1_024;
type Context = { params: Promise<{ runId: string; workspaceId: string }> };

function jsonResponse(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": NO_STORE } });
}

export async function GET(request: NextRequest, context: Context) {
  try {
    const session = await requireBrowserSession(request);
    const { runId, workspaceId } = await context.params;
    return jsonResponse({
      shares: await listEvidenceShareGrants({
        accountAddress: session.principalId,
        runId,
        workspaceId,
      }),
    });
  } catch (error) {
    const response = tokenlessErrorResponse(error);
    return jsonResponse(response.body, response.status);
  }
}

export async function POST(request: NextRequest, context: Context) {
  try {
    const session = await requireBrowserSession(request, { mutation: true });
    let value: unknown;
    try {
      value = await readJsonRequestBody(request, SHARE_BODY_BYTES);
    } catch (error) {
      if (!(error instanceof JsonRequestBodyError)) throw error;
      throw new TokenlessServiceError(
        "Evidence share request must be valid JSON.",
        400,
        "invalid_evidence_share_request",
      );
    }
    if (
      !value ||
      typeof value !== "object" ||
      Array.isArray(value) ||
      Object.keys(value).length !== 1 ||
      typeof (value as Record<string, unknown>).expiresAt !== "string"
    ) {
      throw new TokenlessServiceError(
        "Evidence share request requires only expiresAt.",
        400,
        "invalid_evidence_share_request",
      );
    }
    const expiresAt = new Date(String((value as Record<string, unknown>).expiresAt));
    const { runId, workspaceId } = await context.params;
    const appUrl = getOptionalAppUrl();
    if (!appUrl) {
      throw new TokenlessServiceError("Evidence sharing is unavailable.", 503, "evidence_share_url_unavailable", true);
    }
    const created = await createEvidenceShareGrant({
      accountAddress: session.principalId,
      expiresAt,
      runId,
      workspaceId,
    });
    return jsonResponse(
      {
        share: created.grant,
        shareUrl: `${appUrl}/evidence/share/${encodeURIComponent(created.grant.grantId)}#${created.bearerSecret}`,
      },
      201,
    );
  } catch (error) {
    const response = tokenlessErrorResponse(error);
    return jsonResponse(response.body, response.status);
  }
}
