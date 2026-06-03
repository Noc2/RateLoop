import path from "node:path";
import { getSharedDeploymentAddress as getSharedArtifactAddress } from "@rateloop/contracts/deployments";
import { config as loadDotenv } from "dotenv";
import { isAddress } from "viem";

loadDotenv({ path: ".env.local", override: false });
loadDotenv();

const CHAIN_NAMES: Record<number, string> = {
  31337: "Foundry",
  4801: "World Chain Sepolia",
  480: "World Chain",
};

const LOCAL_HARDHAT_CHAIN_ID = 31337;
const isProduction = process.env.NODE_ENV === "production";
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const CORRELATION_SNAPSHOT_MODES = ["file", "auto"] as const;
const CORRELATION_ARTIFACT_STORAGE_MODES = ["file", "data-uri"] as const;

function readEnv(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
}

function parseBooleanEnv(
  value: string | undefined,
  fallback: boolean,
  label: string,
): boolean {
  if (value === undefined) {
    return fallback;
  }

  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;

  throw new Error(`${label} must be a boolean-like value`);
}

function requireUrlEnv(name: string, errors: string[]): string {
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
    if (isProduction && options.requireHttpsInProduction && url.protocol !== "https:") {
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
    return ZERO_ADDRESS;
  }

  if (!isAddress(value)) {
    errors.push(`${name} must be a valid address`);
    return ZERO_ADDRESS;
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

function resolveOptionalContractAddress(params: {
  chainId: number;
  envName: string;
  contractName: string;
  errors: string[];
  warnings: string[];
}): `0x${string}` {
  const { chainId, envName, contractName, errors, warnings } = params;
  const sharedAddress = getSharedArtifactAddress(chainId, contractName);
  const envValue = readEnv(envName);

  if (envValue) {
    if (!isAddress(envValue)) {
      errors.push(`${envName} must be a valid address`);
      return ZERO_ADDRESS;
    }
    if (
      sharedAddress &&
      envValue.toLowerCase() !== sharedAddress.toLowerCase()
    ) {
      warnings.push(
        `Using ${envName}=${envValue}; shared ${contractName} artifact points at ${sharedAddress}.`,
      );
    }
    return envValue as `0x${string}`;
  }

  return (sharedAddress as `0x${string}` | undefined) ?? ZERO_ADDRESS;
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
        return ZERO_ADDRESS;
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
        return ZERO_ADDRESS;
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
  return ZERO_ADDRESS;
}

function loadConfig() {
  const errors: string[] = [];
  const warnings: string[] = [];
  const chainId = requireIntEnv("CHAIN_ID", errors);
  const keystoreAccount = readEnv("KEYSTORE_ACCOUNT");
  const privateKey = readEnv("KEEPER_PRIVATE_KEY") as `0x${string}` | undefined;
  const frontendFeeEnabled = parseBooleanEnv(
    readEnv("KEEPER_FRONTEND_FEE_ENABLED"),
    false,
    "KEEPER_FRONTEND_FEE_ENABLED",
  );
  const correlationSnapshotsEnabled = parseBooleanEnv(
    readEnv("KEEPER_CORRELATION_SNAPSHOTS_ENABLED"),
    false,
    "KEEPER_CORRELATION_SNAPSHOTS_ENABLED",
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
  const keeperDatabaseUrl = readOptionalPostgresUrlEnv(
    "KEEPER_DATABASE_URL",
    errors,
  );
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

  const loadedConfig = {
    // Network
    rpcUrl: requireUrlEnv("RPC_URL", errors),
    chainId,
    chainName: CHAIN_NAMES[chainId] || readEnv("CHAIN_NAME") || `Chain ${chainId}`,

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
    persistence: {
      databaseUrl: keeperDatabaseUrl ?? null,
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

    // Tuning
    dormancyPeriod: readPositiveBigIntEnv(
      "DORMANCY_PERIOD",
      String(30 * 24 * 60 * 60),
      errors,
    ),
    minGasBalanceWei: readNonNegativeBigIntStringEnv(
      "MIN_GAS_BALANCE_WEI",
      "10000000000000000",
      errors,
    ), // 0.01 ETH
    maxGasPerTx: readPositiveIntEnv("MAX_GAS_PER_TX", "2000000", errors),

    // Monitoring
    metricsPort: readPositiveIntEnv("METRICS_PORT", "9090", errors),
    metricsBindAddress: readEnv("METRICS_BIND_ADDRESS") || "127.0.0.1",
    // KEEPER-2 (2026-05-21 repo audit): required when METRICS_BIND_ADDRESS is non-loopback.
    // Bearer-checked on every /metrics and /health request.
    metricsAuthToken: readEnv("METRICS_AUTH_TOKEN") || null,
    metricsEnabled: parseBooleanEnv(
      readEnv("METRICS_ENABLED"),
      true,
      "METRICS_ENABLED",
    ),

    // Logging
    logFormat: (process.env.LOG_FORMAT || "json") as "json" | "text",

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
    if (correlationSnapshotMode === "file" && !correlationSnapshotArtifactPath) {
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
      correlationSnapshotMode === "auto" &&
      correlationSnapshotArtifactStorageMode === "data-uri" &&
      isProduction
    ) {
      errors.push(
        "KEEPER_CORRELATION_ARTIFACT_STORAGE=data-uri must not be used in production",
      );
    }
    if (loadedConfig.contracts.clusterPayoutOracle === ZERO_ADDRESS) {
      errors.push(
        "CLUSTER_PAYOUT_ORACLE_ADDRESS or a shared ClusterPayoutOracle deployment artifact is required when KEEPER_CORRELATION_SNAPSHOTS_ENABLED=true",
      );
    }
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
