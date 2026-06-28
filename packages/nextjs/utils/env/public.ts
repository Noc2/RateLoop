import deployedContracts from "@rateloop/contracts/deployedContracts";
import { isAddress } from "viem";
import { RPC_OVERRIDES } from "~~/config/shared";
import { listMissingRequiredTargetContracts } from "~~/utils/env/requiredDeployments";
import { DEFAULT_DEV_TARGET_NETWORKS, resolveTargetNetworks } from "~~/utils/env/targetNetworks";
import { mergeRpcOverrides, resolveRpcOverrides } from "~~/utils/rpcUrls";

const isProduction = process.env.NODE_ENV === "production";
export type { SupportedTargetNetwork } from "~~/utils/env/targetNetworks";

function optionalEnv(value: string | undefined): string | undefined {
  const trimmedValue = value?.trim();
  return trimmedValue ? trimmedValue : undefined;
}

function isLocalhostUrl(value: string): boolean {
  const hostname = new URL(value).hostname;
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1" || hostname === "[::1]";
}

function normalizeAppOrigin(value: string | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;

  try {
    return new URL(trimmed).origin;
  } catch {
    return null;
  }
}

// Next only inlines NEXT_PUBLIC_* variables into client bundles when they are
// accessed with static property reads.
const rawPublicEnv = {
  alchemyApiKey: optionalEnv(process.env.NEXT_PUBLIC_ALCHEMY_API_KEY),
  enableRpcFallback: optionalEnv(process.env.NEXT_PUBLIC_ENABLE_RPC_FALLBACK),
  frontendCode: optionalEnv(process.env.NEXT_PUBLIC_FRONTEND_CODE),
  localE2EProductionBuild:
    optionalEnv(process.env.NEXT_PUBLIC_RATELOOP_E2E_PRODUCTION_BUILD) ??
    (process.env.RATELOOP_E2E_PRODUCTION_BUILD === "true" ? "true" : undefined),
  ponderUrl: optionalEnv(process.env.NEXT_PUBLIC_PONDER_URL),
  rpcUrl84532: optionalEnv(process.env.NEXT_PUBLIC_RPC_URL_84532),
  rpcUrl8453: optionalEnv(process.env.NEXT_PUBLIC_RPC_URL_8453),
  rpcUrl4801: optionalEnv(process.env.NEXT_PUBLIC_RPC_URL_4801),
  rpcUrl31337: optionalEnv(process.env.NEXT_PUBLIC_RPC_URL_31337),
  rpcUrl480: optionalEnv(process.env.NEXT_PUBLIC_RPC_URL_480),
  targetNetworks: optionalEnv(process.env.NEXT_PUBLIC_TARGET_NETWORKS),
  thirdwebClientId: optionalEnv(process.env.NEXT_PUBLIC_THIRDWEB_CLIENT_ID),
  useBasePreconfRpc: optionalEnv(process.env.NEXT_PUBLIC_USE_BASE_PRECONF_RPC),
  walletConnectProjectId: optionalEnv(process.env.NEXT_PUBLIC_WALLET_CONNECT_PROJECT_ID),
  appUrl: optionalEnv(process.env.NEXT_PUBLIC_APP_URL),
} as const;

const allowLocalE2EProductionBuild = rawPublicEnv.localE2EProductionBuild === "true";
const rpcOverrides = mergeRpcOverrides(
  RPC_OVERRIDES,
  resolveRpcOverrides(
    {
      31337: rawPublicEnv.rpcUrl31337,
      84532: rawPublicEnv.rpcUrl84532,
      8453: rawPublicEnv.rpcUrl8453,
      4801: rawPublicEnv.rpcUrl4801,
      480: rawPublicEnv.rpcUrl480,
    },
    {
      allowLocalhostInProduction: allowLocalE2EProductionBuild,
      production: isProduction,
    },
  ),
);
const useBasePreconfRpc = rawPublicEnv.useBasePreconfRpc === "true";

