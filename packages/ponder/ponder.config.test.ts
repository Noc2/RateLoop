import { afterEach, describe, expect, it, vi } from "vitest";
import deployedContracts from "@rateloop/contracts/deployedContracts";
import type * as DeploymentsModule from "@rateloop/contracts/deployments";

type DeploymentChain = Record<
  string,
  { address: `0x${string}`; deployedOnBlock?: number }
>;
type AbiEntry = { type?: string; name?: string; anonymous?: boolean };

const sharedDeployments = deployedContracts as Record<
  number,
  DeploymentChain | undefined
>;
const chain31337 = sharedDeployments[31337];
const chain8453 = sharedDeployments[8453];
const PONDER_CONFIG_TEST_TIMEOUT_MS = 30_000;
const ORIGINAL_ENV = { ...process.env };

const BASE_ENV = {
  NODE_ENV: "production",
  PONDER_NETWORK: "base",
  PONDER_RPC_URL_8453: "https://mainnet.base.org",
};

function getDuplicateEventNames(abi: readonly AbiEntry[]) {
  const eventCounts = new Map<string, number>();

  for (const item of abi) {
    if (item.type !== "event" || item.anonymous === true || !item.name) {
      continue;
    }
    eventCounts.set(item.name, (eventCounts.get(item.name) ?? 0) + 1);
  }

  return [...eventCounts.entries()]
    .filter(([, count]) => count > 1)
    .map(([name]) => name)
    .sort();
}

function getExpectedChainStartBlock(chain: DeploymentChain | undefined) {
  const deployedBlocks = Object.values(chain ?? {})
    .map(contract => contract.deployedOnBlock)
    .filter((value): value is number => Number.isInteger(value) && value >= 0);

  return deployedBlocks.length > 0 ? Math.min(...deployedBlocks) : 0;
}

function getExpectedProbeChainId(env: Record<string, string | undefined>) {
  if (env.PONDER_NETWORK === "base") return 8453;
  return 31337;
}

async function loadPonderConfig(
  overrides: Record<string, string | undefined> = {},
  removals: string[] = [],
  probeResult?: string,
) {
  vi.resetModules();
  process.env = {
    ...ORIGINAL_ENV,
    ...BASE_ENV,
    ...overrides,
  };

  for (const key of removals) {
    delete process.env[key];
  }

  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      const chainId = getExpectedProbeChainId(process.env);
      return new Response(JSON.stringify({ result: probeResult ?? `0x${chainId.toString(16)}` }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }),
  );

  return import("./ponder.config.ts");
}

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.doUnmock("@rateloop/contracts/deployments");
  vi.resetModules();
});

