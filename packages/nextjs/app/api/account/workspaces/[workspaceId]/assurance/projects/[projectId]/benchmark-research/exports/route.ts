import { NextRequest } from "next/server";
import {
  benchmarkResearchApplication,
  complianceBody,
  complianceError,
  complianceJson,
  exactBody,
} from "~~/app/api/_support/complianceRoutes";
import { requireBrowserSession } from "~~/lib/auth/request";
import type { BenchmarkResearchApprovedExport } from "~~/lib/tokenless/benchmarkResearchGrants";
import { TokenlessServiceError } from "~~/lib/tokenless/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
type Context = { params: Promise<{ projectId: string; workspaceId: string }> };

export function createBenchmarkExportPost(
  dependencies: {
    requireSession: typeof requireBrowserSession;
    approveExport: ReturnType<typeof benchmarkResearchApplication>["persistence"]["approveExport"];
  } = {
    requireSession: requireBrowserSession,
    approveExport: input => benchmarkResearchApplication().persistence.approveExport(input),
  },
) {
  return async (request: NextRequest, context: Context) => {
    try {
      const session = await dependencies.requireSession(request, { mutation: true });
      const { projectId, workspaceId } = await context.params;
      const body = exactBody(await complianceBody(request, 8 * 1024 * 1024), ["epochId", "labelSetId", "export"]);
      if (
        typeof body.epochId !== "string" ||
        typeof body.labelSetId !== "string" ||
        !body.export ||
        typeof body.export !== "object" ||
        Array.isArray(body.export)
      ) {
        throw new TokenlessServiceError("Benchmark export request is invalid.", 400, "invalid_compliance_request");
      }
      const source = body.export as BenchmarkResearchApprovedExport;
      if (source.workspaceId !== workspaceId || source.projectId !== projectId) {
        throw new TokenlessServiceError(
          "Benchmark research project not found.",
          404,
          "benchmark_research_project_not_found",
        );
      }
      const approved = await dependencies.approveExport({
        authenticatedManagerPrincipalId: session.principalId,
        epochId: body.epochId,
        labelSetId: body.labelSetId,
        export: source,
      });
      return complianceJson(approved, 201);
    } catch (error) {
      return complianceError(error);
    }
  };
}

export const POST = createBenchmarkExportPost();
