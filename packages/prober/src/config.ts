import {
  getSharedDeploymentAddress as getSharedArtifactAddress,
  getSharedDeploymentStartBlock,
} from "@rateloop/contracts/deployments";
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
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const isProduction = process.env.NODE_ENV === "production";

function readEnv(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
}

function parseBooleanEnv(value: string | undefined, fallback: boolean, label: string): boolean {
  if (value === undefined) {
    return fallback;
  }

  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;

  throw new Error(`${label} must be a boolean-like value`);
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

function requireIntEnv(name: string, errors: string[]): number {
  const value = readEnv(name);
  if (!value) {
    errors.push(`${name} is required`);
    return 0;
  }

  return parseIntegerEnv(name, value, "positive", 0, errors);
}

function readPositiveIntEnv(name: string, fallback: string, errors: string[]): number {
  const value = readEnv(name) || fallback;
  return parseIntegerEnv(name, value, "positive", Number(fallback), errors);
}

function readNonNegativeIntEnv(name: string, fallback: string, errors: string[]): number {
  const value = readEnv(name) || fallback;
  return parseIntegerEnv(name, value, "non-negative", Number(fallback), errors);
}

function readNonNegativeBigIntStringEnv(name: string, fallback: string, errors: string[]): string {
  const value = readEnv(name) || fallback;
  const isValidInteger = /^\d+$/.test(value);
  const parsed = isValidInteger ? BigInt(value) : null;

  if (parsed === null || parsed < 0n) {
    errors.push(`${name} must be a non-negative integer`);
    return fallback;
  }

  return value;
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

function readOptionalAddressEnv(name: string, errors: string[]): `0x${string}` | undefined {
  const value = readEnv(name);
  if (!value) return undefined;

  if (!isAddress(value)) {
    errors.push(`${name} must be a valid address`);
    return undefined;
  }

  return value as `0x${string}`;
}

function readOptionalPrivateKeyEnv(name: string, errors: string[]): `0x${string}` | undefined {
  const value = readEnv(name);
  if (!value) return undefined;

  if (!/^0x[0-9a-fA-F]{64}$/.test(value)) {
    errors.push(`${name} must be a 32-byte hex private key`);
    return undefined;
  }

  return value as `0x${string}`;
}

function readRequiredBytes32Env(name: string, errors: string[]): `0x${string}` {
  const value = readEnv(name);
  if (!value) {
    errors.push(`${name} is required`);
    return `0x${"00".repeat(32)}`;
  }

  if (!/^0x[0-9a-fA-F]{64}$/.test(value)) {
    errors.push(`${name} must be a bytes32 hex string`);
    return `0x${"00".repeat(32)}`;
  }

  return value as `0x${string}`;
}

function readLogFormat(errors: string[]): "json" | "text" {
  const value = readEnv("LOG_FORMAT") || "json";
  if (value !== "json" && value !== "text") {
    errors.push("LOG_FORMAT must be either json or text");
    return "json";
  }

  return value;
}

function readDetectorKind(errors: string[]): "mock" {
  const value = readEnv("PROBER_DETECTOR_KIND") || "mock";
  if (value !== "mock") {
    errors.push(`PROBER_DETECTOR_KIND must be one of: mock`);
    return "mock";
  }

  return value;
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

      if (sharedAddress && envValue.toLowerCase() !== sharedAddress.toLowerCase()) {
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
        errors.push(`${envName} must be a valid address when provided for chain ${chainId}`);
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
    errors.push(`${envName} must be a valid address when provided for chain ${chainId}`);
  }
  errors.push(
    `Missing shared deployment artifact for ${contractName} on chain ${chainId}. Refresh @rateloop/contracts deployedContracts.ts before starting the prober for live networks.`,
  );
  return ZERO_ADDRESS;
}

function resolveStartBlock(chainId: number, errors: string[]): number {
  const override = readEnv("PROBER_START_BLOCK");
  if (override) {
    return parseIntegerEnv("PROBER_START_BLOCK", override, "non-negative", 0, errors);
  }

  const sharedStartBlock = getSharedDeploymentStartBlock(chainId, "RaterDeclarationRegistry");
  return sharedStartBlock ?? 0;
}

function loadConfig() {
  const errors: string[] = [];
  const warnings: string[] = [];
  const chainId = requireIntEnv("CHAIN_ID", errors);
  const keystoreAccount = readEnv("KEYSTORE_ACCOUNT");
  const privateKey = readOptionalPrivateKeyEnv("PROBER_PRIVATE_KEY", errors);

  if (!keystoreAccount && !privateKey) {
    errors.push("KEYSTORE_ACCOUNT or PROBER_PRIVATE_KEY is required");
  }

  if (keystoreAccount && !privateKey && !readEnv("KEYSTORE_PASSWORD")) {
    errors.push("KEYSTORE_PASSWORD is required when KEYSTORE_ACCOUNT is configured without PROBER_PRIVATE_KEY");
  }

  const loadedConfig = {
    rpcUrl: requireUrlEnv("RPC_URL", errors),
    chainId,
    chainName: readEnv("CHAIN_NAME") || CHAIN_NAMES[chainId] || `Chain ${chainId}`,

    contracts: {
      raterDeclarationRegistry: resolveContractAddress({
        chainId,
        envName: "RATER_DECLARATION_REGISTRY_ADDRESS",
        contractName: "RaterDeclarationRegistry",
        errors,
        warnings,
      }),
    },

    startBlock: resolveStartBlock(chainId, errors),

    keystoreAccount,
    keystorePassword: process.env.KEYSTORE_PASSWORD,
    privateKey,
    roleWallet: readOptionalAddressEnv("PROBER_ROLE_WALLET", errors),

    intervalMs: readPositiveIntEnv("PROBER_INTERVAL_MS", "30000", errors),
    startupJitterMs: readNonNegativeIntEnv("PROBER_STARTUP_JITTER_MS", "0", errors),
    recentBlockLookback: readPositiveIntEnv("PROBER_RECENT_BLOCK_LOOKBACK", "5000", errors),
    declarationScanBatchBlocks: readPositiveIntEnv("PROBER_DECLARATION_SCAN_BATCH_BLOCKS", "2000", errors),
    maxCandidatesPerTick: readPositiveIntEnv("PROBER_MAX_CANDIDATES_PER_TICK", "10", errors),

    minGasBalanceWei: readNonNegativeBigIntStringEnv("MIN_GAS_BALANCE_WEI", "10000000000000000", errors),
    maxGasPerTx: readPositiveIntEnv("MAX_GAS_PER_TX", "750000", errors),

    detectorKind: readDetectorKind(errors),
    detectorBundleHash: readRequiredBytes32Env("PROBER_DETECTOR_BUNDLE_HASH", errors),
    probeLibraryHash: readRequiredBytes32Env("PROBER_PROBE_LIBRARY_HASH", errors),

    metricsPort: readPositiveIntEnv("METRICS_PORT", "9091", errors),
    metricsBindAddress: readEnv("METRICS_BIND_ADDRESS") || "127.0.0.1",
    metricsEnabled: parseBooleanEnv(readEnv("METRICS_ENABLED"), true, "METRICS_ENABLED"),

    logFormat: readLogFormat(errors),
  };

  if (errors.length > 0) {
    throw new Error(`Invalid prober configuration:\n- ${errors.join("\n- ")}`);
  }

  for (const warning of warnings) {
    console.warn(`[prober config] ${warning}`);
  }

  return loadedConfig;
}

export const config = loadConfig();
