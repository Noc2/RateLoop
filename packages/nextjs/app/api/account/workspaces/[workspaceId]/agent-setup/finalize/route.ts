import { NextRequest, NextResponse } from "next/server";
import { requireBrowserSession } from "~~/lib/auth/request";
import { TokenlessServiceError, tokenlessErrorResponse } from "~~/lib/tokenless/server";
import { finalizeWorkspaceAgentSetup } from "~~/lib/tokenless/workspaceAgentSetup";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Context = { params: Promise<{ workspaceId: string }> };

const ALLOWED_FIELDS = [
  "revision",
  "idempotencyKey",
  "decision",
  "groupId",
  "createInvitation",
  "intendedEmail",
  "expertiseDefinitionIds",
] as const;

export async function POST(request: NextRequest, context: Context) {
  try {
    const session = await requireBrowserSession(request, { mutation: true });
    const { workspaceId } = await context.params;
    const body = (await request.json()) as Record<string, unknown>;
    if (
      !body ||
      Array.isArray(body) ||
      Object.keys(body).some(key => !ALLOWED_FIELDS.includes(key as (typeof ALLOWED_FIELDS)[number]))
    ) {
      throw new TokenlessServiceError(
        "Setup finalization request is invalid.",
        400,
        "invalid_agent_setup_finalization",
      );
    }
    return NextResponse.json(
      await finalizeWorkspaceAgentSetup({
        accountAddress: session.principalId,
        workspaceId,
        revision: body.revision,
        idempotencyKey: body.idempotencyKey,
        decision: body.decision,
        groupId: body.groupId,
        createInvitation: body.createInvitation,
        intendedEmail: body.intendedEmail,
        expertiseDefinitionIds: body.expertiseDefinitionIds,
      }),
      { headers: { "Cache-Control": "private, no-store, max-age=0" } },
    );
  } catch (error) {
    const response = tokenlessErrorResponse(error);
    return NextResponse.json(response.body, {
      status: response.status,
      headers: { "Cache-Control": "private, no-store, max-age=0" },
    });
  }
}
