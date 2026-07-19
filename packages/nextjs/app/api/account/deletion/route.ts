import { NextRequest, NextResponse } from "next/server";
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
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      throw new TokenlessServiceError("Account deletion body must be valid JSON.", 400, "invalid_account_deletion");
    }
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      throw new TokenlessServiceError("Account deletion body must be an object.", 400, "invalid_account_deletion");
    }
    const confirmation = String((body as Record<string, unknown>).confirmation ?? "");
    if (confirmation !== "DELETE") {
      throw new TokenlessServiceError("Type DELETE to confirm account deletion.", 400, "account_deletion_unconfirmed");
    }
    const result = await deleteAccount({
      confirmation,
      principalId: session.principalId,
      recentAuthProof: (body as Record<string, unknown>).recentAuthProof,
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
