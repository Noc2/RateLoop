import { NextRequest, NextResponse } from "next/server";
import { requireBrowserSession } from "~~/lib/auth/request";
import {
  TOKENLESS_AGENT_SCOPES,
  type TokenlessAgentScope,
  createManagedWorkspaceApiKey,
  listWorkspaceApiKeys,
} from "~~/lib/tokenless/productCore";
import { TokenlessServiceError, tokenlessErrorResponse } from "~~/lib/tokenless/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Context = { params: Promise<{ workspaceId: string }> };

export async function GET(request: NextRequest, context: Context) {
  try {
    const session = await requireBrowserSession(request);
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
    const session = await requireBrowserSession(request, { mutation: true });
    const { workspaceId } = await context.params;
    const body = (await request.json()) as {
      expiresAt?: unknown;
      name?: unknown;
      policyId?: unknown;
      role?: unknown;
      scopes?: unknown;
      walletAddress?: unknown;
    };
    if (typeof body.name !== "string" || !body.name.trim() || body.name.trim().length > 120) {
      throw new TokenlessServiceError("API key name must be 1-120 characters.", 400, "invalid_api_key_name");
    }
    if (body.role !== undefined && body.role !== "admin" && body.role !== "member") {
      throw new TokenlessServiceError("API key role must be admin or member.", 400, "invalid_api_key_role");
    }
    if (
      body.scopes !== undefined &&
      (!Array.isArray(body.scopes) ||
        body.scopes.some(
          scope => typeof scope !== "string" || !TOKENLESS_AGENT_SCOPES.includes(scope as TokenlessAgentScope),
        ))
    ) {
      throw new TokenlessServiceError("API key scopes are invalid.", 400, "invalid_api_key_scopes");
    }
    if (body.policyId !== undefined && body.policyId !== null && typeof body.policyId !== "string") {
      throw new TokenlessServiceError("Publishing policy ID is invalid.", 400, "invalid_api_key_policy");
    }
    if (body.walletAddress !== undefined && body.walletAddress !== null && typeof body.walletAddress !== "string") {
      throw new TokenlessServiceError("Wallet address is invalid.", 400, "invalid_api_key_wallet");
    }
    let expiresAt: Date | null = null;
    if (body.expiresAt !== undefined && body.expiresAt !== null && body.expiresAt !== "") {
      if (typeof body.expiresAt !== "string" || !Number.isFinite(new Date(body.expiresAt).getTime())) {
        throw new TokenlessServiceError("API key expiry must be an ISO date.", 400, "invalid_api_key_expiry");
      }
      expiresAt = new Date(body.expiresAt);
    }
    const created = await createManagedWorkspaceApiKey({
      accountAddress: session.address,
      workspaceId,
      name: body.name,
      role: body.role,
      scopes: body.scopes as TokenlessAgentScope[] | undefined,
      policyId: (body.policyId as string | null | undefined) ?? null,
      walletAddress: (body.walletAddress as string | null | undefined) ?? null,
      expiresAt,
    });
    return NextResponse.json(created, { status: 201 });
  } catch (error) {
    const response = tokenlessErrorResponse(error);
    return NextResponse.json(response.body, { status: response.status });
  }
}
