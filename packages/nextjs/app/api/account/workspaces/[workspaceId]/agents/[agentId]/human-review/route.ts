import { NextRequest, NextResponse } from "next/server";
import { requireBrowserSession } from "~~/lib/auth/request";
import {
  getHumanReviewConfigurationForOwner,
  putHumanReviewConfigurationForOwner,
} from "~~/lib/tokenless/humanReviewConfiguration";
import { tokenlessErrorResponse } from "~~/lib/tokenless/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const NO_STORE = { "Cache-Control": "private, no-store, max-age=0" } as const;

type Context = { params: Promise<{ workspaceId: string; agentId: string }> };

export async function GET(request: NextRequest, context: Context) {
  try {
    const session = await requireBrowserSession(request);
    const { workspaceId, agentId } = await context.params;
    return NextResponse.json(
      await getHumanReviewConfigurationForOwner({
        accountAddress: session.principalId,
        workspaceId,
        agentId,
      }),
      { headers: NO_STORE },
    );
  } catch (error) {
    const response = tokenlessErrorResponse(error);
    return NextResponse.json(response.body, { status: response.status, headers: NO_STORE });
  }
}

export async function PUT(request: NextRequest, context: Context) {
  try {
    const session = await requireBrowserSession(request, { mutation: true });
    const { workspaceId, agentId } = await context.params;
    await putHumanReviewConfigurationForOwner({
      accountAddress: session.principalId,
      workspaceId,
      agentId,
      body: await request.json(),
    });
    return NextResponse.json(
      await getHumanReviewConfigurationForOwner({
        accountAddress: session.principalId,
        workspaceId,
        agentId,
      }),
      { headers: NO_STORE },
    );
  } catch (error) {
    const response = tokenlessErrorResponse(error);
    return NextResponse.json(response.body, { status: response.status, headers: NO_STORE });
  }
}
