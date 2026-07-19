import { NextRequest } from "next/server";
import { requireBrowserSession } from "./request";
import {
  AUTH_SESSION_COOKIE,
  type AuthStore,
  type BrowserIdentity,
  __setAuthStoreForTests,
  createAuthSession,
} from "./session";
import assert from "node:assert/strict";
import test, { afterEach, beforeEach } from "node:test";
import { TokenlessServiceError } from "~~/lib/tokenless/server";

const APP_ORIGIN = "https://tokenless.example.test";

function memoryStore(): AuthStore {
  const sessions = new Map<string, { expiresAt: Date; identity: BrowserIdentity }>();
  return {
    async createNonce() {},
    async consumeNonce() {
      return false;
    },
    async createSession(sessionHash, identity, expiresAt) {
      sessions.set(sessionHash, { expiresAt, identity });
    },
    async findSession(sessionHash, checkedAt) {
      const session = sessions.get(sessionHash);
      return !session || session.expiresAt <= checkedAt ? null : { ...session.identity, expiresAt: session.expiresAt };
    },
    async revokeSession(sessionHash) {
      sessions.delete(sessionHash);
    },
  };
}

beforeEach(() => {
  process.env.APP_URL = APP_ORIGIN;
  __setAuthStoreForTests(memoryStore());
});

afterEach(() => {
  delete process.env.APP_URL;
  __setAuthStoreForTests(null);
});

async function authenticatedRequest(method: string, origin?: string) {
  const session = await createAuthSession({
    principalId: "rlp_request_origin_test_0001",
    authProvider: "better_auth:passkey",
    displayName: "Origin test",
  });
  return new NextRequest(`${APP_ORIGIN}/api/account/private-read`, {
    headers: {
      cookie: `${AUTH_SESSION_COOKIE}=${session.token}`,
      ...(origin ? { origin } : {}),
    },
    method,
  });
}

test("browser session authentication denies cross-origin stateful methods by default", async () => {
  const request = await authenticatedRequest("POST", "https://attacker.example");
  await assert.rejects(
    () => requireBrowserSession(request),
    (error: unknown) => error instanceof TokenlessServiceError && error.code === "invalid_origin",
  );
});

test("safe methods remain origin-independent and same-origin stateful requests succeed", async () => {
  const getSession = await requireBrowserSession(await authenticatedRequest("GET"));
  assert.equal(getSession.principalId, "rlp_request_origin_test_0001");

  const postSession = await requireBrowserSession(await authenticatedRequest("POST", APP_ORIGIN));
  assert.equal(postSession.principalId, "rlp_request_origin_test_0001");
});

test("an explicit non-mutation override is required for a cross-origin stateful read", async () => {
  const session = await requireBrowserSession(await authenticatedRequest("POST", "https://reader.example"), {
    mutation: false,
  });
  assert.equal(session.principalId, "rlp_request_origin_test_0001");
});
