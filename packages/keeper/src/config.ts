import path from "node:path";
import { getSharedDeploymentAddress as getSharedArtifactAddress } from "@rateloop/contracts/deployments";
import { config as loadDotenv } from "dotenv";
import { isAddress, zeroAddress } from "viem";

loadDotenv({ path: ".env.local", override: false });
loadDotenv();

const CHAIN_NAMES: Record<number, string> = {
  31337: "Foundry",
  84532: "Base Sepolia",
  8453: "Base",
  4801: "World Chain Sepolia",
  480: "World Chain",
};

const LOCAL_HARDHAT_CHAIN_ID = 31337;
const BASE_MAINNET_CHAIN_ID = 8453;
// ContentRegistry gates markDormant on its internal constant `DORMANCY_PERIOD = 30 days`
// (and on `dormancyAnchorAt`, which has no public view). The constant is not exposed
// on-chain either, so it cannot be read at runtime: a keeper-side period below 30 days
// can only produce guaranteed "Dormancy period not elapsed" reverts. Keep this constant
// in sync with packages/foundry/contracts/ContentRegistry.sol.
const CONTRACT_DORMANCY_PERIOD_S = 30n * 24n * 60n * 60n;
const isProduction = process.env.NODE_ENV === "production";
const CORRELATION_SNAPSHOT_MODES = ["file", "auto"] as const;
const CORRELATION_ARTIFACT_STORAGE_MODES = ["file", "data-uri"] as const;
const LOG_FORMATS = ["json", "text"] as const;
const LOOPBACK_BIND_ADDRESSES = new Set(["127.0.0.1", "::1", "localhost"]);
const PRIVATE_KEY_PATTERN = /^0x[0-9a-fA-F]{64}$/;

function readEnv(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
}

function parseBooleanEnv(
  value: string | undefined,
  fallback: boolean,
  label: string,
  errors: string[],
): boolean {
  if (value === undefined) {
    return fallback;
  }

  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;

  errors.push(`${label} must be a boolean-like value`);
  return fallback;
}

function requireUrlEnv(
  name: string,
  errors: string[],
  options: { requireHttps?: boolean } = {},
): string {
  const value = readEnv(name);
  if (!value) {
    errors.push(`${name} is required`);
    return "";
  }

  try {
    const url = new URL(value);
    const isLocalhost =
      url.hostname === "localhost" ||
      url.hostname === "127.0.0.1" ||
      url.hostname === "::1";

    if (isProduction && isLocalhost) {
      errors.push(`${name} must not point to localhost in production`);
    }
    if (options.requireHttps && url.protocol !== "https:") {
      errors.push(`${name} must use HTTPS`);
    }
  } catch {
    errors.push(`${name} must be a valid URL`);
  }

  return value;
}

function readOptionalUrlEnv(
  name: string,
  errors: string[],
  options: {
    rejectLocalhostInProduction?: boolean;
    requireHttpsInProduction?: boolean;
  } = {},
): string | undefined {
  const value = readEnv(name);
  if (!value) return undefined;

  try {
    const url = new URL(value);
    const isLocalhost =
      url.hostname === "localhost" ||
      url.hostname === "127.0.0.1" ||
      url.hostname === "::1";
    if (isProduction && options.rejectLocalhostInProduction && isLocalhost) {
      errors.push(`${name} must not point to localhost in production`);
    }
    if (
      isProduction &&
      options.requireHttpsInProduction &&
      url.protocol !== "https:"
    ) {
      errors.push(`${name} must be an HTTPS URL in production`);
    }
  } catch {
    errors.push(`${name} must be a valid URL when provided`);
    return undefined;
  }

  return value.replace(/\/+$/, "");
}

function readOptionalPostgresUrlEnv(
  name: string,
  errors: string[],
): string | undefined {
  const value = readEnv(name);
  if (!value) return undefined;

  try {
    const url = new URL(value);
    if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") {
      errors.push(`${name} must use the postgres:// or postgresql:// scheme`);
    }
    if (!url.hostname || !url.pathname || url.pathname === "/") {
      errors.push(`${name} must include a host and database name`);
    }
  } catch {
    errors.push(`${name} must be a valid PostgreSQL URL when provided`);
    return undefined;
  }

  return value;
}

