import "server-only";
import { createThirdwebClient } from "thirdweb";
import { type LoginPayload, type VerifyLoginPayloadParams, createAuth } from "thirdweb/auth";
import { baseSepolia } from "thirdweb/chains";
import { type Address, getAddress } from "viem";
import {
  AuthError,
  type AuthProvider,
  type BrowserIdentity,
  consumeAuthNonce,
  createAuthNonce,
  getAuthOrigin,
} from "~~/lib/auth/session";

const AUTH_STATEMENT = "Sign in to RateLoop.";
const AUTH_TTL_SECONDS = 5 * 60;
const MAX_AUTH_BODY_BYTES = 16_384;
const PROFILE_TIMEOUT_MS = 5_000;
const PROFILE_TYPES = new Set<AuthProvider>(["apple", "email", "google", "passkey"]);

type ThirdwebAuthAdapter = {
  generatePayload(input: { address: string; chainId?: number }): Promise<LoginPayload>;
  verifyPayload(
    input: VerifyLoginPayloadParams,
  ): Promise<{ valid: true; payload: LoginPayload } | { valid: false; error: string }>;
};

type ThirdwebProfile = {
  type?: unknown;
  email?: unknown;
  emailVerified?: unknown;
  name?: unknown;
  givenName?: unknown;
  familyName?: unknown;
};

type ThirdwebWalletRecord = {
  address?: unknown;
  userId?: unknown;
  profiles?: unknown;
};

let authAdapterOverride: ThirdwebAuthAdapter | null = null;
let profileResolverOverride: ((address: Address) => Promise<BrowserIdentity>) | null = null;
let thirdwebAuth: ThirdwebAuthAdapter | null = null;

function requiredSecret() {
  const value = process.env.THIRDWEB_SECRET_KEY?.trim();
  if (!value) throw new AuthError("THIRDWEB_SECRET_KEY is required for browser authentication.", 503);
  return value;
}

function normalizedAuthDomain(value: string | undefined) {
  if (!value?.trim()) return null;
  try {
    return new URL(value.includes("://") ? value : `https://${value}`).host.toLowerCase();
  } catch {
    return null;
  }
}

export function resolveThirdwebAuthConfiguration() {
  const origin = new URL(getAuthOrigin());
  const configuredDomain = normalizedAuthDomain(process.env.NEXT_PUBLIC_THIRDWEB_AUTH_DOMAIN);
  const hosted =
    process.env.VERCEL === "1" || process.env.VERCEL_ENV === "production" || process.env.VERCEL_ENV === "preview";
  if (hosted && !configuredDomain) {
    throw new AuthError("NEXT_PUBLIC_THIRDWEB_AUTH_DOMAIN is required for hosted browser authentication.", 503);
  }
  if (process.env.NEXT_PUBLIC_THIRDWEB_AUTH_DOMAIN?.trim() && !configuredDomain) {
    throw new AuthError("NEXT_PUBLIC_THIRDWEB_AUTH_DOMAIN must be a valid host.", 503);
  }
  if (configuredDomain && configuredDomain !== origin.host.toLowerCase()) {
    throw new AuthError("The thirdweb auth domain does not match this RateLoop deployment.", 503);
  }
  if (origin.hostname === "rateloop.ai" || origin.hostname === "www.rateloop.ai") {
    throw new AuthError("Tokenless browser authentication cannot target the legacy RateLoop deployment.", 503);
  }
  return { domain: configuredDomain ?? origin.host.toLowerCase(), uri: origin.origin };
}

function getThirdwebAuth(): ThirdwebAuthAdapter {
  if (authAdapterOverride) return authAdapterOverride;
  if (thirdwebAuth) return thirdwebAuth;
  const configuration = resolveThirdwebAuthConfiguration();
  const client = createThirdwebClient({ secretKey: requiredSecret() });
  thirdwebAuth = createAuth({
    client,
    domain: configuration.domain,
    login: {
      statement: AUTH_STATEMENT,
      uri: configuration.uri,
      payloadExpirationTimeSeconds: AUTH_TTL_SECONDS,
      nonce: {
        generate: async () => (await createAuthNonce()).nonce,
        validate: nonce => /^[a-f0-9]{32}$/.test(nonce),
      },
    },
  });
  return thirdwebAuth;
}

function safeText(value: unknown, maxLength: number) {
  if (typeof value !== "string") return null;
  const normalized = value.trim().replace(/\s+/g, " ");
  return normalized && normalized.length <= maxLength ? normalized : null;
}

