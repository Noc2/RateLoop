import { NextRequest, NextResponse } from "next/server";
import { requireBrowserSession } from "~~/lib/auth/request";
import { exportWorkspaceAudit } from "~~/lib/privacy/audit";
import { tokenlessErrorResponse } from "~~/lib/tokenless/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const NO_STORE = "private, no-store, max-age=0";

type Context = { params: Promise<{ workspaceId: string }> };

export async function GET(request: NextRequest, context: Context) {
  try {
    const session = await requireBrowserSession(request);
    const { workspaceId } = await context.params;
    const exported = await exportWorkspaceAudit({ accountAddress: session.principalId, workspaceId });
    return NextResponse.json(exported, {
      headers: {
        "Cache-Control": NO_STORE,
        "Content-Disposition": 'attachment; filename="rateloop-audit.json"',
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    const response = tokenlessErrorResponse(error);
    return NextResponse.json(response.body, {
      headers: { "Cache-Control": NO_STORE },
      status: response.status,
    });
  }
}
