import { NextRequest, NextResponse } from "next/server";
import { requireBrowserSession } from "~~/lib/auth/request";
import {
  type AudienceSelection,
  type CohortSource,
  type QualificationRule,
  createProjectCohort,
  listProjectCohorts,
} from "~~/lib/tokenless/audienceAssignments";
import { tokenlessErrorResponse } from "~~/lib/tokenless/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Context = { params: Promise<{ projectId: string; workspaceId: string }> };

export async function GET(request: NextRequest, context: Context) {
  try {
    const session = await requireBrowserSession(request);
    const { projectId, workspaceId } = await context.params;
    return NextResponse.json(await listProjectCohorts({ accountAddress: session.principalId, projectId, workspaceId }));
  } catch (error) {
    const response = tokenlessErrorResponse(error);
    return NextResponse.json(response.body, { status: response.status });
  }
}

export async function POST(request: NextRequest, context: Context) {
  try {
    const session = await requireBrowserSession(request, { mutation: true });
    const { projectId, workspaceId } = await context.params;
    const body = (await request.json()) as {
      capacity?: number;
      name?: string;
      privateGroupId?: string;
      qualificationRules?: QualificationRule[];
      selection?: AudienceSelection;
      source?: CohortSource;
    };
    const cohort = await createProjectCohort({
      accountAddress: session.principalId,
      workspaceId,
      projectId,
      name: body.name ?? "",
      source: body.source as CohortSource,
      selection: body.selection as AudienceSelection,
      capacity: body.capacity ?? 0,
      qualificationRules: body.qualificationRules,
      privateGroupId: body.privateGroupId,
    });
    return NextResponse.json(cohort, { status: 201 });
  } catch (error) {
    const response = tokenlessErrorResponse(error);
    return NextResponse.json(response.body, { status: response.status });
  }
}
