import { NextRequest, NextResponse } from "next/server";
import { requireBrowserSession } from "~~/lib/auth/request";
import { TokenlessServiceError, tokenlessErrorResponse } from "~~/lib/tokenless/server";
import {
  type WorkspaceInviteAccessRole,
  createWorkspaceMemberInvite,
  listWorkspaceMemberInvites,
  listWorkspaceMembers,
} from "~~/lib/tokenless/workspaceGovernance";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
type Context = { params: Promise<{ workspaceId: string }> };
const noStore = { "Cache-Control": "private, no-store, max-age=0" };

async function objectBody(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || Array.isArray(body)) {
    throw new TokenlessServiceError("Member invitation body must be an object.", 400, "invalid_invite");
  }
  return body;
}

export async function GET(request: NextRequest, context: Context) {
  try {
    const session = await requireBrowserSession(request);
    const { workspaceId } = await context.params;
    const [members, invitations] = await Promise.all([
      listWorkspaceMembers({ accountAddress: session.principalId, workspaceId }),
      listWorkspaceMemberInvites({ accountAddress: session.principalId, workspaceId }),
    ]);
    return NextResponse.json({ viewerPrincipalId: session.principalId, members, invitations }, { headers: noStore });
  } catch (error) {
    const response = tokenlessErrorResponse(error);
    return NextResponse.json(response.body, { status: response.status, headers: noStore });
  }
}

export async function POST(request: NextRequest, context: Context) {
  try {
    const session = await requireBrowserSession(request, { mutation: true });
    const { workspaceId } = await context.params;
    const body = await objectBody(request);
    if (
      Object.keys(body).some(key => !["accessRole", "intendedEmail"].includes(key)) ||
      typeof body.accessRole !== "string"
    ) {
      throw new TokenlessServiceError("Choose a workspace role.", 400, "invalid_workspace_role");
    }
    if (body.intendedEmail !== undefined && body.intendedEmail !== null && typeof body.intendedEmail !== "string") {
      throw new TokenlessServiceError("Email must be a string.", 400, "invalid_invite");
    }
    const invitation = await createWorkspaceMemberInvite({
      accountAddress: session.principalId,
      workspaceId,
      accessRole: body.accessRole as WorkspaceInviteAccessRole,
      intendedEmail: (body.intendedEmail as string | null | undefined) ?? null,
    });
    return NextResponse.json({ invitation }, { status: 201, headers: noStore });
  } catch (error) {
    const response = tokenlessErrorResponse(error);
    return NextResponse.json(response.body, { status: response.status, headers: noStore });
  }
}