function readEnumEnv<const T extends readonly string[]>(
  name: string,
  values: T,
  fallback: T[number],
  errors: string[],
): T[number] {
  const value = readEnv(name);
  if (!value) return fallback;
  if (values.includes(value)) return value;

  errors.push(`${name} must be one of: ${values.join(", ")}`);
  return fallback;
}

function readOptionalPrivateKeyEnv(name: string, errors: string[]): `0x${string}` | undefined {
  const value = readEnv(name);
  if (!value) return undefined;
  if (!PRIVATE_KEY_PATTERN.test(value)) {
    errors.push(`${name} must be a 0x-prefixed 32-byte hex private key`);
    return undefined;
  }
  return value as `0x${string}`;
}

function requireIntEnv(name: string, errors: string[]): number {
  const value = readEnv(name);
  if (!value) {
    errors.push(`${name} is required`);
    return 0;
  }

  return parseIntegerEnv(name, value, "positive", 0, errors);
}

function readPositiveIntEnv(
  name: string,
  fallback: string,
  errors: string[],
): number {
  const value = readEnv(name) || fallback;
  return parseIntegerEnv(name, value, "positive", Number(fallback), errors);
}

function readPositiveIntEnvWithOptionalEnvFallback(
  name: string,
  fallbackEnvName: string,
  fallback: string,
  errors: string[],
): number {
  const value = readEnv(name);
  if (value)
    return parseIntegerEnv(name, value, "positive", Number(fallback), errors);

  const fallbackEnvValue = readEnv(fallbackEnvName);
  if (fallbackEnvValue) {
    return parseIntegerEnv(
      fallbackEnvName,
      fallbackEnvValue,
      "positive",
      Number(fallback),
      errors,
    );
  }

  return parseIntegerEnv(name, fallback, "positive", Number(fallback), errors);
}

function readNonNegativeIntEnv(
  name: string,
  fallback: string,
  errors: string[],
): number {
  const value = readEnv(name) || fallback;
  return parseIntegerEnv(name, value, "non-negative", Number(fallback), errors);
}

function parseIntegerEnv(
  name: string,
  value: string,
  kind: "positive" | "non-negative",
  fallback: number,
  errors: string[],
): number {
  const parsed = Number(value);
  const isValidInteger = /^\d+$/.test(value) && Number.isSafeInteger(parsed);
  const isValidRange = kind === "positive" ? parsed > 0 : parsed >= 0;

  if (!isValidInteger || !isValidRange) {
    errors.push(`${name} must be a ${kind} integer`);
    return fallback;
  }

  return parsed;
}

function readPositiveBigIntEnv(
  name: string,
  fallback: string,
  errors: string[],
): bigint {
  return BigInt(readBigIntStringEnv(name, fallback, "positive", errors));
}

function readNonNegativeBigIntStringEnv(
  name: string,
  fallback: string,
  errors: string[],
): string {
  return readBigIntStringEnv(name, fallback, "non-negative", errors);
}

function readBigIntStringEnv(
  name: string,
  fallback: string,
  kind: "positive" | "non-negative",
  errors: string[],
): string {
  const value = readEnv(name) || fallback;
  const isValidInteger = /^\d+$/.test(value);
  const parsed = isValidInteger ? BigInt(value) : null;
  const isValidRange =
    parsed !== null && (kind === "positive" ? parsed > 0n : parsed >= 0n);

  if (!isValidInteger || !isValidRange) {
    errors.push(`${name} must be a ${kind} integer`);
    return fallback;
  }

  return value;
}

function requireAddressEnv(name: string, errors: string[]): `0x${string}` {
  const value = readEnv(name);
  if (!value) {
    errors.push(`${name} is required`);
    return zeroAddress;
  }

  if (!isAddress(value)) {
    errors.push(`${name} must be a valid address`);
    return zeroAddress;
  }

  return value as `0x${string}`;
}

function readOptionalAddressEnv(
  name: string,
  errors: string[],
): `0x${string}` | undefined {
  const value = readEnv(name);
  if (!value) {
    return undefined;
  }

  if (!isAddress(value)) {
    errors.push(`${name} must be a valid address`);
    return undefined;
  }

  return value as `0x${string}`;
}

