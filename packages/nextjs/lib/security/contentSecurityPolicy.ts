import { RPC_OVERRIDES } from "~~/config/shared";
import { isLocalE2EProductionBuildEnabled } from "~~/utils/env/e2eProduction";
import { resolvePonderUrlValue } from "~~/utils/env/ponderUrl";
import { DEFAULT_DEV_TARGET_NETWORKS, resolveTargetNetworks } from "~~/utils/env/targetNetworks";
import { mergeRpcOverrides, resolveRpcOverrides } from "~~/utils/rpcUrls";

type ContentSecurityPolicyOptions = {
  isDev?: boolean;
  isVercelLiveEnabled?: boolean;
  nonce?: string;
  ponderUrl?: string | null;
  rpcOrigins?: string[];
};

const RPC_ENV_KEYS = ["NEXT_PUBLIC_RPC_URL_31337", "NEXT_PUBLIC_RPC_URL_84532", "NEXT_PUBLIC_RPC_URL_8453"] as const;

function toOrigin(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    return new URL(value).origin;
  } catch {
    return undefined;
  }
}

function compactUniqueSources(values: Array<string | null | undefined>) {
  return values.filter(
    (value, index, allValues): value is string => Boolean(value) && allValues.indexOf(value) === index,
  );
}

export function createContentSecurityPolicyNonce() {
  return crypto.randomUUID().replace(/-/g, "");
}

export function resolveRuntimeContentSecurityPolicyOptions(): ContentSecurityPolicyOptions {
  const isDev = process.env.NODE_ENV === "development";
  const allowLocalE2EProductionBuild = isLocalE2EProductionBuildEnabled();
  const targetNetworksFallback = isDev || allowLocalE2EProductionBuild ? DEFAULT_DEV_TARGET_NETWORKS : undefined;
  const rpcOverrides = mergeRpcOverrides(
    RPC_OVERRIDES,
    resolveRpcOverrides(
      {
        31337: process.env.NEXT_PUBLIC_RPC_URL_31337,
        84532: process.env.NEXT_PUBLIC_RPC_URL_84532,
        8453: process.env.NEXT_PUBLIC_RPC_URL_8453,
      },
      {
        allowLocalhostInProduction: allowLocalE2EProductionBuild,
        production: !isDev,
      },
    ),
  );
  const targetNetworks = resolveTargetNetworks(process.env.NEXT_PUBLIC_TARGET_NETWORKS, {
    alchemyApiKey: process.env.NEXT_PUBLIC_ALCHEMY_API_KEY,
    allowFoundryInProduction: allowLocalE2EProductionBuild,
    production: !isDev,
    fallback: targetNetworksFallback,
    rpcOverrides,
    useBasePreconfRpc: process.env.NEXT_PUBLIC_USE_BASE_PRECONF_RPC === "true",
  });
  const rpcUrls = [
    ...targetNetworks.flatMap(network => network.rpcUrls.default.http),
    ...Object.values(rpcOverrides as Partial<Record<number, string>>).filter((value): value is string =>
      Boolean(value),
    ),
  ];

  return {
    isDev,
    isVercelLiveEnabled: process.env.VERCEL_ENV === "preview" || process.env.VERCEL_ENV === "development",
    ponderUrl:
      toOrigin(
        resolvePonderUrlValue(process.env.NEXT_PUBLIC_PONDER_URL, !isDev, allowLocalE2EProductionBuild).url ??
          undefined,
      ) ?? null,
    rpcOrigins: compactUniqueSources([...rpcUrls, ...RPC_ENV_KEYS.map(key => process.env[key])].map(toOrigin)),
  };
}

export function buildContentSecurityPolicy(options: ContentSecurityPolicyOptions = {}) {
  const isDev = options.isDev ?? false;
  const vercelLiveScriptSources = options.isVercelLiveEnabled ? ["https://vercel.live"] : [];
  const vercelLiveStyleSources = options.isVercelLiveEnabled ? ["https://vercel.live"] : [];
  const vercelLiveFontSources = options.isVercelLiveEnabled ? ["https://vercel.live", "https://assets.vercel.com"] : [];
  const vercelLiveConnectSources = options.isVercelLiveEnabled
    ? ["https://vercel.live", "https://*.pusher.com", "wss://*.pusher.com"]
    : [];
  const vercelLiveFrameSources = options.isVercelLiveEnabled ? ["https://vercel.live"] : [];
  // Style nonces are intentionally omitted: CSP3 ignores 'unsafe-inline' when a nonce is
  // present, and third-party UI libraries inject <style> tags without request nonces.
  const styleSources = compactUniqueSources(["'self'", "'unsafe-inline'", ...vercelLiveStyleSources]);

  const scriptSources = compactUniqueSources([
    "'self'",
    options.nonce ? `'nonce-${options.nonce}'` : undefined,
    "'wasm-unsafe-eval'",
    "https://scripts.simpleanalyticscdn.com",
    ...(isDev ? ["'unsafe-eval'"] : []),
    ...vercelLiveScriptSources,
  ]);

  const directives = [
    "default-src 'self'",
    ["script-src", ...scriptSources].join(" "),
    ["style-src", ...styleSources].join(" "),
    ["font-src 'self'", "https://world-id-assets.com", ...vercelLiveFontSources].join(" "),
    "img-src 'self' data: blob: https:",
    compactUniqueSources([
      "connect-src 'self'",
      options.ponderUrl,
      // RPC & blockchain
      "https://*.g.alchemy.com",
      ...(options.rpcOrigins ?? []),
      // drand (tlock encryption)
      "https://api.drand.sh",
      "https://mainnet.drand.sh",
      "https://testnet-api.drand.cloudflare.com",
      // World ID bridge + verification assets
      "https://bridge.worldcoin.org",
      "https://developer.world.org",
      "https://simulator.worldcoin.org",
      "https://*.worldcoin.org",
      "wss://*.worldcoin.org",
      // Wallet connections
      "wss://*.walletconnect.com",
      "https://*.walletconnect.com",
      "https://*.walletconnect.org",
      "https://api.web3modal.org",
      "https://*.thirdweb.com",
      // Vercel Blob browser uploads request client upload URLs from this API host
      // before writing to the storage host below.
      "https://vercel.com",
      "https://*.blob.vercel-storage.com",
      // Simple Analytics
      "https://scripts.simpleanalyticscdn.com",
      "https://queue.simpleanalyticscdn.com",
      ...vercelLiveConnectSources,
      // Public question details may be hosted as immutable raw GitHub Gist text.
      "https://gist.githubusercontent.com",
      // Coinbase Wallet SDK
      "https://cca-lite.coinbase.com",
      "https://www.youtube.com",
      // Dev-only
      ...(isDev ? ["http://localhost:*", "http://127.0.0.1:*", "ws://localhost:*", "ws://127.0.0.1:*"] : []),
    ]).join(" "),
    [
      "frame-src 'self'",
      "https://embedded-wallet.thirdweb.com",
      "https://www.youtube-nocookie.com",
      "https://youtube.com",
      "https://bridge.worldcoin.org",
      "https://simulator.worldcoin.org",
      "https://*.worldcoin.org",
      "https://verify.walletconnect.com",
      ...vercelLiveFrameSources,
    ].join(" "),
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ];

  return directives.join("; ");
}
