import { NextRequest, NextResponse } from "next/server";
import { buildTokenlessNotificationSettingsUrl } from "~~/lib/notifications/resend";
import { verifyTokenlessEmailNotificationToken } from "~~/lib/notifications/tokenless";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function redirect(request: NextRequest, status: "verified" | "invalid") {
  const url = buildTokenlessNotificationSettingsUrl(status) ?? new URL("/human?tab=settings", request.nextUrl.origin);
  if (!url.searchParams.has("email")) url.searchParams.set("email", status);
  url.hash = "notifications";
  return NextResponse.redirect(url, 303);
}

function confirmationPage(request: NextRequest, token: string) {
  const action = `${request.nextUrl.pathname}?token=${encodeURIComponent(token)}`;
  return new NextResponse(
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>Verify your RateLoop email</title><style>body{font-family:ui-sans-serif,system-ui;margin:0;color:#171717}main{max-width:34rem;margin:0 auto;padding:4rem 1.5rem}button{border:0;border-radius:8px;background:#171717;color:#fff;padding:.75rem 1rem;font:inherit;font-weight:600;cursor:pointer}p{color:#555;line-height:1.6}</style></head><body><main><h1>Verify your email?</h1><p>Confirm this address to enable RateLoop notification emails.</p><form method="post" action="${action}"><button type="submit">Verify email</button></form></main></body></html>`,
    { headers: { "Cache-Control": "no-store", "Content-Type": "text/html; charset=utf-8", "X-Robots-Tag": "noindex" } },
  );
}

export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get("token");
  if (!token) return redirect(request, "invalid");
  return confirmationPage(request, token);
}

export async function POST(request: NextRequest) {
  const token = request.nextUrl.searchParams.get("token");
  if (!token) return redirect(request, "invalid");
  const result = await verifyTokenlessEmailNotificationToken(token);
  return redirect(request, result.ok ? "verified" : "invalid");
}
