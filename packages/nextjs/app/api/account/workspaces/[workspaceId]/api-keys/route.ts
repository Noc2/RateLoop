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
const noStore = { "Cache-Control": "private, no-store, max-age=0" };
const scopeSet = new Set<string>(TOKENLESS_AGENT_SCOPES);

async function apiKeyBody(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || Array.isArray(body) || Object.keys(body).some(key => !["expiresAt", "name", "scopes"].includes(key))) {
    throw new TokenlessServiceError("API key body is invalid.", 400, "invalid_api_key");
  }
  if (typeof body.name !== "string") {
    throw new TokenlessServiceError("API key name is required.", 400, "invalid_api_key_name", false, "name");
  }
  if (
    !Array.isArray(body.scopes) ||
    body.scopes.length === 0 ||
    body.scopes.some(scope => typeof scope !== "string" || !scopeSet.has(scope))
  ) {
    throw new TokenlessServiceError(
      "Choose at least one supported API key scope.",
      400,
      "invalid_api_key_scopes",
      false,
      "scopes",
    );
  }
  let expiresAt: Date | null = null;
  if (body.expiresAt !== undefined && body.expiresAt !== null && body.expiresAt !== "") {
    if (typeof body.expiresAt !== "string") {
      throw new TokenlessServiceError(
        "API key expiry must be an ISO date.",
        400,
        "invalid_api_key_expiry",
        false,
        "expiresAt",
      );
    }
    expiresAt = new Date(body.expiresAt);
    if (!Number.isFinite(expiresAt.getTime())) {
      throw new TokenlessServiceError(
        "API key expiry must be an ISO date.",
        400,
        "invalid_api_key_expiry",
        false,
        "expiresAt",
      );
    }
  }
  return { name: body.name, scopes: body.scopes as TokenlessAgentScope[], expiresAt };
}

export async function GET(request: NextRequest, context: Context) {
  try {
    const session = await requireBrowserSession(request);
    const { workspaceId } = await context.params;
    return NextResponse.json(
      { apiKeys: await listWorkspaceApiKeys({ accountAddress: session.principalId, workspaceId }) },
      { headers: noStore },
    );
  } catch (error) {
    const response = tokenlessErrorResponse(error);
    return NextResponse.json(response.body, { status: response.status, headers: noStore });
  }
}

export async function POST(request: NextRequest, context: Context) {
  try {
    const session = await requireBrowserSession(request, { mutation: true });
    const { workspaceId } = await context.params;
    const body = await apiKeyBody(request);
    const created = await createManagedWorkspaceApiKey({
      accountAddress: session.principalId,
      workspaceId,
      ...body,
    });
    const apiKey = (await listWorkspaceApiKeys({ accountAddress: session.principalId, workspaceId })).find(
      entry => entry.apiKeyId === created.apiKeyId,
    );
    if (!apiKey) throw new TokenlessServiceError("Created API key was not found.", 500, "invalid_api_key");
    return NextResponse.json({ apiKey, token: created.token }, { status: 201, headers: noStore });
  } catch (error) {
    const response = tokenlessErrorResponse(error);
    return NextResponse.json(response.body, { status: response.status, headers: noStore });
  }
}
