import { RPC_OVERRIDES } from "./config/shared";
import { isLocalE2EProductionBuildEnabled } from "./utils/env/e2eProduction";
import { resolvePonderUrlValue } from "./utils/env/ponderUrl";
import { DEFAULT_DEV_TARGET_NETWORKS, resolveTargetNetworks } from "./utils/env/targetNetworks";
import { mergeRpcOverrides, resolveRpcOverrides } from "./utils/rpcUrls";
import withBundleAnalyzer from "@next/bundle-analyzer";
import { loadEnvConfig } from "@next/env";
import type { NextConfig } from "next";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

loadEnvConfig(dirname(fileURLToPath(import.meta.url)));

const isDev = process.env.NODE_ENV === "development";
// WS-5 (2026-05-21 repo audit): Vercel Live is a preview-deployment debugging feature; it
// should not load on production. The CSP previously allowed `https://vercel.live` and
// `wss://*.pusher.com` for every Vercel deployment (incl. production) which widened the
// trusted-script and connect-src surface for production users. Narrow the gate to
// preview / development only.
//
// N-3 (2026-05-22 audit): VERCEL_ENV is set exclusively by the Vercel build/runtime
// platform — it is not user-supplied and cannot be spoofed from a browser request.
// See https://vercel.com/docs/projects/environment-variables/system-environment-variables.
// If this CSP gate is ever ported off Vercel, replace the check with the new platform's
// equivalent rather than relying on a request-derived signal.
const isVercelLiveEnabled = process.env.VERCEL_ENV === "preview" || process.env.VERCEL_ENV === "development";
const allowLocalE2EProductionBuild = isLocalE2EProductionBuildEnabled();
const targetNetworksFallback = isDev || allowLocalE2EProductionBuild ? DEFAULT_DEV_TARGET_NETWORKS : undefined;
const rpcOverrides = mergeRpcOverrides(
  RPC_OVERRIDES,
  resolveRpcOverrides({
    31337: process.env.NEXT_PUBLIC_RPC_URL_31337,
    84532: process.env.NEXT_PUBLIC_RPC_URL_84532,
    8453: process.env.NEXT_PUBLIC_RPC_URL_8453,
    4801: process.env.NEXT_PUBLIC_RPC_URL_4801,
    480: process.env.NEXT_PUBLIC_RPC_URL_480,
  }),
);
const targetNetworks = resolveTargetNetworks(process.env.NEXT_PUBLIC_TARGET_NETWORKS, {
  alchemyApiKey: process.env.NEXT_PUBLIC_ALCHEMY_API_KEY,
  allowFoundryInProduction: allowLocalE2EProductionBuild,
  production: !isDev,
  fallback: targetNetworksFallback,
  rpcOverrides,
});

function toOrigin(value: string): string | undefined {
  try {
    return new URL(value).origin;
  } catch {
    return undefined;
  }
}

const rpcUrls = [
  ...targetNetworks.flatMap(network => network.rpcUrls.default.http),
  ...Object.values(rpcOverrides as Partial<Record<number, string>>).filter((value): value is string => Boolean(value)),
] as const;

const rpcOrigins = rpcUrls
  .map(toOrigin)
  .filter((value, index, values): value is string => Boolean(value) && values.indexOf(value) === index);

// Build CSP directives. Production Ponder URL comes from env at build time.
const ponderUrl =
  resolvePonderUrlValue(process.env.NEXT_PUBLIC_PONDER_URL, !isDev, allowLocalE2EProductionBuild).url ?? "";
const vercelLiveScriptSources = isVercelLiveEnabled ? ["https://vercel.live"] : [];
const vercelLiveStyleSources = isVercelLiveEnabled ? ["https://vercel.live"] : [];
const vercelLiveFontSources = isVercelLiveEnabled ? ["https://vercel.live", "https://assets.vercel.com"] : [];
const vercelLiveConnectSources = isVercelLiveEnabled
  ? ["https://vercel.live", "https://*.pusher.com", "wss://*.pusher.com"]
  : [];
const vercelLiveFrameSources = isVercelLiveEnabled ? ["https://vercel.live"] : [];
const cspDirectives = [
  "default-src 'self'",
  // Static CSP headers need inline bootstrap scripts for Next's production app shell.
  [
    "script-src 'self' 'wasm-unsafe-eval' 'unsafe-inline'",
    "https://scripts.simpleanalyticscdn.com",
    ...(isDev ? ["'unsafe-eval'"] : []),
    ...vercelLiveScriptSources,
  ].join(" "),
  ["style-src 'self' 'unsafe-inline'", ...vercelLiveStyleSources].join(" "),
  ["font-src 'self'", "https://world-id-assets.com", ...vercelLiveFontSources].join(" "),
  "img-src 'self' data: blob: https:",
  [
    "connect-src 'self'",
    ponderUrl,
    // RPC & blockchain
    "https://*.g.alchemy.com",
    ...rpcOrigins,
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
    // Coinbase Wallet SDK
    "https://cca-lite.coinbase.com",
    "https://www.youtube.com",
    // Dev-only
    ...(isDev ? ["http://localhost:*", "http://127.0.0.1:*", "ws://localhost:*", "ws://127.0.0.1:*"] : []),
  ]
    .filter(Boolean)
    .join(" "),
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

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  },
  {
    key: "Content-Security-Policy",
    value: cspDirectives.join("; "),
  },
];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  devIndicators: false,
  transpilePackages: ["@rateloop/contracts", "@rateloop/node-utils", "thirdweb", "@thirdweb-dev/wagmi-adapter"],
  typescript: {
    ignoreBuildErrors: process.env.NEXT_PUBLIC_IGNORE_BUILD_ERROR === "true",
  },
  eslint: {
    ignoreDuringBuilds: process.env.NEXT_PUBLIC_IGNORE_BUILD_ERROR === "true",
  },
  webpack: config => {
    config.resolve.fallback = { fs: false, net: false, tls: false };
    config.externals.push("pino-pretty", "lokijs", "encoding");
    return config;
  },
  headers: async () => [
    {
      source: "/(.*)",
      headers: securityHeaders,
    },
    {
      // WS-1 (2026-05-21 repo audit): the browser-signing route receives a bearer `token` in its
      // initial URL. Even after client-side `history.replaceState` strips it, a navigation that
      // resolves before the strip runs (or that we later add) could emit a Referer header
      // carrying the token. Force `no-referrer` on this path so the token can never leave the
      // origin via Referer.
      source: "/agent/sign/:path*",
      headers: [{ key: "Referrer-Policy", value: "no-referrer" }],
    },
    {
      source: "/agent/handoff/:path*",
      headers: [{ key: "Referrer-Policy", value: "no-referrer" }],
    },
  ],
};

module.exports = process.env.ANALYZE === "true" ? withBundleAnalyzer({ enabled: true })(nextConfig) : nextConfig;
