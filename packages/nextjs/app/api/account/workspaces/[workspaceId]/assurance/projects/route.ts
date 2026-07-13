import { NextRequest, NextResponse } from "next/server";
import { requireBrowserSession } from "~~/lib/auth/request";
import {
  createAssuranceProject,
  listAssuranceProjects,
  scopeAssuranceSessionToWorkspace,
} from "~~/lib/tokenless/humanAssurance";
import { TokenlessServiceError, tokenlessErrorResponse } from "~~/lib/tokenless/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Context = { params: Promise<{ workspaceId: string }> };

async function principal(request: NextRequest, context: Context, mutation = false) {
  const session = await requireBrowserSession(request, mutation ? { mutation: true } : undefined);
  const { workspaceId } = await context.params;
  return scopeAssuranceSessionToWorkspace({ accountAddress: session.address, workspaceId });
}

export async function GET(request: NextRequest, context: Context) {
  try {
    return NextResponse.json({ projects: await listAssuranceProjects(await principal(request, context)) });
  } catch (error) {
    const response = tokenlessErrorResponse(error);
    return NextResponse.json(response.body, { status: response.status });
  }
}

export async function POST(request: NextRequest, context: Context) {
  try {
    const scopedPrincipal = await principal(request, context, true);
    const body = (await request.json()) as Record<string, unknown>;
    if (typeof body.name !== "string") {
      throw new TokenlessServiceError("Project name is required.", 400, "invalid_human_assurance_input");
    }
    const project = await createAssuranceProject({
      principal: scopedPrincipal,
      name: body.name,
      description: typeof body.description === "string" ? body.description : undefined,
      dataClassification:
        body.dataClassification === "public" ||
        body.dataClassification === "internal" ||
        body.dataClassification === "confidential" ||
        body.dataClassification === "restricted"
          ? body.dataClassification
          : "internal",
      retentionDays: typeof body.retentionDays === "number" ? body.retentionDays : 30,
    });
    return NextResponse.json(project, { status: 201 });
  } catch (error) {
    const response = tokenlessErrorResponse(error);
    return NextResponse.json(response.body, { status: response.status });
  }
}
