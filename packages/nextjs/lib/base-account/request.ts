import type { NextRequest } from "next/server";
import { BASE_ACCOUNT_SESSION_COOKIE, assertBaseAccountRequestOrigin, findBaseAccountSession } from "./auth";
import "server-only";
import { TokenlessServiceError } from "~~/lib/tokenless/server";

export async function requireBaseAccountRequest(request: NextRequest, options?: { mutation?: boolean }) {
  if (options?.mutation) {
    try {
      assertBaseAccountRequestOrigin(request.headers.get("origin"));
    } catch {
      throw new TokenlessServiceError("Cross-origin request denied.", 403, "invalid_origin");
    }
  }
  const session = await findBaseAccountSession(request.cookies.get(BASE_ACCOUNT_SESSION_COOKIE)?.value);
  if (!session) throw new TokenlessServiceError("Authentication is required.", 401, "authentication_required");
  return session;
}
