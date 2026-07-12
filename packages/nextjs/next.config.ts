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
  transpilePackages: ["@rateloop/contracts", "@rateloop/sdk"],
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
  ],
};

module.exports = process.env.ANALYZE === "true" ? withBundleAnalyzer({ enabled: true })(nextConfig) : nextConfig;
