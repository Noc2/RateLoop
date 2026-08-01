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
type Context = { params: Promise<{ projectId: string; workspaceId: string }> };

export async function POST(request: NextRequest, context: Context) {
  try {
    const session = await requireBrowserSession(request, { mutation: true });
    const { projectId, workspaceId } = await context.params;
    const body = exactBody(await complianceBody(request), [
      "recipientPrincipalId",
      "benchmarkId",
      "agreementId",
      "agreementVersion",
      "purpose",
      "expiresInMs",
    ]);
    if (
      typeof body.recipientPrincipalId !== "string" ||
      typeof body.benchmarkId !== "string" ||
      typeof body.agreementId !== "string" ||
      !Number.isSafeInteger(body.agreementVersion) ||
      !Number.isSafeInteger(body.expiresInMs) ||
      typeof body.purpose !== "string" ||
      !Object.hasOwn(BENCHMARK_RESEARCH_PURPOSE_SCOPES, body.purpose)
    ) {
      throw new TokenlessServiceError("Agreement offer request is invalid.", 400, "invalid_compliance_request");
    }
    const offer = await benchmarkResearchApplication().persistence.offerAgreement({
      authenticatedManagerPrincipalId: session.principalId,
      recipientPrincipalId: body.recipientPrincipalId,
      workspaceId,
      projectId,
      benchmarkId: body.benchmarkId,
      agreementId: body.agreementId,
      agreementVersion: Number(body.agreementVersion),
      purpose: body.purpose as BenchmarkResearchPurpose,
      expiresInMs: Number(body.expiresInMs),
    });
    return complianceJson(offer, 201);
  } catch (error) {
    return complianceError(error);
  }
}
