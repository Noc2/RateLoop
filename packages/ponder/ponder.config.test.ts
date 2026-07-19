import { afterEach, describe, expect, it, vi } from "vitest";

const originalEnv = { ...process.env };
const panel = "0x1000000000000000000000000000000000000001";
const issuer = "0x1000000000000000000000000000000000000002";
const feedbackBonus = "0x1000000000000000000000000000000000000003";
const beaconVerifier = "0x1000000000000000000000000000000000000004";
const deploymentKey = `tokenless-v4:84532:${panel}:${issuer}:0x0000000000000000000000000000000000000000:${feedbackBonus}`;
const hostedRuntime = {
  NODE_ENV: "production",
  TOKENLESS_HOME_REGION: "eu",
  RAILWAY_REPLICA_REGION: "europe-west4-drams3a",
  RAILWAY_PROJECT_ID: "prj-tokenless-eu",
  TOKENLESS_RAILWAY_PROJECT_ID: "prj-tokenless-eu",
  RAILWAY_SERVICE_ID: "svc-tokenless-ponder-eu",
  TOKENLESS_PONDER_SERVICE_ID: "svc-tokenless-ponder-eu",
};

afterEach(() => {
  process.env = { ...originalEnv };
  vi.resetModules();
});

describe("tokenless Ponder config", () => {
  it("registers the complete v4 bundle on Base Sepolia", async () => {
    process.env = {
      ...originalEnv,
      ...hostedRuntime,
      PONDER_NETWORK: "baseSepolia",
      PONDER_RPC_URL_84532: "https://sepolia.base.org",
      PONDER_RPC_FALLBACK_URLS_84532: "https://base-sepolia-fallback.example",
      PONDER_TOKENLESS_PANEL_ADDRESS: panel,
      PONDER_CREDENTIAL_ISSUER_ADDRESS: issuer,
      PONDER_FEEDBACK_BONUS_ADDRESS: feedbackBonus,
      PONDER_BEACON_VERIFIER_ADDRESS: beaconVerifier,
      PONDER_TOKENLESS_START_BLOCK: "44051709",
      RATELOOP_PONDER_PROTOCOL_DEPLOYMENT_KEY: deploymentKey,
    };
    const { default: config } = await import("./ponder.config");
    expect(Object.keys((config as any).contracts).sort()).toEqual([
      "CredentialIssuer",
      "TokenlessFeedbackBonus",
      "TokenlessPanel",
    ]);
    expect(
      (config as any).contracts.TokenlessPanel.network.baseSepolia.address,
    ).toBe(panel);
  });

  it("rejects plaintext live RPCs", async () => {
    process.env = {
      ...originalEnv,
      ...hostedRuntime,
      PONDER_NETWORK: "baseSepolia",
      PONDER_RPC_URL_84532: "http://rpc.example.test",
      PONDER_RPC_FALLBACK_URLS_84532: "https://base-sepolia-fallback.example",
      PONDER_TOKENLESS_PANEL_ADDRESS: panel,
      PONDER_CREDENTIAL_ISSUER_ADDRESS: issuer,
      PONDER_FEEDBACK_BONUS_ADDRESS: feedbackBonus,
      PONDER_BEACON_VERIFIER_ADDRESS: beaconVerifier,
      PONDER_TOKENLESS_START_BLOCK: "1",
      RATELOOP_PONDER_PROTOCOL_DEPLOYMENT_KEY: deploymentKey,
    };
    await expect(import("./ponder.config")).rejects.toThrow("must use HTTPS");
  });

  it("rejects a missing live RPC fallback", async () => {
    process.env = {
      ...originalEnv,
      ...hostedRuntime,
      PONDER_NETWORK: "baseSepolia",
      PONDER_RPC_URL_84532: "https://sepolia.base.org",
      PONDER_TOKENLESS_PANEL_ADDRESS: panel,
      PONDER_CREDENTIAL_ISSUER_ADDRESS: issuer,
      PONDER_FEEDBACK_BONUS_ADDRESS: feedbackBonus,
      PONDER_BEACON_VERIFIER_ADDRESS: beaconVerifier,
      PONDER_TOKENLESS_START_BLOCK: "1",
      RATELOOP_PONDER_PROTOCOL_DEPLOYMENT_KEY: deploymentKey,
    };
    await expect(import("./ponder.config")).rejects.toThrow(
      /must contain at least one independent HTTPS RPC/i,
    );
  });
});
