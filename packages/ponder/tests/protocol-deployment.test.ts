import { zeroAddress } from "viem";
import { describe, expect, it } from "vitest";
import { buildTokenlessDeploymentKey, resolveTokenlessDeployment } from "../src/protocol-deployment";

const panel = "0x1000000000000000000000000000000000000001";
const issuer = "0x1000000000000000000000000000000000000002";

describe("tokenless deployment identity", () => {
  it("builds the stable versioned identity including an explicit zero adapter", () => {
    expect(buildTokenlessDeploymentKey({ chainId: 84_532, panelAddress: panel, issuerAddress: issuer })).toBe(
      `tokenless-v3:84532:${panel}:${issuer}:${zeroAddress}`,
    );
  });

  it("resolves Base Sepolia and fails closed on a mixed identity", () => {
    const env = {
      NODE_ENV: "production",
      PONDER_NETWORK: "baseSepolia",
      PONDER_CHAIN_ID: "84532",
      PONDER_TOKENLESS_PANEL_ADDRESS: panel,
      PONDER_CREDENTIAL_ISSUER_ADDRESS: issuer,
      PONDER_TOKENLESS_START_BLOCK: "44051709",
      RATELOOP_PONDER_PROTOCOL_DEPLOYMENT_KEY: `tokenless-v3:84532:${panel}:${issuer}:${zeroAddress}`,
    };
    expect(resolveTokenlessDeployment(env)).toMatchObject({
      chainId: 84_532,
      panelAddress: panel,
      issuerAddress: issuer,
      adapterAddress: zeroAddress,
      startBlock: 44_051_709,
    });
    expect(() =>
      resolveTokenlessDeployment({
        ...env,
        RATELOOP_PONDER_PROTOCOL_DEPLOYMENT_KEY: `tokenless-v1:84532:${panel}:${issuer}:${zeroAddress}`,
      }),
    ).toThrow("does not match the tokenless deployment identity");
    expect(() =>
      resolveTokenlessDeployment({
        ...env,
        RATELOOP_PONDER_PROTOCOL_DEPLOYMENT_KEY: undefined,
      }),
    ).toThrow("is required for Base Sepolia");
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
      }),
    ).toThrow("non-zero EVM address");
  });
});
