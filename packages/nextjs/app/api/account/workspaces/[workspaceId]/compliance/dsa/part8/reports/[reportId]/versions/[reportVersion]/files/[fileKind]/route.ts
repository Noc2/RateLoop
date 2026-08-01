import { NextRequest, NextResponse } from "next/server";
import { COMPLIANCE_NO_STORE_HEADERS, complianceError } from "~~/app/api/_support/complianceRoutes";
import { requireBrowserSession } from "~~/lib/auth/request";
import { downloadDsaPart8ReportVersion } from "~~/lib/tokenless/dsaPart8ReportVersions";
import { TokenlessServiceError } from "~~/lib/tokenless/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
type Context = {
  params: Promise<{ fileKind: string; reportId: string; reportVersion: string; workspaceId: string }>;
};

export function createDsaPart8FileGet(
  dependencies: {
    requireSession: typeof requireBrowserSession;
    downloadFile: typeof downloadDsaPart8ReportVersion;
  } = { requireSession: requireBrowserSession, downloadFile: downloadDsaPart8ReportVersion },
) {
  return async (request: NextRequest, context: Context) => {
    try {
      const session = await dependencies.requireSession(request);
      const { fileKind, reportId, reportVersion: rawVersion, workspaceId } = await context.params;
      if (fileKind !== "public_csv" && fileKind !== "confidential_evidence_json") {
        throw new TokenlessServiceError("Part 8 report file not found.", 404, "dsa_part8_report_file_not_found");
      }
      const file = await dependencies.downloadFile({
        accountAddress: session.principalId,
        workspaceId,
        reportId,
        reportVersion: Number(rawVersion),
        fileKind,
      });
      return new NextResponse(file.bytes, {
        headers: {
          ...COMPLIANCE_NO_STORE_HEADERS,
          "Content-Disposition": `attachment; filename="${reportId}-v${file.reportVersion}-${fileKind === "public_csv" ? "section-1-6.csv" : "evidence.json"}"`,
          "Content-Type": file.mediaType,
          "X-Content-SHA256": file.fileDigest,
        },
      });
    } catch (error) {
      return complianceError(error);
    }
  };
}

export const GET = createDsaPart8FileGet();
