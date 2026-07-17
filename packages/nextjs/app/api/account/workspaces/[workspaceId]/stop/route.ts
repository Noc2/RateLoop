import { NextRequest, NextResponse } from "next/server";
import { requireBrowserSession } from "~~/lib/auth/request";
import { TokenlessServiceError, tokenlessErrorResponse } from "~~/lib/tokenless/server";
import {
  engageWorkspaceStop,
  getWorkspaceStopState,
  releaseWorkspaceStop,
} from "~~/lib/tokenless/workspaceStopControl";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Context = { params: Promise<{ workspaceId: string }> };

export async function GET(request: NextRequest, context: Context) {
  try {
    const session = await requireBrowserSession(request);
    const { workspaceId } = await context.params;
    return NextResponse.json(
      { stop: await getWorkspaceStopState({ accountAddress: session.principalId, workspaceId }) },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    const response = tokenlessErrorResponse(error);
    return NextResponse.json(response.body, { status: response.status });
  }
}

export async function POST(request: NextRequest, context: Context) {
  try {
    const session = await requireBrowserSession(request, { mutation: true });
    let body: { reason?: unknown };
    try {
      body = (await request.json()) as typeof body;
    } catch {
      throw new TokenlessServiceError("Stop request must be valid JSON.", 400, "invalid_workspace_stop");
    }
    if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).some(key => key !== "reason")) {
      throw new TokenlessServiceError("Only a stop reason may be supplied.", 400, "invalid_workspace_stop");
    }
    const { workspaceId } = await context.params;
    const engaged = await engageWorkspaceStop({
      accountAddress: session.principalId,
      workspaceId,
      reason: body.reason,
    });
    return NextResponse.json(
      { stop: engaged.state, replayed: engaged.replayed },
      { status: engaged.replayed ? 200 : 201, headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    const response = tokenlessErrorResponse(error);
    return NextResponse.json(response.body, { status: response.status });
  }
}

export async function DELETE(request: NextRequest, context: Context) {
  try {
    const session = await requireBrowserSession(request, { mutation: true });
    const { workspaceId } = await context.params;
    const released = await releaseWorkspaceStop({ accountAddress: session.principalId, workspaceId });
    return NextResponse.json(
      { stop: released.state, replayed: released.replayed },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    const response = tokenlessErrorResponse(error);
    return NextResponse.json(response.body, { status: response.status });
  }
}
