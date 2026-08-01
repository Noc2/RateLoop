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

export function createBenchmarkResearchGrantPost(
  dependencies: {
    requireSession: typeof requireBrowserSession;
    application: typeof benchmarkResearchApplication;
  } = { requireSession: requireBrowserSession, application: benchmarkResearchApplication },
) {
  return async (request: NextRequest, context: Context) => {
    try {
      const session = await dependencies.requireSession(request, { mutation: true });
      const { projectId, workspaceId } = await context.params;
      const body = exactBody(await complianceBody(request), [
        "recipientPrincipalId",
        "exportId",
        "purpose",
        "durationMs",
        "idempotencyKey",
      ]);
      if (
        typeof body.recipientPrincipalId !== "string" ||
        typeof body.exportId !== "string" ||
        typeof body.idempotencyKey !== "string" ||
        !Number.isSafeInteger(body.durationMs) ||
        typeof body.purpose !== "string" ||
        !Object.hasOwn(BENCHMARK_RESEARCH_PURPOSE_SCOPES, body.purpose)
      ) {
        throw new TokenlessServiceError("Benchmark grant request is invalid.", 400, "invalid_compliance_request");
      }
      const application = dependencies.application({ requireKeys: true });
      const created = await application.persistence.issueGrant({
        authenticatedManagerPrincipalId: session.principalId,
        workspaceId,
        projectId,
        recipientPrincipalId: body.recipientPrincipalId,
        exportId: body.exportId,
        purpose: body.purpose as BenchmarkResearchPurpose,
        durationMs: Number(body.durationMs),
        idempotencyKey: body.idempotencyKey,
        tokenLookupKeyId: application.currentTokenLookupKeyId!,
        recipientBindingKeyId: application.currentRecipientBindingKeyId!,
      });
      return complianceJson(created, created.idempotent ? 200 : 201);
    } catch (error) {
      return complianceError(error);
    }
  };
}

export const POST = createBenchmarkResearchGrantPost();
