import { NextRequest, NextResponse } from "next/server";
import { requireBrowserSession } from "~~/lib/auth/request";
import { disableManagedReviewPolicy, updateManagedReviewPolicy } from "~~/lib/tokenless/reviewPolicyManagement";
import { tokenlessErrorResponse } from "~~/lib/tokenless/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Context = { params: Promise<{ policyId: string; workspaceId: string }> };

export async function PUT(request: NextRequest, context: Context) {
  try {
    const session = await requireBrowserSession(request, { mutation: true });
    const { policyId, workspaceId } = await context.params;
    const policy = await updateManagedReviewPolicy({
      accountAddress: session.address,
      workspaceId,
      policyId,
      policy: await request.json(),
    });
    return NextResponse.json({ policy });
  } catch (error) {
    const response = tokenlessErrorResponse(error);
    return NextResponse.json(response.body, { status: response.status });
  }
}

export async function DELETE(request: NextRequest, context: Context) {
  try {
    const session = await requireBrowserSession(request, { mutation: true });
    const { policyId, workspaceId } = await context.params;
    await disableManagedReviewPolicy({ accountAddress: session.address, workspaceId, policyId });
    return NextResponse.json({ disabled: true });
  } catch (error) {
    const response = tokenlessErrorResponse(error);
    return NextResponse.json(response.body, { status: response.status });
  }
}
