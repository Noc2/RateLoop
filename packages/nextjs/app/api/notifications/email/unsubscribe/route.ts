import { NextRequest, NextResponse } from "next/server";
import { buildTokenlessNotificationSettingsUrl } from "~~/lib/notifications/resend";
import { unsubscribeTokenlessEmailNotificationToken } from "~~/lib/notifications/tokenless";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get("token");
  const result = token ? await unsubscribeTokenlessEmailNotificationToken(token) : { ok: false };
  const url =
    buildTokenlessNotificationSettingsUrl(result.ok ? "unsubscribed" : "invalid_unsubscribe") ??
    new URL("/human?tab=settings", request.nextUrl.origin);
  if (!url.searchParams.has("email")) url.searchParams.set("email", result.ok ? "unsubscribed" : "invalid_unsubscribe");
  url.hash = "notifications";
  return NextResponse.redirect(url, 303);
}
