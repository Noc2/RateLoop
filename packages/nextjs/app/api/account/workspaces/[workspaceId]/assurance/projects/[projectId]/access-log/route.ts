import { NextRequest, NextResponse } from "next/server";
import { requireBaseAccountRequest } from "~~/lib/base-account/request";
import { listArtifactAccessLog } from "~~/lib/tokenless/artifactPrivacy";
import { tokenlessErrorResponse } from "~~/lib/tokenless/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Context = { params: Promise<{ projectId: string; workspaceId: string }> };

export async function GET(request: NextRequest, context: Context) {
  try {
    const session = await requireBaseAccountRequest(request);
    const { projectId, workspaceId } = await context.params;
    return NextResponse.json({
      events: await listArtifactAccessLog({ accountAddress: session.address, projectId, workspaceId }),
    });
  } catch (error) {
    const response = tokenlessErrorResponse(error);
    return NextResponse.json(response.body, { status: response.status });
  }
}
