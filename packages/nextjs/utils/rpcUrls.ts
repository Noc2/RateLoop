import type { Chain } from "viem";

const RPC_CHAIN_NAMES: Record<number, string> = {
  1: "eth-mainnet",
  8453: "base-mainnet",
  84532: "base-sepolia",
};

type RpcPreferenceOptions = {
  alchemyApiKey?: string;
  preferBasePreconfRpc?: boolean;
  rpcOverrides?: Partial<Record<number, string>>;
};

const BASE_PRECONF_CHAIN_IDS = new Set([8453]);

type RpcOverrideOptions = {
  allowLocalhostInProduction?: boolean;
  production?: boolean;
};

function isLocalhostHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase();
  return normalized === "localhost" || normalized === "127.0.0.1" || normalized === "::1" || normalized === "[::1]";
}

function normalizeHttpUrl(value: string, name = "RPC URL", options: RpcOverrideOptions = {}) {
  const trimmedValue = value.trim();
  let parsedUrl: URL;

  try {
    parsedUrl = new URL(trimmedValue);
  } catch {
    throw new Error(`${name} must be a valid http(s) URL.`);
  }

  if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
    throw new Error(`${name} must be a valid http(s) URL.`);
  }

  if (
    options.production &&
    parsedUrl.protocol === "http:" &&
    !(options.allowLocalhostInProduction && isLocalhostHostname(parsedUrl.hostname))
  ) {
    throw new Error(`${name} must use HTTPS in production; localhost HTTP is only allowed for local E2E builds.`);
  }

  return parsedUrl.toString().replace(/\/$/, "");
}

export function resolveRpcOverrides(
  values: Partial<Record<number, string | undefined>>,
  options: RpcOverrideOptions = {},
) {
  const overrides: Partial<Record<number, string>> = {};

  for (const [chainId, rawValue] of Object.entries(values)) {
    if (!rawValue) {
      continue;
    }

    overrides[Number.parseInt(chainId, 10)] = normalizeHttpUrl(rawValue, `RPC override for chain ${chainId}`, options);
  }

  return overrides;
}

export function mergeRpcOverrides(...sources: Array<Partial<Record<number, string>> | undefined>) {
  const merged: Partial<Record<number, string>> = {};

  for (const source of sources) {
    if (!source) {
      continue;
    }

    Object.assign(merged, source);
  }

  return merged;
}

function uniqueHttpUrls(values: Array<string | undefined>) {
  return values
    .map(value => value?.trim())
    .filter((value, index, allValues): value is string => Boolean(value) && allValues.indexOf(value) === index);
}

export function isBasePreconfRpcChain(chain: Chain) {
  const experimentalPreconfirmationTime = (chain as { experimental_preconfirmationTime?: unknown })
    .experimental_preconfirmationTime;

  return (
    BASE_PRECONF_CHAIN_IDS.has(chain.id) &&
    typeof experimentalPreconfirmationTime === "number" &&
    Number.isFinite(experimentalPreconfirmationTime)
  );
}

export function buildAlchemyHttpUrl(chainId: number, alchemyApiKey?: string) {
  const apiKey = alchemyApiKey?.trim();
  if (!apiKey) {
    return undefined;
  }

  const chainName = RPC_CHAIN_NAMES[chainId];
  if (!chainName) {
    return undefined;
  }

  return `https://${chainName}.g.alchemy.com/v2/${apiKey}`;
}

export function getPreferredHttpRpcUrls(chain: Chain, options: RpcPreferenceOptions = {}) {
  const configuredRpcOverride = options.rpcOverrides?.[chain.id];

  if (options.preferBasePreconfRpc && isBasePreconfRpcChain(chain)) {
    const preferredRpcUrls = uniqueHttpUrls([configuredRpcOverride]);

    if (preferredRpcUrls.length === 0) {
      throw new Error(
        `NEXT_PUBLIC_USE_BASE_PRECONF_RPC requires NEXT_PUBLIC_RPC_URL_${chain.id} to point at a Flashblocks-capable RPC.`,
      );
    }

    return preferredRpcUrls;
  }

  return uniqueHttpUrls([
    configuredRpcOverride,
    buildAlchemyHttpUrl(chain.id, options.alchemyApiKey),
    ...chain.rpcUrls.default.http,
  ]);
}

export function withPreferredHttpRpcUrls<TChain extends Chain>(chain: TChain, options: RpcPreferenceOptions = {}) {
  const preferredHttpUrls = getPreferredHttpRpcUrls(chain, options);
  const currentHttpUrls = chain.rpcUrls.default.http;

  if (
    preferredHttpUrls.length === currentHttpUrls.length &&
    preferredHttpUrls.every((url, index) => url === currentHttpUrls[index])
  ) {
    return chain;
  }

  return {
    ...chain,
    rpcUrls: {
      ...chain.rpcUrls,
      default: {
        ...chain.rpcUrls.default,
        http: preferredHttpUrls,
      },
    },
  } as TChain;
}
