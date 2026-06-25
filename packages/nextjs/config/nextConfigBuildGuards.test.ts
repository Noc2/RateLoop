import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { afterEach, test } from "node:test";

type TestableNextConfig = {
  eslint?: { ignoreDuringBuilds?: boolean };
  typescript?: { ignoreBuildErrors?: boolean };
};

const require = createRequire(import.meta.url);
const configPath = require.resolve("../next.config");
const guardedEnvNames = [
  "APP_ENV",
  "APP_URL",
  "NEXT_PUBLIC_APP_URL",
  "NEXT_PUBLIC_IGNORE_BUILD_ERROR",
  "NEXT_PUBLIC_RATELOOP_E2E_PRODUCTION_BUILD",
  "NEXT_PUBLIC_TARGET_NETWORKS",
  "RATELOOP_E2E_PRODUCTION_BUILD",
  "VERCEL_ENV",
  "VERCEL_PROJECT_PRODUCTION_URL",
  "VERCEL_URL",
] as const;
const originalEnv = Object.fromEntries(guardedEnvNames.map(name => [name, process.env[name]])) as Record<
  (typeof guardedEnvNames)[number],
  string | undefined
>;

function requireFreshNextConfig(): TestableNextConfig {
  delete require.cache[configPath];
  return require("../next.config") as TestableNextConfig;
}

afterEach(() => {
  delete require.cache[configPath];
  for (const name of guardedEnvNames) {
    if (originalEnv[name] === undefined) {
      delete process.env[name];
    } else {
      process.env[name] = originalEnv[name];
    }
  }
});

test("next config never ignores TypeScript or ESLint build failures by default", () => {
  delete process.env.NEXT_PUBLIC_IGNORE_BUILD_ERROR;
  const config = requireFreshNextConfig();

  assert.equal(config.typescript?.ignoreBuildErrors, false);
  assert.equal(config.eslint?.ignoreDuringBuilds, false);
});

test("next config rejects the removed public build-error bypass flag", () => {
  process.env.NEXT_PUBLIC_IGNORE_BUILD_ERROR = "true";

  assert.throws(() => requireFreshNextConfig(), /NEXT_PUBLIC_IGNORE_BUILD_ERROR is no longer supported/);
});

test("next config rejects local E2E production flags on production deployments", () => {
  process.env.RATELOOP_E2E_PRODUCTION_BUILD = "true";
  process.env.VERCEL_ENV = "production";

  assert.throws(() => requireFreshNextConfig(), /local-only and must not be set for production deployments/);
});

test("next config rejects local E2E production flags for mainnet targets", () => {
  process.env.NEXT_PUBLIC_RATELOOP_E2E_PRODUCTION_BUILD = "true";
  process.env.NEXT_PUBLIC_TARGET_NETWORKS = "84532,8453";

  assert.throws(() => requireFreshNextConfig(), /must not be used with mainnet target networks/);
});

test("next config rejects local E2E production flags with non-local app URLs", () => {
  process.env.RATELOOP_E2E_PRODUCTION_BUILD = "true";
  process.env.APP_URL = "https://preview.rateloop.ai";

  assert.throws(() => requireFreshNextConfig(), /require localhost app URLs/);
});

test("next config allows local E2E production flags for localhost Base Sepolia runs", () => {
  process.env.RATELOOP_E2E_PRODUCTION_BUILD = "true";
  process.env.NEXT_PUBLIC_RATELOOP_E2E_PRODUCTION_BUILD = "true";
  process.env.APP_URL = "http://localhost:3000";
  process.env.NEXT_PUBLIC_TARGET_NETWORKS = "84532";

  const config = requireFreshNextConfig();

  assert.equal(config.typescript?.ignoreBuildErrors, false);
  assert.equal(config.eslint?.ignoreDuringBuilds, false);
});
