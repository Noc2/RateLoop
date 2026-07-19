import { NextRequest, NextResponse } from "next/server";
import { getBetterAuth } from "~~/lib/auth/betterAuth";
import { BETTER_AUTH_SESSION_COOKIE_NAMES } from "~~/lib/auth/betterAuthCookies";
import { requireBrowserSession } from "~~/lib/auth/request";
import { AUTH_SESSION_COOKIE } from "~~/lib/auth/session";
import { deleteAccount, getAccountDeletionPreview } from "~~/lib/privacy/accountDeletion";
import { TokenlessServiceError, tokenlessErrorResponse } from "~~/lib/tokenless/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const NO_STORE = { "Cache-Control": "private, no-store, max-age=0" } as const;

export async function GET(request: NextRequest) {
  try {
    const session = await requireBrowserSession(request);
    return NextResponse.json(await getAccountDeletionPreview(session.principalId), { headers: NO_STORE });
  } catch (error) {
    const response = tokenlessErrorResponse(error);
    return NextResponse.json(response.body, { headers: NO_STORE, status: response.status });
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await requireBrowserSession(request, { mutation: true });
    const betterSession = await getBetterAuth().api.getSession({ headers: request.headers });
    if (!betterSession?.user?.id) {
      throw new TokenlessServiceError(
        "Sign in again before deleting this account.",
        401,
        "recent_authentication_required",
      );
    }
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      throw new TokenlessServiceError("Account deletion body must be valid JSON.", 400, "invalid_account_deletion");
    }
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      throw new TokenlessServiceError("Account deletion body must be an object.", 400, "invalid_account_deletion");
    }
    const result = await deleteAccount({
      betterAuthUserId: betterSession.user.id,
      confirmation: String((body as Record<string, unknown>).confirmation ?? ""),
      principalId: session.principalId,
    });
    const response = NextResponse.json(result, { headers: NO_STORE });
    response.cookies.delete(AUTH_SESSION_COOKIE);
    for (const cookieName of BETTER_AUTH_SESSION_COOKIE_NAMES) response.cookies.delete(cookieName);
    return response;
  } catch (error) {
    const response = tokenlessErrorResponse(error);
    return NextResponse.json(response.body, { headers: NO_STORE, status: response.status });
  }
}
