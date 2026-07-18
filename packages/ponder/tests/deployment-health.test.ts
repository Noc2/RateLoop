import { zeroAddress, type Address } from "viem";
import { describe, expect, it } from "vitest";
import {
  validateTokenlessDeploymentOnChain,
  type TokenlessDeploymentHealthClient,
} from "../src/deployment-health";
import type { TokenlessDeployment } from "../src/protocol-deployment";

const PANEL = "0x1000000000000000000000000000000000000001" as Address;
const ISSUER = "0x1000000000000000000000000000000000000002" as Address;
const BONUS = "0x1000000000000000000000000000000000000003" as Address;
const ADAPTER = "0x1000000000000000000000000000000000000004" as Address;
const USDC = "0x1000000000000000000000000000000000000005" as Address;

function deployment(
  overrides: Partial<TokenlessDeployment> = {},
): TokenlessDeployment {
  return {
    schemaVersion: "tokenless-v4",
    network: "baseSepolia",
    chainId: 84_532,
    panelAddress: PANEL,
    issuerAddress: ISSUER,
    adapterAddress: ADAPTER,
    feedbackBonusAddress: BONUS,
    startBlock: 100,
    deploymentKey: `tokenless-v4:84532:${PANEL}:${ISSUER}:${ADAPTER}:${BONUS}`,
    ...overrides,
  };
}

function client(
  overrides: {
    chainId?: number;
    chainHead?: bigint;
    codeAt?: (address: Address) => `0x${string}` | undefined;
    read?: (address: Address, functionName: string) => unknown;
  } = {},
): TokenlessDeploymentHealthClient {
  return {
    async getChainId() {
      return overrides.chainId ?? 84_532;
    },
    async getBlockNumber() {
      return overrides.chainHead ?? 1_000n;
    },
    async getBytecode({ address }) {
      return overrides.codeAt ? overrides.codeAt(address) : "0x6000";
    },
    async readContract(args) {
      const address = args.address as Address;
      const functionName = String(args.functionName);
      if (overrides.read) return overrides.read(address, functionName);
      if (functionName === "credentialIssuer") return ISSUER;
      if (functionName === "usdc") return USDC;
      if (functionName === "panel") return PANEL;
      if (functionName === "SCORING_VERSION") return 2;
      if (functionName === "BASE_PAY_BPS") return 8_000;
      if (functionName === "MAXIMUM_COMMITS") return 500;
      throw new Error(`unexpected read ${functionName}`);
    },
  };
}

describe("live tokenless deployment health", () => {
  it("proves the complete immutable bundle and deployment block", async () => {
    await expect(
      validateTokenlessDeploymentOnChain(client(), deployment()),
    ).resolves.toEqual({
      chainId: 84_532,
      chainHead: 1_000n,
      startBlock: 100,
      usdcAddress: USDC,
      adapterConfigured: true,
    });
  });

  it("fails closed on a wrong chain, missing bytecode, or future start block", async () => {
    await expect(
      validateTokenlessDeploymentOnChain(client({ chainId: 1 }), deployment()),
    ).rejects.toThrow(/reports chain 1/);
    await expect(
      validateTokenlessDeploymentOnChain(
        client({
          codeAt: (address) => (address === BONUS ? undefined : "0x6000"),
        }),
        deployment(),
      ),
    ).rejects.toThrow(/FeedbackBonus has no deployed bytecode/);
    await expect(
      validateTokenlessDeploymentOnChain(
        client({ chainHead: 99n }),
        deployment(),
      ),
    ).rejects.toThrow(/ahead of chain head/);
  });

  it("rejects mixed panel and Feedback Bonus issuer or USDC wiring", async () => {
    await expect(
      validateTokenlessDeploymentOnChain(
        client({
          read: (address, functionName) => {
            if (functionName === "credentialIssuer") {
              return address === BONUS ? ADAPTER : ISSUER;
            }
            if (functionName === "usdc") return USDC;
            if (functionName === "panel") return PANEL;
            if (functionName === "SCORING_VERSION") return 2;
            if (functionName === "BASE_PAY_BPS") return 8_000;
            if (functionName === "MAXIMUM_COMMITS") return 500;
            throw new Error(`unexpected read ${functionName}`);
          },
        }),
        deployment(),
      ),
    ).rejects.toThrow(/issuer wiring/);

    await expect(
      validateTokenlessDeploymentOnChain(
        client({
          read: (address, functionName) => {
            if (functionName === "credentialIssuer") return ISSUER;
            if (functionName === "usdc") {
              return address === BONUS ? ADAPTER : USDC;
            }
            if (functionName === "panel") return PANEL;
            if (functionName === "SCORING_VERSION") return 2;
            if (functionName === "BASE_PAY_BPS") return 8_000;
            if (functionName === "MAXIMUM_COMMITS") return 500;
            throw new Error(`unexpected read ${functionName}`);
          },
        }),
        deployment(),
      ),
    ).rejects.toThrow(/same USDC/);
  });

  it("rejects a configured adapter with mixed immutable wiring", async () => {
    await expect(
      validateTokenlessDeploymentOnChain(
        client({
          read: (address, functionName) => {
            if (functionName === "credentialIssuer") return ISSUER;
            if (functionName === "usdc") return USDC;
            if (functionName === "panel" && address === ADAPTER) {
              return BONUS;
            }
            if (functionName === "SCORING_VERSION") return 2;
            if (functionName === "BASE_PAY_BPS") return 8_000;
            if (functionName === "MAXIMUM_COMMITS") return 500;
            throw new Error(`unexpected read ${functionName}`);
          },
        }),
        deployment(),
      ),
    ).rejects.toThrow(/X402PanelSubmitter wiring/);
  });

  it("permits an explicitly absent optional adapter", async () => {
    await expect(
      validateTokenlessDeploymentOnChain(
        client(),
        deployment({ adapterAddress: zeroAddress }),
      ),
    ).resolves.toMatchObject({ adapterConfigured: false });
  });
});
