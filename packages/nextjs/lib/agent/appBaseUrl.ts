import "server-only";
import { resolveOptionalAppUrl } from "~~/lib/env/server";
import { resolveRequestAppBaseUrl } from "~~/lib/url/appRelative";
import { isLocalE2EProductionBuildEnabled } from "~~/utils/env/e2eProduction";

export const AGENT_APP_BASE_URL_REQUIRED_MESSAGE =
  "APP_URL, NEXT_PUBLIC_APP_URL, or VERCEL_PROJECT_PRODUCTION_URL is required to build agent links in production.";

function readEnv(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
}

function configuredProductionAppUrl(): string | null {
  return (
    resolveOptionalAppUrl({
      allowLocalhostInProduction: false,
      production: true,
      rawAppUrl: readEnv("APP_URL"),
      rawPublicAppUrl: readEnv("NEXT_PUBLIC_APP_URL"),
      rawVercelEnv: readEnv("VERCEL_ENV"),
      rawVercelProjectProductionUrl: readEnv("VERCEL_PROJECT_PRODUCTION_URL"),
      rawVercelUrl: undefined,
    }) ?? null
  );
}

function shouldRequireCanonicalAgentAppBaseUrl(): boolean {
  const appEnv = readEnv("APP_ENV");
  const vercelEnv = readEnv("VERCEL_ENV");

  if (appEnv === "production" || vercelEnv === "production") {
    return true;
  }

  if (isLocalE2EProductionBuildEnabled()) {
    return false;
  }

  return process.env.NODE_ENV === "production" && vercelEnv !== "preview" && vercelEnv !== "development";
}

export function resolveAgentAppBaseUrl(requestUrl: string, routePath: string): string | null {
  if (shouldRequireCanonicalAgentAppBaseUrl()) {
    return configuredProductionAppUrl();
  }

  return resolveRequestAppBaseUrl(requestUrl, routePath);
}
