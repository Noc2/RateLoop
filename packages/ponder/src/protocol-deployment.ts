import { getSharedDeploymentAddress } from "@rateloop/contracts/deployments";
import { isAddress, zeroAddress } from "viem";

export const PONDER_NETWORK_CHAIN_IDS: Record<string, number> = {
  hardhat: 31337,
  baseSepolia: 84532,
  base: 8453,
  worldchainSepolia: 4801,
  worldchain: 480,
};

export interface PonderProtocolDeploymentMetadata {
  configured: true;
  network: string | null;
  chainId: number;
  contentRegistryAddress: `0x${string}`;
  feedbackRegistryAddress: `0x${string}`;
  deploymentKey: string;
  databaseSchema: string | null;
}

function readEnv(env: NodeJS.ProcessEnv | Record<string, string | undefined>, key: string) {
  const value = env[key]?.trim();
  return value ? value : undefined;
}

function normalizeRequiredAddress(value: unknown): `0x${string}` | null {
  if (typeof value !== "string" || !isAddress(value) || value.toLowerCase() === zeroAddress) {
    return null;
  }

  return value.toLowerCase() as `0x${string}`;
}

function resolveChainId(env: NodeJS.ProcessEnv | Record<string, string | undefined>) {
  const network = readEnv(env, "PONDER_NETWORK");
  const networkChainId = network ? PONDER_NETWORK_CHAIN_IDS[network] : undefined;
  const explicitChainId = Number.parseInt(readEnv(env, "PONDER_CHAIN_ID") ?? "", 10);
  if (Number.isSafeInteger(explicitChainId) && explicitChainId > 0) {
    if (networkChainId !== undefined && explicitChainId !== networkChainId) {
      throw new Error(
        `PONDER_CHAIN_ID ${explicitChainId} does not match PONDER_NETWORK ${network} (${networkChainId}).`,
      );
    }
    if (network !== undefined && networkChainId === undefined) return undefined;
    return explicitChainId;
  }

  return networkChainId;
}

export function buildPonderProtocolDeploymentKey(params: {
  chainId: number;
  contentRegistryAddress: `0x${string}`;
  feedbackRegistryAddress: `0x${string}`;
}) {
  return [
    String(params.chainId),
    params.contentRegistryAddress.toLowerCase(),
    params.feedbackRegistryAddress.toLowerCase(),
  ].join(":");
}

function resolveProtocolAddress(
  env: NodeJS.ProcessEnv | Record<string, string | undefined>,
  chainId: number,
  envKey: string,
  contractName: string,
) {
  const envAddress = normalizeRequiredAddress(readEnv(env, envKey));
  const sharedAddress = normalizeRequiredAddress(getSharedDeploymentAddress(chainId, contractName));
  if (readEnv(env, "PONDER_NETWORK") === "hardhat") {
    return envAddress ?? sharedAddress;
  }

  return sharedAddress ?? envAddress;
}

export function resolvePonderProtocolDeploymentMetadata(
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
): PonderProtocolDeploymentMetadata | null {
  const chainId = resolveChainId(env);
  if (!chainId) return null;

  const contentRegistryAddress = resolveProtocolAddress(
    env,
    chainId,
    "PONDER_CONTENT_REGISTRY_ADDRESS",
    "ContentRegistry",
  );
  const feedbackRegistryAddress = resolveProtocolAddress(
    env,
    chainId,
    "PONDER_FEEDBACK_REGISTRY_ADDRESS",
    "FeedbackRegistry",
  );
  if (!contentRegistryAddress || !feedbackRegistryAddress) return null;

  return {
    configured: true,
    network: readEnv(env, "PONDER_NETWORK") ?? null,
    chainId,
    contentRegistryAddress,
    feedbackRegistryAddress,
    deploymentKey: buildPonderProtocolDeploymentKey({
      chainId,
      contentRegistryAddress,
      feedbackRegistryAddress,
    }),
    databaseSchema: readEnv(env, "DATABASE_SCHEMA") ?? null,
  };
}
