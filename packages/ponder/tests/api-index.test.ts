import { afterEach, describe, expect, it, vi } from "vitest";
import { schemaFromProtocolDeploymentKey } from "../scripts/databaseSchema.mjs";

const ORIGINAL_ENV = { ...process.env };

async function loadApp(env: Record<string, string | undefined>) {
  vi.resetModules();
  process.env = {
    ...ORIGINAL_ENV,
    ...env,
  };

  vi.doMock("../src/api/routes/content-routes.js", () => ({ registerContentRoutes: vi.fn() }));
  vi.doMock("../src/api/routes/correlation-routes.js", () => ({ registerCorrelationRoutes: vi.fn() }));
  vi.doMock("../src/api/routes/data-routes.js", () => ({ registerDataRoutes: vi.fn() }));
  vi.doMock("../src/api/routes/discovery-routes.js", () => ({ registerDiscoveryRoutes: vi.fn() }));
  vi.doMock("../src/api/routes/keeper-routes.js", () => ({ registerKeeperRoutes: vi.fn() }));
  vi.doMock("../src/api/routes/leaderboard-routes.js", () => ({ registerLeaderboardRoutes: vi.fn() }));
  vi.doMock("../src/api/human-verified-commit-health.js", () => ({
    inspectHumanVerifiedCommitCountHealth: vi.fn().mockResolvedValue({ status: "ok", staleRoundCount: 0 }),
  }));

  return import("../src/api/index.js");
}

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  vi.restoreAllMocks();
  vi.resetModules();
});

describe("ponder api bootstrap", () => {
  it("fails closed in production when trusted rate-limit headers are not configured", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { default: app } = await loadApp({
      NODE_ENV: "production",
      CORS_ORIGIN: "https://app.rateloop.ai",
      RATE_LIMIT_TRUSTED_IP_HEADERS: undefined,
    });

    const response = await app.request("https://ponder.rateloop.ai/content");

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error: "RATE_LIMIT_TRUSTED_IP_HEADERS not configured. Set the env var.",
    });
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("RATE_LIMIT_TRUSTED_IP_HEADERS is required"));
  });

  it("does not block requests when trusted rate-limit headers are configured", async () => {
    const { default: app } = await loadApp({
      NODE_ENV: "production",
      CORS_ORIGIN: "https://app.rateloop.ai",
      RATE_LIMIT_TRUSTED_IP_HEADERS: "x-forwarded-for",
    });

    const response = await app.request("https://ponder.rateloop.ai/content");

    expect(response.status).toBe(404);
  });

  it("keeps deployment probes outside the shared request limiter", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { default: app } = await loadApp({
      NODE_ENV: "production",
      CORS_ORIGIN: "https://app.rateloop.ai",
      RATE_LIMIT_TRUSTED_IP_HEADERS: undefined,
      PONDER_NETWORK: "hardhat",
      PONDER_CONTENT_REGISTRY_ADDRESS: "0x0000000000000000000000000000000000000001",
      PONDER_FEEDBACK_REGISTRY_ADDRESS: "0x0000000000000000000000000000000000000002",
    });

    const response = await app.request("https://ponder.rateloop.ai/deployment");
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      configured: true,
      chainId: 31337,
      deploymentKey:
        "31337:0x0000000000000000000000000000000000000001:0x0000000000000000000000000000000000000002",
      databaseSchema: schemaFromProtocolDeploymentKey(
        "31337:0x0000000000000000000000000000000000000001:0x0000000000000000000000000000000000000002",
      ),
      databaseSchemaSource: "RATELOOP_PONDER_PROTOCOL_DEPLOYMENT_KEY",
    });
  });

  it("keeps deployment probes available when CORS is misconfigured", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { default: app } = await loadApp({
      NODE_ENV: "production",
      CORS_ORIGIN: undefined,
      RATE_LIMIT_TRUSTED_IP_HEADERS: "x-forwarded-for",
      PONDER_NETWORK: "hardhat",
      PONDER_CONTENT_REGISTRY_ADDRESS: "0x0000000000000000000000000000000000000001",
      PONDER_FEEDBACK_REGISTRY_ADDRESS: "0x0000000000000000000000000000000000000002",
    });

    const response = await app.request("https://ponder.rateloop.ai/deployment");

    expect(response.status).toBe(200);
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("CORS_ORIGIN is required"));
  });

  it("limits bearer-token bypass to GET /keeper/work only", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { default: app } = await loadApp({
      NODE_ENV: "production",
      CORS_ORIGIN: "https://app.rateloop.ai",
      RATE_LIMIT_TRUSTED_IP_HEADERS: undefined,
      PONDER_KEEPER_WORK_TOKEN: "keeper-token",
    });

    const keeperResponse = await app.request("https://ponder.rateloop.ai/keeper/work", {
      headers: { authorization: "Bearer keeper-token" },
    });
    const votesResponse = await app.request("https://ponder.rateloop.ai/votes", {
      headers: { authorization: "Bearer keeper-token" },
    });

    expect(keeperResponse.status).toBe(404);
    expect(votesResponse.status).toBe(503);
    expect(await votesResponse.json()).toEqual({
      error: "RATE_LIMIT_TRUSTED_IP_HEADERS not configured. Set the env var.",
    });
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("RATE_LIMIT_TRUSTED_IP_HEADERS is required"));
  });
});
