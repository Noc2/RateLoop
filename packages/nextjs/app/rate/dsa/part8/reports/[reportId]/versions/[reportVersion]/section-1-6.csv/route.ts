import { NextResponse } from "next/server";
import { downloadPublishedDsaPart8ReportVersion } from "~~/lib/tokenless/dsaPart8ReportVersions";
import { tokenlessErrorResponse } from "~~/lib/tokenless/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const PUBLIC_HEADERS = {
  "Cache-Control": "public, max-age=300, s-maxage=300, immutable",
  "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'",
  "X-Content-Type-Options": "nosniff",
} as const;
type Context = { params: Promise<{ reportId: string; reportVersion: string }> };

export function createPublishedDsaPart8FileGet(
  dependencies: {
    downloadFile: typeof downloadPublishedDsaPart8ReportVersion;
  } = { downloadFile: downloadPublishedDsaPart8ReportVersion },
) {
  return async (_request: Request, context: Context) => {
    try {
      const { reportId, reportVersion } = await context.params;
      const file = await dependencies.downloadFile({ reportId, reportVersion: Number(reportVersion) });
      return new NextResponse(file.bytes, {
        headers: {
          ...PUBLIC_HEADERS,
          "Content-Disposition": `inline; filename="${reportId}-v${file.reportVersion}-section-1-6.csv"`,
          "Content-Type": file.mediaType,
          "X-Content-SHA256": file.fileDigest,
        },
      });
    } catch (error) {
      const response = tokenlessErrorResponse(error);
      return NextResponse.json(response.body, { status: response.status, headers: PUBLIC_HEADERS });
    }
  };
}

export const GET = createPublishedDsaPart8FileGet();
