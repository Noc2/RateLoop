import { NextRequest, NextResponse } from "next/server";
import {
  COMPLIANCE_NO_STORE_HEADERS,
  complianceBody,
  complianceError,
  exactBody,
} from "~~/app/api/_support/complianceRoutes";
import { requireBrowserSession } from "~~/lib/auth/request";
import { revokeProjectWindowComplianceShare } from "~~/lib/tokenless/projectWindowComplianceShares";
import { TokenlessServiceError } from "~~/lib/tokenless/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
type Context = { params: Promise<{ projectId: string; shareId: string; workspaceId: string }> };
const REASONS = ["manager_request", "security_response", "share_replaced", "issuance_error"] as const;

export async function DELETE(request: NextRequest, context: Context) {
  try {
    const session = await requireBrowserSession(request, { mutation: true });
    const { projectId, shareId, workspaceId } = await context.params;
    const body = exactBody(await complianceBody(request), ["reason"]);
    if (!REASONS.includes(body.reason as (typeof REASONS)[number])) {
      throw new TokenlessServiceError("reason is invalid.", 400, "invalid_compliance_request");
    }
    await revokeProjectWindowComplianceShare({
      accountAddress: session.principalId,
      workspaceId,
      projectId,
      shareId,
      reason: body.reason as (typeof REASONS)[number],
    });
    return new NextResponse(null, { status: 204, headers: COMPLIANCE_NO_STORE_HEADERS });
  } catch (error) {
    return complianceError(error);
  }
}
