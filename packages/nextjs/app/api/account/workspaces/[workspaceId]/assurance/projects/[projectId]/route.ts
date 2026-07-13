import { NextRequest, NextResponse } from "next/server";
import { requireBaseAccountRequest } from "~~/lib/base-account/request";
import { getAssuranceProjectResources, scopeAssuranceSessionToWorkspace } from "~~/lib/tokenless/humanAssurance";
import { tokenlessErrorResponse } from "~~/lib/tokenless/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Context = { params: Promise<{ projectId: string; workspaceId: string }> };

export async function GET(request: NextRequest, context: Context) {
  try {
    const session = await requireBaseAccountRequest(request);
    const { projectId, workspaceId } = await context.params;
    const principal = await scopeAssuranceSessionToWorkspace({ accountAddress: session.address, workspaceId });
    return NextResponse.json(await getAssuranceProjectResources({ principal, projectId }));
  } catch (error) {
    const response = tokenlessErrorResponse(error);
    return NextResponse.json(response.body, { status: response.status });
  }
}
