import { getWorldIdClientConfig, getWorldIdServerConfig } from "./config";
import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

const env = process.env as Record<string, string | undefined>;
const originalCredentialAction = env.NEXT_PUBLIC_WORLD_ID_CREDENTIAL_ACTION;
const originalPresenceAction = env.NEXT_PUBLIC_WORLD_ID_PRESENCE_ACTION;
const originalAppId = env.NEXT_PUBLIC_WORLD_ID_APP_ID;
const originalE2EMode = env.NEXT_PUBLIC_WORLD_ID_E2E_MODE;
const originalEnvironment = env.NEXT_PUBLIC_WORLD_ID_ENVIRONMENT;
const originalRpId = env.WORLD_ID_RP_ID;
const originalV4RpId = env.WORLD_ID_V4_RP_ID;
const originalSigningKey = env.WORLD_ID_SIGNING_KEY;

afterEach(() => {
  if (originalCredentialAction === undefined) delete env.NEXT_PUBLIC_WORLD_ID_CREDENTIAL_ACTION;
  else env.NEXT_PUBLIC_WORLD_ID_CREDENTIAL_ACTION = originalCredentialAction;

  if (originalPresenceAction === undefined) delete env.NEXT_PUBLIC_WORLD_ID_PRESENCE_ACTION;
  else env.NEXT_PUBLIC_WORLD_ID_PRESENCE_ACTION = originalPresenceAction;

  if (originalAppId === undefined) delete env.NEXT_PUBLIC_WORLD_ID_APP_ID;
  else env.NEXT_PUBLIC_WORLD_ID_APP_ID = originalAppId;

  if (originalE2EMode === undefined) delete env.NEXT_PUBLIC_WORLD_ID_E2E_MODE;
  else env.NEXT_PUBLIC_WORLD_ID_E2E_MODE = originalE2EMode;

  if (originalEnvironment === undefined) delete env.NEXT_PUBLIC_WORLD_ID_ENVIRONMENT;
  else env.NEXT_PUBLIC_WORLD_ID_ENVIRONMENT = originalEnvironment;

  if (originalRpId === undefined) delete env.WORLD_ID_RP_ID;
  else env.WORLD_ID_RP_ID = originalRpId;

  if (originalV4RpId === undefined) delete env.WORLD_ID_V4_RP_ID;
  else env.WORLD_ID_V4_RP_ID = originalV4RpId;

  if (originalSigningKey === undefined) delete env.WORLD_ID_SIGNING_KEY;
  else env.WORLD_ID_SIGNING_KEY = originalSigningKey;
});

test("World ID client config exposes v4 actions and local mock E2E mode", () => {
  env.NEXT_PUBLIC_WORLD_ID_APP_ID = "app_staging_rateloop_local";
  env.NEXT_PUBLIC_WORLD_ID_CREDENTIAL_ACTION = "rateloop-credential-test";
  env.NEXT_PUBLIC_WORLD_ID_PRESENCE_ACTION = "rateloop-presence-test";
  env.NEXT_PUBLIC_WORLD_ID_ENVIRONMENT = "staging";
  env.NEXT_PUBLIC_WORLD_ID_E2E_MODE = "mock";

  assert.deepEqual(getWorldIdClientConfig(), {
    action: "rateloop-credential-test",
    appId: "app_staging_rateloop_local",
    credentialAction: "rateloop-credential-test",
    e2eMode: "mock",
    enabled: true,
    environment: "staging",
    presenceAction: "rateloop-presence-test",
  });
});

test("World ID client config ignores unsupported E2E modes", () => {
  env.NEXT_PUBLIC_WORLD_ID_APP_ID = "app_staging_rateloop_local";
  env.NEXT_PUBLIC_WORLD_ID_E2E_MODE = "simulator";

  assert.equal(getWorldIdClientConfig().e2eMode, null);
});

test("World ID server config selects credential and presence actions", () => {
  env.NEXT_PUBLIC_WORLD_ID_CREDENTIAL_ACTION = "rateloop-credential-test";
  env.NEXT_PUBLIC_WORLD_ID_PRESENCE_ACTION = "rateloop-presence-test";
  env.NEXT_PUBLIC_WORLD_ID_APP_ID = "app_staging_rateloop_local";
  env.WORLD_ID_RP_ID = "rp_test";
  env.WORLD_ID_V4_RP_ID = "1";
  env.WORLD_ID_SIGNING_KEY = "0x1234";

  assert.deepEqual(getWorldIdServerConfig("credential"), {
    action: "rateloop-credential-test",
    appId: "app_staging_rateloop_local",
    credentialAction: "rateloop-credential-test",
    environment: "production",
    presenceAction: "rateloop-presence-test",
    rpId: "rp_test",
    rpIdError: undefined,
    signingKey: "0x1234",
  });
  assert.equal(getWorldIdServerConfig("presence").action, "rateloop-presence-test");
});

test("World ID server config does not fall back to the app ID for RP context", () => {
  env.NEXT_PUBLIC_WORLD_ID_APP_ID = "app_staging_rateloop_local";
  delete env.WORLD_ID_RP_ID;
  delete env.WORLD_ID_V4_RP_ID;
  env.WORLD_ID_SIGNING_KEY = "0x1234";

  const config = getWorldIdServerConfig();

  assert.equal(config.rpId, undefined);
  assert.match(config.rpIdError ?? "", /relying-party ID is not configured/);
});

test("World ID server config fails closed when legacy RP ID is not an IDKit rp_ value", () => {
  env.NEXT_PUBLIC_WORLD_ID_APP_ID = "app_staging_rateloop_local";
  delete env.WORLD_ID_RP_ID;
  env.WORLD_ID_V4_RP_ID = "1";
  env.WORLD_ID_SIGNING_KEY = "0x1234";

  const config = getWorldIdServerConfig();

  assert.equal(config.rpId, undefined);
  assert.match(config.rpIdError ?? "", /must use the rp_ value/);
});
