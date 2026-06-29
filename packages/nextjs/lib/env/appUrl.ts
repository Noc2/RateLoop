import { isIP } from "node:net";

const RATELOOP_TRUSTED_APP_HOSTNAME_SUFFIX = ".rateloop.ai";

function normalizeUrlHostname(hostname: string): string {
  return hostname
    .toLowerCase()
    .replace(/^\[(.*)\]$/, "$1")
    .replace(/\.+$/, "");
}

function isLocalhostHostname(hostname: string): boolean {
  const normalized = normalizeUrlHostname(hostname);
  return normalized === "localhost" || normalized === "127.0.0.1" || normalized === "::1";
}

function isIpLiteralHostname(hostname: string): boolean {
  return isIP(normalizeUrlHostname(hostname)) !== 0;
}

function isProductionInternalAppHostname(hostname: string): boolean {
  const normalized = normalizeUrlHostname(hostname);
  return (
    !normalized.includes(".") ||
    normalized.endsWith(".localhost") ||
    normalized.endsWith(".local") ||
    normalized.endsWith(".internal")
  );
}

function isTrustedRateLoopAppHostname(hostname: string): boolean {
  const normalized = normalizeUrlHostname(hostname);
  return normalized === "rateloop.ai" || normalized.endsWith(RATELOOP_TRUSTED_APP_HOSTNAME_SUFFIX);
}

function resolveVercelHostUrl(rawValue: string | undefined): string | undefined {
  const trimmed = rawValue?.trim();
  if (!trimmed) {
    return undefined;
  }

  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

export function resolveAppUrl(
  rawValue: string | undefined,
  production: boolean,
  allowLocalhostInProduction = false,
): string | null {
  const resolvedValue = rawValue?.trim() || (!production ? "http://localhost:3000" : undefined);

  if (!resolvedValue) {
    return null;
  }

  try {
    const url = new URL(resolvedValue);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return null;
    }
    if (production) {
      const allowLocalhost = allowLocalhostInProduction && isLocalhostHostname(url.hostname);
      if (url.username || url.password) {
        return null;
      }
      if (url.protocol === "http:" && !allowLocalhost) {
        return null;
      }
      if (!allowLocalhost) {
        if (isLocalhostHostname(url.hostname) || isIpLiteralHostname(url.hostname)) {
          return null;
        }
        if (isProductionInternalAppHostname(url.hostname)) {
          return null;
        }
      }
    }
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
  allowLocalhostInProduction?: boolean;
}): string | undefined {
  const allowLocalhostInProduction = options.allowLocalhostInProduction ?? false;

  return (
    resolveAppUrl(options.rawAppUrl ?? options.rawPublicAppUrl, options.production, allowLocalhostInProduction) ??
    resolveAppUrl(
      options.rawVercelEnv === "production" ? resolveVercelHostUrl(options.rawVercelProjectProductionUrl) : undefined,
      options.production,
      allowLocalhostInProduction,
    ) ??
    resolveAppUrl(resolveVercelHostUrl(options.rawVercelUrl), options.production, allowLocalhostInProduction) ??
    undefined
  );
}

export function resolveTrustedRateLoopAppUrl(options: {
  rawAppUrl?: string;
  rawPublicAppUrl?: string;
  rawVercelEnv?: string;
  rawVercelProjectProductionUrl?: string;
  rawVercelUrl?: string;
  production: boolean;
  allowLocalhostInProduction?: boolean;
}): string | undefined {
  const allowLocalhostInProduction = options.allowLocalhostInProduction ?? false;
  const candidates = [
    options.rawAppUrl,
    options.rawPublicAppUrl,
    options.rawVercelEnv === "production" ? resolveVercelHostUrl(options.rawVercelProjectProductionUrl) : undefined,
    resolveVercelHostUrl(options.rawVercelUrl),
  ];

  for (const candidate of candidates) {
    const resolved = candidate ? resolveAppUrl(candidate, options.production, allowLocalhostInProduction) : null;
    if (!resolved) continue;
    if (options.production) {
      const parsed = new URL(resolved);
      const allowLocalhost = allowLocalhostInProduction && isLocalhostHostname(parsed.hostname);
      if (!allowLocalhost && !isTrustedRateLoopAppHostname(parsed.hostname)) continue;
    }
    return resolved;
  }

  return undefined;
}
