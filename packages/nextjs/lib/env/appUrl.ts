import { isIP } from "node:net";

function isLocalhost(hostname: string) {
  const normalized = hostname.toLowerCase().replace(/^\[(.*)\]$/, "$1");
  return normalized === "localhost" || normalized === "127.0.0.1" || normalized === "::1";
}

function vercelUrl(value: string | undefined) {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

export function resolveAppUrl(rawValue: string | undefined, production: boolean): string | null {
  const value = rawValue?.trim() || (!production ? "http://localhost:3000" : undefined);
  if (!value) return null;

  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    if (url.username || url.password) return null;
    if (production && (url.protocol !== "https:" || isLocalhost(url.hostname) || isIP(url.hostname))) return null;
    return url.toString().replace(/\/$/, "");
  } catch {
    return null;
  }
}

export function resolveOptionalAppUrl(options: {
  rawAppUrl?: string;
  rawPublicAppUrl?: string;
  rawVercelEnv?: string;
  rawVercelProjectProductionUrl?: string;
  rawVercelUrl?: string;
  production: boolean;
}) {
  return (
    resolveAppUrl(options.rawAppUrl ?? options.rawPublicAppUrl, options.production) ??
    resolveAppUrl(
      options.rawVercelEnv === "production" ? vercelUrl(options.rawVercelProjectProductionUrl) : undefined,
      options.production,
    ) ??
    resolveAppUrl(vercelUrl(options.rawVercelUrl), options.production) ??
    undefined
  );
}
