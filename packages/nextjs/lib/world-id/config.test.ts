import { getWorldIdClientConfig } from "./config";
import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

const env = process.env as Record<string, string | undefined>;
const originalAction = env.NEXT_PUBLIC_WORLD_ID_ACTION;
const originalAppId = env.NEXT_PUBLIC_WORLD_ID_APP_ID;
const originalE2EMode = env.NEXT_PUBLIC_WORLD_ID_E2E_MODE;
const originalEnvironment = env.NEXT_PUBLIC_WORLD_ID_ENVIRONMENT;

afterEach(() => {
  if (originalAction === undefined) delete env.NEXT_PUBLIC_WORLD_ID_ACTION;
  else env.NEXT_PUBLIC_WORLD_ID_ACTION = originalAction;

  if (originalAppId === undefined) delete env.NEXT_PUBLIC_WORLD_ID_APP_ID;
  else env.NEXT_PUBLIC_WORLD_ID_APP_ID = originalAppId;

  if (originalE2EMode === undefined) delete env.NEXT_PUBLIC_WORLD_ID_E2E_MODE;
  else env.NEXT_PUBLIC_WORLD_ID_E2E_MODE = originalE2EMode;

  if (originalEnvironment === undefined) delete env.NEXT_PUBLIC_WORLD_ID_ENVIRONMENT;
  else env.NEXT_PUBLIC_WORLD_ID_ENVIRONMENT = originalEnvironment;
});

test("World ID client config exposes local mock E2E mode explicitly", () => {
  env.NEXT_PUBLIC_WORLD_ID_APP_ID = "app_staging_rateloop_local";
  env.NEXT_PUBLIC_WORLD_ID_ACTION = "rateloop-test";
  env.NEXT_PUBLIC_WORLD_ID_ENVIRONMENT = "staging";
  env.NEXT_PUBLIC_WORLD_ID_E2E_MODE = "mock";

  assert.deepEqual(getWorldIdClientConfig(), {
    action: "rateloop-test",
    appId: "app_staging_rateloop_local",
    e2eMode: "mock",
    enabled: true,
    environment: "staging",
  });
});

test("World ID client config ignores unsupported E2E modes", () => {
  env.NEXT_PUBLIC_WORLD_ID_APP_ID = "app_staging_rateloop_local";
  env.NEXT_PUBLIC_WORLD_ID_E2E_MODE = "simulator";

  assert.equal(getWorldIdClientConfig().e2eMode, null);
});
