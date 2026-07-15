import { NextRequest, NextResponse } from "next/server";
import { requireBrowserSession } from "~~/lib/auth/request";
import { createManagedReviewPolicy, listManagedReviewPolicies } from "~~/lib/tokenless/reviewPolicyManagement";
import { tokenlessErrorResponse } from "~~/lib/tokenless/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Context = { params: Promise<{ workspaceId: string }> };

export async function GET(request: NextRequest, context: Context) {
  try {
    const session = await requireBrowserSession(request);
    const { workspaceId } = await context.params;
    return NextResponse.json(await listManagedReviewPolicies({ accountAddress: session.principalId, workspaceId }), {
      headers: { "Cache-Control": "private, no-store, max-age=0" },
    });
  } catch (error) {
    const response = tokenlessErrorResponse(error);
    return NextResponse.json(response.body, {
      status: response.status,
      headers: { "Cache-Control": "private, no-store, max-age=0" },
    });
  }
}

export async function POST(request: NextRequest, context: Context) {
  try {
    const session = await requireBrowserSession(request, { mutation: true });
    const { workspaceId } = await context.params;
    const policy = await createManagedReviewPolicy({
      accountAddress: session.principalId,
      workspaceId,
      policy: await request.json(),
    });
    return NextResponse.json({ policy }, { status: 201 });
  } catch (error) {
    const response = tokenlessErrorResponse(error);
    return NextResponse.json(response.body, { status: response.status });
  }
}
