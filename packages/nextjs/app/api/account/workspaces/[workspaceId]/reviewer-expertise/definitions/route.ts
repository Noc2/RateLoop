import { NextRequest, NextResponse } from "next/server";
import { requireBrowserSession } from "~~/lib/auth/request";
import {
  createWorkspaceReviewerExpertiseDefinition,
  listReviewerExpertiseDefinitions,
} from "~~/lib/tokenless/reviewerExpertiseDefinitions";
import { tokenlessErrorResponse } from "~~/lib/tokenless/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Context = { params: Promise<{ workspaceId: string }> };
const noStore = { "Cache-Control": "private, no-store, max-age=0" };

export async function GET(request: NextRequest, context: Context) {
  try {
    const session = await requireBrowserSession(request);
    const { workspaceId } = await context.params;
    const result = await listReviewerExpertiseDefinitions({
      accountAddress: session.principalId,
      workspaceId,
      context: request.nextUrl.searchParams.get("context") ?? "",
    });
    return NextResponse.json(result, { headers: noStore });
  } catch (error) {
    const response = tokenlessErrorResponse(error);
    return NextResponse.json(response.body, { status: response.status, headers: noStore });
  }
}

export async function POST(request: NextRequest, context: Context) {
  try {
    const session = await requireBrowserSession(request, { mutation: true });
    const { workspaceId } = await context.params;
    const body = (await request.json()) as Record<string, unknown>;
    const result = await createWorkspaceReviewerExpertiseDefinition({
      accountAddress: session.principalId,
      workspaceId,
      label: body.label,
      description: body.description,
    });
    return NextResponse.json(result, { status: 201, headers: noStore });
  } catch (error) {
    const response = tokenlessErrorResponse(error);
    return NextResponse.json(response.body, { status: response.status, headers: noStore });
  }
}
