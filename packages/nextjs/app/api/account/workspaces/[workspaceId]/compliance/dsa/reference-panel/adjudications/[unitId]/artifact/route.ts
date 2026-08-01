import { NextRequest, NextResponse } from "next/server";
import { requireBrowserSession } from "~~/lib/auth/request";
import { readDsaReferencePanelAdjudicationArtifact } from "~~/lib/tokenless/dsaReferencePanelPilot";
import { TokenlessServiceError, tokenlessErrorResponse } from "~~/lib/tokenless/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const NO_STORE = "private, no-store, max-age=0";
const INLINE_CONTENT_TYPES = new Set(["application/json", "image/jpeg", "image/png", "image/webp", "text/plain"]);
type Context = { params: Promise<{ workspaceId: string; unitId: string }> };
type Dependencies = {
  requireSession: (request: NextRequest) => Promise<{ principalId: string }>;
  readArtifact: typeof readDsaReferencePanelAdjudicationArtifact;
};

function requiredQuery(request: NextRequest, key: "epochId" | "leaseId") {
  const value = request.nextUrl.searchParams.get(key)?.trim();
  if (!value) throw new TokenlessServiceError("Artifact not found.", 404, "artifact_not_found");
  return value;
}

export function createDsaReferencePanelAdjudicationArtifactGet(
  dependencies: Dependencies = {
    requireSession: requireBrowserSession,
    readArtifact: readDsaReferencePanelAdjudicationArtifact,
  },
) {
  return async function GET(request: NextRequest, context: Context) {
    try {
      const session = await dependencies.requireSession(request);
      const { workspaceId, unitId } = await context.params;
      const artifact = await dependencies.readArtifact({
        accountAddress: session.principalId,
        workspaceId,
        epochId: requiredQuery(request, "epochId"),
        unitId,
        leaseId: requiredQuery(request, "leaseId"),
      });
      const contentType = artifact.contentType.split(";", 1)[0]!.trim().toLowerCase();
      return new NextResponse(Buffer.from(artifact.bytes), {
        headers: {
          "Cache-Control": NO_STORE,
          ...(!INLINE_CONTENT_TYPES.has(contentType)
            ? { "Content-Disposition": 'attachment; filename="reference-panel-artifact"' }
            : {}),
          "Content-Length": String(artifact.sizeBytes),
          "Content-Type": artifact.contentType,
          "Content-Security-Policy": "default-src 'none'; sandbox",
          "Cross-Origin-Resource-Policy": "same-origin",
          "Referrer-Policy": "no-referrer",
          "X-Frame-Options": "DENY",
          "X-Content-Type-Options": "nosniff",
        },
      });
    } catch (error) {
      const response = tokenlessErrorResponse(error);
      return NextResponse.json(response.body, {
        status: response.status,
        headers: { "Cache-Control": NO_STORE },
      });
    }
  };
}

export const GET = createDsaReferencePanelAdjudicationArtifactGet();
