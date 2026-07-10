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

function escapeHtml(value: string) {
  return value.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function buildStatusResponse(
  request: NextRequest,
  status: "verified" | "invalid",
  options: { ok: boolean; responseStatus: number; redirectStatus?: number },
) {
  const redirectUrl = buildRedirect(request, status);
  return redirectUrl
    ? NextResponse.redirect(redirectUrl, options.redirectStatus)
    : NextResponse.json({ ok: options.ok, status }, { status: options.responseStatus });
}

function buildConfirmationResponse(request: NextRequest) {
  const action = `${request.nextUrl.pathname}${request.nextUrl.search}`;
  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex">
  <title>Verify your RateLoop email</title>
  <style>
    body { color: #111827; font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; margin: 0; }
    main { margin: 0 auto; max-width: 34rem; padding: 4rem 1.5rem; }
    button { background: #111827; border: 0; border-radius: 0.5rem; color: white; cursor: pointer; font: inherit; font-weight: 600; padding: 0.75rem 1rem; }
    p { color: #4b5563; line-height: 1.6; }
  </style>
</head>
<body>
  <main>
    <h1>Verify your email?</h1>
    <p>Confirm this request to enable RateLoop notification emails.</p>
    <form method="post" action="${escapeHtml(action)}">
      <button type="submit">Verify email</button>
    </form>
  </main>
</body>
</html>`;

  return new NextResponse(html, {
    headers: {
      "cache-control": "no-store",
      "content-type": "text/html; charset=utf-8",
      "x-robots-tag": "noindex",
    },
  });
}

export async function GET(request: NextRequest) {
  const routeLimited = await checkRateLimit(request, ROUTE_RATE_LIMIT, {
    routeKey: "/api/notifications/email/verify",
  });
  if (routeLimited) return routeLimited;

  const token = request.nextUrl.searchParams.get("token");
  if (!token) {
    return buildStatusResponse(request, "invalid", {
      ok: false,
      responseStatus: 400,
    });
  }

  return buildConfirmationResponse(request);
}

export async function POST(request: NextRequest) {
  const routeLimited = await checkRateLimit(request, ROUTE_RATE_LIMIT, {
    routeKey: "/api/notifications/email/verify",
  });
  if (routeLimited) return routeLimited;

  const token = request.nextUrl.searchParams.get("token");
  if (!token) {
    return buildStatusResponse(request, "invalid", {
      ok: false,
      redirectStatus: 303,
      responseStatus: 400,
    });
  }

  const limited = await checkRateLimit(request, TOKEN_RATE_LIMIT, {
    extraKeyParts: [token.slice(0, 16)],
    routeKey: "/api/notifications/email/verify/token",
  });
  if (limited) return limited;

  const result = await verifyEmailNotificationToken(token);
  const status = result.ok ? "verified" : "invalid";
  return buildStatusResponse(request, status, {
    ok: result.ok,
    redirectStatus: 303,
    responseStatus: result.ok ? 200 : 400,
  });
}
