import { NextRequest, NextResponse } from "next/server";
import { requireBrowserSession } from "~~/lib/auth/request";
import {
  CONFIDENTIAL_ARTIFACT_NO_STORE,
  confidentialArtifactResponse,
} from "~~/lib/tokenless/confidentialArtifactResponse";
import { readDsaReferencePanelAdjudicationArtifact } from "~~/lib/tokenless/dsaReferencePanelPilot";
import { TokenlessServiceError, tokenlessErrorResponse } from "~~/lib/tokenless/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Context = { params: Promise<{ workspaceId: string; unitId: string }> };
type Dependencies = {
  requireSession: (request: NextRequest) => Promise<{ principalId: string }>;
  readArtifact: typeof readDsaReferencePanelAdjudicationArtifact;
};

export const buildConfidentialArtifactResponse = confidentialArtifactResponse;

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
      return buildConfidentialArtifactResponse({
        artifact,
        filename: "reference-panel-artifact",
      });
    } catch (error) {
      const response = tokenlessErrorResponse(error);
      return NextResponse.json(response.body, {
        status: response.status,
        headers: { "Cache-Control": CONFIDENTIAL_ARTIFACT_NO_STORE },
      });
    }
  };
}

export const GET = createDsaReferencePanelAdjudicationArtifactGet();
