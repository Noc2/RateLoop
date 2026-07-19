import { config as loadDotenv } from "dotenv";
import { isAbsolute } from "node:path";
import { isAddress, zeroAddress, type Address, type Hex } from "viem";

loadDotenv({ path: ".env.local", override: false });
loadDotenv();

const BASE_SEPOLIA_CHAIN_ID = 84532;
const LOCAL_CHAIN_ID = 31337;
const TOKENLESS_EU_RAILWAY_REGION = "europe-west4-drams3a";
export const TOKENLESS_DEPLOYMENT_VERSION = "tokenless-v4";
const PRIVATE_KEY_PATTERN = /^0x[0-9a-fA-F]{64}$/u;
const KMS_KEY_ARN_PATTERN =
  /^arn:aws:kms:([a-z0-9-]+):[0-9]{12}:key\/[0-9a-f-]{36}$/u;
const IAM_ROLE_ARN_PATTERN =
  /^arn:aws:iam::[0-9]{12}:role\/[A-Za-z0-9+=,.@_\/-]+$/u;
const EU_AWS_REGION_PATTERN = /^eu-(?:central|north|south|west)-[1-3]$/u;
const ROLE_SESSION_NAME_PATTERN = /^[\w+=,.@-]{2,64}$/u;
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
  const beaconVerifier = requiredAddress(
    env,
    "TOKENLESS_BEACON_VERIFIER_ADDRESS",
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
  const keystorePassword = readEnv(env, "KEYSTORE_PASSWORD");
  const kmsKeyResource = readEnv(env, "TOKENLESS_KEEPER_KMS_KEY_RESOURCE");
  const kmsExpectedAddress = readEnv(
    env,
    "TOKENLESS_KEEPER_KMS_EXPECTED_ADDRESS",
  );
  const kmsRegion = readEnv(env, "TOKENLESS_KEEPER_KMS_REGION");
  const kmsRoleArn = readEnv(env, "TOKENLESS_KEEPER_KMS_ROLE_ARN");
  const webIdentityTokenFile = readEnv(env, "AWS_WEB_IDENTITY_TOKEN_FILE");
  const kmsRoleSessionName =
    readEnv(env, "TOKENLESS_KEEPER_KMS_ROLE_SESSION_NAME") ??
    "rateloop-tokenless-keeper";
  const kmsValues = [kmsKeyResource, kmsExpectedAddress, kmsRegion, kmsRoleArn];
  const kmsConfigured = kmsValues.some(Boolean);
  const localSignerConfigured = Boolean(privateKey || keystoreAccount);

  if (production && !kmsConfigured) {
    errors.push(
      "production requires the TOKENLESS_KEEPER_KMS_* signer and AWS_WEB_IDENTITY_TOKEN_FILE",
    );
  }
  if (!production && !kmsConfigured && !localSignerConfigured) {
    errors.push(
      "TOKENLESS_KEEPER_KMS_* or a local-test KEYSTORE_ACCOUNT/KEEPER_PRIVATE_KEY is required",
    );
  }
  if (kmsConfigured && localSignerConfigured) {
    errors.push(
      "managed KMS signing cannot be combined with KEYSTORE_ACCOUNT or KEEPER_PRIVATE_KEY",
    );
  }
  if (kmsConfigured) {
    for (const [name, value] of [
      ["TOKENLESS_KEEPER_KMS_KEY_RESOURCE", kmsKeyResource],
      ["TOKENLESS_KEEPER_KMS_EXPECTED_ADDRESS", kmsExpectedAddress],
      ["TOKENLESS_KEEPER_KMS_REGION", kmsRegion],
      ["TOKENLESS_KEEPER_KMS_ROLE_ARN", kmsRoleArn],
      ["AWS_WEB_IDENTITY_TOKEN_FILE", webIdentityTokenFile],
    ] as const) {
      if (!value) errors.push(`${name} is required for managed signing`);
    }
    const keyMatch = kmsKeyResource?.match(KMS_KEY_ARN_PATTERN);
    if (!keyMatch) {
      errors.push(
        "TOKENLESS_KEEPER_KMS_KEY_RESOURCE must be an exact AWS KMS key ARN",
      );
    }
    if (!kmsRegion || !EU_AWS_REGION_PATTERN.test(kmsRegion)) {
      errors.push("TOKENLESS_KEEPER_KMS_REGION must be an EU AWS region");
    }
    if (keyMatch?.[1] !== kmsRegion) {
      errors.push(
        "TOKENLESS_KEEPER_KMS_KEY_RESOURCE region must match TOKENLESS_KEEPER_KMS_REGION",
      );
    }
    if (!kmsRoleArn || !IAM_ROLE_ARN_PATTERN.test(kmsRoleArn)) {
      errors.push("TOKENLESS_KEEPER_KMS_ROLE_ARN must be an AWS IAM role ARN");
    }
    const sdkRoleArn = readEnv(env, "AWS_ROLE_ARN");
    if (sdkRoleArn && sdkRoleArn !== kmsRoleArn) {
      errors.push(
        "AWS_ROLE_ARN must match TOKENLESS_KEEPER_KMS_ROLE_ARN when provided",
      );
    }
    if (!webIdentityTokenFile || !isAbsolute(webIdentityTokenFile)) {
      errors.push("AWS_WEB_IDENTITY_TOKEN_FILE must be an absolute path");
    }
    if (!ROLE_SESSION_NAME_PATTERN.test(kmsRoleSessionName)) {
      errors.push(
        "TOKENLESS_KEEPER_KMS_ROLE_SESSION_NAME must be a valid AWS role session name",
      );
    }
    if (!kmsExpectedAddress || !isAddress(kmsExpectedAddress)) {
      errors.push(
        "TOKENLESS_KEEPER_KMS_EXPECTED_ADDRESS must be an Ethereum address",
      );
    } else if (kmsExpectedAddress.toLowerCase() === zeroAddress) {
      errors.push(
        "TOKENLESS_KEEPER_KMS_EXPECTED_ADDRESS must be a non-zero address",
      );
    }
  }
  if (
    production &&
    ["AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "AWS_SESSION_TOKEN"].some(
      (name) => readEnv(env, name),
    )
  ) {
    errors.push(
      "production keeper forbids static AWS credential environment variables; use web identity",
    );
  }
  if (production && localSignerConfigured) {
    errors.push(
      "production keeper forbids KEYSTORE_ACCOUNT and KEEPER_PRIVATE_KEY",
    );
  }
  if (privateKey && !PRIVATE_KEY_PATTERN.test(privateKey)) {
    errors.push("KEEPER_PRIVATE_KEY must be a 32-byte hex private key");
  }
  if (keystoreAccount && !keystorePassword) {
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
  if (production && minGasBalanceWei === 0n) {
    errors.push("MIN_GAS_BALANCE_WEI must be positive in production");
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
      beaconVerifier,
    },
    signer: kmsConfigured
      ? {
          kind: "aws-kms" as const,
          expectedAddress: kmsExpectedAddress as Address,
          keyResource: kmsKeyResource!,
          region: kmsRegion!,
          roleArn: kmsRoleArn!,
          roleSessionName: kmsRoleSessionName,
          webIdentityTokenFile: webIdentityTokenFile!,
        }
      : {
          kind: "local-test" as const,
          privateKey: privateKey as Hex | undefined,
          keystoreAccount,
        },
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
