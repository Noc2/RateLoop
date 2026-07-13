import { NextRequest, NextResponse } from "next/server";
import { requireBaseAccountRequest } from "~~/lib/base-account/request";
import { requestProjectDeletion } from "~~/lib/tokenless/artifactPrivacy";
import { TokenlessServiceError, tokenlessErrorResponse } from "~~/lib/tokenless/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Context = { params: Promise<{ projectId: string; workspaceId: string }> };

export async function POST(request: NextRequest, context: Context) {
  try {
    const session = await requireBaseAccountRequest(request, { mutation: true });
    const { projectId, workspaceId } = await context.params;
    const body = (await request.json()) as { executeAfter?: unknown; reason?: unknown };
    if (body.reason !== undefined && typeof body.reason !== "string") {
      throw new TokenlessServiceError("Deletion reason must be text.", 400, "invalid_deletion_request");
    }
    const executeAfter =
      typeof body.executeAfter === "string" && Number.isFinite(Date.parse(body.executeAfter))
        ? new Date(body.executeAfter)
        : undefined;
    const deletion = await requestProjectDeletion({
      accountAddress: session.address,
      executeAfter,
      projectId,
      reason: body.reason?.trim() || "customer_request",
      workspaceId,
    });
    return NextResponse.json(deletion, { status: 202 });
  } catch (error) {
    const response = tokenlessErrorResponse(error);
    return NextResponse.json(response.body, { status: response.status });
  }
}
