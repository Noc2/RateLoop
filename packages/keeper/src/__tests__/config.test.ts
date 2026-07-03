import path from "node:path";
import deployedContracts from "@rateloop/contracts/deployedContracts";
import { getSharedDeploymentAddress as actualGetSharedDeploymentAddress } from "@rateloop/contracts/deployments";
import { afterEach, describe, expect, it, vi } from "vitest";

type DeploymentChain = Record<string, { address: `0x${string}` }>;
type SharedDeploymentAddressResolver = (
  chainId: number,
  contractName: string,
) => `0x${string}` | undefined;

const sharedDeployments = deployedContracts as Record<
  number,
  DeploymentChain | undefined
>;
const chain84532 = sharedDeployments[84532];
const chain4801 = sharedDeployments[4801];
const chain480 = sharedDeployments[480];
const chain31337 = sharedDeployments[31337];
const itWithWorldChainArtifacts = chain480 ? it : it.skip;
const itWithWorldChainSepoliaFeedbackBonusEscrowArtifact =
  chain4801?.FeedbackBonusEscrow ? it : it.skip;
const ORIGINAL_ENV = { ...process.env };
const VALID_ENV = {
  RPC_URL: "https://rpc.example.com",
  CHAIN_ID: "31337",
  VOTING_ENGINE_ADDRESS:
    chain31337?.RoundVotingEngine?.address ??
    "0x1111111111111111111111111111111111111111",
  CONTENT_REGISTRY_ADDRESS:
    chain31337?.ContentRegistry?.address ??
    "0x2222222222222222222222222222222222222222",
  ADVISORY_VOTE_RECORDER_ADDRESS:
    chain31337?.AdvisoryVoteRecorder?.address ??
    "0x5555555555555555555555555555555555555555",
  ROUND_REWARD_DISTRIBUTOR_ADDRESS:
    chain31337?.RoundRewardDistributor?.address ??
    "0x3333333333333333333333333333333333333333",
  FRONTEND_REGISTRY_ADDRESS:
    chain31337?.FrontendRegistry?.address ??
    "0x4444444444444444444444444444444444444444",
  PONDER_BASE_URL: "https://ponder.example.com",
  PONDER_KEEPER_WORK_TOKEN: "test-token",
  KEYSTORE_ACCOUNT: "keeper",
  KEYSTORE_PASSWORD: "secret",
  KEEPER_FRONTEND_FEE_ENABLED: "false",
  KEEPER_CORRELATION_SNAPSHOTS_ENABLED: "false",
  METRICS_BIND_ADDRESS: "",
  METRICS_PORT: "",
  METRICS_AUTH_TOKEN: "",
  PORT: "",
};
const LOCAL_VOTING_ENGINE =
  chain31337?.RoundVotingEngine?.address ??
  "0x0000000000000000000000000000000000000000";
const LOCAL_CONTENT_REGISTRY =
  chain31337?.ContentRegistry?.address ??
  "0x0000000000000000000000000000000000000000";
const LOCAL_ADVISORY_VOTE_RECORDER =
  chain31337?.AdvisoryVoteRecorder?.address ??
  "0x5555555555555555555555555555555555555555";

function requireBaseSepoliaDeployment() {
  expect(chain84532).toBeDefined();
  return chain84532!;
}

async function loadKeeperConfig(
  overrides: Record<string, string | undefined> = {},
  removals: string[] = [],
  getSharedDeploymentAddress?: SharedDeploymentAddressResolver,
) {
  vi.resetModules();
  if (getSharedDeploymentAddress) {
    vi.doMock("@rateloop/contracts/deployments", () => ({
      getSharedDeploymentAddress,
    }));
  } else {
    vi.doUnmock("@rateloop/contracts/deployments");
  }
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
  vi.doUnmock("@rateloop/contracts/deployments");
  vi.resetModules();
});

