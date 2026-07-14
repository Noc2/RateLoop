import { NextRequest, NextResponse } from "next/server";
import { requireBrowserSession } from "~~/lib/auth/request";
import { type CreatePrivateGroupInput, createPrivateGroup, listPrivateGroups } from "~~/lib/tokenless/privateGroups";
import { tokenlessErrorResponse } from "~~/lib/tokenless/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Context = { params: Promise<{ workspaceId: string }> };
type CreateGroupBody = Pick<CreatePrivateGroupInput, "name" | "purpose" | "policy">;

export async function GET(request: NextRequest, context: Context) {
  try {
    const session = await requireBrowserSession(request);
    const { workspaceId } = await context.params;
    return NextResponse.json(
      { groups: await listPrivateGroups({ accountAddress: session.address, workspaceId }) },
      { headers: { "Cache-Control": "private, no-store, max-age=0" } },
    );
  } catch (error) {
    const response = tokenlessErrorResponse(error);
    return NextResponse.json(response.body, { status: response.status });
  }
}

export async function POST(request: NextRequest, context: Context) {
  try {
    const session = await requireBrowserSession(request, { mutation: true });
    const { workspaceId } = await context.params;
    const body = (await request.json()) as CreateGroupBody;
    const group = await createPrivateGroup({
      accountAddress: session.address,
      workspaceId,
      name: body.name,
      purpose: body.purpose,
      policy: body.policy,
    });
    return NextResponse.json({ group }, { status: 201 });
  } catch (error) {
    const response = tokenlessErrorResponse(error);
    return NextResponse.json(response.body, { status: response.status });
  }
}
