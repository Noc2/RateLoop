import { NextRequest, NextResponse } from "next/server";
import { requireBrowserSession } from "~~/lib/auth/request";
import {
  getTokenlessNotificationPreferences,
  normalizeNotificationPreferences,
  upsertTokenlessNotificationPreferences,
} from "~~/lib/notifications/tokenless";
import { tokenlessErrorResponse } from "~~/lib/tokenless/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const noStore = { "Cache-Control": "no-store" };

export async function GET(request: NextRequest) {
  try {
    const session = await requireBrowserSession(request);
    return NextResponse.json(await getTokenlessNotificationPreferences(session.principalId), { headers: noStore });
  } catch (error) {
    const response = tokenlessErrorResponse(error);
    return NextResponse.json(response.body, { status: response.status, headers: noStore });
  }
}

export async function PUT(request: NextRequest) {
  try {
    const session = await requireBrowserSession(request, { mutation: true });
    const body = (await request.json()) as { preferences?: unknown };
    const preferences = normalizeNotificationPreferences(body.preferences ?? body);
    return NextResponse.json(
      { ok: true, preferences: await upsertTokenlessNotificationPreferences(session.principalId, preferences) },
      { headers: noStore },
    );
  } catch (error) {
    const response = tokenlessErrorResponse(error);
    const status = response.status === 500 && error instanceof Error ? 400 : response.status;
    return NextResponse.json(response.body, { status, headers: noStore });
  }
}
