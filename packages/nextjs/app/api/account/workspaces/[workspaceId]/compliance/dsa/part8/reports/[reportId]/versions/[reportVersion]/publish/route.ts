import { NextRequest } from "next/server";
import { complianceBody, complianceError, complianceJson, exactBody } from "~~/app/api/_support/complianceRoutes";
import { requireBrowserSession } from "~~/lib/auth/request";
import { publishDsaPart8ReportVersion } from "~~/lib/tokenless/dsaPart8ReportVersions";
import { TokenlessServiceError } from "~~/lib/tokenless/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
type Context = { params: Promise<{ reportId: string; reportVersion: string; workspaceId: string }> };

export async function POST(request: NextRequest, context: Context) {
  try {
    const session = await requireBrowserSession(request, { mutation: true });
    const { reportId, reportVersion: rawVersion, workspaceId } = await context.params;
    const body = exactBody(await complianceBody(request), ["reportDigest"]);
    if (typeof body.reportDigest !== "string" || !/^sha256:[0-9a-f]{64}$/u.test(body.reportDigest)) {
      throw new TokenlessServiceError("reportDigest is invalid.", 400, "invalid_compliance_request");
    }
    const reportVersion = Number(rawVersion);
    const publication = await publishDsaPart8ReportVersion({
      accountAddress: session.principalId,
      workspaceId,
      reportId,
      reportVersion,
      reportDigest: body.reportDigest as `sha256:${string}`,
    });
    return complianceJson(publication, 201);
  } catch (error) {
    return complianceError(error);
  }
}
