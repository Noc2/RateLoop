import { NextRequest, NextResponse } from "next/server";
import { requireBrowserSession } from "~~/lib/auth/request";
import {
  type PrivateGroupPolicyInput,
  createPrivateGroupPolicyVersion,
  getPrivateGroup,
} from "~~/lib/tokenless/privateGroups";
import { tokenlessErrorResponse } from "~~/lib/tokenless/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Context = { params: Promise<{ workspaceId: string; groupId: string }> };

export async function GET(request: NextRequest, context: Context) {
  try {
    const session = await requireBrowserSession(request);
    const { workspaceId, groupId } = await context.params;
    const group = await getPrivateGroup({ accountAddress: session.principalId, workspaceId, groupId });
    return NextResponse.json({ group }, { headers: { "Cache-Control": "private, no-store, max-age=0" } });
  } catch (error) {
    const response = tokenlessErrorResponse(error);
    return NextResponse.json(response.body, { status: response.status });
  }
}

export async function POST(request: NextRequest, context: Context) {
  try {
    const session = await requireBrowserSession(request, { mutation: true });
    const { workspaceId, groupId } = await context.params;
    const body = (await request.json()) as { policy: PrivateGroupPolicyInput };
    const version = await createPrivateGroupPolicyVersion({
      accountAddress: session.principalId,
      workspaceId,
      groupId,
      policy: body.policy,
    });
    return NextResponse.json({ version }, { status: 201 });
  } catch (error) {
    const response = tokenlessErrorResponse(error);
    return NextResponse.json(response.body, { status: response.status });
  }
}
