import { NextRequest, NextResponse } from "next/server";
import { buildTokenlessNotificationSettingsUrl } from "~~/lib/notifications/resend";
import { unsubscribeTokenlessEmailNotificationToken } from "~~/lib/notifications/tokenless";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function notificationSettingsUrl(request: NextRequest, result?: "unsubscribed" | "invalid_unsubscribe") {
  const url = buildTokenlessNotificationSettingsUrl(result) ?? new URL("/human?tab=settings", request.nextUrl.origin);
  if (result && !url.searchParams.has("email")) url.searchParams.set("email", result);
  url.hash = "notifications";
  return url;
}

function htmlAttribute(value: string) {
  return value.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get("token")?.trim();
  if (!token) return NextResponse.redirect(notificationSettingsUrl(request, "invalid_unsubscribe"), 303);
  const action = new URL(request.nextUrl.pathname, request.nextUrl.origin);
  action.searchParams.set("token", token);
  action.searchParams.set("manual", "1");
  const keepUrl = notificationSettingsUrl(request);
  return new NextResponse(
    `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Unsubscribe from RateLoop email</title></head>
<body><main><h1>Unsubscribe from RateLoop email?</h1><p>This stops optional email notifications.</p><form method="post" action="${htmlAttribute(action.toString())}"><button type="submit">Unsubscribe</button></form><p><a href="${htmlAttribute(keepUrl.toString())}">Keep notifications</a></p></main></body>
</html>`,
    {
      headers: {
        "Cache-Control": "private, no-store, max-age=0",
        "Content-Security-Policy": "default-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
        "Content-Type": "text/html; charset=utf-8",
        "Referrer-Policy": "no-referrer",
        "X-Content-Type-Options": "nosniff",
      },
    },
  );
}

export async function POST(request: NextRequest) {
  const token = request.nextUrl.searchParams.get("token")?.trim();
  if (!token) return new NextResponse(null, { status: 400 });
  const result = await unsubscribeTokenlessEmailNotificationToken(token);
  if (request.nextUrl.searchParams.get("manual") === "1") {
    return NextResponse.redirect(
      notificationSettingsUrl(request, result.ok ? "unsubscribed" : "invalid_unsubscribe"),
      303,
    );
  }
  return new NextResponse(null, { status: result.ok ? 200 : 404 });
}
