import { config as loadDotenv } from "dotenv";
import { isAddress, zeroAddress, type Address, type Hex } from "viem";

loadDotenv({ path: ".env.local", override: false });
loadDotenv();

const BASE_SEPOLIA_CHAIN_ID = 84532;
const LOCAL_CHAIN_ID = 31337;
const TOKENLESS_EU_RAILWAY_REGION = "europe-west4-drams3a";
export const TOKENLESS_DEPLOYMENT_VERSION = "tokenless-v4";
const PRIVATE_KEY_PATTERN = /^0x[0-9a-fA-F]{64}$/u;
const MAXIMUM_RPC_FALLBACKS = 3;

function readEnv(env: NodeJS.ProcessEnv, name: string): string | undefined {
  const value = env[name]?.trim();
  return value || undefined;
}

function required(env: NodeJS.ProcessEnv, name: string, errors: string[]) {
  const value = readEnv(env, name);
  if (!value) errors.push(`${name} is required`);
  return value ?? "";
}

function positiveInteger(
  env: NodeJS.ProcessEnv,
  name: string,
  fallback: number,
  errors: string[],
) {
  const raw = readEnv(env, name);
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value <= 0) {
    errors.push(`${name} must be a positive integer`);
    return fallback;
  }
  return value;
}

function nonNegativeInteger(
  env: NodeJS.ProcessEnv,
  name: string,
  fallback: number,
  errors: string[],
) {
  const raw = readEnv(env, name);
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 0) {
    errors.push(`${name} must be a non-negative integer`);
    return fallback;
  }
  return value;
}

function requiredAddress(
  env: NodeJS.ProcessEnv,
  name: string,
  errors: string[],
): Address {
  const value = required(env, name, errors);
  if (!isAddress(value) || value.toLowerCase() === zeroAddress) {
    errors.push(`${name} must be a non-zero address`);
    return zeroAddress;
  }
  return value;
}

function optionalAddress(
  env: NodeJS.ProcessEnv,
  name: string,
  errors: string[],
): Address {
  const value = readEnv(env, name);
  if (!value) return zeroAddress;
  if (!isAddress(value)) {
    errors.push(`${name} must be an address when provided`);
    return zeroAddress;
  }
  return value;
}

