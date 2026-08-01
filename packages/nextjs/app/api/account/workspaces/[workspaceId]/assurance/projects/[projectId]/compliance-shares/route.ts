import { NextRequest } from "next/server";
import {
  canonicalDate,
  complianceBody,
  complianceError,
  complianceJson,
  exactBody,
} from "~~/app/api/_support/complianceRoutes";
import { requireBrowserSession } from "~~/lib/auth/request";
import {
  issueProjectWindowComplianceShare,
  listProjectWindowComplianceShares,
} from "~~/lib/tokenless/projectWindowComplianceShares";
import { TokenlessServiceError } from "~~/lib/tokenless/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
type Context = { params: Promise<{ projectId: string; workspaceId: string }> };

export async function GET(request: NextRequest, context: Context) {
  try {
    const session = await requireBrowserSession(request);
    const { projectId, workspaceId } = await context.params;
    return complianceJson({
      shares: await listProjectWindowComplianceShares({
        accountAddress: session.principalId,
        workspaceId,
        projectId,
      }),
    });
  } catch (error) {
    return complianceError(error);
  }
}

export function createComplianceSharePost(
  dependencies: {
    requireSession: typeof requireBrowserSession;
    issueShare: typeof issueProjectWindowComplianceShare;
  } = { requireSession: requireBrowserSession, issueShare: issueProjectWindowComplianceShare },
) {
  return async (request: NextRequest, context: Context) => {
    try {
      const session = await dependencies.requireSession(request, { mutation: true });
      const { projectId, workspaceId } = await context.params;
      const body = exactBody(await complianceBody(request), [
        "evidenceWindowStart",
        "evidenceWindowEnd",
        "evidencePacketIds",
        "reportVersions",
        "expiresAt",
      ]);
      if (!Array.isArray(body.evidencePacketIds) || !body.evidencePacketIds.every(value => typeof value === "string")) {
        throw new TokenlessServiceError("evidencePacketIds is invalid.", 400, "invalid_compliance_request");
      }
      if (!Array.isArray(body.reportVersions)) {
        throw new TokenlessServiceError("reportVersions is invalid.", 400, "invalid_compliance_request");
      }
      const created = await dependencies.issueShare({
        accountAddress: session.principalId,
        workspaceId,
        projectId,
        evidenceWindowStart: canonicalDate(body.evidenceWindowStart, "evidenceWindowStart"),
        evidenceWindowEnd: canonicalDate(body.evidenceWindowEnd, "evidenceWindowEnd"),
        evidencePacketIds: body.evidencePacketIds as string[],
        reportVersions: body.reportVersions as Array<{ reportId: string; reportVersion: number }>,
        expiresAt: canonicalDate(body.expiresAt, "expiresAt"),
      });
      return complianceJson(created, 201);
    } catch (error) {
      return complianceError(error);
    }
  };
}

export const POST = createComplianceSharePost();