function normalizedEmail(profile: ThirdwebProfile | undefined) {
  if (profile?.emailVerified !== true) return null;
  const email = safeText(profile.email, 320)?.toLowerCase() ?? null;
  if (!email || !/^[^\s@]+@[^\s@]+$/.test(email)) return null;
  return email;
}

function displayName(profile: ThirdwebProfile | undefined) {
  const explicit = safeText(profile?.name, 160);
  if (explicit) return explicit;
  return safeText([profile?.givenName, profile?.familyName].filter(value => typeof value === "string").join(" "), 160);
}

export function normalizeThirdwebIdentity(address: Address, wallet: ThirdwebWalletRecord | null): BrowserIdentity {
  const profiles = Array.isArray(wallet?.profiles) ? (wallet.profiles as ThirdwebProfile[]) : [];
  const selected = profiles.find(profile => PROFILE_TYPES.has(String(profile.type) as AuthProvider));
  const selectedType =
    selected && PROFILE_TYPES.has(String(selected.type) as AuthProvider)
      ? (String(selected.type) as AuthProvider)
      : null;
  const email = normalizedEmail(selected) ?? profiles.map(normalizedEmail).find(Boolean) ?? null;
  return {
    address: getAddress(address),
    authProvider: selectedType ?? (wallet ? "thirdweb" : "external_wallet"),
    thirdwebUserId: safeText(wallet?.userId, 200),
    email,
    emailVerified: Boolean(email),
    emailDomain: email?.slice(email.lastIndexOf("@") + 1) ?? null,
    displayName: displayName(selected),
  };
}

function walletsFromResponse(body: unknown): ThirdwebWalletRecord[] {
  if (!body || typeof body !== "object") return [];
  const result = (body as { result?: unknown }).result;
  if (!result || typeof result !== "object") return [];
  const wallets = (result as { wallets?: unknown }).wallets;
  return Array.isArray(wallets) ? (wallets as ThirdwebWalletRecord[]) : [];
}

async function fetchWalletRecords(parameter: "address" | "externalWalletAddress", address: Address) {
  const url = new URL("https://api.thirdweb.com/v1/wallets/user");
  url.searchParams.set(parameter, address);
  url.searchParams.set("limit", "2");
  const response = await fetch(url, {
    headers: { "x-secret-key": requiredSecret() },
    cache: "no-store",
    signal: AbortSignal.timeout(PROFILE_TIMEOUT_MS),
  });
  if (!response.ok) throw new AuthError("Unable to resolve the verified thirdweb identity profile.", 503);
  return walletsFromResponse(await response.json());
}

async function resolveThirdwebIdentity(address: Address) {
  if (profileResolverOverride) return profileResolverOverride(address);
  const generated = await fetchWalletRecords("address", address);
  if (generated[0]) return normalizeThirdwebIdentity(address, generated[0]);
  const external = await fetchWalletRecords("externalWalletAddress", address);
  return normalizeThirdwebIdentity(address, external[0] ?? null);
}

export async function generateThirdwebLoginPayload(input: { address: string; chainId?: number }) {
  let address: Address;
  try {
    address = getAddress(input.address);
  } catch {
    throw new AuthError("A valid wallet address is required.", 400);
  }
  if (input.chainId !== undefined && input.chainId !== baseSepolia.id) {
    throw new AuthError("RateLoop authentication is restricted to Base Sepolia on this deployment.", 400);
  }
  return getThirdwebAuth().generatePayload({ address, chainId: baseSepolia.id });
}

export async function verifyThirdwebLogin(input: VerifyLoginPayloadParams) {
  if (JSON.stringify(input).length > MAX_AUTH_BODY_BYTES) throw new AuthError("Malformed authentication payload.", 400);
  if (!input.payload || input.payload.chain_id !== String(baseSepolia.id)) {
    throw new AuthError("The sign-in request does not match this RateLoop deployment.", 401);
  }
  const verified = await getThirdwebAuth().verifyPayload(input);
  if (!verified.valid) throw new AuthError("Invalid or expired RateLoop sign-in request.", 401);
  const consumed = await consumeAuthNonce(verified.payload.nonce);
  if (!consumed) throw new AuthError("The sign-in request expired or was already used.", 401);
  return resolveThirdwebIdentity(getAddress(verified.payload.address));
}

export function __setThirdwebAuthOverridesForTests(input: {
  auth?: ThirdwebAuthAdapter | null;
  resolveProfile?: ((address: Address) => Promise<BrowserIdentity>) | null;
}) {
  authAdapterOverride = input.auth ?? null;
  profileResolverOverride = input.resolveProfile ?? null;
  thirdwebAuth = null;
}
