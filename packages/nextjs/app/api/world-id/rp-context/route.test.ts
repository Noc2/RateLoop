import { POST } from "./route";
import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

const env = process.env as Record<string, string | undefined>;
const originalAction = env.NEXT_PUBLIC_WORLD_ID_ACTION;
const originalAppId = env.NEXT_PUBLIC_WORLD_ID_APP_ID;
const originalEnvironment = env.NEXT_PUBLIC_WORLD_ID_ENVIRONMENT;
const originalRpId = env.WORLD_ID_RP_ID;
const originalSigningKey = env.WORLD_ID_SIGNING_KEY;

const TEST_SIGNING_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";

afterEach(() => {
  if (originalAction === undefined) delete env.NEXT_PUBLIC_WORLD_ID_ACTION;
  else env.NEXT_PUBLIC_WORLD_ID_ACTION = originalAction;

  if (originalAppId === undefined) delete env.NEXT_PUBLIC_WORLD_ID_APP_ID;
  else env.NEXT_PUBLIC_WORLD_ID_APP_ID = originalAppId;

  if (originalEnvironment === undefined) delete env.NEXT_PUBLIC_WORLD_ID_ENVIRONMENT;
  else env.NEXT_PUBLIC_WORLD_ID_ENVIRONMENT = originalEnvironment;

  if (originalRpId === undefined) delete env.WORLD_ID_RP_ID;
  else env.WORLD_ID_RP_ID = originalRpId;

  if (originalSigningKey === undefined) delete env.WORLD_ID_SIGNING_KEY;
  else env.WORLD_ID_SIGNING_KEY = originalSigningKey;
});

test("World ID RP context route signs a short-lived v4 request", async () => {
  env.NEXT_PUBLIC_WORLD_ID_ACTION = "rateloop-test";
  env.NEXT_PUBLIC_WORLD_ID_APP_ID = "app_test";
  env.NEXT_PUBLIC_WORLD_ID_ENVIRONMENT = "staging";
  env.WORLD_ID_RP_ID = "rp_test";
  env.WORLD_ID_SIGNING_KEY = TEST_SIGNING_KEY;

  const response = await POST();
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.action, "rateloop-test");
  assert.equal(body.environment, "staging");
  assert.equal(body.rpContext.rp_id, "rp_test");
  assert.match(body.rpContext.nonce, /^0x[0-9a-f]+$/);
  assert.match(body.rpContext.signature, /^0x[0-9a-f]+$/);
  assert.equal(body.rpContext.expires_at - body.rpContext.created_at, 300);
});

test("World ID RP context route fails closed without signing credentials", async () => {
  env.NEXT_PUBLIC_WORLD_ID_APP_ID = "app_test";
  env.WORLD_ID_RP_ID = "rp_test";
  delete env.WORLD_ID_SIGNING_KEY;

  const response = await POST();

  assert.equal(response.status, 503);
});
