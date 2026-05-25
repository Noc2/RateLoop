import deployedContracts from "@rateloop/contracts/deployedContracts";
import { afterEach, describe, expect, it, vi } from "vitest";

type DeploymentChain = Record<string, { address: `0x${string}` }>;

const sharedDeployments = deployedContracts as Record<number, DeploymentChain | undefined>;
const chain480 = sharedDeployments[480];
const chain4801 = sharedDeployments[4801];
const chain31337 = sharedDeployments[31337];
const itWithWorldChainArtifacts = chain480 ? it : it.skip;
const ORIGINAL_ENV = { ...process.env };
const VALID_ENV = {
  RPC_URL: "https://rpc.example.com",
  CHAIN_ID: "31337",
  VOTING_ENGINE_ADDRESS: chain31337?.RoundVotingEngine?.address ?? "0x1111111111111111111111111111111111111111",
  CONTENT_REGISTRY_ADDRESS: chain31337?.ContentRegistry?.address ?? "0x2222222222222222222222222222222222222222",
  ADVISORY_VOTE_RECORDER_ADDRESS:
    chain31337?.AdvisoryVoteRecorder?.address ?? "0x5555555555555555555555555555555555555555",
  ROUND_REWARD_DISTRIBUTOR_ADDRESS:
    chain31337?.RoundRewardDistributor?.address ?? "0x3333333333333333333333333333333333333333",
  FRONTEND_REGISTRY_ADDRESS: chain31337?.FrontendRegistry?.address ?? "0x4444444444444444444444444444444444444444",
  KEYSTORE_ACCOUNT: "keeper",
  KEYSTORE_PASSWORD: "secret",
};
const LOCAL_VOTING_ENGINE = chain31337?.RoundVotingEngine?.address ?? "0x0000000000000000000000000000000000000000";
const LOCAL_CONTENT_REGISTRY = chain31337?.ContentRegistry?.address ?? "0x0000000000000000000000000000000000000000";
const LOCAL_ADVISORY_VOTE_RECORDER =
  chain31337?.AdvisoryVoteRecorder?.address ?? "0x5555555555555555555555555555555555555555";