function isLoopbackBindAddress(value: string): boolean {
  return LOOPBACK_BIND_ADDRESSES.has(value) || value.startsWith("127.");
}

function resolveOptionalContractAddress(params: {
  chainId: number;
  envName: string;
  contractName: string;
  errors: string[];
  warnings: string[];
  rejectLiveMismatch?: boolean;
  requireSharedArtifact?: boolean;
}): `0x${string}` {
  const {
    chainId,
    envName,
    contractName,
    errors,
    warnings,
    rejectLiveMismatch,
    requireSharedArtifact,
  } = params;
  const sharedAddress = getSharedArtifactAddress(chainId, contractName);
  const envValue = readEnv(envName);

  if (
    requireSharedArtifact &&
    chainId !== LOCAL_HARDHAT_CHAIN_ID &&
    !sharedAddress
  ) {
    if (envValue && !isAddress(envValue)) {
      errors.push(`${envName} must be a valid address`);
    }
    errors.push(
      `Missing shared deployment artifact for ${contractName} on chain ${chainId}; ${envName} cannot be used as an env-only live override when the related keeper feature is enabled. Refresh @rateloop/contracts deployedContracts.ts or disable the feature.`,
    );
    return zeroAddress;
  }

  if (envValue) {
    if (!isAddress(envValue)) {
      errors.push(`${envName} must be a valid address`);
      return zeroAddress;
    }
    if (
      sharedAddress &&
      envValue.toLowerCase() !== sharedAddress.toLowerCase()
    ) {
      const message =
        `${envName}=${envValue} conflicts with ${contractName} from shared deployment artifacts ` +
        `(${sharedAddress}) for chain ${chainId}.`;
      if (rejectLiveMismatch && chainId !== LOCAL_HARDHAT_CHAIN_ID) {
        errors.push(
          `${message} Remove the env override or refresh shared deployments.`,
        );
      } else {
        warnings.push(
          `Using ${envName}=${envValue}; shared ${contractName} artifact points at ${sharedAddress}.`,
        );
      }
    }
    return envValue as `0x${string}`;
  }

  return (sharedAddress as `0x${string}` | undefined) ?? zeroAddress;
}

function resolveContractAddress(params: {
  chainId: number;
  envName: string;
  contractName: string;
  errors: string[];
  warnings: string[];
}): `0x${string}` {
  const { chainId, envName, contractName, errors, warnings } = params;
  const sharedAddress = getSharedArtifactAddress(chainId, contractName);
  const envValue = readEnv(envName);

  if (chainId === LOCAL_HARDHAT_CHAIN_ID) {
    if (envValue) {
      if (!isAddress(envValue)) {
        errors.push(`${envName} must be a valid address`);
        return zeroAddress;
      }

      if (
        sharedAddress &&
        envValue.toLowerCase() !== sharedAddress.toLowerCase()
      ) {
        warnings.push(
          `Using ${envName}=${envValue} for local chain ${chainId}; shared ${contractName} artifact points at ${sharedAddress}.`,
        );
      }

      return envValue as `0x${string}`;
    }

    if (sharedAddress) {
      return sharedAddress;
    }

    return requireAddressEnv(envName, errors);
  }

  if (sharedAddress) {
    if (envValue) {
      if (!isAddress(envValue)) {
        errors.push(
          `${envName} must be a valid address when provided for chain ${chainId}`,
        );
        return zeroAddress;
      }

      if (envValue.toLowerCase() !== sharedAddress.toLowerCase()) {
        errors.push(
          `${envName}=${envValue} conflicts with ${contractName} from shared deployment artifacts (${sharedAddress}) for chain ${chainId}. Remove the env override or refresh shared deployments.`,
        );
      }
    }

    return sharedAddress;
  }

  if (envValue && !isAddress(envValue)) {
    errors.push(
      `${envName} must be a valid address when provided for chain ${chainId}`,
    );
  }
  errors.push(
    `Missing shared deployment artifact for ${contractName} on chain ${chainId}. Refresh @rateloop/contracts deployedContracts.ts before starting the keeper for live networks.`,
  );
  return zeroAddress;
}

