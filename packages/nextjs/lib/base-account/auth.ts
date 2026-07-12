import { createHash, randomBytes } from "node:crypto";
import "server-only";
import { type Address, type Hex, createPublicClient, getAddress, http } from "viem";
import { baseSepolia } from "viem/chains";
import { parseSiweMessage } from "viem/siwe";
import { dbClient } from "~~/lib/db";
import { resolveOptionalAppUrl } from "~~/lib/env/appUrl";

const NONCE_TTL_MS = 5 * 60 * 1_000;
const SESSION_TTL_MS = 12 * 60 * 60 * 1_000;
const MAX_CLOCK_SKEW_MS = 5 * 60 * 1_000;

export const BASE_ACCOUNT_SESSION_COOKIE =
  process.env.NODE_ENV === "production" ? "__Host-rateloop-session" : "rateloop-session";

type AuthSession = { address: Address; expiresAt: Date };

export type BaseAccountAuthStore = {
  createNonce(nonceHash: string, expiresAt: Date): Promise<void>;
  consumeNonce(nonceHash: string, now: Date): Promise<boolean>;
  createSession(sessionHash: string, address: Address, expiresAt: Date, createdAt: Date): Promise<void>;
  findSession(sessionHash: string, now: Date): Promise<AuthSession | null>;
  revokeSession(sessionHash: string, now: Date): Promise<void>;
};

