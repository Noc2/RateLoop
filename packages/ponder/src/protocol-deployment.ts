import { isAddress, zeroAddress } from "viem";

export const TOKENLESS_SCHEMA_VERSION = "tokenless-v4";
const TOKENLESS_EU_RAILWAY_REGION = "europe-west4-drams3a";
export const PONDER_NETWORK_CHAIN_IDS = {
  hardhat: 31_337,
  baseSepolia: 84_532,
} as const;

export type TokenlessNetwork = keyof typeof PONDER_NETWORK_CHAIN_IDS;

export interface TokenlessDeployment {
  schemaVersion: typeof TOKENLESS_SCHEMA_VERSION;
  network: TokenlessNetwork;
  chainId: number;
  panelAddress: `0x${string}`;
  issuerAddress: `0x${string}`;
  adapterAddress: `0x${string}`;
  feedbackBonusAddress: `0x${string}`;
  beaconVerifierAddress: `0x${string}`;
  startBlock: number;
  deploymentKey: string;
}

export function tokenlessDeploymentHealth(deployment: TokenlessDeployment) {
  return {
    status: "ok" as const,
    protocol: TOKENLESS_SCHEMA_VERSION,
    chainId: deployment.chainId,
    deploymentKey: deployment.deploymentKey,
    feedbackBonusAddress: deployment.feedbackBonusAddress,
    beaconVerifierAddress: deployment.beaconVerifierAddress,
    startBlock: deployment.startBlock,
  };
}

function read(
  env: NodeJS.ProcessEnv | Record<string, string | undefined>,
  key: string,
) {
  const value = env[key]?.trim();
  return value ? value : undefined;
}

function requiredAddress(
  value: string | undefined,
  key: string,
): `0x${string}` {
  if (!value || !isAddress(value) || value.toLowerCase() === zeroAddress) {
    throw new Error(`${key} must be a non-zero EVM address.`);
  }
  return value.toLowerCase() as `0x${string}`;
}

function optionalAddress(
  value: string | undefined,
  key: string,
): `0x${string}` {
  if (!value) return zeroAddress;
  if (!isAddress(value))
    throw new Error(`${key} must be an EVM address when set.`);
  return value.toLowerCase() as `0x${string}`;
}

function unsignedInteger(
  value: string | undefined,
  key: string,
  fallback?: number,
) {
  if (value === undefined && fallback !== undefined) return fallback;
  if (!value || !/^(?:0|[1-9]\d*)$/u.test(value)) {
    throw new Error(`${key} must be an unsigned base-10 integer.`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed))
    throw new Error(`${key} exceeds the safe integer range.`);
  return parsed;
}

function validateEuRuntime(
  env: NodeJS.ProcessEnv | Record<string, string | undefined>,
) {
  if (read(env, "NODE_ENV") !== "production") return;
  if (read(env, "TOKENLESS_HOME_REGION") !== "eu") {
    throw new Error("TOKENLESS_HOME_REGION must be eu in production.");
  }
  if (read(env, "RAILWAY_REPLICA_REGION") !== TOKENLESS_EU_RAILWAY_REGION) {
    throw new Error(
      `RAILWAY_REPLICA_REGION must be ${TOKENLESS_EU_RAILWAY_REGION}.`,
    );
  }
  for (const [actualName, expectedName] of [
    ["RAILWAY_PROJECT_ID", "TOKENLESS_RAILWAY_PROJECT_ID"],
    ["RAILWAY_SERVICE_ID", "TOKENLESS_PONDER_SERVICE_ID"],
  ]) {
    const actual = read(env, actualName);
    const expected = read(env, expectedName);
    if (
      !actual ||
      !expected ||
      actual !== expected ||
      /(?:legacy|rate-loop-nextjs|rateloop\.ai)/iu.test(actual)
    ) {
      throw new Error(
        `${actualName} must match ${expectedName} for the isolated tokenless EU worker.`,
      );
    }
  }
}

export function buildTokenlessDeploymentKey(params: {
  chainId: number;
  panelAddress: `0x${string}`;
  issuerAddress: `0x${string}`;
  adapterAddress?: `0x${string}`;
  feedbackBonusAddress: `0x${string}`;
}) {
  return [
    TOKENLESS_SCHEMA_VERSION,
    String(params.chainId),
    params.panelAddress.toLowerCase(),
    params.issuerAddress.toLowerCase(),
    (params.adapterAddress ?? zeroAddress).toLowerCase(),
    params.feedbackBonusAddress.toLowerCase(),
  ].join(":");
}

