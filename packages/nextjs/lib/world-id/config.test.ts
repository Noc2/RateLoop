import { getWorldIdClientConfig, getWorldIdServerConfig } from "./config";
import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

const env = process.env as Record<string, string | undefined>;
const originalAction = env.NEXT_PUBLIC_WORLD_ID_ACTION;
const originalAppId = env.NEXT_PUBLIC_WORLD_ID_APP_ID;
const originalE2EMode = env.NEXT_PUBLIC_WORLD_ID_E2E_MODE;
const originalEnvironment = env.NEXT_PUBLIC_WORLD_ID_ENVIRONMENT;
const originalProofMode = env.NEXT_PUBLIC_WORLD_ID_PROOF_MODE;
const originalRpId = env.WORLD_ID_RP_ID;
const originalSigningKey = env.WORLD_ID_SIGNING_KEY;

afterEach(() => {
  if (originalAction === undefined) delete env.NEXT_PUBLIC_WORLD_ID_ACTION;
  else env.NEXT_PUBLIC_WORLD_ID_ACTION = originalAction;

  if (originalAppId === undefined) delete env.NEXT_PUBLIC_WORLD_ID_APP_ID;
  else env.NEXT_PUBLIC_WORLD_ID_APP_ID = originalAppId;

  if (originalE2EMode === undefined) delete env.NEXT_PUBLIC_WORLD_ID_E2E_MODE;
  else env.NEXT_PUBLIC_WORLD_ID_E2E_MODE = originalE2EMode;

  if (originalEnvironment === undefined) delete env.NEXT_PUBLIC_WORLD_ID_ENVIRONMENT;
  else env.NEXT_PUBLIC_WORLD_ID_ENVIRONMENT = originalEnvironment;

  if (originalProofMode === undefined) delete env.NEXT_PUBLIC_WORLD_ID_PROOF_MODE;
  else env.NEXT_PUBLIC_WORLD_ID_PROOF_MODE = originalProofMode;

  if (originalRpId === undefined) delete env.WORLD_ID_RP_ID;
  else env.WORLD_ID_RP_ID = originalRpId;

  if (originalSigningKey === undefined) delete env.WORLD_ID_SIGNING_KEY;
  else env.WORLD_ID_SIGNING_KEY = originalSigningKey;
});

test("World ID client config exposes local mock E2E mode explicitly", () => {
  env.NEXT_PUBLIC_WORLD_ID_APP_ID = "app_staging_rateloop_local";
  env.NEXT_PUBLIC_WORLD_ID_ACTION = "rateloop-test";
  env.NEXT_PUBLIC_WORLD_ID_ENVIRONMENT = "staging";
  env.NEXT_PUBLIC_WORLD_ID_E2E_MODE = "mock";
  env.NEXT_PUBLIC_WORLD_ID_PROOF_MODE = "compat";

  assert.deepEqual(getWorldIdClientConfig(), {
    action: "rateloop-test",
    appId: "app_staging_rateloop_local",
    e2eMode: "mock",
    enabled: true,
    environment: "staging",
    proofMode: "compat",
  });
});

test("World ID client config ignores unsupported E2E modes", () => {
  env.NEXT_PUBLIC_WORLD_ID_APP_ID = "app_staging_rateloop_local";
  env.NEXT_PUBLIC_WORLD_ID_E2E_MODE = "simulator";

  assert.equal(getWorldIdClientConfig().e2eMode, null);
});

test("World ID proof mode defaults to legacy and ignores unsupported values", () => {
  env.NEXT_PUBLIC_WORLD_ID_PROOF_MODE = "future";

  assert.equal(getWorldIdClientConfig().proofMode, "legacy");
  assert.equal(getWorldIdServerConfig().proofMode, "legacy");
});

test("World ID server config exposes v4 proof mode", () => {
  env.NEXT_PUBLIC_WORLD_ID_ACTION = "rateloop-test";
  env.NEXT_PUBLIC_WORLD_ID_APP_ID = "app_staging_rateloop_local";
  env.NEXT_PUBLIC_WORLD_ID_PROOF_MODE = "v4";
  env.WORLD_ID_RP_ID = "rp_test";
  env.WORLD_ID_SIGNING_KEY = "0x1234";

  assert.deepEqual(getWorldIdServerConfig(), {
    action: "rateloop-test",
    environment: "production",
    proofMode: "v4",
    rpId: "rp_test",
    signingKey: "0x1234",
  });
});
