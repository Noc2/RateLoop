import { NextRequest } from "next/server";
import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { POST as submitPayment } from "~~/app/api/agent/v1/asks/[operationKey]/payment/route";
import { POST as submitAsk } from "~~/app/api/agent/v1/asks/route";
import { resolveBetterAuthPrincipal } from "~~/lib/auth/principal";
import { AUTH_SESSION_COOKIE, createAuthSession } from "~~/lib/auth/session";
import { __setDatabaseResourcesForTests } from "~~/lib/db";
import { createMemoryDatabaseResources } from "~~/lib/db/testing/testMemory";
import { createWorkspace, createWorkspaceApiKey } from "~~/lib/tokenless/productCore";

const APP_ORIGIN = "https://tokenless.example.test";
const ORIGINAL_APP_URL = process.env.APP_URL;
const OPERATION_KEY = "operation_origin_guard_test";
const paymentContext = { params: Promise.resolve({ operationKey: OPERATION_KEY }) };

beforeEach(() => {
  process.env.APP_URL = APP_ORIGIN;
  __setDatabaseResourcesForTests(createMemoryDatabaseResources());
});

afterEach(() => {
  __setDatabaseResourcesForTests(null);
  if (ORIGINAL_APP_URL === undefined) delete process.env.APP_URL;
  else process.env.APP_URL = ORIGINAL_APP_URL;
});

async function credentials() {
  const identity = await resolveBetterAuthPrincipal({
    betterAuthUserId: "better_product_origin_guard",
    method: "passkey",
  });
  const session = await createAuthSession(identity);
  const { workspaceId } = await createWorkspace({
    name: "Product origin guard",
    ownerAddress: identity.principalId,
  });
  const apiKey = await createWorkspaceApiKey({ name: "Origin-independent agent", workspaceId });
  return { apiKey: apiKey.token, sessionToken: session.token };
}

function sessionRequest(path: string, token: string, origin?: string) {
  return new NextRequest(`${APP_ORIGIN}${path}`, {
    body: "{}",
    headers: {
      "content-type": "application/json",
      cookie: `${AUTH_SESSION_COOKIE}=${token}`,
      ...(origin ? { origin } : {}),
    },
    method: "POST",
  });
}

function apiKeyRequest(path: string, token: string) {
  return new NextRequest(`${APP_ORIGIN}${path}`, {
    body: "{}",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    method: "POST",
  });
}

async function assertInvalidOrigin(response: Response) {
  assert.equal(response.status, 403);
  assert.equal((await response.json()).code, "invalid_origin");
}

test("cookie-authenticated agent mutations require the canonical origin while API keys remain origin-independent", async () => {
  const { apiKey, sessionToken } = await credentials();
  const cases = [
    {
      invoke: (request: NextRequest) => submitAsk(request),
      path: "/api/agent/v1/asks",
    },
    {
      invoke: (request: NextRequest) => submitPayment(request, paymentContext),
      path: `/api/agent/v1/asks/${OPERATION_KEY}/payment`,
    },
  ];

  for (const { invoke, path } of cases) {
    await assertInvalidOrigin(await invoke(sessionRequest(path, sessionToken)));
    await assertInvalidOrigin(await invoke(sessionRequest(path, sessionToken, "https://attacker.example")));

    const sameOrigin = await invoke(sessionRequest(path, sessionToken, APP_ORIGIN));
    assert.notEqual(sameOrigin.status, 403);
    assert.notEqual((await sameOrigin.clone().json()).code, "invalid_origin");

    const machine = await invoke(apiKeyRequest(path, apiKey));
    assert.notEqual(machine.status, 403);
    assert.notEqual((await machine.clone().json()).code, "invalid_origin");
  }
});
