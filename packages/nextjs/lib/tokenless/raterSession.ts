import { type NextRequest } from "next/server";
import "server-only";
import {
  BASE_ACCOUNT_SESSION_COOKIE,
  findBaseAccountSession,
  getBaseAccountAuthOrigin,
} from "~~/lib/base-account/auth";
import { TokenlessServiceError } from "~~/lib/tokenless/server";

export async function requireRaterSession(request: NextRequest, requireSameOrigin: boolean) {
  if (requireSameOrigin) {
    const origin = request.headers.get("origin");
    let valid = false;
    try {
      valid = Boolean(origin && new URL(origin).origin === getBaseAccountAuthOrigin());
    } catch {
      valid = false;
    }
    if (!valid) throw new TokenlessServiceError("Cross-origin rater request denied.", 403, "cross_origin_denied");
  }
  const session = await findBaseAccountSession(request.cookies.get(BASE_ACCOUNT_SESSION_COOKIE)?.value);
  if (!session)
    throw new TokenlessServiceError("Sign in with your Base Account first.", 401, "authentication_required");
  return session;
}