describe("keeper config", () => {
  it("infers the chain name from the configured chain id", async () => {
    const { config } = await loadKeeperConfig();

    expect(config.chainId).toBe(31337);
    expect(config.chainName).toBe("Foundry");
    expect(config.cleanupBatchSize).toBe(25);
    expect(config.feedbackBonusForfeits).toEqual({
      enabled: true,
      maxPoolsPerTick: 25,
      minAgeSeconds: 60,
    });
    expect(config.proactiveRoundOpening).toEqual({
      enabled: false,
      maxPerTick: 2,
      recentSeconds: 21_600n,
    });
    expect(config.rewardPoolQualifications).toEqual({
      enabled: true,
      maxRoundsPerTick: 25,
      maxBundleSyncsPerTick: 10,
      bundleMaxRoundsPerSync: 25,
    });
    expect(config.frontendFees.enabled).toBe(false);
    expect(config.persistence).toEqual({
      databaseUrl: null,
      mainLoopLockRequired: false,
      correlationSnapshotLockRequired: false,
    });
  });

  it("loads proactive round opening limits", async () => {
    const { config } = await loadKeeperConfig({
      KEEPER_PROACTIVE_ROUND_OPENING_ENABLED: "true",
      KEEPER_PROACTIVE_ROUND_OPENING_MAX_PER_TICK: "3",
      KEEPER_PROACTIVE_ROUND_OPENING_RECENT_SECONDS: "900",
    });

    expect(config.proactiveRoundOpening).toEqual({
      enabled: true,
      maxPerTick: 3,
      recentSeconds: 900n,
    });
  });

  it("loads reward pool qualification sweep settings", async () => {
    const { config } = await loadKeeperConfig({
      KEEPER_REWARD_POOL_QUALIFICATIONS_ENABLED: "false",
      KEEPER_REWARD_POOL_QUALIFICATIONS_PER_TICK: "7",
      KEEPER_BUNDLE_TERMINAL_SYNCS_PER_TICK: "3",
      KEEPER_BUNDLE_TERMINAL_SYNC_MAX_ROUNDS: "11",
    });

    expect(config.rewardPoolQualifications).toEqual({
      enabled: false,
      maxRoundsPerTick: 7,
      maxBundleSyncsPerTick: 3,
      bundleMaxRoundsPerSync: 11,
    });
  });

  it("loads an optional keeper persistence database URL", async () => {
    const { config } = await loadKeeperConfig({
      KEEPER_DATABASE_URL:
        "postgresql://postgres:postgres@postgres.railway.internal:5432/railway",
    });

    expect(config.persistence.databaseUrl).toBe(
      "postgresql://postgres:postgres@postgres.railway.internal:5432/railway",
    );
    expect(config.persistence.mainLoopLockRequired).toBe(false);
  });

  it("requires keeper persistence for production main-loop locks by default", async () => {
    await expect(
      loadKeeperConfig({
        NODE_ENV: "production",
      }),
    ).rejects.toThrow(
      "KEEPER_DATABASE_URL is required when KEEPER_MAIN_LOOP_LOCK_REQUIRED=true",
    );
  });

  it("requires PONDER_KEEPER_WORK_TOKEN in production", async () => {
    await expect(
      loadKeeperConfig({
        NODE_ENV: "production",
        PONDER_KEEPER_WORK_TOKEN: "",
      }),
    ).rejects.toThrow("PONDER_KEEPER_WORK_TOKEN is required in production");
  });

  it("allows production operators to explicitly opt out of main-loop locks", async () => {
    const { config } = await loadKeeperConfig({
      KEEPER_MAIN_LOOP_LOCK_REQUIRED: "false",
      NODE_ENV: "production",
    });

    expect(config.persistence).toEqual({
      databaseUrl: null,
      mainLoopLockRequired: false,
      correlationSnapshotLockRequired: false,
    });
  });

  it("enables required main-loop locks in production when a database is configured", async () => {
    const { config } = await loadKeeperConfig({
      KEEPER_DATABASE_URL:
        "postgresql://postgres:postgres@postgres.railway.internal:5432/railway",
      NODE_ENV: "production",
    });

    expect(config.persistence).toEqual({
      databaseUrl:
        "postgresql://postgres:postgres@postgres.railway.internal:5432/railway",
      mainLoopLockRequired: true,
      correlationSnapshotLockRequired: false,
    });
  });

  it("enables required correlation snapshot locks in production when snapshots are enabled", async () => {
    const { config } = await loadKeeperConfig({
      NODE_ENV: "production",
      KEEPER_DATABASE_URL:
        "postgresql://postgres:postgres@postgres.railway.internal:5432/railway",
      KEEPER_CORRELATION_SNAPSHOTS_ENABLED: "true",
      KEEPER_CORRELATION_SNAPSHOTS_MODE: "auto",
      KEEPER_CORRELATION_ARTIFACT_STORAGE: "file",
      KEEPER_CORRELATION_SNAPSHOT_PUBLIC_BASE_URL:
        "https://artifacts.example.com/rateloop/",
      PONDER_BASE_URL: "https://ponder.example.com",
      CLUSTER_PAYOUT_ORACLE_ADDRESS:
        "0x6666666666666666666666666666666666666666",
      PORT: "8080",
      METRICS_AUTH_TOKEN: "0123456789abcdef",
    });

    expect(config.persistence.correlationSnapshotLockRequired).toBe(true);
  });

  it("requires keeper persistence for production correlation snapshot locks by default", async () => {
    await expect(
      loadKeeperConfig({
        NODE_ENV: "production",
        KEEPER_CORRELATION_SNAPSHOTS_ENABLED: "true",
        KEEPER_CORRELATION_SNAPSHOTS_MODE: "auto",
        KEEPER_CORRELATION_ARTIFACT_STORAGE: "file",
        KEEPER_CORRELATION_SNAPSHOT_PUBLIC_BASE_URL:
          "https://artifacts.example.com/rateloop/",
        PONDER_BASE_URL: "https://ponder.example.com",
        CLUSTER_PAYOUT_ORACLE_ADDRESS:
          "0x6666666666666666666666666666666666666666",
        PORT: "8080",
        METRICS_AUTH_TOKEN: "0123456789abcdef",
      }),
    ).rejects.toThrow(
      "KEEPER_DATABASE_URL is required when KEEPER_CORRELATION_SNAPSHOT_LOCK_REQUIRED=true",
    );
  });

  it("requires production mode for Base mainnet keeper runtime", async () => {
    await expect(
      loadKeeperConfig({
        CHAIN_ID: "8453",
        RPC_URL: "https://mainnet.base.org",
      }),
    ).rejects.toThrow("NODE_ENV=production is required when CHAIN_ID=8453");
  });

  it("rejects invalid keeper persistence database URLs", async () => {
    await expect(
      loadKeeperConfig({
        KEEPER_DATABASE_URL: "https://postgres.example.com/railway",
      }),
    ).rejects.toThrow(
      "KEEPER_DATABASE_URL must use the postgres:// or postgresql:// scheme",
    );
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

  it("rejects malformed private keys before account initialization", async () => {
    await expect(
      loadKeeperConfig(
        {
          KEEPER_PRIVATE_KEY: "0x1234",
        },
        ["KEYSTORE_ACCOUNT", "KEYSTORE_PASSWORD"],
      ),
    ).rejects.toThrow("KEEPER_PRIVATE_KEY must be a 0x-prefixed 32-byte hex private key");
  });

  it("does not let a malformed private key satisfy wallet configuration", async () => {
    await expect(
      loadKeeperConfig(
        {
          KEYSTORE_ACCOUNT: "keeper",
          KEEPER_PRIVATE_KEY: "0x1234",
        },
        ["KEYSTORE_PASSWORD"],
      ),
    ).rejects.toThrow("KEYSTORE_PASSWORD is required when KEYSTORE_ACCOUNT is configured without KEEPER_PRIVATE_KEY");
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
    ).rejects.toThrow(
      "KEYSTORE_PASSWORD is required when KEYSTORE_ACCOUNT is configured without KEEPER_PRIVATE_KEY",
    );
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

  it("rejects unsupported log formats", async () => {
    await expect(
      loadKeeperConfig({
        LOG_FORMAT: "xml",
      }),
    ).rejects.toThrow("LOG_FORMAT must be one of: json, text");
  });

  it("rejects localhost RPC URLs in production", async () => {
    await expect(
      loadKeeperConfig({
        NODE_ENV: "production",
        RPC_URL: "http://localhost:8545",
      }),
    ).rejects.toThrow("RPC_URL must not point to localhost in production");
  });

  it("rejects plaintext RPC URLs for live chain ids", async () => {
    await expect(
      loadKeeperConfig({
        CHAIN_ID: "84532",
        RPC_URL: "http://sepolia.base.org",
      }),
    ).rejects.toThrow("RPC_URL must use HTTPS");
  });

  it("validates cleanup batch size as a positive integer", async () => {
    await expect(
      loadKeeperConfig({
        KEEPER_CLEANUP_BATCH_SIZE: "0",
      }),
    ).rejects.toThrow("KEEPER_CLEANUP_BATCH_SIZE must be a positive integer");
  });

  it("clamps DORMANCY_PERIOD below the on-chain contract constant and warns", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { config } = await loadKeeperConfig({
      DORMANCY_PERIOD: "86400", // 1 day < ContentRegistry.DORMANCY_PERIOD (30 days)
    });

    expect(config.dormancyPeriod).toBe(30n * 24n * 60n * 60n);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining(
        "below the on-chain ContentRegistry.DORMANCY_PERIOD",
      ),
    );
  });

  it("accepts DORMANCY_PERIOD at or above the on-chain contract constant", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { config } = await loadKeeperConfig({
      DORMANCY_PERIOD: "5184000", // 60 days
    });

    expect(config.dormancyPeriod).toBe(5_184_000n);
    expect(warnSpy).not.toHaveBeenCalledWith(
      expect.stringContaining("DORMANCY_PERIOD"),
    );
  });

  it("loads and normalizes the Ponder API base URL", async () => {
    const { config } = await loadKeeperConfig({
      PONDER_BASE_URL: "https://ponder.example.com/",
    });

    expect(config.ponderBaseUrl).toBe("https://ponder.example.com");
  });

  it("requires a Ponder API base URL", async () => {
    await expect(loadKeeperConfig({}, ["PONDER_BASE_URL"])).rejects.toThrow(
      "PONDER_BASE_URL is required",
    );
  });

  it("rejects an invalid Ponder API base URL", async () => {
    await expect(
      loadKeeperConfig({
        PONDER_BASE_URL: "not a url",
      }),
    ).rejects.toThrow("PONDER_BASE_URL must be a valid URL when provided");
  });

  it("rejects local or non-HTTPS Ponder API base URLs in production", async () => {
    await expect(
      loadKeeperConfig({
        NODE_ENV: "production",
        PONDER_BASE_URL: "http://localhost:42069",
      }),
    ).rejects.toThrow(
      "PONDER_BASE_URL must not point to localhost in production",
    );

    await expect(
      loadKeeperConfig({
        NODE_ENV: "production",
        PONDER_BASE_URL: "http://ponder.example.com",
      }),
    ).rejects.toThrow("PONDER_BASE_URL must be an HTTPS URL in production");
  });

  it.each([
    ["CHAIN_ID", "4801abc", "CHAIN_ID must be a positive integer"],
    [
      "KEEPER_INTERVAL_MS",
      "30000ms",
      "KEEPER_INTERVAL_MS must be a positive integer",
    ],
    [
      "KEEPER_STARTUP_JITTER_MS",
      "0ms",
      "KEEPER_STARTUP_JITTER_MS must be a non-negative integer",
    ],
    [
      "KEEPER_CLEANUP_BATCH_SIZE",
      "25items",
      "KEEPER_CLEANUP_BATCH_SIZE must be a positive integer",
    ],
    [
      "KEEPER_FEEDBACK_BONUS_FORFEITS_PER_TICK",
      "25items",
      "KEEPER_FEEDBACK_BONUS_FORFEITS_PER_TICK must be a non-negative integer",
    ],
    [
      "KEEPER_FEEDBACK_BONUS_FORFEIT_MIN_AGE_SECONDS",
      "60seconds",
      "KEEPER_FEEDBACK_BONUS_FORFEIT_MIN_AGE_SECONDS must be a non-negative integer",
    ],
    [
      "KEEPER_FRONTEND_FEE_RECENT_ROUNDS_PER_TICK",
      "50rounds",
      "KEEPER_FRONTEND_FEE_RECENT_ROUNDS_PER_TICK must be a non-negative integer",
    ],
    [
      "KEEPER_FRONTEND_FEE_BACKFILL_ROUNDS_PER_TICK",
      "50rounds",
      "KEEPER_FRONTEND_FEE_BACKFILL_ROUNDS_PER_TICK must be a non-negative integer",
    ],
    [
      "MAX_GAS_PER_TX",
      "2000000gas",
      "MAX_GAS_PER_TX must be a positive integer",
    ],
    ["METRICS_PORT", "9090http", "METRICS_PORT must be a positive integer"],
    [
      "DORMANCY_PERIOD",
      "2592000s",
      "DORMANCY_PERIOD must be a positive integer",
    ],
    [
      "MIN_GAS_BALANCE_WEI",
      "10000000000000000wei",
      "MIN_GAS_BALANCE_WEI must be a non-negative integer",
    ],
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
      KEEPER_FEEDBACK_BONUS_FORFEITS_PER_TICK: "0",
      KEEPER_FEEDBACK_BONUS_FORFEIT_MIN_AGE_SECONDS: "0",
      MIN_GAS_BALANCE_WEI: "0",
    });

    expect(config.startupJitterMs).toBe(0);
    expect(config.feedbackBonusForfeits.maxPoolsPerTick).toBe(0);
    expect(config.feedbackBonusForfeits.minAgeSeconds).toBe(0);
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

  it("aggregates invalid boolean values with other config errors", async () => {
    await expect(
      loadKeeperConfig(
        {
          METRICS_ENABLED: "disabled",
        },
        ["RPC_URL"],
      ),
    ).rejects.toThrow(
      /Invalid keeper configuration:\n- RPC_URL is required\n- METRICS_ENABLED must be a boolean-like value/,
    );
  });

  it("loads feedback bonus forfeit sweep settings from the environment", async () => {
    const localFeedbackBonusEscrow =
      chain31337?.FeedbackBonusEscrow?.address ??
      "0x7777777777777777777777777777777777777777";
    const { config } = await loadKeeperConfig({
      FEEDBACK_BONUS_ESCROW_ADDRESS: localFeedbackBonusEscrow,
      KEEPER_FEEDBACK_BONUS_FORFEITS_ENABLED: "false",
      KEEPER_FEEDBACK_BONUS_FORFEITS_PER_TICK: "7",
      KEEPER_FEEDBACK_BONUS_FORFEIT_MIN_AGE_SECONDS: "120",
    });

    expect(config.contracts.feedbackBonusEscrow).toBe(localFeedbackBonusEscrow);
    expect(config.feedbackBonusForfeits).toEqual({
      enabled: false,
      maxPoolsPerTick: 7,
      minAgeSeconds: 120,
    });
  });

  it("rejects invalid feedback bonus forfeit settings", async () => {
    await expect(
      loadKeeperConfig({
        KEEPER_FEEDBACK_BONUS_FORFEITS_ENABLED: "sometimes",
      }),
    ).rejects.toThrow(
      "KEEPER_FEEDBACK_BONUS_FORFEITS_ENABLED must be a boolean-like value",
    );

    await expect(
      loadKeeperConfig({
        FEEDBACK_BONUS_ESCROW_ADDRESS: "not-an-address",
      }),
    ).rejects.toThrow("FEEDBACK_BONUS_ESCROW_ADDRESS must be a valid address");
  });

  it("uses PORT as the hosted metrics port fallback and external bind", async () => {
    const { config } = await loadKeeperConfig({
      PORT: "8080",
      METRICS_AUTH_TOKEN: "0123456789abcdef",
    });

    expect(config.metricsPort).toBe(8080);
    expect(config.metricsBindAddress).toBe("0.0.0.0");
    expect(config.metricsAuthToken).toBe("0123456789abcdef");
  });

  it("lets METRICS_PORT override PORT", async () => {
    const { config } = await loadKeeperConfig({
      PORT: "8080",
      METRICS_PORT: "9091",
      METRICS_AUTH_TOKEN: "0123456789abcdef",
    });

    expect(config.metricsPort).toBe(9091);
    expect(config.metricsBindAddress).toBe("0.0.0.0");
  });

  it("requires metrics auth when hosted PORT exposes liveness externally", async () => {
    await expect(
      loadKeeperConfig({
        PORT: "8080",
      }),
    ).rejects.toThrow(
      "METRICS_AUTH_TOKEN (>= 16 chars) is required when METRICS_BIND_ADDRESS is non-loopback",
    );
  });

  it("rejects invalid hosted PORT fallbacks", async () => {
    await expect(
      loadKeeperConfig({
        PORT: "http",
      }),
    ).rejects.toThrow("PORT must be a positive integer");
  });

  it("defaults hosted file artifact publication to an external metrics bind", async () => {
    const { config } = await loadKeeperConfig({
      PORT: "8080",
      METRICS_AUTH_TOKEN: "0123456789abcdef",
      KEEPER_CORRELATION_SNAPSHOTS_ENABLED: "true",
      KEEPER_CORRELATION_SNAPSHOTS_MODE: "auto",
      KEEPER_CORRELATION_ARTIFACT_STORAGE: "file",
      KEEPER_CORRELATION_SNAPSHOT_PUBLIC_BASE_URL:
        "https://artifacts.example.com/rateloop/",
      PONDER_BASE_URL: "https://ponder.example.com",
      CLUSTER_PAYOUT_ORACLE_ADDRESS:
        "0x6666666666666666666666666666666666666666",
    });

    expect(config.metricsBindAddress).toBe("0.0.0.0");
    expect(config.metricsAuthToken).toBe("0123456789abcdef");
  });

  it("rejects hosted file artifact publication on a loopback metrics bind", async () => {
    await expect(
      loadKeeperConfig({
        PORT: "8080",
        METRICS_BIND_ADDRESS: "127.0.0.1",
        KEEPER_CORRELATION_SNAPSHOTS_ENABLED: "true",
        KEEPER_CORRELATION_SNAPSHOTS_MODE: "auto",
        KEEPER_CORRELATION_ARTIFACT_STORAGE: "file",
        KEEPER_CORRELATION_SNAPSHOT_PUBLIC_BASE_URL:
          "https://artifacts.example.com/rateloop/",
        PONDER_BASE_URL: "https://ponder.example.com",
        CLUSTER_PAYOUT_ORACLE_ADDRESS:
          "0x6666666666666666666666666666666666666666",
      }),
    ).rejects.toThrow(
      "METRICS_BIND_ADDRESS must be unset or non-loopback when auto correlation snapshots publish file artifacts",
    );
  });

  it("rejects hosted file artifact publication when metrics are disabled", async () => {
    await expect(
      loadKeeperConfig({
        PORT: "8080",
        METRICS_ENABLED: "false",
        METRICS_AUTH_TOKEN: "0123456789abcdef",
        KEEPER_CORRELATION_SNAPSHOTS_ENABLED: "true",
        KEEPER_CORRELATION_SNAPSHOTS_MODE: "auto",
        KEEPER_CORRELATION_ARTIFACT_STORAGE: "file",
        KEEPER_CORRELATION_SNAPSHOT_PUBLIC_BASE_URL:
          "https://artifacts.example.com/rateloop/",
        PONDER_BASE_URL: "https://ponder.example.com",
        CLUSTER_PAYOUT_ORACLE_ADDRESS:
          "0x6666666666666666666666666666666666666666",
      }),
    ).rejects.toThrow(
      "METRICS_ENABLED=true is required when auto correlation snapshots publish file artifacts",
    );
  });

  it("allows data-uri correlation artifacts on a loopback metrics bind", async () => {
    const { config } = await loadKeeperConfig({
      METRICS_BIND_ADDRESS: "127.0.0.1",
      KEEPER_CORRELATION_SNAPSHOTS_ENABLED: "true",
      KEEPER_CORRELATION_SNAPSHOTS_MODE: "auto",
      KEEPER_CORRELATION_ARTIFACT_STORAGE: "data-uri",
      PONDER_BASE_URL: "https://ponder.example.com",
      CLUSTER_PAYOUT_ORACLE_ADDRESS:
        "0x6666666666666666666666666666666666666666",
    });

    expect(config.metricsBindAddress).toBe("127.0.0.1");
    expect(config.correlationSnapshots.artifactStorage.mode).toBe("data-uri");
  });

  it("requires a metrics auth token for non-loopback binds", async () => {
    await expect(
      loadKeeperConfig({
        METRICS_BIND_ADDRESS: "0.0.0.0",
      }),
    ).rejects.toThrow(
      "METRICS_AUTH_TOKEN (>= 16 chars) is required when METRICS_BIND_ADDRESS is non-loopback",
    );
  });

  it("derives local contract addresses from shared deployment artifacts", async () => {
    const { config } = await loadKeeperConfig(
      {
        CHAIN_ID: "31337",
      },
      [
        "VOTING_ENGINE_ADDRESS",
        "CONTENT_REGISTRY_ADDRESS",
        "ADVISORY_VOTE_RECORDER_ADDRESS",
      ],
    );

    expect(config.contracts.votingEngine).toBe(LOCAL_VOTING_ENGINE);
    expect(config.contracts.contentRegistry).toBe(LOCAL_CONTENT_REGISTRY);
    expect(config.contracts.advisoryVoteRecorder).toBe(
      LOCAL_ADVISORY_VOTE_RECORDER,
    );
  });

  itWithWorldChainArtifacts(
    "derives World Chain mainnet contract addresses from shared deployment artifacts",
    async () => {
      const { config } = await loadKeeperConfig(
        {
          CHAIN_ID: "480",
        },
        [
          "VOTING_ENGINE_ADDRESS",
          "CONTENT_REGISTRY_ADDRESS",
          "ADVISORY_VOTE_RECORDER_ADDRESS",
        ],
      );

      expect(config.chainId).toBe(480);
      expect(config.chainName).toBe("World Chain");
      expect(config.contracts.votingEngine).toBe(
        chain480!.RoundVotingEngine.address,
      );
      expect(config.contracts.contentRegistry).toBe(
        chain480!.ContentRegistry.address,
      );
    },
  );

  it("derives World Chain Sepolia contract addresses from shared deployment artifacts", async () => {
    const { config } = await loadKeeperConfig(
      {
        CHAIN_ID: "4801",
      },
      [
        "VOTING_ENGINE_ADDRESS",
        "CONTENT_REGISTRY_ADDRESS",
        "ADVISORY_VOTE_RECORDER_ADDRESS",
      ],
    );

    expect(config.chainId).toBe(4801);
    expect(config.chainName).toBe("World Chain Sepolia");
    expect(config.contracts.votingEngine).toBe(
      chain4801!.RoundVotingEngine.address,
    );
    expect(config.contracts.contentRegistry).toBe(
      chain4801!.ContentRegistry.address,
    );
    expect(config.contracts.advisoryVoteRecorder).toBe(
      chain4801!.AdvisoryVoteRecorder.address,
    );
  });

  it("derives Base Sepolia contract addresses from shared deployment artifacts", async () => {
    const baseSepolia = requireBaseSepoliaDeployment();
    const { config } = await loadKeeperConfig(
      {
        CHAIN_ID: "84532",
        RPC_URL: "https://sepolia.base.org",
      },
      [
        "VOTING_ENGINE_ADDRESS",
        "CONTENT_REGISTRY_ADDRESS",
        "ADVISORY_VOTE_RECORDER_ADDRESS",
      ],
    );

    expect(config.chainId).toBe(84532);
    expect(config.chainName).toBe("Base Sepolia");
    expect(config.contracts.votingEngine).toBe(
      baseSepolia.RoundVotingEngine.address,
    );
    expect(config.contracts.contentRegistry).toBe(
      baseSepolia.ContentRegistry.address,
    );
    expect(config.contracts.advisoryVoteRecorder).toBe(
      baseSepolia.AdvisoryVoteRecorder.address,
    );
  });

  it("prefers local hardhat contract env values over shared deployment artifacts", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const localVotingEngine = "0x196dBCBb54b8ec4958c959D8949EBFE87aC2Aaaf";
    const localContentRegistry = "0x82Dc47734901ee7d4f4232f398752cB9Dd5dACcC";
    const localAdvisoryVoteRecorder =
      "0xaAaAaAaaAaAaAaaAaAAAAAAAAaaaAaAaAaaAaaAa";
    const { config } = await loadKeeperConfig({
      CHAIN_ID: "31337",
      VOTING_ENGINE_ADDRESS: localVotingEngine,
      CONTENT_REGISTRY_ADDRESS: localContentRegistry,
      ADVISORY_VOTE_RECORDER_ADDRESS: localAdvisoryVoteRecorder,
    });

    expect(config.contracts.votingEngine).toBe(localVotingEngine);
    expect(config.contracts.contentRegistry).toBe(localContentRegistry);
    expect(config.contracts.advisoryVoteRecorder).toBe(
      localAdvisoryVoteRecorder,
    );
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("Using VOTING_ENGINE_ADDRESS"),
    );
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("Using CONTENT_REGISTRY_ADDRESS"),
    );
  });

  itWithWorldChainArtifacts(
    "rejects stale live contract env values when shared deployment artifacts exist",
    async () => {
      await expect(
        loadKeeperConfig({
          CHAIN_ID: "480",
          VOTING_ENGINE_ADDRESS: "0x196dBCBb54b8ec4958c959D8949EBFE87aC2Aaaf",
          CONTENT_REGISTRY_ADDRESS:
            "0x82Dc47734901ee7d4f4232f398752cB9Dd5dACcC",
          ADVISORY_VOTE_RECORDER_ADDRESS:
            "0xaAaAaAaaAaAaAaaAaAAAAAAAAaaaAaAaAaaAaaAa",
        }),
      ).rejects.toThrow(
        "conflicts with RoundVotingEngine from shared deployment artifacts",
      );
    },
  );

  itWithWorldChainSepoliaFeedbackBonusEscrowArtifact(
    "rejects stale live FeedbackBonusEscrow env values when shared deployment artifacts exist",
    async () => {
      await expect(
        loadKeeperConfig(
          {
            CHAIN_ID: "4801",
            FEEDBACK_BONUS_ESCROW_ADDRESS:
              "0x7777777777777777777777777777777777777777",
          },
          [
            "VOTING_ENGINE_ADDRESS",
            "CONTENT_REGISTRY_ADDRESS",
            "ADVISORY_VOTE_RECORDER_ADDRESS",
          ],
        ),
      ).rejects.toThrow(
        "conflicts with FeedbackBonusEscrow from shared deployment artifacts",
      );
    },
  );

  it("rejects stale live ClusterPayoutOracle env values when shared deployment artifacts exist", async () => {
    requireBaseSepoliaDeployment();

    await expect(
      loadKeeperConfig(
        {
          CHAIN_ID: "84532",
          CLUSTER_PAYOUT_ORACLE_ADDRESS:
            "0x196dBCBb54b8ec4958c959D8949EBFE87aC2Aaaf",
        },
        [
          "VOTING_ENGINE_ADDRESS",
          "CONTENT_REGISTRY_ADDRESS",
          "ADVISORY_VOTE_RECORDER_ADDRESS",
        ],
      ),
    ).rejects.toThrow(
      "conflicts with ClusterPayoutOracle from shared deployment artifacts",
    );
  });

  it("rejects env-only live ClusterPayoutOracle addresses when correlation snapshots are enabled", async () => {
    requireBaseSepoliaDeployment();
    const getSharedDeploymentAddress: SharedDeploymentAddressResolver = (
      chainId,
      contractName,
    ) =>
      chainId === 84532 && contractName === "ClusterPayoutOracle"
        ? undefined
        : actualGetSharedDeploymentAddress(chainId, contractName);

    await expect(
      loadKeeperConfig(
        {
          CHAIN_ID: "84532",
          RPC_URL: "https://sepolia.base.org",
          KEEPER_CORRELATION_SNAPSHOTS_ENABLED: "true",
          KEEPER_CORRELATION_SNAPSHOTS_MODE: "file",
          KEEPER_CORRELATION_SNAPSHOT_ARTIFACT_PATH:
            "./correlation-snapshots.json",
          CLUSTER_PAYOUT_ORACLE_ADDRESS:
            "0x6666666666666666666666666666666666666666",
        },
        [
          "VOTING_ENGINE_ADDRESS",
          "CONTENT_REGISTRY_ADDRESS",
          "ADVISORY_VOTE_RECORDER_ADDRESS",
        ],
        getSharedDeploymentAddress,
      ),
    ).rejects.toThrow(
      "CLUSTER_PAYOUT_ORACLE_ADDRESS cannot be used as an env-only live override",
    );
  });

  it("rejects env-only live FeedbackBonusEscrow addresses when forfeits are enabled", async () => {
    requireBaseSepoliaDeployment();
    const getSharedDeploymentAddress: SharedDeploymentAddressResolver = (
      chainId,
      contractName,
    ) =>
      chainId === 84532 && contractName === "FeedbackBonusEscrow"
        ? undefined
        : actualGetSharedDeploymentAddress(chainId, contractName);

    await expect(
      loadKeeperConfig(
        {
          CHAIN_ID: "84532",
          RPC_URL: "https://sepolia.base.org",
          KEEPER_FEEDBACK_BONUS_FORFEITS_ENABLED: "true",
          FEEDBACK_BONUS_ESCROW_ADDRESS:
            "0x7777777777777777777777777777777777777777",
        },
        [
          "VOTING_ENGINE_ADDRESS",
          "CONTENT_REGISTRY_ADDRESS",
          "ADVISORY_VOTE_RECORDER_ADDRESS",
        ],
        getSharedDeploymentAddress,
      ),
    ).rejects.toThrow(
      "FEEDBACK_BONUS_ESCROW_ADDRESS cannot be used as an env-only live override",
    );
  });

  it("rejects live env-only contract addresses when no shared deployment artifact exists for the chain", async () => {
    await expect(
      loadKeeperConfig({
        CHAIN_ID: "999999",
        VOTING_ENGINE_ADDRESS: "0x196dBCBb54b8ec4958c959D8949EBFE87aC2Aaaf",
        CONTENT_REGISTRY_ADDRESS: "0x82Dc47734901ee7d4f4232f398752cB9Dd5dACcC",
        ADVISORY_VOTE_RECORDER_ADDRESS:
          "0xaAaAaAaaAaAaAaaAaAAAAAAAAaaaAaAaAaaAaaAa",
      }),
    ).rejects.toThrow(
      "Missing shared deployment artifact for RoundVotingEngine on chain 999999",
    );
  });

  it("loads hosted frontend fee sweep settings from the environment", async () => {
    const { config } = await loadKeeperConfig({
      KEEPER_FRONTEND_FEE_ENABLED: "true",
      KEEPER_FRONTEND_ADDRESS: "0x7777777777777777777777777777777777777777",
      KEEPER_FRONTEND_FEE_LOOKBACK_ROUNDS: "12",
      KEEPER_FRONTEND_FEE_RECENT_ROUNDS_PER_TICK: "7",
      KEEPER_FRONTEND_FEE_BACKFILL_ROUNDS_PER_TICK: "9",
      KEEPER_FRONTEND_FEE_WITHDRAW: "false",
    });

    expect(config.frontendFees).toEqual(
      expect.objectContaining({
        enabled: true,
        frontendAddress: "0x7777777777777777777777777777777777777777",
        lookbackRounds: 12,
        recentRoundsPerTick: 7,
        backfillRoundsPerTick: 9,
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
      CLUSTER_PAYOUT_ORACLE_ADDRESS:
        "0x6666666666666666666666666666666666666666",
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
          // outputDir is resolved to an absolute path so the writer and metrics
          // reader agree regardless of process CWD; the default string is unchanged.
          outputDir: path.resolve("correlation-artifacts"),
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
      KEEPER_CORRELATION_SNAPSHOT_PUBLIC_BASE_URL:
        "https://artifacts.example.com/rateloop/",
      KEEPER_CORRELATION_SNAPSHOT_STORAGE_DIR: "/tmp/rateloop-correlation",
      KEEPER_CORRELATION_SNAPSHOT_MAX_ROUNDS_PER_TICK: "7",
      PORT: "8080",
      METRICS_AUTH_TOKEN: "0123456789abcdef",
      PONDER_BASE_URL: "https://ponder.example.com",
      CLUSTER_PAYOUT_ORACLE_ADDRESS:
        "0x6666666666666666666666666666666666666666",
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
          CLUSTER_PAYOUT_ORACLE_ADDRESS:
            "0x6666666666666666666666666666666666666666",
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
          CLUSTER_PAYOUT_ORACLE_ADDRESS:
            "0x6666666666666666666666666666666666666666",
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
        KEEPER_CORRELATION_SNAPSHOT_PUBLIC_BASE_URL:
          "http://artifacts.example.com/rateloop/",
        PONDER_BASE_URL: "https://ponder.example.com",
        CLUSTER_PAYOUT_ORACLE_ADDRESS:
          "0x6666666666666666666666666666666666666666",
      }),
    ).rejects.toThrow(
      "KEEPER_CORRELATION_SNAPSHOT_PUBLIC_BASE_URL must be an HTTPS URL when auto correlation snapshots use file artifact storage",
    );
  });
});
