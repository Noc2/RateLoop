import { assertNextConfigBuildGuards } from "./config/buildGuards";
import { DEFAULT_LOCALE, SUPPORTED_LOCALES } from "./i18n/config";
import withBundleAnalyzer from "@next/bundle-analyzer";
import { loadEnvConfig } from "@next/env";
import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

loadEnvConfig(dirname(fileURLToPath(import.meta.url)));
assertNextConfigBuildGuards();

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin-allow-popups" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  },
];

const evidenceShareHeaders = [
  { key: "Cache-Control", value: "private, no-store, max-age=0" },
  { key: "Referrer-Policy", value: "no-referrer" },
  { key: "X-Robots-Tag", value: "noindex, nofollow, noarchive" },
];

const evidenceShareSources = [
  "/evidence/share/:path*",
  ...SUPPORTED_LOCALES.filter(locale => locale !== DEFAULT_LOCALE).map(locale => `/${locale}/evidence/share/:path*`),
];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  devIndicators: false,
  transpilePackages: ["@rateloop/sdk"],
  typescript: {
    ignoreBuildErrors: false,
  },
  eslint: {
    ignoreDuringBuilds: false,
  },
  headers: async () => [
    {
      source: "/(.*)",
      headers: securityHeaders,
    },
    ...evidenceShareSources.map(source => ({ source, headers: evidenceShareHeaders })),
  ],
};

const withNextIntl = createNextIntlPlugin("./i18n/request.ts");
const configuredNext = process.env.ANALYZE === "true" ? withBundleAnalyzer({ enabled: true })(nextConfig) : nextConfig;

module.exports = withNextIntl(configuredNext);
