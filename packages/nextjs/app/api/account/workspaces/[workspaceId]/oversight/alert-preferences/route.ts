import { NextRequest, NextResponse } from "next/server";
import { requireBrowserSession } from "~~/lib/auth/request";
import { getWorkspaceAlertPreferences, updateWorkspaceAlertPreferences } from "~~/lib/tokenless/oversightAlerts";
import { TokenlessServiceError, tokenlessErrorResponse } from "~~/lib/tokenless/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Context = { params: Promise<{ workspaceId: string }> };

const noStore = { "Cache-Control": "private, no-store" };

export async function GET(request: NextRequest, context: Context) {
  try {
    const session = await requireBrowserSession(request);
    const { workspaceId } = await context.params;
    return NextResponse.json(
      { preferences: await getWorkspaceAlertPreferences({ accountAddress: session.principalId, workspaceId }) },
      { headers: noStore },
    );
  } catch (error) {
    const response = tokenlessErrorResponse(error);
    return NextResponse.json(response.body, { status: response.status, headers: noStore });
  }
}

export async function PUT(request: NextRequest, context: Context) {
  try {
    const session = await requireBrowserSession(request, { mutation: true });
    let body: { preferences?: unknown };
    try {
      body = (await request.json()) as typeof body;
    } catch {
      throw new TokenlessServiceError("Alert preferences must be valid JSON.", 400, "invalid_alert_preferences");
    }
    const { workspaceId } = await context.params;
    return NextResponse.json(
      {
        preferences: await updateWorkspaceAlertPreferences({
          accountAddress: session.principalId,
          workspaceId,
          preferences: body?.preferences,
        }),
      },
      { headers: noStore },
    );
  } catch (error) {
    const response = tokenlessErrorResponse(error);
    return NextResponse.json(response.body, { status: response.status, headers: noStore });
  }
}
