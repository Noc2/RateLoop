import { resolveAgentAppBaseUrl } from "./appBaseUrl";
import assert from "node:assert/strict";
import test, { afterEach } from "node:test";

const env = process.env as Record<string, string | undefined>;
const originalAppEnv = env.APP_ENV;
const originalAppUrl = env.APP_URL;
const originalLocalE2E = env.RATELOOP_E2E_PRODUCTION_BUILD;
const originalNextPublicAppUrl = env.NEXT_PUBLIC_APP_URL;
const originalNextPublicLocalE2E = env.NEXT_PUBLIC_RATELOOP_E2E_PRODUCTION_BUILD;
const originalNodeEnv = env.NODE_ENV;
const originalVercelEnv = env.VERCEL_ENV;
const originalVercelProjectProductionUrl = env.VERCEL_PROJECT_PRODUCTION_URL;
const originalVercelUrl = env.VERCEL_URL;

function restoreEnv(name: keyof NodeJS.ProcessEnv, value: string | undefined) {
  if (value === undefined) {
    delete env[name];
  } else {
    env[name] = value;
  }
}

function resetAgentUrlEnv() {
  delete env.APP_ENV;
  delete env.APP_URL;
  delete env.RATELOOP_E2E_PRODUCTION_BUILD;
  delete env.NEXT_PUBLIC_APP_URL;
  delete env.NEXT_PUBLIC_RATELOOP_E2E_PRODUCTION_BUILD;
  delete env.VERCEL_ENV;
  delete env.VERCEL_PROJECT_PRODUCTION_URL;
  delete env.VERCEL_URL;
}

afterEach(() => {
  restoreEnv("APP_ENV", originalAppEnv);
  restoreEnv("APP_URL", originalAppUrl);
  restoreEnv("RATELOOP_E2E_PRODUCTION_BUILD", originalLocalE2E);
  restoreEnv("NEXT_PUBLIC_APP_URL", originalNextPublicAppUrl);
  restoreEnv("NEXT_PUBLIC_RATELOOP_E2E_PRODUCTION_BUILD", originalNextPublicLocalE2E);
  restoreEnv("NODE_ENV", originalNodeEnv);
  restoreEnv("VERCEL_ENV", originalVercelEnv);
  restoreEnv("VERCEL_PROJECT_PRODUCTION_URL", originalVercelProjectProductionUrl);
  restoreEnv("VERCEL_URL", originalVercelUrl);
});

test("resolveAgentAppBaseUrl uses canonical app URLs in production", () => {
  resetAgentUrlEnv();
  env.NODE_ENV = "production";
  env.APP_URL = "https://www.rateloop.ai/app";

  assert.equal(
    resolveAgentAppBaseUrl("https://evil.example/api/agent/handoffs", "/api/agent/handoffs"),
    "https://www.rateloop.ai/app",
  );
});

test("resolveAgentAppBaseUrl rejects unsafe configured production app URLs", () => {
  resetAgentUrlEnv();
  env.NODE_ENV = "production";
  env.APP_URL = "http://www.rateloop.ai";

  assert.equal(resolveAgentAppBaseUrl("https://evil.example/api/agent/handoffs", "/api/agent/handoffs"), null);

  env.APP_URL = "https://www.rateloop.ai@evil.example";
  assert.equal(resolveAgentAppBaseUrl("https://evil.example/api/agent/handoffs", "/api/agent/handoffs"), null);
});

test("resolveAgentAppBaseUrl fails closed when production only has Vercel preview URL", () => {
  resetAgentUrlEnv();
  env.NODE_ENV = "production";
  env.VERCEL_ENV = "production";
  env.VERCEL_URL = "rateloop-preview.vercel.app";

  assert.equal(resolveAgentAppBaseUrl("https://evil.example/api/agent/handoffs", "/api/agent/handoffs"), null);
});

test("resolveAgentAppBaseUrl uses Vercel production URL in production", () => {
  resetAgentUrlEnv();
  env.NODE_ENV = "production";
  env.VERCEL_ENV = "production";
  env.VERCEL_PROJECT_PRODUCTION_URL = "www.rateloop.ai";
  env.VERCEL_URL = "rateloop-preview.vercel.app";

  assert.equal(
    resolveAgentAppBaseUrl("https://evil.example/api/agent/handoffs", "/api/agent/handoffs"),
    "https://www.rateloop.ai",
  );
});

test("resolveAgentAppBaseUrl preserves preview request bases", () => {
  resetAgentUrlEnv();
  env.NODE_ENV = "production";
  env.VERCEL_ENV = "preview";

  assert.equal(
    resolveAgentAppBaseUrl("https://preview.example/rateloop/api/agent/handoffs", "/api/agent/handoffs"),
    "https://preview.example/rateloop",
  );
});
