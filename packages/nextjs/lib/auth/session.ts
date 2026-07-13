import { createHash, randomBytes } from "node:crypto";
import "server-only";
import { type Address, getAddress } from "viem";
import { dbClient } from "~~/lib/db";
import { resolveOptionalAppUrl } from "~~/lib/env/appUrl";

const NONCE_TTL_MS = 5 * 60 * 1_000;
const SESSION_TTL_MS = 12 * 60 * 60 * 1_000;

export const AUTH_SESSION_COOKIE =
  process.env.NODE_ENV === "production" ? "__Host-rateloop-session" : "rateloop-session";

export type AuthProvider = "apple" | "base_account" | "email" | "external_wallet" | "google" | "passkey" | "thirdweb";

export type BrowserIdentity = {
  address: Address;
  authProvider: AuthProvider;
  thirdwebUserId: string | null;
  email: string | null;
  emailVerified: boolean;
  emailDomain: string | null;
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
    await dbClient.execute({
      sql: "DELETE FROM tokenless_auth_nonces WHERE expires_at <= ?",
      args: [createdAt],
    });
    await dbClient.execute({
      sql: `INSERT INTO tokenless_auth_nonces (nonce_hash, expires_at, created_at)
            VALUES (?, ?, ?)`,
      args: [nonceHash, expiresAt, createdAt],
    });
  },
  async consumeNonce(nonceHash, now) {
    const result = await dbClient.execute({
      sql: `UPDATE tokenless_auth_nonces
            SET consumed_at = ?
            WHERE nonce_hash = ? AND consumed_at IS NULL AND expires_at > ?
            RETURNING nonce_hash`,
      args: [now, nonceHash, now],
    });
    return result.rowCount === 1;
  },
  async createSession(sessionHash, identity, expiresAt, createdAt) {
    await dbClient.execute({
      sql: `INSERT INTO tokenless_browser_identities
            (principal_address, thirdweb_user_id, auth_provider, primary_email, email_verified,
             email_domain, display_name, created_at, updated_at, last_login_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT (principal_address) DO UPDATE SET
              thirdweb_user_id = COALESCE(EXCLUDED.thirdweb_user_id, tokenless_browser_identities.thirdweb_user_id),
              auth_provider = EXCLUDED.auth_provider,
              primary_email = COALESCE(EXCLUDED.primary_email, tokenless_browser_identities.primary_email),
              email_verified = EXCLUDED.email_verified OR tokenless_browser_identities.email_verified,
              email_domain = COALESCE(EXCLUDED.email_domain, tokenless_browser_identities.email_domain),
              display_name = COALESCE(EXCLUDED.display_name, tokenless_browser_identities.display_name),
              updated_at = EXCLUDED.updated_at,
              last_login_at = EXCLUDED.last_login_at`,
      args: [
        identity.address.toLowerCase(),
        identity.thirdwebUserId,
        identity.authProvider,
        identity.email,
        identity.emailVerified,
        identity.emailDomain,
        identity.displayName,
        createdAt,
        createdAt,
        createdAt,
      ],
    });
    await dbClient.execute({
      sql: `INSERT INTO tokenless_auth_sessions
            (session_hash, account_address, auth_provider, expires_at, created_at)
            VALUES (?, ?, ?, ?, ?)`,
      args: [sessionHash, identity.address.toLowerCase(), identity.authProvider, expiresAt, createdAt],
    });
  },
  async findSession(sessionHash, now) {
    const result = await dbClient.execute({
      sql: `SELECT s.account_address, s.auth_provider AS session_auth_provider, s.expires_at,
                   i.thirdweb_user_id, i.auth_provider, i.primary_email, i.email_verified,
                   i.email_domain, i.display_name
            FROM tokenless_auth_sessions s
            LEFT JOIN tokenless_browser_identities i ON i.principal_address = s.account_address
            WHERE s.session_hash = ? AND s.revoked_at IS NULL AND s.expires_at > ?
            LIMIT 1`,
      args: [sessionHash, now],
    });
    const row = result.rows[0] as Record<string, unknown> | undefined;
    if (!row?.account_address || !row.expires_at) return null;
    const provider = String(row.auth_provider ?? row.session_auth_provider ?? "base_account") as AuthProvider;
    return {
      address: getAddress(String(row.account_address)),
      authProvider: provider,
      thirdwebUserId: row.thirdweb_user_id ? String(row.thirdweb_user_id) : null,
      email: row.primary_email ? String(row.primary_email) : null,
      emailVerified: row.email_verified === true,
      emailDomain: row.email_domain ? String(row.email_domain) : null,
      displayName: row.display_name ? String(row.display_name) : null,
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

function digest(value: string) {
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
  await getAuthStore().createSession(
    digest(token),
    { ...identity, address: getAddress(identity.address) },
    expiresAt,
    now,
  );
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
