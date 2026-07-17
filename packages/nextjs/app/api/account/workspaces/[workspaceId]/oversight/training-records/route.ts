import { NextRequest, NextResponse } from "next/server";
import { requireBrowserSession } from "~~/lib/auth/request";
import { tokenlessErrorResponse } from "~~/lib/tokenless/server";
import { exportTrainingRecords } from "~~/lib/tokenless/trainingRecordsExport";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Context = { params: Promise<{ workspaceId: string }> };

export async function GET(request: NextRequest, context: Context) {
  try {
    const session = await requireBrowserSession(request);
    const { workspaceId } = await context.params;
    const exported = await exportTrainingRecords({ accountAddress: session.principalId, workspaceId });
    return NextResponse.json(exported, {
      headers: {
        "Cache-Control": "private, no-store",
        "Content-Disposition": `attachment; filename="rateloop-training-records-${workspaceId}.json"`,
      },
    });
  } catch (error) {
    const response = tokenlessErrorResponse(error);
    return NextResponse.json(response.body, { status: response.status });
  }
}
