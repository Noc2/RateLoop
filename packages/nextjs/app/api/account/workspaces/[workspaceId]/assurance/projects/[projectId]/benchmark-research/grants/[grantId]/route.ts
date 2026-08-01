import { NextRequest } from "next/server";
import {
  benchmarkResearchApplication,
  complianceBody,
  complianceError,
  complianceJson,
  exactBody,
} from "~~/app/api/_support/complianceRoutes";
import { requireBrowserSession } from "~~/lib/auth/request";
import { TokenlessServiceError } from "~~/lib/tokenless/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
type Context = { params: Promise<{ grantId: string; projectId: string; workspaceId: string }> };
const REASONS = ["recipient_request", "scope_withdrawn", "security_response", "grant_replaced"] as const;

export async function DELETE(request: NextRequest, context: Context) {
  try {
    const session = await requireBrowserSession(request, { mutation: true });
    const { grantId, projectId, workspaceId } = await context.params;
    const body = exactBody(await complianceBody(request), ["reason"]);
    if (!REASONS.includes(body.reason as (typeof REASONS)[number])) {
      throw new TokenlessServiceError("Grant revocation reason is invalid.", 400, "invalid_compliance_request");
    }
    const revocation = await benchmarkResearchApplication().persistence.revokeGrant({
      authenticatedManagerPrincipalId: session.principalId,
      workspaceId,
      projectId,
      grantId,
      reason: body.reason as (typeof REASONS)[number],
    });
    return complianceJson(revocation);
  } catch (error) {
    return complianceError(error);
  }
}
