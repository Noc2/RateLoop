import { beforeAll, describe, expect, it } from "vitest";

const PANEL = "0x0000000000000000000000000000000000000011";
const ISSUER = "0x0000000000000000000000000000000000000022";
const ZERO = "0x0000000000000000000000000000000000000000";

let loadConfig: typeof import("../config.js").loadConfig;
let buildTokenlessDeploymentKey: typeof import("../config.js").buildTokenlessDeploymentKey;

beforeAll(async () => {
  process.env.NODE_ENV = "test";
  process.env.CHAIN_ID = "31337";
  process.env.RPC_URL = "http://127.0.0.1:8545";
  process.env.TOKENLESS_PANEL_ADDRESS = PANEL;
  process.env.TOKENLESS_CREDENTIAL_ISSUER_ADDRESS = ISSUER;
  process.env.TOKENLESS_DEPLOYMENT_KEY = `tokenless-v3:31337:${PANEL}:${ISSUER}:${ZERO}`;
  process.env.KEEPER_PRIVATE_KEY = `0x${"11".repeat(32)}`;
  ({ loadConfig, buildTokenlessDeploymentKey } = await import("../config.js"));
});

function productionEnv(): NodeJS.ProcessEnv {
  return {
    NODE_ENV: "production",
    CHAIN_ID: "84532",
    RPC_URL: "https://sepolia.base.org",
    TOKENLESS_PANEL_ADDRESS: PANEL,
    TOKENLESS_CREDENTIAL_ISSUER_ADDRESS: ISSUER,
    TOKENLESS_DEPLOYMENT_KEY: `tokenless-v3:84532:${PANEL}:${ISSUER}:${ZERO}`,
    TOKENLESS_DEPLOYMENT_BLOCK: "123",
    KEEPER_PRIVATE_KEY: `0x${"22".repeat(32)}`,
    METRICS_BIND_ADDRESS: "0.0.0.0",
    METRICS_AUTH_TOKEN: "0123456789abcdef",
  };
}

describe("tokenless keeper config", () => {
  it("builds the versioned isolated deployment identity", () => {
    expect(
      buildTokenlessDeploymentKey({
        chainId: 84532,
        panel: PANEL,
        credentialIssuer: ISSUER,
      })
    ).toBe(`tokenless-v3:84532:${PANEL}:${ISSUER}:${ZERO}`);
  });

  it("accepts a complete Base Sepolia deployment", () => {
    const config = loadConfig(productionEnv());
    expect(config.chainId).toBe(84532);
    expect(config.deployment.blockNumber).toBe(123n);
    expect(config.deployment.panel).toBe(PANEL);
  });

  it("requires a nonzero deployment block in production", () => {
    expect(() =>
      loadConfig({ ...productionEnv(), TOKENLESS_DEPLOYMENT_BLOCK: "0" })
    ).toThrow(/TOKENLESS_DEPLOYMENT_BLOCK must be positive/);
  });

  it("rejects mainnet and mixed deployment keys", () => {
    expect(() => loadConfig({ ...productionEnv(), CHAIN_ID: "8453" })).toThrow(
      /CHAIN_ID must be 31337 or 84532/
    );
    expect(() =>
      loadConfig({
        ...productionEnv(),
        TOKENLESS_DEPLOYMENT_KEY: `tokenless-v2:84532:${PANEL}:${ISSUER}:${ZERO}`,
      })
    ).toThrow(/does not match/);
  });

  it("requires HTTPS and authenticated hosted metrics", () => {
    expect(() =>
      loadConfig({
        ...productionEnv(),
        RPC_URL: "http://sepolia.example",
        METRICS_AUTH_TOKEN: "short",
      })
    ).toThrow(/RPC_URL must use HTTPS/);
  });
});
