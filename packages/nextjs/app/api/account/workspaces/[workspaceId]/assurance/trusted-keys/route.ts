import { NextRequest, NextResponse } from "next/server";
import { requireBrowserSession } from "~~/lib/auth/request";
import { listWorkspaceEvidenceSigningKeys } from "~~/lib/tokenless/evidenceSigningKeys";
import { TokenlessServiceError, tokenlessErrorResponse } from "~~/lib/tokenless/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const NO_STORE = { "Cache-Control": "private, no-store, max-age=0" } as const;
type Context = { params: Promise<{ workspaceId: string }> };

export async function GET(request: NextRequest, context: Context) {
  try {
    const session = await requireBrowserSession(request);
    const { workspaceId } = await context.params;
    const history = await listWorkspaceEvidenceSigningKeys({ accountAddress: session.principalId, workspaceId });
    const format = request.nextUrl.searchParams.get("format");
    const keyId = request.nextUrl.searchParams.get("keyId");
    if (format === null && keyId === null) return NextResponse.json(history, { headers: NO_STORE });
    if (format !== "spki" || !keyId) {
      throw new TokenlessServiceError(
        "Trusted-key downloads require format=spki and an explicit keyId.",
        400,
        "trusted_evidence_key_download_invalid",
      );
    }
    const trustedKey = history.keys.find(key => key.keyId === keyId);
    if (!trustedKey) {
      throw new TokenlessServiceError(
        "The requested trusted key is unavailable.",
        404,
        "trusted_evidence_key_not_found",
      );
    }
    const filename = `rateloop-evidence-${trustedKey.keyId.replace(/[^A-Za-z0-9._-]/gu, "-")}.spki.txt`;
    return new NextResponse(`${trustedKey.publicKeySpki}\n`, {
      headers: {
        ...NO_STORE,
        "Content-Type": "text/plain; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "X-RateLoop-Evidence-Key-Id": trustedKey.keyId,
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    const response = tokenlessErrorResponse(error);
    return NextResponse.json(response.body, { status: response.status, headers: NO_STORE });
  }
}