const postgresAuthStore: BaseAccountAuthStore = {
  async createNonce(nonceHash, expiresAt) {
    const createdAt = new Date();
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
  async createSession(sessionHash, address, expiresAt, createdAt) {
    await dbClient.execute({
      sql: `INSERT INTO tokenless_auth_sessions
            (session_hash, account_address, expires_at, created_at)
            VALUES (?, ?, ?, ?)`,
      args: [sessionHash, address.toLowerCase(), expiresAt, createdAt],
    });
  },
  async findSession(sessionHash, now) {
    const result = await dbClient.execute({
      sql: `SELECT account_address, expires_at
            FROM tokenless_auth_sessions
            WHERE session_hash = ? AND revoked_at IS NULL AND expires_at > ?
            LIMIT 1`,
      args: [sessionHash, now],
    });
    const row = result.rows[0] as { account_address?: string; expires_at?: Date | string } | undefined;
    if (!row?.account_address || !row.expires_at) return null;
    return { address: getAddress(row.account_address), expiresAt: new Date(row.expires_at) };
  },
  async revokeSession(sessionHash, now) {
    await dbClient.execute({
      sql: `UPDATE tokenless_auth_sessions SET revoked_at = ? WHERE session_hash = ? AND revoked_at IS NULL`,
      args: [now, sessionHash],
    });
  },
};

let authStoreOverride: BaseAccountAuthStore | null = null;
let signatureVerifierOverride:
  | ((input: { address: Address; message: string; signature: Hex }) => Promise<boolean>)
  | null = null;

function getAuthStore() {
  return authStoreOverride ?? postgresAuthStore;
}

function digest(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

export function getBaseAccountAuthOrigin() {
  const origin = resolveOptionalAppUrl({
    rawAppUrl: process.env.APP_URL,
    rawPublicAppUrl: process.env.NEXT_PUBLIC_APP_URL,
    rawVercelEnv: process.env.VERCEL_ENV,
    rawVercelProjectProductionUrl: process.env.VERCEL_PROJECT_PRODUCTION_URL,
    rawVercelUrl: process.env.VERCEL_URL,
    production: process.env.NODE_ENV === "production",
  });
  if (!origin) throw new Error("APP_URL is required for Base Account authentication.");
  return new URL(origin).origin;
}

function getSignatureVerifier() {
  if (signatureVerifierOverride) return signatureVerifierOverride;
  const configuredRpc =
    process.env.BASE_SEPOLIA_RPC_URL?.trim() || process.env.NEXT_PUBLIC_BASE_SEPOLIA_RPC_URL?.trim();
  if (!configuredRpc && process.env.NODE_ENV === "production") {
    throw new Error("BASE_SEPOLIA_RPC_URL is required for Base Account authentication in production.");
  }
  const client = createPublicClient({ chain: baseSepolia, transport: http(configuredRpc || undefined) });
  return (input: { address: Address; message: string; signature: Hex }) => client.verifyMessage(input);
}

export async function createBaseAccountNonce(now = new Date()) {
  const nonce = randomBytes(16).toString("hex");
  const expiresAt = new Date(now.getTime() + NONCE_TTL_MS);
  await getAuthStore().createNonce(digest(nonce), expiresAt);
  return { nonce, expiresAt };
}

export async function verifyBaseAccountSiwe(input: {
  claimedAddress: string;
  message: string;
  signature: string;
  now?: Date;
}) {
  if (input.message.length > 8_192 || !/^0x[0-9a-fA-F]+$/.test(input.signature)) {
    throw new BaseAccountAuthError("Malformed authentication payload.", 400);
  }

  let claimedAddress: Address;
  try {
    claimedAddress = getAddress(input.claimedAddress);
  } catch {
    throw new BaseAccountAuthError("Invalid account address.", 400);
  }

  const parsed = parseSiweMessage(input.message);
  const expectedOrigin = new URL(getBaseAccountAuthOrigin());
  const now = input.now ?? new Date();
  if (
    !parsed.address ||
    getAddress(parsed.address) !== claimedAddress ||
    parsed.domain !== expectedOrigin.host ||
    !parsed.uri ||
    new URL(parsed.uri).origin !== expectedOrigin.origin ||
    parsed.version !== "1" ||
    parsed.chainId !== baseSepolia.id ||
    !parsed.nonce ||
    !parsed.issuedAt ||
    parsed.issuedAt.getTime() > now.getTime() + MAX_CLOCK_SKEW_MS ||
    parsed.issuedAt.getTime() < now.getTime() - NONCE_TTL_MS - MAX_CLOCK_SKEW_MS ||
    (parsed.expirationTime && parsed.expirationTime <= now)
  ) {
    throw new BaseAccountAuthError("The sign-in request does not match this RateLoop deployment.", 401);
  }

  const valid = await getSignatureVerifier()({
    address: claimedAddress,
    message: input.message,
    signature: input.signature as Hex,
  });
  if (!valid) throw new BaseAccountAuthError("Invalid Base Account signature.", 401);

  const consumed = await getAuthStore().consumeNonce(digest(parsed.nonce), now);
  if (!consumed) throw new BaseAccountAuthError("The sign-in request expired or was already used.", 401);

  return claimedAddress;
}

export async function createBaseAccountSession(address: Address, now = new Date()) {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(now.getTime() + SESSION_TTL_MS);
  await getAuthStore().createSession(digest(token), getAddress(address), expiresAt, now);
  return { token, expiresAt };
}

export async function findBaseAccountSession(token: string | undefined, now = new Date()) {
  if (!token || token.length > 256) return null;
  return getAuthStore().findSession(digest(token), now);
}

export async function revokeBaseAccountSession(token: string | undefined, now = new Date()) {
  if (!token || token.length > 256) return;
  await getAuthStore().revokeSession(digest(token), now);
}

export function assertBaseAccountRequestOrigin(origin: string | null) {
  if (!origin || new URL(origin).origin !== getBaseAccountAuthOrigin()) {
    throw new BaseAccountAuthError("Cross-origin authentication request denied.", 403);
  }
}

export class BaseAccountAuthError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "BaseAccountAuthError";
  }
}

export function __setBaseAccountAuthOverridesForTests(input: {
  store?: BaseAccountAuthStore | null;
  verifySignature?: ((input: { address: Address; message: string; signature: Hex }) => Promise<boolean>) | null;
}) {
  authStoreOverride = input.store ?? null;
  signatureVerifierOverride = input.verifySignature ?? null;
}
