import {
  type AuthStore,
  type BrowserIdentity,
  __setAuthStoreForTests,
  consumeAuthNonce,
  createAuthNonce,
  createAuthSession,
  findAuthSession,
  revokeAuthSession,
} from "./session";
import assert from "node:assert/strict";
import test, { afterEach, beforeEach } from "node:test";

const now = new Date("2026-07-13T12:00:00.000Z");

function identity(): BrowserIdentity {
  return {
    principalId: "rlp_123456789012345678901234",
    authProvider: "better_auth:google",
    displayName: "Enterprise Buyer",
  };
}

function createMemoryStore(): AuthStore {
  const nonces = new Map<string, { consumed: boolean; expiresAt: Date }>();
  const sessions = new Map<string, { identity: BrowserIdentity; expiresAt: Date; revoked: boolean }>();
  return {
    async createNonce(nonceHash, expiresAt) {
      nonces.set(nonceHash, { consumed: false, expiresAt });
    },
    async consumeNonce(nonceHash, consumedAt) {
      const nonce = nonces.get(nonceHash);
      if (!nonce || nonce.consumed || nonce.expiresAt <= consumedAt) return false;
      nonce.consumed = true;
      return true;
    },
    async createSession(sessionHash, browserIdentity, expiresAt) {
      sessions.set(sessionHash, { identity: browserIdentity, expiresAt, revoked: false });
    },
    async findSession(sessionHash, checkedAt) {
      const session = sessions.get(sessionHash);
      return !session || session.revoked || session.expiresAt <= checkedAt
        ? null
        : { ...session.identity, expiresAt: session.expiresAt };
    },
    async revokeSession(sessionHash) {
      const session = sessions.get(sessionHash);
      if (session) session.revoked = true;
    },
  };
}

beforeEach(() => __setAuthStoreForTests(createMemoryStore()));
afterEach(() => __setAuthStoreForTests(null));

test("authentication nonces are one-time and expire", async () => {
  const nonce = await createAuthNonce(now);
  assert.equal(await consumeAuthNonce(nonce.nonce, now), true);
  assert.equal(await consumeAuthNonce(nonce.nonce, now), false);

  const expired = await createAuthNonce(now);
  assert.equal(await consumeAuthNonce(expired.nonce, new Date(expired.expiresAt.getTime() + 1)), false);
  assert.equal(await consumeAuthNonce("not-a-valid-nonce", now), false);
});

test("RateLoop sessions are hash-only, expiring, revocable, and bound to an opaque principal", async () => {
  const created = await createAuthSession(identity(), now);
  assert.equal(created.token.length > 32, true);
  assert.deepEqual(await findAuthSession(created.token, now), { ...identity(), expiresAt: created.expiresAt });
  assert.equal(await findAuthSession(created.token, new Date(created.expiresAt.getTime() + 1)), null);
  await revokeAuthSession(created.token, now);
  assert.equal(await findAuthSession(created.token, now), null);
});
