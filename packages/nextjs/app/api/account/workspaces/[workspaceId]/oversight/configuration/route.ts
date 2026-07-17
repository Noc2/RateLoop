import { NextRequest, NextResponse } from "next/server";
import { requireBrowserSession } from "~~/lib/auth/request";
import { exportOversightConfiguration } from "~~/lib/tokenless/incidentReportExport";
import { tokenlessErrorResponse } from "~~/lib/tokenless/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Context = { params: Promise<{ workspaceId: string }> };

export async function GET(request: NextRequest, context: Context) {
  try {
    const session = await requireBrowserSession(request);
    const { workspaceId } = await context.params;
    const exported = await exportOversightConfiguration({ accountAddress: session.principalId, workspaceId });
    return NextResponse.json(exported, {
      headers: {
        "Cache-Control": "private, no-store",
        "Content-Disposition": `attachment; filename="rateloop-oversight-configuration-${workspaceId}.json"`,
      },
    });
  } catch (error) {
    const response = tokenlessErrorResponse(error);
    return NextResponse.json(response.body, { status: response.status });
  }
}
