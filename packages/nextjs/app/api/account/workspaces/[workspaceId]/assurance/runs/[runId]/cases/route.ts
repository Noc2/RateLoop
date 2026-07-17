import { NextRequest, NextResponse } from "next/server";
import { requireBrowserSession } from "~~/lib/auth/request";
import { getOversightRunCaseView } from "~~/lib/tokenless/oversightCaseView";
import { tokenlessErrorResponse } from "~~/lib/tokenless/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Context = { params: Promise<{ workspaceId: string; runId: string }> };

export async function GET(request: NextRequest, context: Context) {
  try {
    const session = await requireBrowserSession(request);
    const { workspaceId, runId } = await context.params;
    const view = await getOversightRunCaseView({ accountAddress: session.principalId, workspaceId, runId });
    return NextResponse.json(view, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    const response = tokenlessErrorResponse(error);
    return NextResponse.json(response.body, { status: response.status });
  }
}
