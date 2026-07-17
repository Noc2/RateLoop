import { NextRequest, NextResponse } from "next/server";
import { requireBrowserSession } from "~~/lib/auth/request";
import { listNotificationInbox, markNotificationInboxRead } from "~~/lib/tokenless/oversightAlerts";
import { TokenlessServiceError, tokenlessErrorResponse } from "~~/lib/tokenless/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const noStore = { "Cache-Control": "private, no-store" };

export async function GET(request: NextRequest) {
  try {
    const session = await requireBrowserSession(request);
    const rawLimit = request.nextUrl.searchParams.get("limit");
    const limit = rawLimit === null ? undefined : Number(rawLimit);
    if (limit !== undefined && (!Number.isSafeInteger(limit) || limit < 1 || limit > 100)) {
      throw new TokenlessServiceError("limit must be an integer between 1 and 100.", 400, "invalid_notification_read");
    }
    return NextResponse.json(await listNotificationInbox({ accountAddress: session.principalId, limit }), {
      headers: noStore,
    });
  } catch (error) {
    const response = tokenlessErrorResponse(error);
    return NextResponse.json(response.body, { status: response.status, headers: noStore });
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await requireBrowserSession(request, { mutation: true });
    let body: { notificationIds?: unknown };
    try {
      body = (await request.json()) as typeof body;
    } catch {
      throw new TokenlessServiceError("Read receipts must be valid JSON.", 400, "invalid_notification_read");
    }
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      throw new TokenlessServiceError("Read receipts must be an object.", 400, "invalid_notification_read");
    }
    return NextResponse.json(
      await markNotificationInboxRead({
        accountAddress: session.principalId,
        notificationIds: body.notificationIds,
      }),
      { headers: noStore },
    );
  } catch (error) {
    const response = tokenlessErrorResponse(error);
    return NextResponse.json(response.body, { status: response.status, headers: noStore });
  }
}