function rpcUrls(
  env: NodeJS.ProcessEnv,
  production: boolean,
  errors: string[],
) {
  const primary = required(env, "RPC_URL", errors);
  const fallbacks = (readEnv(env, "RPC_FALLBACK_URLS") ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  if (production && fallbacks.length === 0) {
    errors.push(
      "RPC_FALLBACK_URLS must contain at least one independent HTTPS RPC in production",
    );
  }
  if (fallbacks.length > MAXIMUM_RPC_FALLBACKS) {
    errors.push(
      `RPC_FALLBACK_URLS must contain at most ${MAXIMUM_RPC_FALLBACKS} URLs`,
    );
  }
  const normalized = [primary, ...fallbacks].map((value, index) => {
    const name = index === 0 ? "RPC_URL" : "RPC_FALLBACK_URLS";
    try {
      const parsed = new URL(value);
      if (
        !["http:", "https:"].includes(parsed.protocol) ||
        parsed.username ||
        parsed.password ||
        parsed.hash
      ) {
        throw new Error("invalid");
      }
      if (production && parsed.protocol !== "https:") {
        errors.push(`${name} must use HTTPS in production`);
      }
      return parsed.toString();
    } catch {
      errors.push(`${name} must contain valid HTTP URLs`);
      return value;
    }
  });
  if (new Set(normalized).size !== normalized.length) {
    errors.push("RPC_URL and RPC_FALLBACK_URLS must be distinct");
  }
  return {
    rpcUrl: normalized[0] ?? primary,
    rpcFallbackUrls: normalized.slice(1),
  };
}

function validateEuRuntime(
  env: NodeJS.ProcessEnv,
  production: boolean,
  errors: string[],
) {
  if (!production) return;
  if (readEnv(env, "TOKENLESS_HOME_REGION") !== "eu") {
    errors.push("TOKENLESS_HOME_REGION must be eu in production");
  }
  if (readEnv(env, "RAILWAY_REPLICA_REGION") !== TOKENLESS_EU_RAILWAY_REGION) {
    errors.push(
      `RAILWAY_REPLICA_REGION must be ${TOKENLESS_EU_RAILWAY_REGION}`,
    );
  }
  for (const [actualName, expectedName] of [
    ["RAILWAY_PROJECT_ID", "TOKENLESS_RAILWAY_PROJECT_ID"],
    ["RAILWAY_SERVICE_ID", "TOKENLESS_KEEPER_SERVICE_ID"],
  ]) {
    const actual = readEnv(env, actualName);
    const expected = readEnv(env, expectedName);
    if (
      !actual ||
      !expected ||
      actual !== expected ||
      /(?:legacy|rate-loop-nextjs|rateloop\.ai)/iu.test(actual)
    ) {
      errors.push(
        `${actualName} must match ${expectedName} for the isolated tokenless EU worker`,
      );
    }
  }
}

export function buildTokenlessDeploymentKey(params: {
  chainId: number;
  panel: Address;
  credentialIssuer: Address;
  x402PanelSubmitter?: Address;
  feedbackBonus: Address;
}) {
  return [
    TOKENLESS_DEPLOYMENT_VERSION,
    String(params.chainId),
    params.panel.toLowerCase(),
    params.credentialIssuer.toLowerCase(),
    (params.x402PanelSubmitter ?? zeroAddress).toLowerCase(),
    params.feedbackBonus.toLowerCase(),
  ].join(":");
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env) {
  const errors: string[] = [];
  const production = readEnv(env, "NODE_ENV") === "production";
  validateEuRuntime(env, production, errors);
  const chainId = positiveInteger(env, "CHAIN_ID", 0, errors);
  if (![LOCAL_CHAIN_ID, BASE_SEPOLIA_CHAIN_ID].includes(chainId)) {
    errors.push(
      `CHAIN_ID must be ${LOCAL_CHAIN_ID} or ${BASE_SEPOLIA_CHAIN_ID}`,
    );
  }
  if (production && chainId !== BASE_SEPOLIA_CHAIN_ID) {
    errors.push(
      `production tokenless keeper requires CHAIN_ID=${BASE_SEPOLIA_CHAIN_ID}`,
    );
  }

  const { rpcUrl, rpcFallbackUrls } = rpcUrls(env, production, errors);
  const ponderUrl = readEnv(env, "TOKENLESS_PONDER_URL");
  const ponderKeeperWorkToken = readEnv(env, "PONDER_KEEPER_WORK_TOKEN");
  if (production && !ponderUrl)
    errors.push("TOKENLESS_PONDER_URL is required in production");
  if (production && !ponderKeeperWorkToken)
    errors.push("PONDER_KEEPER_WORK_TOKEN is required in production");
  if (
    (ponderUrl && !ponderKeeperWorkToken) ||
    (!ponderUrl && ponderKeeperWorkToken)
  ) {
    errors.push(
      "TOKENLESS_PONDER_URL and PONDER_KEEPER_WORK_TOKEN must be configured together",
    );
  }
  if (ponderUrl) {
    try {
      const parsed = new URL(ponderUrl);
      if (
        !["http:", "https:"].includes(parsed.protocol) ||
        parsed.username ||
        parsed.password ||
        parsed.hash
      ) {
        throw new Error("invalid");
      }
      if (production && parsed.protocol !== "https:") {
        errors.push("TOKENLESS_PONDER_URL must use HTTPS in production");
      }
    } catch {
      errors.push("TOKENLESS_PONDER_URL must be a valid HTTP URL");
    }
  }

  const panel = requiredAddress(env, "TOKENLESS_PANEL_ADDRESS", errors);
  const credentialIssuer = requiredAddress(
    env,
    "TOKENLESS_CREDENTIAL_ISSUER_ADDRESS",
    errors,
  );
  const x402PanelSubmitter = optionalAddress(
    env,
    "TOKENLESS_X402_PANEL_SUBMITTER_ADDRESS",
    errors,
  );
  const feedbackBonus = requiredAddress(
    env,
    "TOKENLESS_FEEDBACK_BONUS_ADDRESS",
    errors,
  );
  const expectedDeploymentKey = buildTokenlessDeploymentKey({
    chainId,
    panel,
    credentialIssuer,
    x402PanelSubmitter,
    feedbackBonus,
  });
  const deploymentKey = required(env, "TOKENLESS_DEPLOYMENT_KEY", errors);
  if (deploymentKey && deploymentKey.toLowerCase() !== expectedDeploymentKey) {
    errors.push(
      "TOKENLESS_DEPLOYMENT_KEY does not match the configured chain and tokenless contract addresses",
    );
  }

  const privateKey = readEnv(env, "KEEPER_PRIVATE_KEY");
  const keystoreAccount = readEnv(env, "KEYSTORE_ACCOUNT");
  if (!privateKey && !keystoreAccount) {
    errors.push("KEYSTORE_ACCOUNT or KEEPER_PRIVATE_KEY is required");
  }
  if (privateKey && !PRIVATE_KEY_PATTERN.test(privateKey)) {
    errors.push("KEEPER_PRIVATE_KEY must be a 32-byte hex private key");
  }
  if (keystoreAccount && !readEnv(env, "KEYSTORE_PASSWORD") && !privateKey) {
    errors.push("KEYSTORE_PASSWORD is required with KEYSTORE_ACCOUNT");
  }

  const metricsBindAddress =
    readEnv(env, "METRICS_BIND_ADDRESS") ??
    (readEnv(env, "PORT") ? "0.0.0.0" : "127.0.0.1");
  const metricsAuthToken = readEnv(env, "METRICS_AUTH_TOKEN") ?? null;
  if (
    production &&
    !["127.0.0.1", "::1", "localhost"].includes(metricsBindAddress) &&
    (!metricsAuthToken || metricsAuthToken.length < 16)
  ) {
    errors.push(
      "METRICS_AUTH_TOKEN of at least 16 characters is required for a non-loopback production bind",
    );
  }

  const deploymentBlockNumber = nonNegativeInteger(
    env,
    "TOKENLESS_DEPLOYMENT_BLOCK",
    0,
    errors,
  );
  if (production && deploymentBlockNumber === 0) {
    errors.push("TOKENLESS_DEPLOYMENT_BLOCK must be positive in production");
  }
  const intervalMs = positiveInteger(env, "KEEPER_INTERVAL_MS", 15_000, errors);
  const maxRoundsPerTick = positiveInteger(
    env,
    "KEEPER_MAX_ROUNDS_PER_TICK",
    100,
    errors,
  );
  const settlementBatchSize = positiveInteger(
    env,
    "KEEPER_SETTLEMENT_BATCH_SIZE",
    25,
    errors,
  );
  const maxCiphertextBytes = positiveInteger(
    env,
    "KEEPER_MAX_CIPHERTEXT_BYTES",
    16_384,
    errors,
  );
  const maxFeedbackBonusPoolsPerTick = positiveInteger(
    env,
    "KEEPER_MAX_FEEDBACK_BONUS_POOLS_PER_TICK",
    100,
    errors,
  );
  const hostedPort = positiveInteger(env, "PORT", 9090, errors);
  const metricsPort = positiveInteger(env, "METRICS_PORT", hostedPort, errors);
  let minGasBalanceWei = 0n;
  try {
    minGasBalanceWei = BigInt(
      readEnv(env, "MIN_GAS_BALANCE_WEI") ?? "1000000000000000",
    );
    if (minGasBalanceWei < 0n) throw new Error("negative");
  } catch {
    errors.push("MIN_GAS_BALANCE_WEI must be a non-negative integer");
  }

  if (errors.length > 0) {
    throw new Error(
      `Invalid tokenless keeper configuration:\n- ${errors.join("\n- ")}`,
    );
  }

  return {
    chainId,
    chainName: chainId === BASE_SEPOLIA_CHAIN_ID ? "Base Sepolia" : "Anvil",
    rpcFallbackUrls,
    rpcUrl,
    deployment: {
      key: deploymentKey,
      blockNumber: BigInt(deploymentBlockNumber),
      panel,
      credentialIssuer,
      x402PanelSubmitter,
      feedbackBonus,
    },
    privateKey: privateKey as Hex | undefined,
    keystoreAccount,
    intervalMs,
    maxRoundsPerTick,
    settlementBatchSize,
    maxCiphertextBytes,
    maxFeedbackBonusPoolsPerTick,
    metricsPort,
    metricsBindAddress,
    metricsAuthToken,
    logFormat: readEnv(env, "LOG_FORMAT") === "text" ? "text" : "json",
    minGasBalanceWei,
    ponderWorkFeed:
      ponderUrl && ponderKeeperWorkToken
        ? { baseUrl: ponderUrl, token: ponderKeeperWorkToken }
        : null,
  } as const;
}

export const config = loadConfig();
