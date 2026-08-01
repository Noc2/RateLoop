import { NextRequest } from "next/server";
import {
  benchmarkResearchApplication,
  complianceBody,
  complianceError,
  complianceJson,
  exactBody,
} from "~~/app/api/_support/complianceRoutes";
import { requireBrowserSession } from "~~/lib/auth/request";
import {
  BENCHMARK_RESEARCH_PURPOSE_SCOPES,
  type BenchmarkResearchPurpose,
} from "~~/lib/tokenless/benchmarkResearchGrants";
import { TokenlessServiceError } from "~~/lib/tokenless/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
type Context = { params: Promise<{ agreementId: string }> };

export async function POST(request: NextRequest, context: Context) {
  try {
    const session = await requireBrowserSession(request, { mutation: true });
    const { agreementId } = await context.params;
    const body = exactBody(await complianceBody(request), [
      "workspaceId",
      "projectId",
      "benchmarkId",
      "agreementVersion",
      "purpose",
    ]);
    if (
      typeof body.workspaceId !== "string" ||
      typeof body.projectId !== "string" ||
      typeof body.benchmarkId !== "string" ||
      !Number.isSafeInteger(body.agreementVersion) ||
      typeof body.purpose !== "string" ||
      !Object.hasOwn(BENCHMARK_RESEARCH_PURPOSE_SCOPES, body.purpose)
    ) {
      throw new TokenlessServiceError("Agreement acceptance request is invalid.", 400, "invalid_compliance_request");
    }
    const agreement = await benchmarkResearchApplication().persistence.acceptAgreement({
      authenticatedRecipientPrincipalId: session.principalId,
      workspaceId: body.workspaceId,
      projectId: body.projectId,
      benchmarkId: body.benchmarkId,
      agreementId,
      agreementVersion: Number(body.agreementVersion),
      purpose: body.purpose as BenchmarkResearchPurpose,
    });
    return complianceJson(agreement, 201);
  } catch (error) {
    return complianceError(error);
  }
}
