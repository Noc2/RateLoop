import { NextRequest, NextResponse } from "next/server";
import { requireBrowserSession } from "~~/lib/auth/request";
import { prepareAndReserveNetworkRunAudience } from "~~/lib/tokenless/networkAudienceOrchestration";
import { tokenlessErrorResponse } from "~~/lib/tokenless/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Context = { params: Promise<{ runId: string; workspaceId: string }> };

export async function POST(request: NextRequest, context: Context) {
  try {
    const session = await requireBrowserSession(request, { mutation: true });
    const { runId, workspaceId } = await context.params;
    const body = (await request.json()) as {
      confidentialityTermsHash?: string;
      projectId?: string;
      reservationTtlMs?: number;
    };
    return NextResponse.json(
      await prepareAndReserveNetworkRunAudience({
        accountAddress: session.principalId,
        workspaceId,
        projectId: body.projectId ?? "",
        runId,
        confidentialityTermsHash: body.confidentialityTermsHash ?? "",
        reservationTtlMs: body.reservationTtlMs,
      }),
      { status: 201 },
    );
  } catch (error) {
    const response = tokenlessErrorResponse(error);
    return NextResponse.json(response.body, { status: response.status });
  }
}