function loadConfig() {
  const errors: string[] = [];
  const warnings: string[] = [];
  const chainId = requireIntEnv("CHAIN_ID", errors);
  if (chainId === BASE_MAINNET_CHAIN_ID && !isProduction) {
    errors.push("NODE_ENV=production is required when CHAIN_ID=8453");
  }
  const keystoreAccount = readEnv("KEYSTORE_ACCOUNT");
  const privateKey = readOptionalPrivateKeyEnv("KEEPER_PRIVATE_KEY", errors);
  const frontendFeeEnabled = parseBooleanEnv(
    readEnv("KEEPER_FRONTEND_FEE_ENABLED"),
    false,
    "KEEPER_FRONTEND_FEE_ENABLED",
    errors,
  );
  const feedbackBonusForfeitsEnabled = parseBooleanEnv(
    readEnv("KEEPER_FEEDBACK_BONUS_FORFEITS_ENABLED"),
    true,
    "KEEPER_FEEDBACK_BONUS_FORFEITS_ENABLED",
    errors,
  );
  const correlationSnapshotsEnabled = parseBooleanEnv(
    readEnv("KEEPER_CORRELATION_SNAPSHOTS_ENABLED"),
    false,
    "KEEPER_CORRELATION_SNAPSHOTS_ENABLED",
    errors,
  );
  const correlationSnapshotArtifactPath = readEnv(
    "KEEPER_CORRELATION_SNAPSHOT_ARTIFACT_PATH",
  );
  const correlationSnapshotMode = readEnumEnv(
    "KEEPER_CORRELATION_SNAPSHOTS_MODE",
    CORRELATION_SNAPSHOT_MODES,
    correlationSnapshotArtifactPath ? "file" : "auto",
    errors,
  );
  const correlationSnapshotArtifactStorageMode = readEnumEnv(
    "KEEPER_CORRELATION_ARTIFACT_STORAGE",
    CORRELATION_ARTIFACT_STORAGE_MODES,
    chainId === LOCAL_HARDHAT_CHAIN_ID ? "data-uri" : "file",
    errors,
  );
  const correlationSnapshotArtifactPublicBaseUrl = readOptionalUrlEnv(
    "KEEPER_CORRELATION_SNAPSHOT_PUBLIC_BASE_URL",
    errors,
  );
  const hostedPort = readEnv("PORT");
  const metricsPort = readPositiveIntEnvWithOptionalEnvFallback(
    "METRICS_PORT",
    "PORT",
    "9090",
    errors,
  );
  const shouldUseHostedBind = Boolean(hostedPort);
  const publishesPublicFileArtifacts =
    correlationSnapshotsEnabled &&
    correlationSnapshotMode === "auto" &&
    correlationSnapshotArtifactStorageMode === "file" &&
    Boolean(correlationSnapshotArtifactPublicBaseUrl);
  const metricsBindAddress =
    readEnv("METRICS_BIND_ADDRESS") ||
    (shouldUseHostedBind ? "0.0.0.0" : "127.0.0.1");
  const metricsAuthToken = readEnv("METRICS_AUTH_TOKEN") || null;
  const keeperDatabaseUrl = readOptionalPostgresUrlEnv(
    "KEEPER_DATABASE_URL",
    errors,
  );
  const mainLoopLockRequired = parseBooleanEnv(
    readEnv("KEEPER_MAIN_LOOP_LOCK_REQUIRED"),
    isProduction,
    "KEEPER_MAIN_LOOP_LOCK_REQUIRED",
    errors,
  );
  const correlationSnapshotLockRequired = correlationSnapshotsEnabled
    ? parseBooleanEnv(
        readEnv("KEEPER_CORRELATION_SNAPSHOT_LOCK_REQUIRED"),
        isProduction,
        "KEEPER_CORRELATION_SNAPSHOT_LOCK_REQUIRED",
        errors,
      )
    : false;
  const ponderBaseUrl = readOptionalUrlEnv("PONDER_BASE_URL", errors, {
    rejectLocalhostInProduction: true,
    requireHttpsInProduction: true,
  });

  if (!keystoreAccount && !privateKey) {
    errors.push("KEYSTORE_ACCOUNT or KEEPER_PRIVATE_KEY is required");
  }

  if (keystoreAccount && !privateKey && !readEnv("KEYSTORE_PASSWORD")) {
    errors.push(
      "KEYSTORE_PASSWORD is required when KEYSTORE_ACCOUNT is configured without KEEPER_PRIVATE_KEY",
    );
  }
  if (!readEnv("PONDER_BASE_URL")) {
    errors.push("PONDER_BASE_URL is required");
  }
  if (isProduction && !readEnv("PONDER_KEEPER_WORK_TOKEN")?.trim()) {
    errors.push("PONDER_KEEPER_WORK_TOKEN is required in production");
  }

  const frontendFeeContracts =
    frontendFeeEnabled && chainId > 0
      ? {
          roundRewardDistributor: resolveContractAddress({
            chainId,
            envName: "ROUND_REWARD_DISTRIBUTOR_ADDRESS",
            contractName: "RoundRewardDistributor",
            errors,
            warnings,
          }),
          frontendRegistry: resolveContractAddress({
            chainId,
            envName: "FRONTEND_REGISTRY_ADDRESS",
            contractName: "FrontendRegistry",
            errors,
            warnings,
          }),
        }
      : null;
  const correlationSnapshotFrontendRegistry =
    correlationSnapshotsEnabled && chainId > 0
      ? resolveContractAddress({
          chainId,
          envName: "FRONTEND_REGISTRY_ADDRESS",
          contractName: "FrontendRegistry",
          errors,
          warnings,
        })
      : undefined;

  const configuredDormancyPeriod = readPositiveBigIntEnv(
    "DORMANCY_PERIOD",
    String(CONTRACT_DORMANCY_PERIOD_S),
    errors,
  );
  if (configuredDormancyPeriod < CONTRACT_DORMANCY_PERIOD_S) {
    warnings.push(
      `DORMANCY_PERIOD=${configuredDormancyPeriod}s is below the on-chain ContentRegistry.DORMANCY_PERIOD ` +
        `(${CONTRACT_DORMANCY_PERIOD_S}s = 30 days); markDormant would always revert with ` +
        `"Dormancy period not elapsed". Clamping to ${CONTRACT_DORMANCY_PERIOD_S}s.`,
    );
  }

  const loadedConfig = {
    // Network
    rpcUrl: requireUrlEnv("RPC_URL", errors, {
      requireHttps: chainId !== LOCAL_HARDHAT_CHAIN_ID,
    }),
    chainId,
    chainName:
      CHAIN_NAMES[chainId] || readEnv("CHAIN_NAME") || `Chain ${chainId}`,

    // Contracts
    contracts: {
      votingEngine: resolveContractAddress({
        chainId,
        envName: "VOTING_ENGINE_ADDRESS",
        contractName: "RoundVotingEngine",
        errors,
        warnings,
      }),
      contentRegistry: resolveContractAddress({
        chainId,
        envName: "CONTENT_REGISTRY_ADDRESS",
        contractName: "ContentRegistry",
        errors,
        warnings,
      }),
      feedbackRegistry: resolveContractAddress({
        chainId,
        envName: "FEEDBACK_REGISTRY_ADDRESS",
        contractName: "FeedbackRegistry",
        errors,
        warnings,
      }),
      advisoryVoteRecorder: resolveContractAddress({
        chainId,
        envName: "ADVISORY_VOTE_RECORDER_ADDRESS",
        contractName: "AdvisoryVoteRecorder",
        errors,
        warnings,
      }),
      clusterPayoutOracle: resolveOptionalContractAddress({
        chainId,
        envName: "CLUSTER_PAYOUT_ORACLE_ADDRESS",
        contractName: "ClusterPayoutOracle",
        errors,
        warnings,
        rejectLiveMismatch: true,
        requireSharedArtifact: correlationSnapshotsEnabled,
      }),
      feedbackBonusEscrow: resolveOptionalContractAddress({
        chainId,
        envName: "FEEDBACK_BONUS_ESCROW_ADDRESS",
        contractName: "FeedbackBonusEscrow",
        errors,
        warnings,
        rejectLiveMismatch: true,
        requireSharedArtifact: feedbackBonusForfeitsEnabled,
      }),
    },

    // Wallet
    keystoreAccount,
    // H-8 (2026-05-22 audit): the password used to live on the long-running config
    // object, so any future JSON.stringify(config) (diagnostics, crash dump, telemetry)
    // would leak it. keystore.ts reads process.env.KEYSTORE_PASSWORD directly when
    // decrypting, so the config object no longer needs to carry it at all.
    privateKey,

    // Keeper behavior
    intervalMs: readPositiveIntEnv("KEEPER_INTERVAL_MS", "30000", errors),
    ponderBaseUrl,
    // Work discovery: Ponder `/keeper/work` on most ticks; full chain enumeration on
    // reconciliation ticks. See packages/keeper/README.md for liveness bounds.
    keeperWorkDiscovery: (() => {
      const maxCandidates = readPositiveIntEnv(
        "KEEPER_WORK_DISCOVERY_MAX_CANDIDATES",
        "500",
        errors,
      );
      const reconciliationEveryTicks = readPositiveIntEnv(
        "KEEPER_WORK_DISCOVERY_RECONCILE_EVERY_TICKS",
        "120",
        errors,
      );
      const defaultChainScanPerTick = String(
        Math.max(10, Math.ceil(maxCandidates / reconciliationEveryTicks)),
      );
      return {
        enabled: parseBooleanEnv(
          readEnv("KEEPER_WORK_DISCOVERY_PONDER_ENABLED"),
          true,
          "KEEPER_WORK_DISCOVERY_PONDER_ENABLED",
          errors,
        ),
        reconciliationEveryTicks,
        maxCandidates,
        chainScanPerTick: readPositiveIntEnv(
          "KEEPER_WORK_DISCOVERY_CHAIN_SCAN_PER_TICK",
          defaultChainScanPerTick,
          errors,
        ),
      };
    })(),
    proactiveRoundOpening: {
      enabled: parseBooleanEnv(
        readEnv("KEEPER_PROACTIVE_ROUND_OPENING_ENABLED"),
        false,
        "KEEPER_PROACTIVE_ROUND_OPENING_ENABLED",
        errors,
      ),
      maxPerTick: readNonNegativeIntEnv(
        "KEEPER_PROACTIVE_ROUND_OPENING_MAX_PER_TICK",
        "2",
        errors,
      ),
      recentSeconds: BigInt(readNonNegativeBigIntStringEnv(
        "KEEPER_PROACTIVE_ROUND_OPENING_RECENT_SECONDS",
        String(6n * 60n * 60n),
        errors,
      )),
    },
    rewardPoolQualifications: {
      enabled: parseBooleanEnv(
        readEnv("KEEPER_REWARD_POOL_QUALIFICATIONS_ENABLED"),
        true,
        "KEEPER_REWARD_POOL_QUALIFICATIONS_ENABLED",
        errors,
      ),
      maxRoundsPerTick: readNonNegativeIntEnv(
        "KEEPER_REWARD_POOL_QUALIFICATIONS_PER_TICK",
        "25",
        errors,
      ),
      maxBundleSyncsPerTick: readNonNegativeIntEnv(
        "KEEPER_BUNDLE_TERMINAL_SYNCS_PER_TICK",
        "10",
        errors,
      ),
      bundleMaxRoundsPerSync: readNonNegativeIntEnv(
        "KEEPER_BUNDLE_TERMINAL_SYNC_MAX_ROUNDS",
        "25",
        errors,
      ),
    },
    payoutFinality: {
      opsLagBudgetSeconds: readNonNegativeIntEnv(
        "KEEPER_PAYOUT_FINALITY_OPS_LAG_BUDGET_SECONDS",
        "900",
        errors,
      ),
      overlapProof: parseBooleanEnv(
        readEnv("KEEPER_PAYOUT_FINALITY_OVERLAP_PROOF"),
        false,
        "KEEPER_PAYOUT_FINALITY_OVERLAP_PROOF",
        errors,
      ),
    },
    feedbackBonusForfeits: {
      enabled: feedbackBonusForfeitsEnabled,
      maxPoolsPerTick: readNonNegativeIntEnv(
        "KEEPER_FEEDBACK_BONUS_FORFEITS_PER_TICK",
        "25",
        errors,
      ),
      minAgeSeconds: readNonNegativeIntEnv(
        "KEEPER_FEEDBACK_BONUS_FORFEIT_MIN_AGE_SECONDS",
        "60",
        errors,
      ),
    },
    persistence: {
      databaseUrl: keeperDatabaseUrl ?? null,
      mainLoopLockRequired,
      correlationSnapshotLockRequired,
    },
    startupJitterMs: readNonNegativeIntEnv(
      "KEEPER_STARTUP_JITTER_MS",
      "0",
      errors,
    ),
    cleanupBatchSize: readPositiveIntEnv(
      "KEEPER_CLEANUP_BATCH_SIZE",
      "25",
      errors,
    ),
    // How far back (in blocks) the eth_getLogs ciphertext fallback may scan when Ponder
    // is unavailable. Default covers ~7 days at 2s blocks; raise it for deployments that
    // configure round durations longer than that.
    logFallbackLookbackBlocks: readPositiveIntEnv(
      "KEEPER_LOG_FALLBACK_LOOKBACK_BLOCKS",
      "300000",
      errors,
    ),

    // Tuning
    dormancyPeriod:
      configuredDormancyPeriod < CONTRACT_DORMANCY_PERIOD_S
        ? CONTRACT_DORMANCY_PERIOD_S
        : configuredDormancyPeriod,
    minGasBalanceWei: readNonNegativeBigIntStringEnv(
      "MIN_GAS_BALANCE_WEI",
      "10000000000000000",
      errors,
    ), // 0.01 ETH
    maxGasPerTx: readPositiveIntEnv("MAX_GAS_PER_TX", "2000000", errors),

    // Monitoring
    metricsPort,
    metricsBindAddress,
    // KEEPER-2 (2026-05-21 repo audit): required when METRICS_BIND_ADDRESS is non-loopback.
    // Bearer-checked on every /metrics and /health request.
    metricsAuthToken,
    metricsEnabled: parseBooleanEnv(
      readEnv("METRICS_ENABLED"),
      true,
      "METRICS_ENABLED",
      errors,
    ),

    // Logging
    logFormat: readEnumEnv("LOG_FORMAT", LOG_FORMATS, "json", errors),

    // Frontend-fee ops
    frontendFees: {
      enabled: frontendFeeEnabled,
      frontendAddress: readOptionalAddressEnv(
        "KEEPER_FRONTEND_ADDRESS",
        errors,
      ),
      lookbackRounds: readPositiveIntEnv(
        "KEEPER_FRONTEND_FEE_LOOKBACK_ROUNDS",
        "8",
        errors,
      ),
      recentRoundsPerTick: readNonNegativeIntEnv(
        "KEEPER_FRONTEND_FEE_RECENT_ROUNDS_PER_TICK",
        "50",
        errors,
      ),
      backfillRoundsPerTick: readNonNegativeIntEnv(
        "KEEPER_FRONTEND_FEE_BACKFILL_ROUNDS_PER_TICK",
        "50",
        errors,
      ),
      withdrawEnabled: parseBooleanEnv(
        readEnv("KEEPER_FRONTEND_FEE_WITHDRAW"),
        true,
        "KEEPER_FRONTEND_FEE_WITHDRAW",
        errors,
      ),
      contracts: frontendFeeContracts,
    },

    // Correlation snapshot publication
    correlationSnapshots: {
      enabled: correlationSnapshotsEnabled,
      mode: correlationSnapshotMode,
      artifactPath: correlationSnapshotArtifactPath,
      frontendRegistry: correlationSnapshotFrontendRegistry,
      maxRoundsPerTick: readPositiveIntEnv(
        "KEEPER_CORRELATION_SNAPSHOT_MAX_ROUNDS_PER_TICK",
        "20",
        errors,
      ),
      artifactStorage: {
        mode: correlationSnapshotArtifactStorageMode,
        // Resolve to an absolute path here so the writer
        // (correlation-artifact-storage.ts) and the metrics reader (metrics.ts)
        // always agree on the same directory regardless of the process launch
        // CWD. The configured value / default string is unchanged.
        outputDir: path.resolve(
          readEnv("KEEPER_CORRELATION_SNAPSHOT_STORAGE_DIR") ||
            "correlation-artifacts",
        ),
        publicBaseUrl: correlationSnapshotArtifactPublicBaseUrl || "",
      },
    },
  };

  if (correlationSnapshotsEnabled) {
    if (isProduction && !keeperDatabaseUrl) {
      errors.push("KEEPER_DATABASE_URL is required in production");
    }
    if (
      correlationSnapshotMode === "file" &&
      !correlationSnapshotArtifactPath
    ) {
      errors.push(
        "KEEPER_CORRELATION_SNAPSHOT_ARTIFACT_PATH is required when KEEPER_CORRELATION_SNAPSHOTS_ENABLED=true and KEEPER_CORRELATION_SNAPSHOTS_MODE=file",
      );
    }
    if (correlationSnapshotMode === "auto" && !loadedConfig.ponderBaseUrl) {
      errors.push(
        "PONDER_BASE_URL is required when KEEPER_CORRELATION_SNAPSHOTS_ENABLED=true and KEEPER_CORRELATION_SNAPSHOTS_MODE=auto",
      );
    }
    if (
      correlationSnapshotMode === "auto" &&
      correlationSnapshotArtifactStorageMode === "file" &&
      !correlationSnapshotArtifactPublicBaseUrl
    ) {
      errors.push(
        "KEEPER_CORRELATION_SNAPSHOT_PUBLIC_BASE_URL is required when auto correlation snapshots use file artifact storage",
      );
    }
    if (
      correlationSnapshotMode === "auto" &&
      correlationSnapshotArtifactStorageMode === "file" &&
      correlationSnapshotArtifactPublicBaseUrl &&
      !correlationSnapshotArtifactPublicBaseUrl.startsWith("https://")
    ) {
      errors.push(
        "KEEPER_CORRELATION_SNAPSHOT_PUBLIC_BASE_URL must be an HTTPS URL when auto correlation snapshots use file artifact storage",
      );
    }
    if (
      publishesPublicFileArtifacts &&
      !loadedConfig.metricsEnabled
    ) {
      errors.push(
        "METRICS_ENABLED=true is required when auto correlation snapshots publish file artifacts",
      );
    }
    if (
      publishesPublicFileArtifacts &&
      isLoopbackBindAddress(loadedConfig.metricsBindAddress)
    ) {
      errors.push(
        "METRICS_BIND_ADDRESS must be unset or non-loopback when auto correlation snapshots publish file artifacts",
      );
    }
    if (
      correlationSnapshotMode === "auto" &&
      correlationSnapshotArtifactStorageMode === "data-uri" &&
      isProduction
    ) {
      errors.push(
        "KEEPER_CORRELATION_ARTIFACT_STORAGE=data-uri must not be used in production",
      );
    }
    if (loadedConfig.contracts.clusterPayoutOracle === zeroAddress) {
      errors.push(
        "CLUSTER_PAYOUT_ORACLE_ADDRESS or a shared ClusterPayoutOracle deployment artifact is required when KEEPER_CORRELATION_SNAPSHOTS_ENABLED=true",
      );
    }
  }
  if (mainLoopLockRequired && !keeperDatabaseUrl) {
    errors.push(
      "KEEPER_DATABASE_URL is required when KEEPER_MAIN_LOOP_LOCK_REQUIRED=true",
    );
  }
  if (correlationSnapshotLockRequired && !keeperDatabaseUrl) {
    errors.push(
      "KEEPER_DATABASE_URL is required when KEEPER_CORRELATION_SNAPSHOT_LOCK_REQUIRED=true",
    );
  }
  if (
    loadedConfig.metricsEnabled &&
    !isLoopbackBindAddress(loadedConfig.metricsBindAddress) &&
    (!loadedConfig.metricsAuthToken ||
      loadedConfig.metricsAuthToken.length < 16)
  ) {
    errors.push(
      "METRICS_AUTH_TOKEN (>= 16 chars) is required when METRICS_BIND_ADDRESS is non-loopback",
    );
  }

  if (errors.length > 0) {
    throw new Error(`Invalid keeper configuration:\n- ${errors.join("\n- ")}`);
  }

  for (const warning of warnings) {
    console.warn(`[keeper config] ${warning}`);
  }

  return loadedConfig;
}

export const config = loadConfig();
