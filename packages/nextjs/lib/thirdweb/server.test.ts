import {
  __setThirdwebAuthOverridesForTests,
  generateThirdwebLoginPayload,
  normalizeThirdwebIdentity,
  resolveThirdwebAuthConfiguration,
  verifyThirdwebLogin,
} from "./server";
import assert from "node:assert/strict";
import test, { afterEach, beforeEach } from "node:test";
import type { LoginPayload, VerifyLoginPayloadParams } from "thirdweb/auth";
import type { Address } from "viem";
import {
  AuthError,
  type AuthStore,
  type BrowserIdentity,
  __setAuthStoreForTests,
  createAuthNonce,
} from "~~/lib/auth/session";

const address = "0x1111111111111111111111111111111111111111" as Address;
const now = new Date("2026-07-13T12:00:00.000Z");

function createMemoryStore(): AuthStore {
  const nonces = new Map<string, { consumed: boolean; expiresAt: Date }>();
  return {
    async createNonce(nonceHash, expiresAt) {
      nonces.set(nonceHash, { consumed: false, expiresAt });
    },
    async consumeNonce(nonceHash) {
      const nonce = nonces.get(nonceHash);
      if (!nonce || nonce.consumed) return false;
      nonce.consumed = true;
      return true;
    },
    async createSession() {},
    async findSession() {
      return null;
    },
    async revokeSession() {},
  };
}

function payload(nonce: string, overrides: Partial<LoginPayload> = {}): LoginPayload {
  return {
    domain: "tokenless.example",
    address,
    statement: "Sign in to RateLoop.",
    uri: "https://tokenless.example",
    version: "1",
    chain_id: "84532",
    nonce,
    issued_at: now.toISOString(),
    expiration_time: new Date(now.getTime() + 300_000).toISOString(),
    invalid_before: now.toISOString(),
    ...overrides,
  };
}

const verifiedIdentity: BrowserIdentity = {
  address,
  authProvider: "google",
  thirdwebUserId: "tw-user-1",
  email: "buyer@example.com",
  emailVerified: true,
  emailDomain: "example.com",
  displayName: "Buyer Example",
};

beforeEach(() => {
  process.env.APP_URL = "https://tokenless.example";
  __setAuthStoreForTests(createMemoryStore());
  __setThirdwebAuthOverridesForTests({
    auth: {
      async generatePayload({ address: requestedAddress }) {
        return payload("a".repeat(32), { address: requestedAddress });
      },
      async verifyPayload(input: VerifyLoginPayloadParams) {
        return input.signature === "0x11" && input.payload.domain === "tokenless.example"
          ? { valid: true as const, payload: input.payload }
          : { valid: false as const, error: "invalid" };
      },
    },
    resolveProfile: async () => verifiedIdentity,
  });
});

afterEach(() => {
  delete process.env.APP_URL;
  delete process.env.NEXT_PUBLIC_THIRDWEB_AUTH_DOMAIN;
  delete process.env.VERCEL_ENV;
  __setAuthStoreForTests(null);
  __setThirdwebAuthOverridesForTests({ auth: null, resolveProfile: null });
});

test("hosted auth requires the configured thirdweb domain to match the RateLoop origin", () => {
  process.env.VERCEL_ENV = "preview";
  assert.throws(resolveThirdwebAuthConfiguration, /AUTH_DOMAIN is required/i);

  process.env.NEXT_PUBLIC_THIRDWEB_AUTH_DOMAIN = "attacker.example";
  assert.throws(resolveThirdwebAuthConfiguration, /does not match/i);

  process.env.NEXT_PUBLIC_THIRDWEB_AUTH_DOMAIN = "tokenless.example";
  assert.deepEqual(resolveThirdwebAuthConfiguration(), {
    domain: "tokenless.example",
    uri: "https://tokenless.example",
  });
});

test("login payload generation is pinned to Base Sepolia", async () => {
  const generated = await generateThirdwebLoginPayload({ address, chainId: 84532 });
  assert.equal(generated.address, address);
  await assert.rejects(
    generateThirdwebLoginPayload({ address, chainId: 8453 }),
    (error: unknown) => error instanceof AuthError && error.status === 400,
  );
});

test("thirdweb login rejects wrong-domain signatures and nonce replay", async () => {
  const challenge = await createAuthNonce();
  const signed = { payload: payload(challenge.nonce), signature: "0x11" };
  assert.deepEqual(await verifyThirdwebLogin(signed), verifiedIdentity);
  await assert.rejects(verifyThirdwebLogin(signed), /already used/i);

  const wrongDomainNonce = await createAuthNonce();
  await assert.rejects(
    verifyThirdwebLogin({
      payload: payload(wrongDomainNonce.nonce, { domain: "attacker.example" }),
      signature: "0x11",
    }),
    /invalid or expired/i,
  );
});

test("thirdweb profile normalization accepts only verified email metadata", () => {
  assert.deepEqual(
    normalizeThirdwebIdentity(address, {
      userId: "tw-user-1",
      profiles: [{ type: "google", email: " Buyer@Example.COM ", emailVerified: true, name: " Buyer Example " }],
    }),
    verifiedIdentity,
  );

  const external = normalizeThirdwebIdentity(address, {
    userId: "tw-user-2",
    profiles: [{ type: "email", email: "unverified@example.com", emailVerified: false }],
  });
  assert.equal(external.email, null);
  assert.equal(external.emailVerified, false);
});
