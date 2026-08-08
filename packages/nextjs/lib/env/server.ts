import "server-only";
import { resolveOptionalAppUrl } from "~~/lib/env/appUrl";

const defaultDevDatabaseUrl = "postgresql://postgres:postgres@127.0.0.1:5432/rateloop_tokenless";

function readEnv(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value || undefined;
}

/** Loopback is the only place a plaintext Postgres connection is acceptable. */
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

export function isLoopbackDatabaseHost(hostname: string) {
  return LOOPBACK_HOSTS.has(hostname.toLowerCase());
}

/**
 * Forces certificate-verified TLS on every non-loopback Postgres connection.
 *
 * The pool sets no `ssl` option, so transport security is decided entirely by
 * this string — and two paths through the previous version left it off:
 *
 * - **No `sslmode` at all.** The upgrade only rewrote `prefer`, `require` and
 *   `verify-ca`, so a URL with no `sslmode` fell through untouched and connected
 *   in plaintext across the public internet from the app host to the database.
 * - **`uselibpqcompat=true` returned the URL unmodified.** In that mode
 *   `pg-connection-string` maps `sslmode=require` to `rejectUnauthorized: false`,
 *   which accepts any certificate — so the one documented option that looked like
 *   it asked for TLS actually disabled verification of it.
 *
 * Both are now refused or upgraded rather than passed through. The question a
 * German security questionnaire asks is whether application-to-database traffic
 * is encrypted *with certificate validation*; the honest answer used to be "it
 * depends on an environment variable no code checks."
 */
function normalizeDatabaseUrl(rawUrl: string): string {
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== "postgres:" && parsed.protocol !== "postgresql:") return rawUrl;
    const loopback = isLoopbackDatabaseHost(parsed.hostname);

    if (parsed.searchParams.get("uselibpqcompat") === "true") {
      if (!loopback) {
        throw new Error(
          "DATABASE_URL must not set uselibpqcompat=true for a remote host: that mode maps sslmode=require to " +
            "rejectUnauthorized=false, which accepts any certificate. Remove it and use sslmode=verify-full.",
        );
      }
      return rawUrl;
    }

    parsed.searchParams.delete("uselibpqcompat");
    const sslMode = parsed.searchParams.get("sslmode");
    if (!loopback) {
      // Absent counts as weak here, which is the case the old code missed.
      if (sslMode !== "verify-full") parsed.searchParams.set("sslmode", "verify-full");
    } else if (sslMode === "prefer" || sslMode === "require" || sslMode === "verify-ca") {
      parsed.searchParams.set("sslmode", "verify-full");
    }
    return parsed.toString();
  } catch (error) {
    // A thrown policy violation must not be swallowed by the parse guard.
    if (error instanceof Error && error.message.startsWith("DATABASE_URL must not")) throw error;
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
