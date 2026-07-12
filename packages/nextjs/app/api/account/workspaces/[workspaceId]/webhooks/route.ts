import { NextRequest, NextResponse } from "next/server";
import { requireBaseAccountRequest } from "~~/lib/base-account/request";
import { TokenlessServiceError, tokenlessErrorResponse } from "~~/lib/tokenless/server";
import { createWorkspaceWebhook, listWorkspaceWebhooks } from "~~/lib/tokenless/transparency";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Context = { params: Promise<{ workspaceId: string }> };

export async function GET(request: NextRequest, context: Context) {
  try {
    const session = await requireBaseAccountRequest(request);
    const { workspaceId } = await context.params;
    return NextResponse.json({
      webhooks: await listWorkspaceWebhooks({ accountAddress: session.address, workspaceId }),
    });
  } catch (error) {
    const response = tokenlessErrorResponse(error);
    return NextResponse.json(response.body, { status: response.status });
  }
}

export async function POST(request: NextRequest, context: Context) {
  try {
    const session = await requireBaseAccountRequest(request, { mutation: true });
    const { workspaceId } = await context.params;
    const body = (await request.json()) as { url?: unknown; eventTypes?: unknown };
    if (typeof body.url !== "string" || !Array.isArray(body.eventTypes)) {
      throw new TokenlessServiceError("url and eventTypes are required.", 400, "invalid_webhook");
    }
    const created = await createWorkspaceWebhook({
      accountAddress: session.address,
      workspaceId,
      url: body.url,
      eventTypes: body.eventTypes as string[],
    });
    return NextResponse.json(created, { status: 201 });
  } catch (error) {
    const response = tokenlessErrorResponse(error);
    return NextResponse.json(response.body, { status: response.status });
  }
}
