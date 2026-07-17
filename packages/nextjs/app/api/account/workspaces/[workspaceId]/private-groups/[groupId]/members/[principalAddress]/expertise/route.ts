import { NextRequest, NextResponse } from "next/server";
import { requireBrowserSession } from "~~/lib/auth/request";
import { replacePrivateGroupMemberExpertise } from "~~/lib/tokenless/reviewerExpertiseAssignments";
import { tokenlessErrorResponse } from "~~/lib/tokenless/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Context = {
  params: Promise<{ workspaceId: string; groupId: string; principalAddress: string }>;
};

export async function PUT(request: NextRequest, context: Context) {
  try {
    const session = await requireBrowserSession(request, { mutation: true });
    const { workspaceId, groupId, principalAddress } = await context.params;
    const body = (await request.json()) as { definitions?: unknown; expiresAt?: unknown };
    const expertise = await replacePrivateGroupMemberExpertise({
      accountAddress: session.principalId,
      workspaceId,
      groupId,
      reviewerAccountAddress: principalAddress,
      definitions: body.definitions,
      expiresAt: body.expiresAt,
    });
    return NextResponse.json({ expertise });
  } catch (error) {
    const response = tokenlessErrorResponse(error);
    return NextResponse.json(response.body, { status: response.status });
  }
}
