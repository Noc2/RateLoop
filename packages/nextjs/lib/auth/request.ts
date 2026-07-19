import type { NextRequest } from "next/server";
import { AUTH_SESSION_COOKIE, assertAuthRequestOrigin, findAuthSession } from "./session";
import "server-only";
import { TokenlessServiceError } from "~~/lib/tokenless/server";

export async function requireBrowserSession(request: NextRequest, options?: { mutation?: boolean }) {
  const mutation = options?.mutation ?? !["GET", "HEAD", "OPTIONS"].includes(request.method.toUpperCase());
  if (mutation) {
    try {
      assertAuthRequestOrigin(request.headers.get("origin"));
    } catch {
      throw new TokenlessServiceError("Cross-origin request denied.", 403, "invalid_origin");
    }
  }
  const session = await findAuthSession(request.cookies.get(AUTH_SESSION_COOKIE)?.value);
  if (!session) throw new TokenlessServiceError("Authentication is required.", 401, "authentication_required");
  return session;
}
