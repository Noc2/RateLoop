import {
  BaseAccountAuthError,
  type BaseAccountAuthStore,
  __setBaseAccountAuthOverridesForTests,
  createBaseAccountNonce,
  createBaseAccountSession,
  findBaseAccountSession,
  revokeBaseAccountSession,
  verifyBaseAccountSiwe,
} from "./auth";
import assert from "node:assert/strict";
import test, { afterEach, beforeEach } from "node:test";
import type { Address, Hex } from "viem";

const address = "0x1111111111111111111111111111111111111111" as Address;
const now = new Date("2026-07-12T12:00:00.000Z");

function createMemoryStore() {
  const nonces = new Map<string, { consumed: boolean; expiresAt: Date }>();
  const sessions = new Map<string, { address: Address; expiresAt: Date; revoked: boolean }>();
  const store: BaseAccountAuthStore = {
    async createNonce(nonceHash, expiresAt) {
      nonces.set(nonceHash, { consumed: false, expiresAt });
    },
    async consumeNonce(nonceHash, consumedAt) {
      const nonce = nonces.get(nonceHash);
      if (!nonce || nonce.consumed || nonce.expiresAt <= consumedAt) return false;
      nonce.consumed = true;
      return true;
    },
    async createSession(sessionHash, accountAddress, expiresAt) {
      sessions.set(sessionHash, { address: accountAddress, expiresAt, revoked: false });
    },
    async findSession(sessionHash, checkedAt) {
      const session = sessions.get(sessionHash);
      return !session || session.revoked || session.expiresAt <= checkedAt
        ? null
        : { address: session.address, expiresAt: session.expiresAt };
    },
    async revokeSession(sessionHash) {
      const session = sessions.get(sessionHash);
      if (session) session.revoked = true;
    },
  };
  return store;
}

function siweMessage(nonce: string, domain = "tokenless.example") {
  return `${domain} wants you to sign in with your Ethereum account:
${address}

Sign in to RateLoop.

URI: https://${domain}
Version: 1
Chain ID: 84532
Nonce: ${nonce}
Issued At: ${now.toISOString()}
Expiration Time: ${new Date(now.getTime() + 5 * 60_000).toISOString()}`;
}

beforeEach(() => {
  process.env.APP_URL = "https://tokenless.example";
  __setBaseAccountAuthOverridesForTests({
    store: createMemoryStore(),
    verifySignature: async ({ address: verifiedAddress, signature }) =>
      verifiedAddress === address && signature === ("0x11" as Hex),
  });
});

afterEach(() => {
  delete process.env.APP_URL;
  __setBaseAccountAuthOverridesForTests({ store: null, verifySignature: null });
});

test("SIWE verification binds domain, chain, address, nonce and rejects replay", async () => {
  const { nonce } = await createBaseAccountNonce(now);
  await assert.rejects(
    verifyBaseAccountSiwe({
      claimedAddress: address,
      message: siweMessage(nonce, "attacker.example"),
      signature: "0x11",
      now,
    }),
    (error: unknown) => error instanceof BaseAccountAuthError && error.status === 401,
  );

  assert.equal(
    await verifyBaseAccountSiwe({ claimedAddress: address, message: siweMessage(nonce), signature: "0x11", now }),
    address,
  );
  await assert.rejects(
    verifyBaseAccountSiwe({ claimedAddress: address, message: siweMessage(nonce), signature: "0x11", now }),
    /already used/,
  );
});

test("session tokens are opaque, expiring and revocable", async () => {
  const session = await createBaseAccountSession(address, now);
  assert.equal(session.token.length > 32, true);
  assert.deepEqual(await findBaseAccountSession(session.token, now), { address, expiresAt: session.expiresAt });
  assert.equal(await findBaseAccountSession(session.token, new Date(session.expiresAt.getTime() + 1)), null);
  await revokeBaseAccountSession(session.token, now);
  assert.equal(await findBaseAccountSession(session.token, now), null);
});
