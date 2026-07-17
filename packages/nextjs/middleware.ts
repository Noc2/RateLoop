import { type NextRequest, NextResponse } from "next/server";
import {
  buildContentSecurityPolicy,
  createContentSecurityPolicyNonce,
  resolveAgentOAuthFormActionRedirectOrigins,
  resolveAgentOAuthFrameRedirectOrigins,
  resolveRuntimeContentSecurityPolicyOptions,
} from "./lib/security/contentSecurityPolicy";

export function middleware(request: NextRequest) {
  const nonce = createContentSecurityPolicyNonce();
  const redirectUri = request.nextUrl.searchParams.get("redirect_uri");
  const contentSecurityPolicy = buildContentSecurityPolicy({
    ...resolveRuntimeContentSecurityPolicyOptions(),
    formActionRedirectOrigins: resolveAgentOAuthFormActionRedirectOrigins(request.nextUrl.pathname, redirectUri),
    frameRedirectOrigins: resolveAgentOAuthFrameRedirectOrigins(request.nextUrl.pathname, redirectUri),
    nonce,
  });
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", contentSecurityPolicy);

  const response = NextResponse.next({
    request: {
      headers: requestHeaders,
    },
  });

  response.headers.set("Content-Security-Policy", contentSecurityPolicy);

  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|og-image.jpg|robots.txt|sitemap.xml|twitter-image.jpg).*)"],
};
