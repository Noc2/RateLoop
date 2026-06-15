import type { NextResponse } from "next/server";
import "server-only";
import { createSignedSessionStore } from "~~/lib/auth/signedSessionStore";

export const WATCHLIST_SIGNED_READ_SESSION_COOKIE_NAME = "rateloop_watchlist_read_session";
export const NOTIFICATION_PREFERENCES_SIGNED_READ_SESSION_COOKIE_NAME =
  "rateloop_notification_preferences_read_session";
export const NOTIFICATION_EMAIL_SIGNED_READ_SESSION_COOKIE_NAME = "rateloop_notification_email_read_session";
export const AGENT_POLICIES_SIGNED_READ_SESSION_COOKIE_NAME = "rateloop_agent_policies_read_session";
export const GATED_CONTEXT_SIGNED_READ_SESSION_COOKIE_NAME = "rateloop_gated_context_read_session";
const SIGNED_READ_SESSION_TTL_MS = 365 * 24 * 60 * 60 * 1000;

export const SIGNED_READ_SESSION_SCOPES = [
  "watchlist",
  "notification_preferences",
  "notification_email",
  "agent_policies",
  "gated_context",
] as const;

export type SignedReadSessionScope = (typeof SIGNED_READ_SESSION_SCOPES)[number];

export const SIGNED_READ_SESSION_COOKIE_NAMES: Record<SignedReadSessionScope, string> = {
  watchlist: WATCHLIST_SIGNED_READ_SESSION_COOKIE_NAME,
  notification_preferences: NOTIFICATION_PREFERENCES_SIGNED_READ_SESSION_COOKIE_NAME,
  notification_email: NOTIFICATION_EMAIL_SIGNED_READ_SESSION_COOKIE_NAME,
  agent_policies: AGENT_POLICIES_SIGNED_READ_SESSION_COOKIE_NAME,
  gated_context: GATED_CONTEXT_SIGNED_READ_SESSION_COOKIE_NAME,
};

const signedReadSessionStore = createSignedSessionStore<SignedReadSessionScope>({
  tableName: "signed_read_sessions",
  indexName: "signed_read_sessions_wallet_scope_expires_idx",
  ttlMs: SIGNED_READ_SESSION_TTL_MS,
  cookieNames: SIGNED_READ_SESSION_COOKIE_NAMES,
});

export const issueSignedReadSession = signedReadSessionStore.issueSession;
export const verifySignedReadSession = signedReadSessionStore.verifySession;
export const getSignedReadSessionCookie = signedReadSessionStore.getSessionCookie;

export async function setSignedReadSessionCookie(
  response: NextResponse,
  walletAddress: `0x${string}`,
  scope: SignedReadSessionScope,
) {
  const session = await issueSignedReadSession(walletAddress, scope);
  response.cookies.set(getSignedReadSessionCookie(scope, session));
  return response;
}

export async function setAllSignedReadSessionCookies(response: NextResponse, walletAddress: `0x${string}`) {
  await Promise.all(
    SIGNED_READ_SESSION_SCOPES.map(async scope => {
      await setSignedReadSessionCookie(response, walletAddress, scope);
    }),
  );

  return response;
}
