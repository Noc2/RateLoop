import { NextRequest, NextResponse } from "next/server";
import { getOptionalAppUrl } from "~~/lib/env/server";
import { verifyEmailNotificationToken } from "~~/lib/notifications/emailSettings";
import { buildNotificationSettingsRedirectUrl } from "~~/lib/notifications/emailUrls";
import { checkRateLimit } from "~~/utils/rateLimit";

const RATE_LIMIT = { limit: 30, windowMs: 60_000 };

function buildRedirect(request: NextRequest, status: "verified" | "invalid") {
  return buildNotificationSettingsRedirectUrl({
    requestOrigin: request.nextUrl.origin,
    fallbackAppUrl: getOptionalAppUrl(),
    status,
  });
}

export async function GET(request: NextRequest) {
  const limited = await checkRateLimit(request, RATE_LIMIT, {
    extraKeyParts: [request.nextUrl.searchParams.get("token")?.slice(0, 16)],
  });
  if (limited) return limited;

  const token = request.nextUrl.searchParams.get("token");
  if (!token) {
    const redirectUrl = buildRedirect(request, "invalid");
    return redirectUrl
      ? NextResponse.redirect(redirectUrl)
      : NextResponse.json({ ok: false, status: "invalid" }, { status: 400 });
  }

  const result = await verifyEmailNotificationToken(token);
  const status = result.ok ? "verified" : "invalid";
  const redirectUrl = buildRedirect(request, status);
  return redirectUrl
    ? NextResponse.redirect(redirectUrl)
    : NextResponse.json({ ok: result.ok, status }, { status: result.ok ? 200 : 400 });
}
