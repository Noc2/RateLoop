import { NextRequest, NextResponse } from "next/server";
import { requireBrowserSession } from "~~/lib/auth/request";
import { TokenlessServiceError, tokenlessErrorResponse } from "~~/lib/tokenless/server";
import { configureWorkspaceSetupReviews } from "~~/lib/tokenless/workspaceAgentSetup";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Context = { params: Promise<{ workspaceId: string }> };

export async function POST(request: NextRequest, context: Context) {
  try {
    const session = await requireBrowserSession(request, { mutation: true });
    const { workspaceId } = await context.params;
    const body = (await request.json()) as Record<string, unknown>;
    if (
      !body ||
      Array.isArray(body) ||
      Object.keys(body).some(key => !["revision", "review"].includes(key)) ||
      !body.review ||
      typeof body.review !== "object" ||
      Array.isArray(body.review) ||
      Object.keys(body.review).some(
        key => !["mode", "reviewerAudience", "contentBoundary", "autonomousAccess"].includes(key),
      )
    ) {
      throw new TokenlessServiceError("Review behavior is invalid.", 400, "invalid_agent_setup_review");
    }
    return NextResponse.json(
      await configureWorkspaceSetupReviews({
        accountAddress: session.principalId,
        workspaceId,
        revision: body.revision,
        review: body.review,
      }),
      { headers: { "Cache-Control": "private, no-store, max-age=0" } },
    );
  } catch (error) {
    const response = tokenlessErrorResponse(error);
    return NextResponse.json(response.body, {
      status: response.status,
      headers: { "Cache-Control": "private, no-store, max-age=0" },
    });
  }
}
