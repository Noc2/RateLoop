import { zeroAddress } from "viem";
import { describe, expect, it } from "vitest";
import {
  buildTokenlessDeploymentKey,
  resolveTokenlessDeployment,
  tokenlessDeploymentHealth,
} from "../src/protocol-deployment";

const panel = "0x1000000000000000000000000000000000000001";
const issuer = "0x1000000000000000000000000000000000000002";
const feedbackBonus = "0x1000000000000000000000000000000000000003";
const beaconVerifier = "0x1000000000000000000000000000000000000004";
const deploymentKey = `tokenless-v4:84532:${panel}:${issuer}:${zeroAddress}:${feedbackBonus}`;
const hostedRuntime = {
  NODE_ENV: "production",
  TOKENLESS_HOME_REGION: "eu",
  RAILWAY_REPLICA_REGION: "europe-west4-drams3a",
  RAILWAY_PROJECT_ID: "prj-tokenless-eu",
  TOKENLESS_RAILWAY_PROJECT_ID: "prj-tokenless-eu",
  RAILWAY_SERVICE_ID: "svc-tokenless-ponder-eu",
  TOKENLESS_PONDER_SERVICE_ID: "svc-tokenless-ponder-eu",
};

function baseSepoliaEnv() {
  return {
    ...hostedRuntime,
    PONDER_NETWORK: "baseSepolia",
    PONDER_CHAIN_ID: "84532",
    PONDER_TOKENLESS_PANEL_ADDRESS: panel,
    PONDER_CREDENTIAL_ISSUER_ADDRESS: issuer,
    PONDER_FEEDBACK_BONUS_ADDRESS: feedbackBonus,
    PONDER_BEACON_VERIFIER_ADDRESS: beaconVerifier,
    PONDER_TOKENLESS_START_BLOCK: "44051709",
    RATELOOP_PONDER_PROTOCOL_DEPLOYMENT_KEY: deploymentKey,
  };
}

describe("tokenless deployment identity", () => {
  it("builds the stable versioned identity including the required feedback bonus", () => {
    expect(
      buildTokenlessDeploymentKey({
        chainId: 84_532,
        panelAddress: panel,
        issuerAddress: issuer,
        feedbackBonusAddress: feedbackBonus,
      }),
    ).toBe(deploymentKey);
  });

  it("resolves Base Sepolia and fails closed on a mixed identity", () => {
    const env = baseSepoliaEnv();
    expect(resolveTokenlessDeployment(env)).toMatchObject({
      chainId: 84_532,
      panelAddress: panel,
      issuerAddress: issuer,
      adapterAddress: zeroAddress,
      feedbackBonusAddress: feedbackBonus,
      beaconVerifierAddress: beaconVerifier,
      startBlock: 44_051_709,
    });
    expect(() =>
      resolveTokenlessDeployment({
        ...env,
        RATELOOP_PONDER_PROTOCOL_DEPLOYMENT_KEY: `tokenless-v3:84532:${panel}:${issuer}:${zeroAddress}`,
      }),
    ).toThrow("does not match the tokenless deployment identity");
    expect(() =>
      resolveTokenlessDeployment({
        ...env,
        RATELOOP_PONDER_PROTOCOL_DEPLOYMENT_KEY: undefined,
      }),
    ).toThrow("is required for Base Sepolia");
    expect(() =>
      resolveTokenlessDeployment({
        ...env,
        PONDER_FEEDBACK_BONUS_ADDRESS: zeroAddress,
      }),
    ).toThrow("PONDER_FEEDBACK_BONUS_ADDRESS must be a non-zero EVM address");
  });

  it("rejects legacy networks and zero core addresses", () => {
    expect(() =>
      resolveTokenlessDeployment({
        PONDER_NETWORK: "base",
        PONDER_TOKENLESS_PANEL_ADDRESS: panel,
        PONDER_CREDENTIAL_ISSUER_ADDRESS: issuer,
      }),
    ).toThrow("hardhat or baseSepolia");
    expect(() =>
      resolveTokenlessDeployment({
        PONDER_NETWORK: "hardhat",
        PONDER_TOKENLESS_PANEL_ADDRESS: zeroAddress,
        PONDER_CREDENTIAL_ISSUER_ADDRESS: issuer,
        PONDER_FEEDBACK_BONUS_ADDRESS: feedbackBonus,
        PONDER_BEACON_VERIFIER_ADDRESS: beaconVerifier,
      }),
    ).toThrow("non-zero EVM address");
  });

  it("exposes the complete deployment identity used by the Railway health gate", () => {
    const deployment = resolveTokenlessDeployment(baseSepoliaEnv());
    expect(tokenlessDeploymentHealth(deployment)).toEqual({
      status: "ok",
      protocol: "tokenless-v4",
      chainId: 84_532,
      deploymentKey,
      feedbackBonusAddress: feedbackBonus,
      beaconVerifierAddress: beaconVerifier,
      startBlock: 44_051_709,
    });
  });

  it("requires the exact EU Railway runtime identity", () => {
    const env = baseSepoliaEnv();
    expect(resolveTokenlessDeployment(env).chainId).toBe(84_532);
    expect(() =>
      resolveTokenlessDeployment({
        ...env,
        RAILWAY_REPLICA_REGION: "us-east4-eqdc4a",
      }),
    ).toThrow("RAILWAY_REPLICA_REGION must be europe-west4-drams3a");
    expect(() =>
      resolveTokenlessDeployment({
        ...env,
        RAILWAY_PROJECT_ID: "legacy-project",
      }),
    ).toThrow("RAILWAY_PROJECT_ID must match TOKENLESS_RAILWAY_PROJECT_ID");
  });
});