describe("ponder config", () => {
  it("keeps RaterRegistry event names unambiguous for Ponder handlers", async () => {
    const { default: config } = await loadPonderConfig({
      NODE_ENV: "test",
      PONDER_NETWORK: "hardhat",
      PONDER_RPC_URL_31337: "http://127.0.0.1:8545",
    });
    const loadedConfig = config as any;
    const raterRegistryAbi = loadedConfig.contracts.RaterRegistry.abi as readonly AbiEntry[];

    expect(getDuplicateEventNames(raterRegistryAbi)).toEqual([]);
    expect(raterRegistryAbi).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "event", name: "IdentityBanned" }),
        expect.objectContaining({ type: "event", name: "IdentityUnbanned" }),
      ]),
    );
  }, PONDER_CONFIG_TEST_TIMEOUT_MS);

  it("derives Base mainnet addresses and start blocks from shared deployment artifacts", async () => {
    expect(chain8453?.ContentRegistry?.address).toBeDefined();
    expect(chain8453?.RoundVotingEngine?.address).toBeDefined();
    expect(chain8453?.LoopReputation?.address).toBeDefined();

    const { default: config } = await loadPonderConfig();
    const loadedConfig = config as any;
    const expectedChainStartBlock = getExpectedChainStartBlock(chain8453);
    const expectedContentRegistryStartBlock =
      chain8453?.ContentRegistry?.deployedOnBlock ?? expectedChainStartBlock;

    expect(loadedConfig.contracts.ContentRegistry.network.base.address).toBe(
      chain8453!.ContentRegistry.address,
    );
    expect(loadedConfig.contracts.RoundVotingEngine.network.base.address).toBe(
      chain8453!.RoundVotingEngine.address,
    );
    expect(loadedConfig.contracts.LoopReputation.network.base.address).toBe(
      chain8453!.LoopReputation.address,
    );
    expect(loadedConfig.contracts.ContentRegistry.network.base.startBlock).toBe(
      expectedContentRegistryStartBlock,
    );
  }, PONDER_CONFIG_TEST_TIMEOUT_MS);

  it("rejects stale Base mainnet address env overrides when shared deployment artifacts exist", async () => {
    await expect(
      loadPonderConfig({
        PONDER_CONTENT_REGISTRY_ADDRESS: "0x1111111111111111111111111111111111111111",
      }),
    ).rejects.toThrow("conflicts with ContentRegistry from shared deployment artifacts");
  }, PONDER_CONFIG_TEST_TIMEOUT_MS);

  it("points missing Base mainnet artifacts at restoration instead of routine redeploy", async () => {
    vi.doMock("@rateloop/contracts/deployments", async importOriginal => {
      const actual = await importOriginal<typeof DeploymentsModule>();

      return {
        ...actual,
        getSharedDeploymentAddress: (chainId: number, contractName: string) =>
          chainId === 8453
            ? undefined
            : actual.getSharedDeploymentAddress(chainId, contractName),
        getSharedDeploymentStartBlock: (chainId: number, contractName: string) =>
          chainId === 8453
            ? undefined
            : actual.getSharedDeploymentStartBlock(chainId, contractName),
      };
    });

    await expect(loadPonderConfig()).rejects.toThrow(
      /Missing shared deployment artifact for ContentRegistry on chain 8453.*Restore the existing Base mainnet deployment artifact.*yarn base-mainnet:check/,
    );
  }, PONDER_CONFIG_TEST_TIMEOUT_MS);

  it("requires production mode for Base mainnet runtime", async () => {
    await expect(
      loadPonderConfig({
        NODE_ENV: "test",
      }),
    ).rejects.toThrow("NODE_ENV=production is required when PONDER_NETWORK=base.");
  }, PONDER_CONFIG_TEST_TIMEOUT_MS);

  it("rejects local E2E flags on Base mainnet Ponder", async () => {
    await expect(
      loadPonderConfig({
        RATELOOP_E2E_PRODUCTION_BUILD: "true",
        NEXT_PUBLIC_RATELOOP_E2E_PRODUCTION_BUILD: "true",
      }),
    ).rejects.toThrow(
      "RATELOOP_E2E_PRODUCTION_BUILD and NEXT_PUBLIC_RATELOOP_E2E_PRODUCTION_BUILD are local test flags and must not be set when PONDER_NETWORK=base.",
    );
  }, PONDER_CONFIG_TEST_TIMEOUT_MS);

  it("names malformed Base RPC env values in the startup error", async () => {
    await expect(
      loadPonderConfig({
        PONDER_RPC_URL_8453: "not a url",
      }),
    ).rejects.toThrow("PONDER_RPC_URL_8453 must be a valid URL.");
  }, PONDER_CONFIG_TEST_TIMEOUT_MS);

  it("warns when the RPC probe returns a malformed chain id quantity", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    await loadPonderConfig({}, [], "0x2105junk");

    await vi.waitFor(() => {
      expect(warnSpy).toHaveBeenCalledWith(
        "[ponder] PONDER_RPC_URL_8453 probe returned no chainId",
      );
    });
  }, PONDER_CONFIG_TEST_TIMEOUT_MS);

  it("rejects plaintext RPC env values for Base mainnet", async () => {
    await expect(
      loadPonderConfig({
        PONDER_RPC_URL_8453: "http://rpc.example.com",
      }),
    ).rejects.toThrow("PONDER_RPC_URL_8453 must use HTTPS for base.");
  }, PONDER_CONFIG_TEST_TIMEOUT_MS);

  it("allows local hardhat RPC during production-mode E2E startup", async () => {
    const { default: config } = await loadPonderConfig({
      NODE_ENV: "production",
      PONDER_NETWORK: "hardhat",
      PONDER_RPC_URL_31337: "http://127.0.0.1:8545",
    });

    const loadedConfig = config as any;

    expect(loadedConfig.networks.hardhat.chainId).toBe(31337);
  }, PONDER_CONFIG_TEST_TIMEOUT_MS);

  it("uses start block 0 for local hardhat even when artifacts contain deployment blocks", async () => {
    expect(chain31337?.ContentRegistry?.address).toBeDefined();
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { default: config } = await loadPonderConfig(
      {
        NODE_ENV: "test",
        PONDER_NETWORK: "hardhat",
        PONDER_RPC_URL_31337: "http://127.0.0.1:8545",
        PONDER_CONTENT_REGISTRY_START_BLOCK: String(
          chain31337!.ContentRegistry.deployedOnBlock ?? 1,
        ),
      },
      ["PONDER_CONTENT_REGISTRY_ADDRESS"],
    );

    const loadedConfig = config as any;

    expect(loadedConfig.contracts.ContentRegistry.network.hardhat.address).toBe(
      chain31337!.ContentRegistry.address,
    );
    expect(loadedConfig.contracts.ContentRegistry.network.hardhat.startBlock).toBe(0);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("using start block 0"));
  }, PONDER_CONFIG_TEST_TIMEOUT_MS);
});
