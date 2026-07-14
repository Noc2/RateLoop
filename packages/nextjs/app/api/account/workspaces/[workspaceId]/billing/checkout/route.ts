import { NextRequest, NextResponse } from "next/server";
import { requireBrowserSession } from "~~/lib/auth/request";
import { startWorkspaceCheckout } from "~~/lib/billing/workspaceBilling";
import { TokenlessServiceError, tokenlessErrorResponse } from "~~/lib/tokenless/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Context = { params: Promise<{ workspaceId: string }> };

export async function POST(request: NextRequest, context: Context) {
  try {
    const session = await requireBrowserSession(request, { mutation: true });
    const { workspaceId } = await context.params;
    let body: { plan?: unknown } | null;
    try {
      body = (await request.json()) as { plan?: unknown } | null;
    } catch {
      throw new TokenlessServiceError("Checkout request body must be valid JSON.", 400, "invalid_billing_plan");
    }
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      throw new TokenlessServiceError("Checkout request body must be an object.", 400, "invalid_billing_plan");
    }
    return NextResponse.json(
      await startWorkspaceCheckout({ accountAddress: session.address, plan: body.plan, workspaceId }),
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
