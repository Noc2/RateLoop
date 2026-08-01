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
type Context = { params: Promise<{ projectId: string; workspaceId: string }> };

export async function POST(request: NextRequest, context: Context) {
  try {
    const session = await requireBrowserSession(request, { mutation: true });
    const { projectId, workspaceId } = await context.params;
    const body = exactBody(await complianceBody(request), ["benchmarkId", "activationReference", "deploymentKey"]);
    if ([body.benchmarkId, body.activationReference, body.deploymentKey].some(value => typeof value !== "string")) {
      throw new TokenlessServiceError("Benchmark activation request is invalid.", 400, "invalid_compliance_request");
    }
    const activation = await benchmarkResearchApplication().persistence.activateBenchmark({
      authenticatedManagerPrincipalId: session.principalId,
      workspaceId,
      projectId,
      benchmarkId: body.benchmarkId as string,
      activationReference: body.activationReference as string,
      deploymentKey: body.deploymentKey as string,
    });
    return complianceJson(activation, 201);
  } catch (error) {
    return complianceError(error);
  }
}