export function resolveTokenlessDeployment(
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
): TokenlessDeployment {
  validateEuRuntime(env);
  const network =
    read(env, "PONDER_NETWORK") ??
    (read(env, "NODE_ENV") === "production" ? undefined : "hardhat");
  if (!network || !(network in PONDER_NETWORK_CHAIN_IDS)) {
    throw new Error("PONDER_NETWORK must be hardhat or baseSepolia.");
  }
  const typedNetwork = network as TokenlessNetwork;
  const chainId = PONDER_NETWORK_CHAIN_IDS[typedNetwork];
  const explicitChainId = read(env, "PONDER_CHAIN_ID");
  if (
    explicitChainId !== undefined &&
    unsignedInteger(explicitChainId, "PONDER_CHAIN_ID") !== chainId
  ) {
    throw new Error(
      `PONDER_CHAIN_ID must match PONDER_NETWORK ${typedNetwork} (${chainId}).`,
    );
  }

  const panelAddress = requiredAddress(
    read(env, "PONDER_TOKENLESS_PANEL_ADDRESS"),
    "PONDER_TOKENLESS_PANEL_ADDRESS",
  );
  const issuerAddress = requiredAddress(
    read(env, "PONDER_CREDENTIAL_ISSUER_ADDRESS"),
    "PONDER_CREDENTIAL_ISSUER_ADDRESS",
  );
  const adapterAddress = optionalAddress(
    read(env, "PONDER_X402_PANEL_SUBMITTER_ADDRESS"),
    "PONDER_X402_PANEL_SUBMITTER_ADDRESS",
  );
  const feedbackBonusAddress = requiredAddress(
    read(env, "PONDER_FEEDBACK_BONUS_ADDRESS"),
    "PONDER_FEEDBACK_BONUS_ADDRESS",
  );
  const beaconVerifierAddress = requiredAddress(
    read(env, "PONDER_BEACON_VERIFIER_ADDRESS"),
    "PONDER_BEACON_VERIFIER_ADDRESS",
  );
  const startBlock = unsignedInteger(
    read(env, "PONDER_TOKENLESS_START_BLOCK"),
    "PONDER_TOKENLESS_START_BLOCK",
    typedNetwork === "hardhat" ? 0 : undefined,
  );
  const deploymentKey = buildTokenlessDeploymentKey({
    chainId,
    panelAddress,
    issuerAddress,
    adapterAddress,
    feedbackBonusAddress,
  });
  const configuredKey = read(
    env,
    "RATELOOP_PONDER_PROTOCOL_DEPLOYMENT_KEY",
  )?.toLowerCase();
  if (typedNetwork === "baseSepolia" && !configuredKey) {
    throw new Error(
      "RATELOOP_PONDER_PROTOCOL_DEPLOYMENT_KEY is required for Base Sepolia.",
    );
  }
  if (configuredKey && configuredKey !== deploymentKey) {
    throw new Error(
      "RATELOOP_PONDER_PROTOCOL_DEPLOYMENT_KEY does not match the tokenless deployment identity.",
    );
  }

  return {
    schemaVersion: TOKENLESS_SCHEMA_VERSION,
    network: typedNetwork,
    chainId,
    panelAddress,
    issuerAddress,
    adapterAddress,
    feedbackBonusAddress,
    beaconVerifierAddress,
    startBlock,
    deploymentKey,
  };
}

export function roundKey(deploymentKey: string, roundId: bigint) {
  return `${deploymentKey}:${roundId}`;
}

export function commitKey(deploymentKey: string, value: `0x${string}`) {
  return `${deploymentKey}:${value.toLowerCase()}`;
}

export function creditOwnerKey(deploymentKey: string, owner: `0x${string}`) {
  return `${deploymentKey}:${owner.toLowerCase()}`;
}

export function feedbackBonusPoolKey(deploymentKey: string, poolId: bigint) {
  return `${deploymentKey}:feedback-bonus:${poolId}`;
}

export function feedbackBonusRecordKey(
  deploymentKey: string,
  feedbackKey: `0x${string}`,
) {
  return `${deploymentKey}:feedback:${feedbackKey.toLowerCase()}`;
}

export function deploymentEventKey(
  deploymentKey: string,
  transactionHash: `0x${string}`,
  logIndex: number,
) {
  return `${deploymentKey}:${transactionHash.toLowerCase()}:${logIndex}`;
}
