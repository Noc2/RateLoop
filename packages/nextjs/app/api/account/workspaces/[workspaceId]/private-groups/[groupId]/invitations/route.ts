import { NextRequest, NextResponse } from "next/server";
import { requireBrowserSession } from "~~/lib/auth/request";
import {
  type CreatePrivateGroupInvitationInput,
  createPrivateGroupInvitation,
  listPrivateGroupInvitations,
} from "~~/lib/tokenless/privateGroups";
import { tokenlessErrorResponse } from "~~/lib/tokenless/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Context = { params: Promise<{ workspaceId: string; groupId: string }> };
type InvitationBody = Omit<
  CreatePrivateGroupInvitationInput,
  "accountAddress" | "workspaceId" | "groupId" | "expiresAt" | "membershipExpiresAt" | "expertiseExpiresAt" | "now"
> & {
  expiresAt?: string;
  membershipExpiresAt?: string | null;
  expertiseExpiresAt?: string | null;
};

function optionalDate(value: string | null | undefined) {
  if (value === undefined || value === null) return value;
  return new Date(value);
}

export async function GET(request: NextRequest, context: Context) {
  try {
    const session = await requireBrowserSession(request);
    const { workspaceId, groupId } = await context.params;
    const invitations = await listPrivateGroupInvitations({
      accountAddress: session.principalId,
      workspaceId,
      groupId,
    });
    return NextResponse.json({ invitations }, { headers: { "Cache-Control": "private, no-store, max-age=0" } });
  } catch (error) {
    const response = tokenlessErrorResponse(error);
    return NextResponse.json(response.body, { status: response.status });
  }
}

export async function POST(request: NextRequest, context: Context) {
  try {
    const session = await requireBrowserSession(request, { mutation: true });
    const { workspaceId, groupId } = await context.params;
    const body = (await request.json()) as InvitationBody;
    const invitation = await createPrivateGroupInvitation({
      ...body,
      accountAddress: session.principalId,
      workspaceId,
      groupId,
      expiresAt: optionalDate(body.expiresAt) ?? undefined,
      membershipExpiresAt: optionalDate(body.membershipExpiresAt),
      expertiseExpiresAt: optionalDate(body.expertiseExpiresAt),
    });
    return NextResponse.json({ invitation }, { status: 201 });
  } catch (error) {
    const response = tokenlessErrorResponse(error);
    return NextResponse.json(response.body, { status: response.status });
  }
}