function requireUrl(name: string, value: string | undefined, fallback?: string): string {
  const resolvedValue = value ?? fallback;

  if (!resolvedValue) {
    throw new Error(`${name} is required${isProduction ? " in production" : ""}.`);
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(resolvedValue);
  } catch {
    throw new Error(`${name} must be a valid URL.`);
  }

  if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
    throw new Error(`${name} must be a valid http(s) URL.`);
  }

  if (isProduction && !allowLocalE2EProductionBuild && isLocalhostUrl(resolvedValue)) {
    throw new Error(`${name} must not point to localhost in production.`);
  }

  if (
    isProduction &&
    parsedUrl.protocol === "http:" &&
    !(allowLocalE2EProductionBuild && isLocalhostUrl(resolvedValue))
  ) {
    throw new Error(`${name} must use HTTPS in production; localhost HTTP is only allowed for local E2E builds.`);
  }

  return resolvedValue;
}

const targetNetworks = resolveTargetNetworks(rawPublicEnv.targetNetworks, {
  alchemyApiKey: rawPublicEnv.alchemyApiKey,
  allowFoundryInProduction: allowLocalE2EProductionBuild,
  production: isProduction,
  fallback: !isProduction || allowLocalE2EProductionBuild ? DEFAULT_DEV_TARGET_NETWORKS : undefined,
  rpcOverrides,
  useBasePreconfRpc,
});
const targetNetworkIds = targetNetworks.map(network => network.id);

const deployedContractsByChain = deployedContracts as Record<number, Record<string, unknown> | undefined>;
const missingDeployments = targetNetworkIds.filter(chainId => deployedContractsByChain[chainId] === undefined);

function deploymentMetadataRecoveryHint(chainIds: number[]) {
  if (chainIds.includes(8453)) {
    return "For Base mainnet, restore the existing production deployment metadata/contracts package and run yarn base-mainnet:check. For staging or new networks, deploy contracts before enabling them.";
  }

  return "For staging or new networks, deploy contracts before enabling them.";
}

if (missingDeployments.length > 0) {
  throw new Error(
    `Missing deployed contract definitions for chain IDs: ${missingDeployments.join(", ")}. ${deploymentMetadataRecoveryHint(missingDeployments)}`,
  );
}

const missingRequiredContracts = listMissingRequiredTargetContracts(targetNetworkIds, deployedContractsByChain);

if (missingRequiredContracts.length > 0) {
  const missingContractChainIds = [
    ...new Set(
      missingRequiredContracts.map(entry => Number(entry.split(":")[0])).filter(chainId => Number.isInteger(chainId)),
    ),
  ];
  throw new Error(
    `Missing required deployed contract definitions for target networks: ${missingRequiredContracts.join(", ")}. ${deploymentMetadataRecoveryHint(missingContractChainIds)}`,
  );
}

// M-13 (2026-05-22 audit): the previous hardcoded dev fallback was visible in source
// and reusable by anyone who pulled the repo, so a third party could spin up a clone
// under the same WalletConnect project metadata. Require explicit configuration via
// NEXT_PUBLIC_WALLET_CONNECT_PROJECT_ID; when unset, WalletConnect is simply omitted
// from the wallet list (other connectors still work for local development).
const walletConnectProjectId = rawPublicEnv.walletConnectProjectId;

const frontendCode = rawPublicEnv.frontendCode;
if (frontendCode && !isAddress(frontendCode)) {
  throw new Error("NEXT_PUBLIC_FRONTEND_CODE must be a valid address.");
}

export const publicEnv = {
  isProduction,
  targetNetworks,
  alchemyApiKey: rawPublicEnv.alchemyApiKey,
  rpcOverrides,
  useBasePreconfRpc,
  thirdwebClientId: rawPublicEnv.thirdwebClientId,
  walletConnectProjectId,
  get ponderUrl() {
    return requireUrl(
      "NEXT_PUBLIC_PONDER_URL",
      rawPublicEnv.ponderUrl,
      !isProduction ? "http://localhost:42069" : undefined,
    );
  },
  frontendCode: frontendCode as `0x${string}` | undefined,
  rpcFallbackEnabled: !isProduction || rawPublicEnv.enableRpcFallback === "true",
  get configuredAppOrigin() {
    return normalizeAppOrigin(rawPublicEnv.appUrl);
  },
};
