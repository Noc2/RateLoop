import "server-only";
import { resolveOptionalAppUrl } from "~~/lib/env/appUrl";

const defaultDevDatabaseUrl = "postgresql://postgres:postgres@127.0.0.1:5432/rateloop_tokenless";

function readEnv(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value || undefined;
}

function normalizeDatabaseUrl(rawUrl: string): string {
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== "postgres:" && parsed.protocol !== "postgresql:") return rawUrl;

    const useLibpqCompat = parsed.searchParams.get("uselibpqcompat");
    if (useLibpqCompat === "true") return rawUrl;

    parsed.searchParams.delete("uselibpqcompat");
    const sslMode = parsed.searchParams.get("sslmode");
    if (sslMode === "prefer" || sslMode === "require" || sslMode === "verify-ca") {
      parsed.searchParams.set("sslmode", "verify-full");
    }
    return parsed.toString();
  } catch {
    return rawUrl;
  }
}

export function getDatabaseConfig() {
  const configured = readEnv("DATABASE_URL");
  const url = configured
    ? normalizeDatabaseUrl(configured)
    : process.env.NODE_ENV === "production"
      ? undefined
      : defaultDevDatabaseUrl;

  if (!url) throw new Error("DATABASE_URL is required in production.");
  return { url };
}

export function getOptionalAppUrl() {
  return resolveOptionalAppUrl({
    rawAppUrl: readEnv("APP_URL"),
    rawPublicAppUrl: readEnv("NEXT_PUBLIC_APP_URL"),
    rawVercelEnv: readEnv("VERCEL_ENV"),
    rawVercelProjectProductionUrl: readEnv("VERCEL_PROJECT_PRODUCTION_URL"),
    rawVercelUrl: readEnv("VERCEL_URL"),
    production: process.env.NODE_ENV === "production",
  });
}

export function getResendConfig() {
  return {
    apiKey: readEnv("RESEND_API_KEY"),
    fromEmail: readEnv("RESEND_FROM_EMAIL"),
  };
}
