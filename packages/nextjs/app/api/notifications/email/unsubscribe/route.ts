import { NextRequest, NextResponse } from "next/server";
import { getNotificationDeliverySecret, getOptionalAppUrl } from "~~/lib/env/server";
import { unsubscribeEmailNotificationSubscription } from "~~/lib/notifications/emailSettings";
import {
  buildNotificationSettingsRedirectUrl,
  verifyNotificationEmailUnsubscribeToken,
} from "~~/lib/notifications/emailUrls";

type UnsubscribeStatus = "unsubscribed" | "invalid_unsubscribe";

function buildRedirect(request: NextRequest, status: "unsubscribed" | "invalid_unsubscribe") {
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
  status: UnsubscribeStatus,
  options: {
    ok: boolean;
    responseStatus: number;
    redirectStatus?: number;
  },
) {
  const redirectUrl = buildRedirect(request, status);
  return redirectUrl
    ? NextResponse.redirect(redirectUrl, options.redirectStatus)
    : NextResponse.json({ ok: options.ok, status }, { status: options.responseStatus });
}

function getUnsubscribePayload(request: NextRequest) {
  const token = request.nextUrl.searchParams.get("token");
  const secret = getNotificationDeliverySecret();

  if (!token || !secret) {
    return null;
  }

  return verifyNotificationEmailUnsubscribeToken(token, secret);
}

function buildConfirmationResponse(request: NextRequest) {
  const action = `${request.nextUrl.pathname}${request.nextUrl.search}`;
  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex">
  <title>Unsubscribe from RateLoop emails</title>
  <style>
    body { color: #111827; font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; margin: 0; }
    main { margin: 0 auto; max-width: 34rem; padding: 4rem 1.5rem; }
    button { background: #111827; border: 0; border-radius: 0.5rem; color: white; cursor: pointer; font: inherit; font-weight: 600; padding: 0.75rem 1rem; }
    p { color: #4b5563; line-height: 1.6; }
  </style>
</head>
<body>
  <main>
    <h1>Unsubscribe from RateLoop emails?</h1>
    <p>Confirm this request to stop notification emails for this wallet.</p>
    <form method="post" action="${escapeHtml(action)}">
      <button type="submit">Unsubscribe</button>
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
  const payload = getUnsubscribePayload(request);
  if (!payload) {
    return buildStatusResponse(request, "invalid_unsubscribe", { ok: false, responseStatus: 400 });
  }

  return buildConfirmationResponse(request);
}

export async function POST(request: NextRequest) {
  const payload = getUnsubscribePayload(request);
  if (!payload) {
    return buildStatusResponse(request, "invalid_unsubscribe", {
      ok: false,
      redirectStatus: 303,
      responseStatus: 400,
    });
  }

  const result = await unsubscribeEmailNotificationSubscription(payload.walletAddress as `0x${string}`, payload.email);
  const status = result.ok ? "unsubscribed" : "invalid_unsubscribe";
  return buildStatusResponse(request, status, {
    ok: result.ok,
    redirectStatus: 303,
    responseStatus: result.ok ? 200 : 400,
  });
}
