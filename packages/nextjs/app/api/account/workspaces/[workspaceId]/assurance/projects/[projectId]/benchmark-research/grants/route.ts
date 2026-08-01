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
      "exportId",
      "purpose",
      "durationMs",
    ]);
    if (
      typeof body.recipientPrincipalId !== "string" ||
      typeof body.exportId !== "string" ||
      !Number.isSafeInteger(body.durationMs) ||
      typeof body.purpose !== "string" ||
      !Object.hasOwn(BENCHMARK_RESEARCH_PURPOSE_SCOPES, body.purpose)
    ) {
      throw new TokenlessServiceError("Benchmark grant request is invalid.", 400, "invalid_compliance_request");
    }
    const application = benchmarkResearchApplication({ requireKeys: true });
    const created = await application.persistence.issueGrant({
      authenticatedManagerPrincipalId: session.principalId,
      workspaceId,
      projectId,
      recipientPrincipalId: body.recipientPrincipalId,
      exportId: body.exportId,
      purpose: body.purpose as BenchmarkResearchPurpose,
      durationMs: Number(body.durationMs),
      tokenLookupKeyId: application.currentTokenLookupKeyId!,
      recipientBindingKeyId: application.currentRecipientBindingKeyId!,
    });
    return complianceJson({ ...created, tokenLookupKeyId: application.currentTokenLookupKeyId }, 201);
  } catch (error) {
    return complianceError(error);
  }
}
