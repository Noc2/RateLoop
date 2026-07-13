import { afterEach, describe, expect, it, vi } from "vitest";

const originalEnv = { ...process.env };
const panel = "0x1000000000000000000000000000000000000001";
const issuer = "0x1000000000000000000000000000000000000002";
const deploymentKey = `tokenless-v3:84532:${panel}:${issuer}:0x0000000000000000000000000000000000000000`;

afterEach(() => {
  process.env = { ...originalEnv };
  vi.resetModules();
});

describe("tokenless Ponder config", () => {
  it("registers only the panel and issuer on Base Sepolia", async () => {
    process.env = {
      ...originalEnv,
      NODE_ENV: "production",
      PONDER_NETWORK: "baseSepolia",
      PONDER_RPC_URL_84532: "https://sepolia.base.org",
      PONDER_TOKENLESS_PANEL_ADDRESS: panel,
      PONDER_CREDENTIAL_ISSUER_ADDRESS: issuer,
      PONDER_TOKENLESS_START_BLOCK: "44051709",
      RATELOOP_PONDER_PROTOCOL_DEPLOYMENT_KEY: deploymentKey,
    };
    const { default: config } = await import("./ponder.config");
    expect(Object.keys((config as any).contracts).sort()).toEqual(["CredentialIssuer", "TokenlessPanel"]);
    expect((config as any).contracts.TokenlessPanel.network.baseSepolia.address).toBe(panel);
  });

  it("rejects plaintext live RPCs", async () => {
    process.env = {
      ...originalEnv,
      NODE_ENV: "production",
      PONDER_NETWORK: "baseSepolia",
      PONDER_RPC_URL_84532: "http://rpc.example.test",
      PONDER_TOKENLESS_PANEL_ADDRESS: panel,
      PONDER_CREDENTIAL_ISSUER_ADDRESS: issuer,
      PONDER_TOKENLESS_START_BLOCK: "1",
      RATELOOP_PONDER_PROTOCOL_DEPLOYMENT_KEY: deploymentKey,
    };
    await expect(import("./ponder.config")).rejects.toThrow("must use HTTPS");
  });
});
