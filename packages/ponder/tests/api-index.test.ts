import { afterEach, describe, expect, it, vi } from "vitest";
import { schemaFromProtocolDeploymentKey } from "../scripts/databaseSchema.mjs";

const ORIGINAL_ENV = { ...process.env };

const DEFAULT_CORRELATION_FINALITY = {
  status: "ok",
  normalMaxDelaySeconds: 3600,
  includesVetoWindow: true,
  breachCount: 0,
  disputedCount: 0,
  rejectedCount: 0,
  phases: [],
};

async function loadApp(
  env: Record<string, string | undefined>,
  options: {
    correlationFinality?: typeof DEFAULT_CORRELATION_FINALITY;
    humanVerifiedCommitCount?: { status: string; staleRoundCount: number };
  } = {},
) {
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
    inspectHumanVerifiedCommitCountHealth: vi.fn().mockResolvedValue(
      options.humanVerifiedCommitCount ?? { status: "ok", staleRoundCount: 0 },
    ),
  }));
  vi.doMock("../src/api/correlation-finality-sla.js", () => ({
    buildCorrelationFinalitySla: vi.fn().mockResolvedValue(
      options.correlationFinality ?? DEFAULT_CORRELATION_FINALITY,
    ),
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

  it("does not partially parse malformed replica counts", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { default: app } = await loadApp({
      NODE_ENV: "production",
      CORS_ORIGIN: "https://app.rateloop.ai",
      RATE_LIMIT_TRUSTED_IP_HEADERS: "x-forwarded-for",
      PONDER_REPLICA_COUNT: "2abc",
    });

    const response = await app.request("https://ponder.rateloop.ai/content");

    expect(response.status).toBe(404);
    expect(warnSpy).not.toHaveBeenCalledWith(
      expect.stringContaining("in-memory rate limiter is running with 2 replicas"),
    );
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

  it("reports indexer health ok when all nested checks are ok", async () => {
    const { default: app } = await loadApp({});

    const response = await app.request("https://ponder.rateloop.ai/health/indexer");

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      status: "ok",
      checks: {
        correlationFinality: { status: "ok" },
        humanVerifiedCommitCount: { status: "ok" },
      },
    });
  });

  it("surfaces correlation finality attention at the top-level indexer health status", async () => {
    const { default: app } = await loadApp(
      {},
      {
        correlationFinality: {
          ...DEFAULT_CORRELATION_FINALITY,
          status: "attention",
          disputedCount: 1,
        },
      },
    );

    const response = await app.request("https://ponder.rateloop.ai/health/indexer");

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      status: "attention",
      checks: {
        correlationFinality: { status: "attention", disputedCount: 1 },
      },
    });
  });

  it("reports degraded indexer health for normal-path finality breaches", async () => {
    const { default: app } = await loadApp(
      {},
      {
        correlationFinality: {
          ...DEFAULT_CORRELATION_FINALITY,
          status: "degraded",
          breachCount: 1,
        },
      },
    );

    const response = await app.request("https://ponder.rateloop.ai/health/indexer");

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      status: "degraded",
      checks: {
        correlationFinality: { status: "degraded", breachCount: 1 },
      },
    });
  });

  it("keeps human-verified warnings degraded even when finality is only attention", async () => {
    const { default: app } = await loadApp(
      {},
      {
        correlationFinality: {
          ...DEFAULT_CORRELATION_FINALITY,
          status: "attention",
          disputedCount: 1,
        },
        humanVerifiedCommitCount: { status: "warning", staleRoundCount: 2 },
      },
    );

    const response = await app.request("https://ponder.rateloop.ai/health/indexer");

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      status: "degraded",
      checks: {
        correlationFinality: { status: "attention" },
        humanVerifiedCommitCount: { status: "warning", staleRoundCount: 2 },
      },
    });
  });
});
