import { NextRequest, NextResponse } from "next/server";
import { requireBrowserSession } from "~~/lib/auth/request";
import { TokenlessServiceError, tokenlessErrorResponse } from "~~/lib/tokenless/server";
import {
  type WorkspaceInviteAccessRole,
  changeWorkspaceMemberAccessRole,
  removeWorkspaceMember,
} from "~~/lib/tokenless/workspaceGovernance";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
type Context = { params: Promise<{ workspaceId: string; principalId: string }> };
const noStore = { "Cache-Control": "private, no-store, max-age=0" };

export async function PATCH(request: NextRequest, context: Context) {
  try {
    const session = await requireBrowserSession(request, { mutation: true });
    const { workspaceId, principalId } = await context.params;
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    if (
      !body ||
      Array.isArray(body) ||
      Object.keys(body).some(key => key !== "accessRole") ||
      typeof body.accessRole !== "string"
    ) {
      throw new TokenlessServiceError("Choose a workspace role.", 400, "invalid_workspace_role");
    }
    return NextResponse.json(
      await changeWorkspaceMemberAccessRole({
        accountAddress: session.principalId,
        workspaceId,
        principalId,
        accessRole: body.accessRole as WorkspaceInviteAccessRole,
      }),
      { headers: noStore },
    );
  } catch (error) {
    const response = tokenlessErrorResponse(error);
    return NextResponse.json(response.body, { status: response.status, headers: noStore });
  }
}

export async function DELETE(request: NextRequest, context: Context) {
  try {
    const session = await requireBrowserSession(request, { mutation: true });
    const { workspaceId, principalId } = await context.params;
    return NextResponse.json(
      await removeWorkspaceMember({ accountAddress: session.principalId, workspaceId, principalId }),
      { headers: noStore },
    );
  } catch (error) {
    const response = tokenlessErrorResponse(error);
    return NextResponse.json(response.body, { status: response.status, headers: noStore });
  }
}
