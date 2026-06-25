import { NextRequest, NextResponse } from "next/server";
import { getOptionalAppUrl } from "~~/lib/env/server";
import { verifyEmailNotificationToken } from "~~/lib/notifications/emailSettings";
import { buildNotificationSettingsRedirectUrl } from "~~/lib/notifications/emailUrls";
import { checkRateLimit } from "~~/utils/rateLimit";

const ROUTE_RATE_LIMIT = { limit: 60, windowMs: 60_000 };
const TOKEN_RATE_LIMIT = { limit: 30, windowMs: 60_000 };

function buildRedirect(request: NextRequest, status: "verified" | "invalid") {
  return buildNotificationSettingsRedirectUrl({
    requestOrigin: request.nextUrl.origin,
    fallbackAppUrl: getOptionalAppUrl(),
    status,
  });
}

export async function GET(request: NextRequest) {
  const routeLimited = await checkRateLimit(request, ROUTE_RATE_LIMIT, {
    routeKey: "/api/notifications/email/verify",
  });
  if (routeLimited) return routeLimited;

  const token = request.nextUrl.searchParams.get("token");
  if (!token) {
    const redirectUrl = buildRedirect(request, "invalid");
    return redirectUrl
      ? NextResponse.redirect(redirectUrl)
      : NextResponse.json({ ok: false, status: "invalid" }, { status: 400 });
  }

  const limited = await checkRateLimit(request, TOKEN_RATE_LIMIT, {
    extraKeyParts: [token.slice(0, 16)],
    routeKey: "/api/notifications/email/verify/token",
  });
  if (limited) return limited;

  const result = await verifyEmailNotificationToken(token);
  const status = result.ok ? "verified" : "invalid";
  const redirectUrl = buildRedirect(request, status);
  return redirectUrl
    ? NextResponse.redirect(redirectUrl)
    : NextResponse.json({ ok: result.ok, status }, { status: result.ok ? 200 : 400 });
}
