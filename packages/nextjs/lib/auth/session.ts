import { createHash, randomBytes } from "node:crypto";
import "server-only";
import { dbClient } from "~~/lib/db";
import { resolveOptionalAppUrl } from "~~/lib/env/appUrl";

const NONCE_TTL_MS = 5 * 60 * 1_000;
const SESSION_TTL_MS = 12 * 60 * 60 * 1_000;

export const AUTH_SESSION_COOKIE =
  process.env.NODE_ENV === "production" ? "__Host-rateloop-session" : "rateloop-session";

export type AuthProvider =
  | "better_auth"
  | "better_auth:apple"
  | "better_auth:email-otp"
  | "better_auth:google"
  | "better_auth:passkey"
  | "better_auth:sso";

export type BrowserIdentity = {
  principalId: string;
  authProvider: AuthProvider;
  displayName: string | null;
};

export type AuthSession = BrowserIdentity & { expiresAt: Date };

export type AuthStore = {
  createNonce(nonceHash: string, expiresAt: Date, createdAt: Date): Promise<void>;
  consumeNonce(nonceHash: string, now: Date): Promise<boolean>;
  createSession(sessionHash: string, identity: BrowserIdentity, expiresAt: Date, createdAt: Date): Promise<void>;
  findSession(sessionHash: string, now: Date): Promise<AuthSession | null>;
  revokeSession(sessionHash: string, now: Date): Promise<void>;
};

const postgresAuthStore: AuthStore = {
  async createNonce(nonceHash, expiresAt, createdAt) {
    await dbClient.execute({ sql: "DELETE FROM tokenless_auth_nonces WHERE expires_at <= ?", args: [createdAt] });
    await dbClient.execute({
      sql: `INSERT INTO tokenless_auth_nonces (nonce_hash, expires_at, created_at) VALUES (?, ?, ?)`,
      args: [nonceHash, expiresAt, createdAt],
    });
  },
  async consumeNonce(nonceHash, now) {
    const result = await dbClient.execute({
      sql: `UPDATE tokenless_auth_nonces SET consumed_at = ?
            WHERE nonce_hash = ? AND consumed_at IS NULL AND expires_at > ? RETURNING nonce_hash`,
      args: [now, nonceHash, now],
    });
    return result.rowCount === 1;
  },
  async createSession(sessionHash, identity, expiresAt, createdAt) {
    const principal = await dbClient.execute({
      sql: `SELECT principal_id FROM tokenless_principals
            WHERE principal_id = ? AND status = 'active' LIMIT 1`,
      args: [identity.principalId],
    });
    if (principal.rowCount !== 1) throw new AuthError("The RateLoop principal is not active.", 403);
    await dbClient.execute({
      sql: `INSERT INTO tokenless_auth_sessions
            (session_hash, principal_id, account_address, auth_provider, expires_at, created_at)
            VALUES (?, ?, NULL, ?, ?, ?)`,
      args: [sessionHash, identity.principalId, identity.authProvider, expiresAt, createdAt],
    });
  },
  async findSession(sessionHash, now) {
    const result = await dbClient.execute({
      sql: `SELECT s.principal_id, s.auth_provider, s.expires_at
            FROM tokenless_auth_sessions s
            JOIN tokenless_principals p ON p.principal_id = s.principal_id AND p.status = 'active'
            WHERE s.session_hash = ? AND s.revoked_at IS NULL AND s.expires_at > ? LIMIT 1`,
      args: [sessionHash, now],
    });
    const row = result.rows[0] as Record<string, unknown> | undefined;
    if (!row?.principal_id || !row.expires_at) return null;
    return {
      principalId: String(row.principal_id),
      authProvider: String(row.auth_provider) as AuthProvider,
      displayName: null,
      expiresAt: new Date(String(row.expires_at)),
    };
  },
  async revokeSession(sessionHash, now) {
    await dbClient.execute({
      sql: `UPDATE tokenless_auth_sessions SET revoked_at = ? WHERE session_hash = ? AND revoked_at IS NULL`,
      args: [now, sessionHash],
    });
  },
};

let authStoreOverride: AuthStore | null = null;

function getAuthStore() {
  return authStoreOverride ?? postgresAuthStore;
}

export function digest(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

export function getAuthOrigin() {
  const origin = resolveOptionalAppUrl({
    rawAppUrl: process.env.APP_URL,
    rawPublicAppUrl: process.env.NEXT_PUBLIC_APP_URL,
    rawVercelEnv: process.env.VERCEL_ENV,
    rawVercelProjectProductionUrl: process.env.VERCEL_PROJECT_PRODUCTION_URL,
    rawVercelUrl: process.env.VERCEL_URL,
    production: process.env.NODE_ENV === "production",
  });
  if (!origin) throw new AuthError("APP_URL is required for browser authentication.", 503);
  return new URL(origin).origin;
}

export async function createAuthNonce(now = new Date()) {
  const nonce = randomBytes(16).toString("hex");
  const expiresAt = new Date(now.getTime() + NONCE_TTL_MS);
  await getAuthStore().createNonce(digest(nonce), expiresAt, now);
  return { nonce, expiresAt };
}

export async function consumeAuthNonce(nonce: string, now = new Date()) {
  if (!/^[a-f0-9]{32}$/.test(nonce)) return false;
  return getAuthStore().consumeNonce(digest(nonce), now);
}

export async function createAuthSession(identity: BrowserIdentity, now = new Date()) {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(now.getTime() + SESSION_TTL_MS);
  await getAuthStore().createSession(digest(token), identity, expiresAt, now);
  return { token, expiresAt };
}

export async function findAuthSession(token: string | undefined, now = new Date()) {
  if (!token || token.length > 256) return null;
  return getAuthStore().findSession(digest(token), now);
}

export async function revokeAuthSession(token: string | undefined, now = new Date()) {
  if (!token || token.length > 256) return;
  await getAuthStore().revokeSession(digest(token), now);
}

export function assertAuthRequestOrigin(origin: string | null) {
  try {
    if (!origin || new URL(origin).origin !== getAuthOrigin()) throw new Error("mismatch");
  } catch {
    throw new AuthError("Cross-origin authentication request denied.", 403);
  }
}

export class AuthError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "AuthError";
  }
}

export function __setAuthStoreForTests(store: AuthStore | null) {
  authStoreOverride = store;
}
