import { NextRequest, NextResponse } from "next/server";
import { requireBrowserSession } from "~~/lib/auth/request";
import { type QualificationProvenance, createReviewerInvitation } from "~~/lib/tokenless/audienceAssignments";
import { tokenlessErrorResponse } from "~~/lib/tokenless/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Context = { params: Promise<{ projectId: string; workspaceId: string }> };

export async function POST(request: NextRequest, context: Context) {
  try {
    const session = await requireBrowserSession(request, { mutation: true });
    const { projectId, workspaceId } = await context.params;
    const body = (await request.json()) as {
      cohortId?: string;
      expiresAt?: string;
      intendedAccountAddress?: string;
      maximumActiveAssignments?: number;
      qualificationProvenance?: QualificationProvenance[];
    };
    const invitation = await createReviewerInvitation({
      accountAddress: session.principalId,
      workspaceId,
      projectId,
      cohortId: body.cohortId ?? "",
      intendedAccountAddress: body.intendedAccountAddress,
      qualificationProvenance: body.qualificationProvenance,
      maximumActiveAssignments: body.maximumActiveAssignments,
      expiresAt: body.expiresAt ? new Date(body.expiresAt) : undefined,
    });
    return NextResponse.json(invitation, { status: 201 });
  } catch (error) {
    const response = tokenlessErrorResponse(error);
    return NextResponse.json(response.body, { status: response.status });
  }
}
