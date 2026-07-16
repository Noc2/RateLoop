import { NextRequest, NextResponse } from "next/server";
import dashboard from "~~/config/rateloop-assurance-grafana-v1.json";
import { requireBrowserSession } from "~~/lib/auth/request";
import { requireAssuranceMetricsManagement } from "~~/lib/tokenless/assuranceMetrics";
import { tokenlessErrorResponse } from "~~/lib/tokenless/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
type Context = { params: Promise<{ workspaceId: string }> };
const NO_STORE = "private, no-store, max-age=0";

export async function GET(request: NextRequest, context: Context) {
  try {
    const session = await requireBrowserSession(request);
    const { workspaceId } = await context.params;
    await requireAssuranceMetricsManagement(session.principalId, workspaceId);
    return NextResponse.json(dashboard, {
      headers: {
        "Cache-Control": NO_STORE,
        "Content-Disposition": 'attachment; filename="rateloop-assurance-grafana-v1.json"',
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    const response = tokenlessErrorResponse(error);
    return NextResponse.json(response.body, { headers: { "Cache-Control": NO_STORE }, status: response.status });
  }
}
