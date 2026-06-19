import type { Chain } from "viem";
import { base, baseSepolia } from "viem/chains";

const RPC_CHAIN_NAMES: Record<number, string> = {
  1: "eth-mainnet",
  8453: "base-mainnet",
  84532: "base-sepolia",
  480: "worldchain-mainnet",
  4801: "worldchain-sepolia",
};

type RpcPreferenceOptions = {
  alchemyApiKey?: string;
  basePreconfRpcOverrides?: Partial<Record<number, string>>;
  preferBasePreconfRpc?: boolean;
  rpcOverrides?: Partial<Record<number, string>>;
};

function normalizeHttpUrl(value: string, name = "RPC URL") {
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

  return parsedUrl.toString().replace(/\/$/, "");
}

export function resolveRpcOverrides(values: Partial<Record<number, string | undefined>>) {
  const overrides: Partial<Record<number, string>> = {};

  for (const [chainId, rawValue] of Object.entries(values)) {
    if (!rawValue) {
      continue;
    }

    overrides[Number.parseInt(chainId, 10)] = normalizeHttpUrl(rawValue, `RPC override for chain ${chainId}`);
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
  return (
    (chain.id === 8453 || chain.id === 84532) &&
    chain.rpcUrls.default.http.some(url => /https:\/\/(?:mainnet|sepolia)-preconf\.base\.org\/?$/i.test(url))
  );
}

function isBasePreconfRpcUrl(value: string) {
  return /https:\/\/(?:mainnet|sepolia)-preconf\.base\.org\/?$/i.test(value);
}

function getBaseStandardHttpRpcUrls(chainId: number) {
  if (chainId === base.id) {
    return base.rpcUrls.default.http;
  }

  if (chainId === baseSepolia.id) {
    return baseSepolia.rpcUrls.default.http;
  }

  return [];
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
  if (options.preferBasePreconfRpc && isBasePreconfRpcChain(chain)) {
    const preconfDefaults = chain.rpcUrls.default.http.filter(isBasePreconfRpcUrl);

    return uniqueHttpUrls([
      options.basePreconfRpcOverrides?.[chain.id],
      options.rpcOverrides?.[chain.id],
      buildAlchemyHttpUrl(chain.id, options.alchemyApiKey),
      ...getBaseStandardHttpRpcUrls(chain.id),
      ...preconfDefaults,
    ]);
  }

  return uniqueHttpUrls([
    options.rpcOverrides?.[chain.id],
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
