import { type NextRequest, NextResponse } from "next/server";
import {
  buildContentSecurityPolicy,
  createContentSecurityPolicyNonce,
  resolveRuntimeContentSecurityPolicyOptions,
} from "./lib/security/contentSecurityPolicy";

export function middleware(request: NextRequest) {
  const nonce = createContentSecurityPolicyNonce();
  const contentSecurityPolicy = buildContentSecurityPolicy({
    ...resolveRuntimeContentSecurityPolicyOptions(),
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
  matcher: [
    "/((?!_next/static|_next/image|api/og|favicon.ico|og-image.jpg|robots.txt|sitemap.xml|twitter-image.jpg).*)",
  ],
};
