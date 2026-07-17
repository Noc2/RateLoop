import { NextRequest, NextResponse } from "next/server";
import { requireBrowserSession } from "~~/lib/auth/request";
import { listPrivateGroupExpertiseCoverage } from "~~/lib/tokenless/reviewerExpertiseAssignments";
import { tokenlessErrorResponse } from "~~/lib/tokenless/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Context = { params: Promise<{ workspaceId: string; groupId: string }> };

export async function POST(request: NextRequest, context: Context) {
  try {
    const session = await requireBrowserSession(request);
    const { workspaceId, groupId } = await context.params;
    const body = (await request.json()) as { requirements?: unknown; responseDeadline?: unknown };
    const coverage = await listPrivateGroupExpertiseCoverage({
      accountAddress: session.principalId,
      workspaceId,
      groupId,
      requirements: body.requirements,
      responseDeadline: body.responseDeadline,
    });
    return NextResponse.json({ coverage }, { headers: { "Cache-Control": "private, no-store, max-age=0" } });
  } catch (error) {
    const response = tokenlessErrorResponse(error);
    return NextResponse.json(response.body, { status: response.status });
  }
}
