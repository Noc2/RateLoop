import { NextRequest, NextResponse } from "next/server";
import { requireBrowserSession } from "~~/lib/auth/request";
import { createWorkspace, listProductWorkspaces } from "~~/lib/tokenless/productCore";
import { TokenlessServiceError, tokenlessErrorResponse } from "~~/lib/tokenless/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    const session = await requireBrowserSession(request);
    return NextResponse.json({ workspaces: await listProductWorkspaces(session.address) });
  } catch (error) {
    const response = tokenlessErrorResponse(error);
    return NextResponse.json(response.body, { status: response.status });
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await requireBrowserSession(request, { mutation: true });
    const body = (await request.json()) as { name?: unknown };
    if (typeof body.name !== "string" || !body.name.trim() || body.name.trim().length > 120) {
      throw new TokenlessServiceError("Workspace name must be 1-120 characters.", 400, "invalid_workspace");
    }
    const workspace = await createWorkspace({ name: body.name, ownerAddress: session.address });
    return NextResponse.json(workspace, { status: 201 });
  } catch (error) {
    const response = tokenlessErrorResponse(error);
    return NextResponse.json(response.body, { status: response.status });
  }
}