async function loadKeeperConfig(
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

describe("keeper config", () => {
  it("infers the chain name from the configured chain id", async () => {
    const { config } = await loadKeeperConfig();

    expect(config.chainId).toBe(31337);
    expect(config.chainName).toBe("Foundry");
    expect(config.cleanupBatchSize).toBe(25);
    expect(config.frontendFees.enabled).toBe(false);
  });

  it("ignores stale CHAIN_NAME overrides for known chain ids", async () => {
    const { config } = await loadKeeperConfig({
      CHAIN_ID: "31337",
      CHAIN_NAME: "World Chain Sepolia",
    });

    expect(config.chainName).toBe("Foundry");
  });

  it("accepts a private key when no keystore account is configured", async () => {
    const privateKey = `0x${"11".repeat(32)}`;
    const { config } = await loadKeeperConfig(
      {
        KEEPER_PRIVATE_KEY: privateKey,
      },
      ["KEYSTORE_ACCOUNT", "KEYSTORE_PASSWORD"],
    );

    expect(config.privateKey).toBe(privateKey);
    expect(config.keystoreAccount).toBeUndefined();
  });

  it("requires a keystore password when using a keystore account without a private key", async () => {
    await expect(
      loadKeeperConfig(
        {
          KEYSTORE_ACCOUNT: "keeper",
          KEEPER_PRIVATE_KEY: "",
        },
        ["KEYSTORE_PASSWORD"],
      ),
    ).rejects.toThrow("KEYSTORE_PASSWORD is required when KEYSTORE_ACCOUNT is configured without KEEPER_PRIVATE_KEY");
  });

  it("allows a private key to override an incomplete keystore account", async () => {
    const privateKey = `0x${"22".repeat(32)}`;
    const { config } = await loadKeeperConfig(
      {
        KEYSTORE_ACCOUNT: "keeper",
        KEEPER_PRIVATE_KEY: privateKey,
      },
      ["KEYSTORE_PASSWORD"],
    );

    expect(config.privateKey).toBe(privateKey);
    expect(config.keystoreAccount).toBe("keeper");
    // H-8 (2026-05-22 audit): keystorePassword is no longer carried on the long-lived
    // config object; the keystore loader reads it from process.env at decrypt time.
    expect("keystorePassword" in config).toBe(false);
  });

  it("requires either a keystore account or private key", async () => {
    await expect(
      loadKeeperConfig({
        KEYSTORE_ACCOUNT: "",
        KEYSTORE_PASSWORD: "",
        KEEPER_PRIVATE_KEY: "",
      }),
    ).rejects.toThrow("KEYSTORE_ACCOUNT or KEEPER_PRIVATE_KEY is required");
  });

  it("rejects localhost RPC URLs in production", async () => {
    await expect(
      loadKeeperConfig({
        NODE_ENV: "production",
        RPC_URL: "http://localhost:8545",
      }),
    ).rejects.toThrow("RPC_URL must not point to localhost in production");
  });

  it("validates cleanup batch size as a positive integer", async () => {
    await expect(
      loadKeeperConfig({
        KEEPER_CLEANUP_BATCH_SIZE: "0",
      }),
    ).rejects.toThrow("KEEPER_CLEANUP_BATCH_SIZE must be a positive integer");
  });

  it("loads an optional Ponder API base URL", async () => {
    const { config } = await loadKeeperConfig({
      PONDER_BASE_URL: "https://ponder.example.com/",
    });

    expect(config.ponderBaseUrl).toBe("https://ponder.example.com");
  });

  it("rejects an invalid Ponder API base URL", async () => {
    await expect(
      loadKeeperConfig({
        PONDER_BASE_URL: "not a url",
      }),
    ).rejects.toThrow("PONDER_BASE_URL must be a valid URL when provided");
  });

  it.each([
    ["CHAIN_ID", "4801abc", "CHAIN_ID must be a positive integer"],
    ["KEEPER_INTERVAL_MS", "30000ms", "KEEPER_INTERVAL_MS must be a positive integer"],
    ["KEEPER_STARTUP_JITTER_MS", "0ms", "KEEPER_STARTUP_JITTER_MS must be a non-negative integer"],
    ["KEEPER_CLEANUP_BATCH_SIZE", "25items", "KEEPER_CLEANUP_BATCH_SIZE must be a positive integer"],
    ["MAX_GAS_PER_TX", "2000000gas", "MAX_GAS_PER_TX must be a positive integer"],
    ["METRICS_PORT", "9090http", "METRICS_PORT must be a positive integer"],
    ["DORMANCY_PERIOD", "2592000s", "DORMANCY_PERIOD must be a positive integer"],
    ["MIN_GAS_BALANCE_WEI", "10000000000000000wei", "MIN_GAS_BALANCE_WEI must be a non-negative integer"],
  ])("rejects trailing junk in %s", async (name, value, message) => {
    await expect(
      loadKeeperConfig({
        [name]: value,
      }),
    ).rejects.toThrow(message);
  });

  it("accepts zero for non-negative numeric settings", async () => {
    const { config } = await loadKeeperConfig({
      KEEPER_STARTUP_JITTER_MS: "0",
      MIN_GAS_BALANCE_WEI: "0",
    });

    expect(config.startupJitterMs).toBe(0);
    expect(config.minGasBalanceWei).toBe("0");
  });

  it.each([
    ["true", true],
    ["1", true],
    ["yes", true],
    ["on", true],
    ["false", false],
    ["0", false],
    ["no", false],
    ["off", false],
  ])("parses METRICS_ENABLED=%s", async (value, expected) => {
    const { config } = await loadKeeperConfig({
      METRICS_ENABLED: value,
    });

    expect(config.metricsEnabled).toBe(expected);
  });

  it("rejects invalid METRICS_ENABLED values", async () => {
    await expect(
      loadKeeperConfig({
        METRICS_ENABLED: "disabled",
      }),
    ).rejects.toThrow("METRICS_ENABLED must be a boolean-like value");
  });

  it("derives local contract addresses from shared deployment artifacts", async () => {
    const { config } = await loadKeeperConfig(
      {
        CHAIN_ID: "31337",
      },
      ["VOTING_ENGINE_ADDRESS", "CONTENT_REGISTRY_ADDRESS", "ADVISORY_VOTE_RECORDER_ADDRESS"],
    );

    expect(config.contracts.votingEngine).toBe(LOCAL_VOTING_ENGINE);
    expect(config.contracts.contentRegistry).toBe(LOCAL_CONTENT_REGISTRY);
    expect(config.contracts.advisoryVoteRecorder).toBe(LOCAL_ADVISORY_VOTE_RECORDER);
  });

  itWithWorldChainArtifacts("derives World Chain mainnet contract addresses from shared deployment artifacts", async () => {
    const { config } = await loadKeeperConfig(
      {
        CHAIN_ID: "480",
      },
      ["VOTING_ENGINE_ADDRESS", "CONTENT_REGISTRY_ADDRESS", "ADVISORY_VOTE_RECORDER_ADDRESS"],
    );

    expect(config.chainId).toBe(480);
    expect(config.chainName).toBe("World Chain");
    expect(config.contracts.votingEngine).toBe(chain480!.RoundVotingEngine.address);
    expect(config.contracts.contentRegistry).toBe(chain480!.ContentRegistry.address);
  });

  it("prefers local hardhat contract env values over shared deployment artifacts", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const localVotingEngine = "0x196dBCBb54b8ec4958c959D8949EBFE87aC2Aaaf";
    const localContentRegistry = "0x82Dc47734901ee7d4f4232f398752cB9Dd5dACcC";
    const localAdvisoryVoteRecorder = "0xaAaAaAaaAaAaAaaAaAAAAAAAAaaaAaAaAaaAaaAa";
    const { config } = await loadKeeperConfig({
      CHAIN_ID: "31337",
      VOTING_ENGINE_ADDRESS: localVotingEngine,
      CONTENT_REGISTRY_ADDRESS: localContentRegistry,
      ADVISORY_VOTE_RECORDER_ADDRESS: localAdvisoryVoteRecorder,
    });

    expect(config.contracts.votingEngine).toBe(localVotingEngine);
    expect(config.contracts.contentRegistry).toBe(localContentRegistry);
    expect(config.contracts.advisoryVoteRecorder).toBe(localAdvisoryVoteRecorder);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("Using VOTING_ENGINE_ADDRESS"));
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("Using CONTENT_REGISTRY_ADDRESS"));
  });

  itWithWorldChainArtifacts("rejects stale live contract env values when shared deployment artifacts exist", async () => {
    await expect(
      loadKeeperConfig({
        CHAIN_ID: "480",
        VOTING_ENGINE_ADDRESS: "0x196dBCBb54b8ec4958c959D8949EBFE87aC2Aaaf",
        CONTENT_REGISTRY_ADDRESS: "0x82Dc47734901ee7d4f4232f398752cB9Dd5dACcC",
        ADVISORY_VOTE_RECORDER_ADDRESS: "0xaAaAaAaaAaAaAaaAaAAAAAAAAaaaAaAaAaaAaaAa",
      }),
    ).rejects.toThrow("conflicts with RoundVotingEngine from shared deployment artifacts");
  });

  it("rejects live env-only contract addresses when no shared deployment artifact exists for the chain", async () => {
    await expect(
      loadKeeperConfig({
        CHAIN_ID: "999999",
        VOTING_ENGINE_ADDRESS: "0x196dBCBb54b8ec4958c959D8949EBFE87aC2Aaaf",
        CONTENT_REGISTRY_ADDRESS: "0x82Dc47734901ee7d4f4232f398752cB9Dd5dACcC",
        ADVISORY_VOTE_RECORDER_ADDRESS: "0xaAaAaAaaAaAaAaaAaAAAAAAAAaaaAaAaAaaAaaAa",
      }),
    ).rejects.toThrow("Missing shared deployment artifact for RoundVotingEngine on chain 999999");
  });

  it("loads hosted frontend fee sweep settings from the environment", async () => {
    const { config } = await loadKeeperConfig({
      KEEPER_FRONTEND_FEE_ENABLED: "true",
      KEEPER_FRONTEND_ADDRESS: "0x7777777777777777777777777777777777777777",
      KEEPER_FRONTEND_FEE_LOOKBACK_ROUNDS: "12",
      KEEPER_FRONTEND_FEE_WITHDRAW: "false",
    });

    expect(config.frontendFees).toEqual(
      expect.objectContaining({
        enabled: true,
        frontendAddress: "0x7777777777777777777777777777777777777777",
        lookbackRounds: 12,
        withdrawEnabled: false,
        contracts: expect.objectContaining({
          roundRewardDistributor: expect.stringMatching(/^0x[0-9a-fA-F]{40}$/),
          frontendRegistry: expect.stringMatching(/^0x[0-9a-fA-F]{40}$/),
        }),
      }),
    );
  });

  it("rejects an invalid hosted frontend address", async () => {
    await expect(
      loadKeeperConfig({
        KEEPER_FRONTEND_ADDRESS: "not-an-address",
      }),
    ).rejects.toThrow("KEEPER_FRONTEND_ADDRESS must be a valid address");
  });

  it("loads file-based correlation snapshot publication settings", async () => {
    const { config } = await loadKeeperConfig({
      KEEPER_CORRELATION_SNAPSHOTS_ENABLED: "true",
      KEEPER_CORRELATION_SNAPSHOTS_MODE: "file",
      KEEPER_CORRELATION_SNAPSHOT_ARTIFACT_PATH: "./correlation-snapshots.json",
      CLUSTER_PAYOUT_ORACLE_ADDRESS: "0x6666666666666666666666666666666666666666",
    });

    expect(config.correlationSnapshots).toEqual(
      expect.objectContaining({
        enabled: true,
        mode: "file",
        artifactPath: "./correlation-snapshots.json",
        maxRoundsPerTick: 20,
        frontendRegistry: expect.stringMatching(/^0x[0-9a-fA-F]{40}$/),
        artifactStorage: {
          mode: "data-uri",
          outputDir: "correlation-artifacts",
          publicBaseUrl: "",
        },
      }),
    );
  });

  it("loads production-capable automatic correlation snapshot settings", async () => {
    const { config } = await loadKeeperConfig({
      KEEPER_CORRELATION_SNAPSHOTS_ENABLED: "true",
      KEEPER_CORRELATION_SNAPSHOTS_MODE: "auto",
      KEEPER_CORRELATION_ARTIFACT_STORAGE: "file",
      KEEPER_CORRELATION_SNAPSHOT_PUBLIC_BASE_URL: "https://artifacts.example.com/rateloop/",
      KEEPER_CORRELATION_SNAPSHOT_STORAGE_DIR: "/tmp/rateloop-correlation",
      KEEPER_CORRELATION_SNAPSHOT_MAX_ROUNDS_PER_TICK: "7",
      PONDER_BASE_URL: "https://ponder.example.com",
      CLUSTER_PAYOUT_ORACLE_ADDRESS: "0x6666666666666666666666666666666666666666",
    });

    expect(config.correlationSnapshots).toEqual(
      expect.objectContaining({
        enabled: true,
        mode: "auto",
        artifactPath: undefined,
        maxRoundsPerTick: 7,
        artifactStorage: {
          mode: "file",
          outputDir: "/tmp/rateloop-correlation",
          publicBaseUrl: "https://artifacts.example.com/rateloop",
        },
      }),
    );
  });

  it("requires Ponder when automatic correlation snapshots are enabled", async () => {
    await expect(
      loadKeeperConfig(
        {
          KEEPER_CORRELATION_SNAPSHOTS_ENABLED: "true",
          KEEPER_CORRELATION_SNAPSHOTS_MODE: "auto",
          CLUSTER_PAYOUT_ORACLE_ADDRESS: "0x6666666666666666666666666666666666666666",
        },
        ["PONDER_BASE_URL"],
      ),
    ).rejects.toThrow(
      "PONDER_BASE_URL is required when KEEPER_CORRELATION_SNAPSHOTS_ENABLED=true and KEEPER_CORRELATION_SNAPSHOTS_MODE=auto",
    );
  });

  it("requires a public artifact URL for automatic file artifact storage", async () => {
    await expect(
      loadKeeperConfig(
        {
          KEEPER_CORRELATION_SNAPSHOTS_ENABLED: "true",
          KEEPER_CORRELATION_SNAPSHOTS_MODE: "auto",
          KEEPER_CORRELATION_ARTIFACT_STORAGE: "file",
          PONDER_BASE_URL: "https://ponder.example.com",
          CLUSTER_PAYOUT_ORACLE_ADDRESS: "0x6666666666666666666666666666666666666666",
        },
        ["KEEPER_CORRELATION_SNAPSHOT_PUBLIC_BASE_URL"],
      ),
    ).rejects.toThrow(
      "KEEPER_CORRELATION_SNAPSHOT_PUBLIC_BASE_URL is required when auto correlation snapshots use file artifact storage",
    );
  });

  it("requires an HTTPS artifact URL for automatic file artifact storage", async () => {
    await expect(
      loadKeeperConfig({
        KEEPER_CORRELATION_SNAPSHOTS_ENABLED: "true",
        KEEPER_CORRELATION_SNAPSHOTS_MODE: "auto",
        KEEPER_CORRELATION_ARTIFACT_STORAGE: "file",
        KEEPER_CORRELATION_SNAPSHOT_PUBLIC_BASE_URL: "http://artifacts.example.com/rateloop/",
        PONDER_BASE_URL: "https://ponder.example.com",
        CLUSTER_PAYOUT_ORACLE_ADDRESS: "0x6666666666666666666666666666666666666666",
      }),
    ).rejects.toThrow(
      "KEEPER_CORRELATION_SNAPSHOT_PUBLIC_BASE_URL must be an HTTPS URL when auto correlation snapshots use file artifact storage",
    );
  });
});
