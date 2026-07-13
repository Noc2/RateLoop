import { isAddress, zeroAddress } from "viem";

export const TOKENLESS_SCHEMA_VERSION = "tokenless-v2";
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
  startBlock: number;
  deploymentKey: string;
}

function read(env: NodeJS.ProcessEnv | Record<string, string | undefined>, key: string) {
  const value = env[key]?.trim();
  return value ? value : undefined;
}

function requiredAddress(value: string | undefined, key: string): `0x${string}` {
  if (!value || !isAddress(value) || value.toLowerCase() === zeroAddress) {
    throw new Error(`${key} must be a non-zero EVM address.`);
  }
  return value.toLowerCase() as `0x${string}`;
}

function optionalAddress(value: string | undefined, key: string): `0x${string}` {
  if (!value) return zeroAddress;
  if (!isAddress(value)) throw new Error(`${key} must be an EVM address when set.`);
  return value.toLowerCase() as `0x${string}`;
}

function unsignedInteger(value: string | undefined, key: string, fallback?: number) {
  if (value === undefined && fallback !== undefined) return fallback;
  if (!value || !/^(?:0|[1-9]\d*)$/u.test(value)) {
    throw new Error(`${key} must be an unsigned base-10 integer.`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) throw new Error(`${key} exceeds the safe integer range.`);
  return parsed;
}

export function buildTokenlessDeploymentKey(params: {
  chainId: number;
  panelAddress: `0x${string}`;
  issuerAddress: `0x${string}`;
  adapterAddress?: `0x${string}`;
}) {
  return [
    TOKENLESS_SCHEMA_VERSION,
    String(params.chainId),
    params.panelAddress.toLowerCase(),
    params.issuerAddress.toLowerCase(),
    (params.adapterAddress ?? zeroAddress).toLowerCase(),
  ].join(":");
}

export function resolveTokenlessDeployment(
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
): TokenlessDeployment {
  const network = read(env, "PONDER_NETWORK") ?? (read(env, "NODE_ENV") === "production" ? undefined : "hardhat");
  if (!network || !(network in PONDER_NETWORK_CHAIN_IDS)) {
    throw new Error("PONDER_NETWORK must be hardhat or baseSepolia.");
  }
  const typedNetwork = network as TokenlessNetwork;
  const chainId = PONDER_NETWORK_CHAIN_IDS[typedNetwork];
  const explicitChainId = read(env, "PONDER_CHAIN_ID");
  if (explicitChainId !== undefined && unsignedInteger(explicitChainId, "PONDER_CHAIN_ID") !== chainId) {
    throw new Error(`PONDER_CHAIN_ID must match PONDER_NETWORK ${typedNetwork} (${chainId}).`);
  }

  const panelAddress = requiredAddress(read(env, "PONDER_TOKENLESS_PANEL_ADDRESS"), "PONDER_TOKENLESS_PANEL_ADDRESS");
  const issuerAddress = requiredAddress(
    read(env, "PONDER_CREDENTIAL_ISSUER_ADDRESS"),
    "PONDER_CREDENTIAL_ISSUER_ADDRESS",
  );
  const adapterAddress = optionalAddress(
    read(env, "PONDER_X402_PANEL_SUBMITTER_ADDRESS"),
    "PONDER_X402_PANEL_SUBMITTER_ADDRESS",
  );
  const startBlock = unsignedInteger(
    read(env, "PONDER_TOKENLESS_START_BLOCK"),
    "PONDER_TOKENLESS_START_BLOCK",
    typedNetwork === "hardhat" ? 0 : undefined,
  );
  const deploymentKey = buildTokenlessDeploymentKey({ chainId, panelAddress, issuerAddress, adapterAddress });
  const configuredKey = read(env, "RATELOOP_PONDER_PROTOCOL_DEPLOYMENT_KEY")?.toLowerCase();
  if (typedNetwork === "baseSepolia" && !configuredKey) {
    throw new Error("RATELOOP_PONDER_PROTOCOL_DEPLOYMENT_KEY is required for Base Sepolia.");
  }
  if (configuredKey && configuredKey !== deploymentKey) {
    throw new Error("RATELOOP_PONDER_PROTOCOL_DEPLOYMENT_KEY does not match the tokenless deployment identity.");
  }

  return {
    schemaVersion: TOKENLESS_SCHEMA_VERSION,
    network: typedNetwork,
    chainId,
    panelAddress,
    issuerAddress,
    adapterAddress,
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
