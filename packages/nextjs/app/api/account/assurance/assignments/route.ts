import { NextRequest, NextResponse } from "next/server";
import { requireBrowserSession } from "~~/lib/auth/request";
import { listReviewerAssignments } from "~~/lib/tokenless/reviewerAssignments";
import { tokenlessErrorResponse } from "~~/lib/tokenless/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    const session = await requireBrowserSession(request);
    const params = request.nextUrl.searchParams;
    return NextResponse.json(
      {
        assignments: await listReviewerAssignments({
          accountAddress: session.principalId,
          query: params.get("q") ?? "",
          state: params.get("state") ?? "",
          view: params.get("view") ?? "active",
          limit: Number(params.get("limit") ?? 50),
        }),
        query: params.get("q") ?? "",
        state: params.get("state") ?? "",
        view: params.get("view") ?? "active",
      },
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
