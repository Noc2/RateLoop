import { assertNextConfigBuildGuards } from "./config/buildGuards";
import withBundleAnalyzer from "@next/bundle-analyzer";
import { loadEnvConfig } from "@next/env";
import type { NextConfig } from "next";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

loadEnvConfig(dirname(fileURLToPath(import.meta.url)));
assertNextConfigBuildGuards();

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  },
];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  devIndicators: false,
  transpilePackages: ["@rateloop/contracts", "@rateloop/node-utils", "thirdweb", "@thirdweb-dev/wagmi-adapter"],
  outputFileTracingIncludes: {
    "/api/og/vote": ["./app/api/og/vote/fonts/**/*"],
  },
  typescript: {
    ignoreBuildErrors: false,
  },
  eslint: {
    ignoreDuringBuilds: false,
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
