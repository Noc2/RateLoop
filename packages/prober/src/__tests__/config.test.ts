import deployedContracts from "@rateloop/contracts/deployedContracts";
import { afterEach, describe, expect, it, vi } from "vitest";

type DeploymentChain = Record<string, { address: `0x${string}`; deployedOnBlock?: number }>;

const sharedDeployments = deployedContracts as Record<number, DeploymentChain | undefined>;
const chain31337 = sharedDeployments[31337];
const ORIGINAL_ENV = { ...process.env };
const VALID_ENV = {
  RPC_URL: "https://rpc.example.com",
  CHAIN_ID: "31337",
  RATER_DECLARATION_REGISTRY_ADDRESS:
    chain31337?.RaterDeclarationRegistry?.address ?? "0x1111111111111111111111111111111111111111",
  KEYSTORE_ACCOUNT: "prober",
  KEYSTORE_PASSWORD: "secret",
  PROBER_DETECTOR_BUNDLE_HASH: `0x${"11".repeat(32)}`,
  PROBER_PROBE_LIBRARY_HASH: `0x${"22".repeat(32)}`,
};

async function loadProberConfig(
  overrides: Record<string, string | undefined> = {},
  removals: string[] = [],
) {
  vi.resetModules();
  process.env = {
    ...ORIGINAL_ENV,
    ...VALID_ENV,
    ...overrides,
  };

  for (const key of removals) {
    process.env[key] = "";
  }

  return import("../config.js");
}

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  vi.restoreAllMocks();
  vi.resetModules();
});

describe("prober config", () => {
  it("loads defaults for the mock detector service", async () => {
    const { config } = await loadProberConfig();

    expect(config.chainId).toBe(31337);
    expect(config.chainName).toBe("Foundry");
    expect(config.detectorKind).toBe("mock");
    expect(config.intervalMs).toBe(30000);
    expect(config.recentBlockLookback).toBe(5000);
    expect(config.maxCandidatesPerTick).toBe(10);
    expect(config.minGasBalanceWei).toBe("10000000000000000");
  });

  it("accepts a private key when no keystore account is configured", async () => {
    const privateKey = `0x${"33".repeat(32)}`;
    const { config } = await loadProberConfig(
      {
        PROBER_PRIVATE_KEY: privateKey,
      },
      ["KEYSTORE_ACCOUNT", "KEYSTORE_PASSWORD"],
    );

    expect(config.privateKey).toBe(privateKey);
    expect(config.keystoreAccount).toBeUndefined();
  });

  it("derives the local registry deployment from shared artifacts when unset", async () => {
    const { config } = await loadProberConfig({}, ["RATER_DECLARATION_REGISTRY_ADDRESS"]);

    expect(config.contracts.raterDeclarationRegistry).toBe(
      chain31337?.RaterDeclarationRegistry?.address ?? "0x0000000000000000000000000000000000000000",
    );
    expect(config.startBlock).toBe(chain31337?.RaterDeclarationRegistry?.deployedOnBlock ?? 0);
  });

  it("requires detector and probe library hashes", async () => {
    await expect(
      loadProberConfig(
        {
          PROBER_DETECTOR_BUNDLE_HASH: "",
          PROBER_PROBE_LIBRARY_HASH: "",
        },
      ),
    ).rejects.toThrow(
      "PROBER_DETECTOR_BUNDLE_HASH is required",
    );
  });

  it("rejects unsupported detector kinds", async () => {
    await expect(
      loadProberConfig({
        PROBER_DETECTOR_KIND: "llmmap",
      }),
    ).rejects.toThrow("PROBER_DETECTOR_KIND must be one of: mock");
  });
});
