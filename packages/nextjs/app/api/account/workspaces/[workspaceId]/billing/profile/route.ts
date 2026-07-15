import { NextRequest, NextResponse } from "next/server";
import { requireBrowserSession } from "~~/lib/auth/request";
import { getWorkspaceBillingProfile, updateWorkspaceBillingProfile } from "~~/lib/billing/workspaceBilling";
import { TokenlessServiceError, tokenlessErrorResponse } from "~~/lib/tokenless/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Context = { params: Promise<{ workspaceId: string }> };

const noStore = { "Cache-Control": "private, no-store, max-age=0" };

export async function GET(request: NextRequest, context: Context) {
  try {
    const session = await requireBrowserSession(request);
    const { workspaceId } = await context.params;
    return NextResponse.json(await getWorkspaceBillingProfile({ accountAddress: session.principalId, workspaceId }), {
      headers: noStore,
    });
  } catch (error) {
    const response = tokenlessErrorResponse(error);
    return NextResponse.json(response.body, { status: response.status, headers: noStore });
  }
}

export async function PATCH(request: NextRequest, context: Context) {
  try {
    const session = await requireBrowserSession(request, { mutation: true });
    const { workspaceId } = await context.params;
    let body: Record<string, unknown> | null;
    try {
      body = (await request.json()) as Record<string, unknown> | null;
    } catch {
      throw new TokenlessServiceError("Billing profile body must be valid JSON.", 400, "invalid_billing_profile");
    }
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      throw new TokenlessServiceError("Billing profile body must be an object.", 400, "invalid_billing_profile");
    }
    return NextResponse.json(
      await updateWorkspaceBillingProfile({
        accountAddress: session.principalId,
        legalName: body.legalName,
        registeredAddress: body.registeredAddress,
        registrationNumber: body.registrationNumber,
        vatCountryCode: body.vatCountryCode,
        vatId: body.vatId,
        workspaceId,
      }),
      { headers: noStore },
    );
  } catch (error) {
    const response = tokenlessErrorResponse(error);
    return NextResponse.json(response.body, { status: response.status, headers: noStore });
  }
}
