import { NextRequest } from "next/server";
import { POST } from "./route";
import assert from "node:assert/strict";
import { afterEach, before, test } from "node:test";
import { __setRateLimitStoreForTests } from "~~/utils/rateLimit";

const env = process.env as Record<string, string | undefined>;
const originalCredentialAction = env.NEXT_PUBLIC_WORLD_ID_CREDENTIAL_ACTION;
const originalPresenceAction = env.NEXT_PUBLIC_WORLD_ID_PRESENCE_ACTION;
const originalAppId = env.NEXT_PUBLIC_WORLD_ID_APP_ID;
const originalEnvironment = env.NEXT_PUBLIC_WORLD_ID_ENVIRONMENT;
const originalProofMode = env.NEXT_PUBLIC_WORLD_ID_PROOF_MODE;
const originalRpId = env.WORLD_ID_RP_ID;
const originalV4RpId = env.WORLD_ID_V4_RP_ID;
const originalSigningKey = env.WORLD_ID_SIGNING_KEY;

const TEST_SIGNING_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";

// H-9 (2026-05-22 audit): the route now applies checkRateLimit, which expects a
// NextRequest plus a working rate-limit store. Build a real NextRequest and stub
// the store with an always-allow in-memory implementation so this test continues
// to exercise the rp-context signing path rather than the rate-limit path.
function makeRequest(body?: unknown) {
  return new NextRequest("https://rateloop.ai/api/world-id/rp-context", {
    method: "POST",
    headers: new Headers({ "x-forwarded-for": "203.0.113.77" }),
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function makeRawRequest(body: string) {
  return new NextRequest("https://rateloop.ai/api/world-id/rp-context", {
    method: "POST",
    headers: new Headers({
      "content-type": "application/json",
      "x-forwarded-for": "203.0.113.77",
    }),
    body,
  });
}

before(() => {
  // Always-allow rate-limit store: the cleanup lease select returns one row so the
  // delete branch runs, and the main rate-limit INSERT returns request_count: 1 so
  // the limit (20/min) is never exceeded.
  __setRateLimitStoreForTests({
    execute: async () => ({ rows: [{ name: "cleanup", request_count: 1 }] }) as never,
  });
});

afterEach(() => {
  if (originalCredentialAction === undefined) delete env.NEXT_PUBLIC_WORLD_ID_CREDENTIAL_ACTION;
  else env.NEXT_PUBLIC_WORLD_ID_CREDENTIAL_ACTION = originalCredentialAction;

  if (originalPresenceAction === undefined) delete env.NEXT_PUBLIC_WORLD_ID_PRESENCE_ACTION;
  else env.NEXT_PUBLIC_WORLD_ID_PRESENCE_ACTION = originalPresenceAction;

  if (originalAppId === undefined) delete env.NEXT_PUBLIC_WORLD_ID_APP_ID;
  else env.NEXT_PUBLIC_WORLD_ID_APP_ID = originalAppId;

  if (originalEnvironment === undefined) delete env.NEXT_PUBLIC_WORLD_ID_ENVIRONMENT;
  else env.NEXT_PUBLIC_WORLD_ID_ENVIRONMENT = originalEnvironment;

  if (originalProofMode === undefined) delete env.NEXT_PUBLIC_WORLD_ID_PROOF_MODE;
  else env.NEXT_PUBLIC_WORLD_ID_PROOF_MODE = originalProofMode;

  if (originalRpId === undefined) delete env.WORLD_ID_RP_ID;
  else env.WORLD_ID_RP_ID = originalRpId;

  if (originalV4RpId === undefined) delete env.WORLD_ID_V4_RP_ID;
  else env.WORLD_ID_V4_RP_ID = originalV4RpId;

  if (originalSigningKey === undefined) delete env.WORLD_ID_SIGNING_KEY;
  else env.WORLD_ID_SIGNING_KEY = originalSigningKey;
});

test("World ID RP context route signs a short-lived legacy credential request", async () => {
  env.NEXT_PUBLIC_WORLD_ID_CREDENTIAL_ACTION = "rateloop-test";
  env.NEXT_PUBLIC_WORLD_ID_PRESENCE_ACTION = "rateloop-presence";
  env.NEXT_PUBLIC_WORLD_ID_APP_ID = "app_test";
  env.NEXT_PUBLIC_WORLD_ID_ENVIRONMENT = "staging";
  env.WORLD_ID_RP_ID = "rp_test";
  env.WORLD_ID_V4_RP_ID = "1";
  env.WORLD_ID_SIGNING_KEY = TEST_SIGNING_KEY;

  const response = await POST(makeRequest());
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.action, "rateloop-test");
  assert.equal(typeof body.diagnosticId, "string");
  assert.ok(body.diagnosticId.length > 0);
  assert.equal(body.environment, "staging");
  assert.equal(body.proofMode, "legacy");
  assert.equal(body.purpose, "credential");
  assert.equal(body.rpContext.rp_id, "rp_test");
  assert.match(body.rpContext.nonce, /^0x[0-9a-f]+$/);
  assert.match(body.rpContext.signature, /^0x[0-9a-f]+$/);
  assert.equal(body.rpContext.expires_at - body.rpContext.created_at, 300);
});

test("World ID RP context route signs presence requests with the presence action", async () => {
  env.NEXT_PUBLIC_WORLD_ID_CREDENTIAL_ACTION = "rateloop-test";
  env.NEXT_PUBLIC_WORLD_ID_PRESENCE_ACTION = "rateloop-presence";
  env.NEXT_PUBLIC_WORLD_ID_APP_ID = "app_test";
  env.NEXT_PUBLIC_WORLD_ID_PROOF_MODE = "v4";
  env.WORLD_ID_RP_ID = "rp_test";
  env.WORLD_ID_SIGNING_KEY = TEST_SIGNING_KEY;

  const response = await POST(makeRequest({ purpose: "presence" }));
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.action, "rateloop-presence");
  assert.equal(body.proofMode, "v4");
  assert.equal(body.purpose, "presence");
});

test("World ID RP context route rejects presence requests in legacy proof mode", async () => {
  env.NEXT_PUBLIC_WORLD_ID_CREDENTIAL_ACTION = "rateloop-test";
  env.NEXT_PUBLIC_WORLD_ID_PRESENCE_ACTION = "rateloop-presence";
  env.NEXT_PUBLIC_WORLD_ID_APP_ID = "app_test";
  env.WORLD_ID_RP_ID = "rp_test";
  env.WORLD_ID_SIGNING_KEY = TEST_SIGNING_KEY;

  const response = await POST(makeRequest({ purpose: "presence" }));
  const body = await response.json();

  assert.equal(response.status, 400);
  assert.match(body.error, /v3 does not support fresh recheck/);
});

test("World ID RP context route fails closed without signing credentials", async () => {
  env.NEXT_PUBLIC_WORLD_ID_APP_ID = "app_test";
  env.WORLD_ID_RP_ID = "rp_test";
  delete env.WORLD_ID_SIGNING_KEY;

  const response = await POST(makeRequest());
  const body = await response.json();

  assert.equal(response.status, 503);
  assert.equal(body.error, "World ID signing key is not configured for this deployment.");
});

test("World ID RP context route fails closed without an IDKit RP ID", async () => {
  env.NEXT_PUBLIC_WORLD_ID_APP_ID = "app_test";
  delete env.WORLD_ID_RP_ID;
  delete env.WORLD_ID_V4_RP_ID;
  env.WORLD_ID_SIGNING_KEY = TEST_SIGNING_KEY;

  const response = await POST(makeRequest());
  const body = await response.json();

  assert.equal(response.status, 503);
  assert.equal(body.error, "World ID relying-party ID is not configured for this deployment.");
});

test("World ID RP context route rejects app IDs in the RP context field", async () => {
  env.NEXT_PUBLIC_WORLD_ID_APP_ID = "app_test";
  env.WORLD_ID_RP_ID = "app_test";
  env.WORLD_ID_SIGNING_KEY = TEST_SIGNING_KEY;

  const response = await POST(makeRequest());
  const body = await response.json();

  assert.equal(response.status, 503);
  assert.equal(body.error, "World ID relying-party ID must use the rp_ value from the World Developer Portal.");
});

test("World ID RP context route rejects oversized JSON bodies", async () => {
  const response = await POST(makeRawRequest(JSON.stringify({ padding: "x".repeat(4096), purpose: "presence" })));
  const body = await response.json();

  assert.equal(response.status, 413);
  assert.equal(body.code, "request_entity_too_large");
});

test("World ID RP context route rejects malformed bodies and unsupported purposes", async () => {
  for (const request of [
    makeRawRequest("not-json"),
    makeRequest([]),
    makeRequest("credential"),
    makeRequest({ purpose: "presense" }),
    makeRequest({ purpose: 1 }),
  ]) {
    const response = await POST(request);
    const body = await response.json();

    assert.equal(response.status, 400);
    assert.equal(body.code, "invalid_request");
    assert.equal(body.message, "Request body must be a JSON object with purpose set to credential or presence.");
  }
});
