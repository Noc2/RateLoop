import { NextRequest, NextResponse } from "next/server";
import { stripLocalePrefix } from "./i18n/config";
import { routing } from "./i18n/routing";
import {
  buildContentSecurityPolicy,
  createContentSecurityPolicyNonce,
  resolveAgentOAuthFormActionRedirectOrigins,
  resolveAgentOAuthFrameRedirectOrigins,
  resolveRuntimeContentSecurityPolicyOptions,
} from "./lib/security/contentSecurityPolicy";
import createIntlMiddleware from "next-intl/middleware";

const handleI18nRouting = createIntlMiddleware(routing);

export function isMachinePath(pathname: string) {
  return (
    pathname === "/api" ||
    pathname.startsWith("/api/") ||
    pathname === "/.well-known" ||
    pathname.startsWith("/.well-known/")
  );
}

export function middleware(request: NextRequest) {
  const nonce = createContentSecurityPolicyNonce();
  const redirectUri = request.nextUrl.searchParams.get("redirect_uri");
  const securityPathname = stripLocalePrefix(request.nextUrl.pathname);
  const contentSecurityPolicy = buildContentSecurityPolicy({
    ...resolveRuntimeContentSecurityPolicyOptions(),
    formActionRedirectOrigins: resolveAgentOAuthFormActionRedirectOrigins(securityPathname, redirectUri),
    frameRedirectOrigins: resolveAgentOAuthFrameRedirectOrigins(securityPathname, redirectUri),
    nonce,
  });
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", contentSecurityPolicy);

  const response = isMachinePath(request.nextUrl.pathname)
    ? NextResponse.next({
        request: {
          headers: requestHeaders,
        },
      })
    : handleI18nRouting(new NextRequest(request, { headers: requestHeaders }));

  response.headers.set("Content-Security-Policy", contentSecurityPolicy);

  return response;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|og-image.jpg|robots.txt|sitemap.xml|twitter-image.jpg|.*\\.[^/]+$).*)",
  ],
};
