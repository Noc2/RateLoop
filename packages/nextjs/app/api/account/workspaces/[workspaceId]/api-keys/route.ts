import { NextRequest, NextResponse } from "next/server";
import { requireBaseAccountRequest } from "~~/lib/base-account/request";
import { createManagedWorkspaceApiKey, listWorkspaceApiKeys } from "~~/lib/tokenless/productCore";
import { TokenlessServiceError, tokenlessErrorResponse } from "~~/lib/tokenless/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Context = { params: Promise<{ workspaceId: string }> };

export async function GET(request: NextRequest, context: Context) {
  try {
    const session = await requireBaseAccountRequest(request);
    const { workspaceId } = await context.params;
    return NextResponse.json({
      apiKeys: await listWorkspaceApiKeys({ accountAddress: session.address, workspaceId }),
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
    const body = (await request.json()) as { name?: unknown; role?: unknown };
    if (typeof body.name !== "string" || !body.name.trim() || body.name.trim().length > 120) {
      throw new TokenlessServiceError("API key name must be 1-120 characters.", 400, "invalid_api_key_name");
    }
    if (body.role !== undefined && body.role !== "admin" && body.role !== "member") {
      throw new TokenlessServiceError("API key role must be admin or member.", 400, "invalid_api_key_role");
    }
    const created = await createManagedWorkspaceApiKey({
      accountAddress: session.address,
      workspaceId,
      name: body.name,
      role: body.role,
    });
    return NextResponse.json(created, { status: 201 });
  } catch (error) {
    const response = tokenlessErrorResponse(error);
    return NextResponse.json(response.body, { status: response.status });
  }
}
