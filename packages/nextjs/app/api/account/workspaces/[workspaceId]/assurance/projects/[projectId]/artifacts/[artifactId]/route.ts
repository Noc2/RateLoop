import { NextRequest, NextResponse } from "next/server";
import { requireBaseAccountRequest } from "~~/lib/base-account/request";
import { readEncryptedArtifact } from "~~/lib/tokenless/artifactPrivacy";
import { tokenlessErrorResponse } from "~~/lib/tokenless/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Context = { params: Promise<{ artifactId: string; projectId: string; workspaceId: string }> };

export async function GET(request: NextRequest, context: Context) {
  try {
    const session = await requireBaseAccountRequest(request);
    const { artifactId, projectId, workspaceId } = await context.params;
    const shouldExport = request.nextUrl.searchParams.get("download") === "true";
    const artifact = await readEncryptedArtifact({
      accountAddress: session.address,
      artifactId,
      projectId,
      purpose: shouldExport ? "export" : "preview",
      requestReference: request.headers.get("x-request-id") ?? undefined,
      workspaceId,
    });
    return new NextResponse(Buffer.from(artifact.bytes), {
      headers: {
        "Cache-Control": "private, no-store, max-age=0",
        "Content-Length": String(artifact.sizeBytes),
        "Content-Type": artifact.contentType,
        "X-Content-Type-Options": "nosniff",
        ...(shouldExport ? { "Content-Disposition": `attachment; filename="${artifactId}"` } : {}),
      },
    });
  } catch (error) {
    const response = tokenlessErrorResponse(error);
    return NextResponse.json(response.body, { status: response.status });
  }
}
