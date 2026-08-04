import { NextRequest, NextResponse } from "next/server";
import { requireBrowserSession } from "~~/lib/auth/request";
import { readEncryptedArtifact } from "~~/lib/tokenless/artifactPrivacy";
import {
  CONFIDENTIAL_ARTIFACT_NO_STORE,
  confidentialArtifactResponse,
} from "~~/lib/tokenless/confidentialArtifactResponse";
import { tokenlessErrorResponse } from "~~/lib/tokenless/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Context = { params: Promise<{ artifactId: string; projectId: string; workspaceId: string }> };

export const buildConfidentialArtifactResponse = confidentialArtifactResponse;

export async function GET(request: NextRequest, context: Context) {
  try {
    const session = await requireBrowserSession(request);
    const { artifactId, projectId, workspaceId } = await context.params;
    const shouldExport = request.nextUrl.searchParams.get("download") === "true";
    const artifact = await readEncryptedArtifact({
      accountAddress: session.principalId,
      artifactId,
      leaseId: request.nextUrl.searchParams.get("leaseId") ?? undefined,
      projectId,
      purpose: shouldExport ? "export" : "preview",
      requestReference: request.headers.get("x-request-id") ?? undefined,
      workspaceId,
    });
    return buildConfidentialArtifactResponse({
      artifact,
      download: shouldExport,
      filename: artifactId,
    });
  } catch (error) {
    const response = tokenlessErrorResponse(error);
    return NextResponse.json(response.body, {
      status: response.status,
      headers: { "Cache-Control": CONFIDENTIAL_ARTIFACT_NO_STORE },
    });
  }
}
