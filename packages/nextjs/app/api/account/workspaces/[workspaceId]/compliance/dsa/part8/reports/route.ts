import { NextRequest } from "next/server";
import { complianceBody, complianceError, complianceJson, exactBody } from "~~/app/api/_support/complianceRoutes";
import { requireBrowserSession } from "~~/lib/auth/request";
import {
  type BuildDsaPart8ReportVersionInput,
  createDsaPart8ReportVersion,
} from "~~/lib/tokenless/dsaPart8ReportVersions";
import { TokenlessServiceError } from "~~/lib/tokenless/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
type Context = { params: Promise<{ workspaceId: string }> };

function reportBuild(value: unknown, workspaceId: string) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TokenlessServiceError("build must be an object.", 400, "invalid_compliance_request");
  }
  const source: Record<string, unknown> = { ...(value as Record<string, unknown>), workspaceId };
  const methodEvidence = source.methodEvidence;
  if (methodEvidence && typeof methodEvidence === "object" && !Array.isArray(methodEvidence)) {
    const method = methodEvidence as Record<string, unknown>;
    if (typeof method.evidenceBytesBase64 !== "string" || "evidenceBytes" in method) {
      throw new TokenlessServiceError(
        "methodEvidence must carry evidenceBytesBase64.",
        400,
        "invalid_compliance_request",
      );
    }
    if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(method.evidenceBytesBase64)) {
      throw new TokenlessServiceError(
        "methodEvidence.evidenceBytesBase64 is invalid.",
        400,
        "invalid_compliance_request",
      );
    }
    const evidenceBytes = Buffer.from(method.evidenceBytesBase64, "base64");
    if (evidenceBytes.toString("base64") !== method.evidenceBytesBase64) {
      throw new TokenlessServiceError(
        "methodEvidence.evidenceBytesBase64 is invalid.",
        400,
        "invalid_compliance_request",
      );
    }
    source.methodEvidence = { ...method, evidenceBytes: new Uint8Array(evidenceBytes) };
    delete (source.methodEvidence as Record<string, unknown>).evidenceBytesBase64;
  }
  return source as unknown as Omit<BuildDsaPart8ReportVersionInput, "createdBy" | "frozenAt">;
}

export function createPart8ReportPost(
  dependencies: {
    requireSession: typeof requireBrowserSession;
    createReport: typeof createDsaPart8ReportVersion;
  } = { requireSession: requireBrowserSession, createReport: createDsaPart8ReportVersion },
) {
  return async (request: NextRequest, context: Context) => {
    try {
      const session = await dependencies.requireSession(request, { mutation: true });
      const { workspaceId } = await context.params;
      const body = exactBody(await complianceBody(request, 8 * 1024 * 1024), ["build"]);
      const evidence = await dependencies.createReport({
        accountAddress: session.principalId,
        build: reportBuild(body.build, workspaceId),
      });
      return complianceJson(
        {
          report: evidence.report,
          cells: evidence.cells,
          files: evidence.files.map(file => ({
            fileKind: file.fileKind,
            mediaType: file.mediaType,
            byteLength: file.byteLength,
            fileDigest: file.fileDigest,
          })),
        },
        201,
      );
    } catch (error) {
      return complianceError(error);
    }
  };
}

export const POST = createPart8ReportPost();
