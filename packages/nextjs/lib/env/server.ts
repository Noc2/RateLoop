import "server-only";
import { RPC_OVERRIDES } from "~~/config/shared";
import { resolveOptionalAppUrl, resolveTrustedRateLoopAppUrl } from "~~/lib/env/appUrl";
import { isLocalE2EProductionBuildEnabled } from "~~/utils/env/e2eProduction";
import { resolvePonderUrlValue } from "~~/utils/env/ponderUrl";
import {
  DEFAULT_DEV_TARGET_NETWORKS,
  type SupportedTargetNetwork,
  resolveTargetNetworks,
} from "~~/utils/env/targetNetworks";
import { mergeRpcOverrides, resolveRpcOverrides } from "~~/utils/rpcUrls";

const isProduction = process.env.NODE_ENV === "production";
const defaultDevDatabaseUrl = "postgresql://postgres:postgres@127.0.0.1:5432/rateloop_app";
const allowLocalE2EProductionBuild = isLocalE2EProductionBuildEnabled();

function readEnv(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
}

export { resolveAppUrl, resolveOptionalAppUrl, resolveTrustedRateLoopAppUrl } from "~~/lib/env/appUrl";

function normalizeDatabaseUrl(rawUrl: string): string {
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== "postgres:" && parsed.protocol !== "postgresql:") {
      return rawUrl;
    }

    const useLibpqCompat = parsed.searchParams.get("uselibpqcompat");
    if (useLibpqCompat === "true") {
      return rawUrl;
    }

    parsed.searchParams.delete("uselibpqcompat");

    const sslMode = parsed.searchParams.get("sslmode");
    if (sslMode === "prefer" || sslMode === "require" || sslMode === "verify-ca") {
      parsed.searchParams.set("sslmode", "verify-full");
      return parsed.toString();
    }

    return parsed.toString();
  } catch {
    return rawUrl;
  }
}

export function resolveServerPonderUrl(
  rawValue: string | undefined,
  production: boolean,
  allowLocalhostInProduction = false,
): string | null {
  return resolvePonderUrlValue(rawValue, production, allowLocalhostInProduction).url;
}

export function getOptionalPonderUrl(): string | null {
  return resolveServerPonderUrl(readEnv("NEXT_PUBLIC_PONDER_URL"), isProduction, allowLocalE2EProductionBuild);
}

export function resolveServerTargetNetworks(
  rawValue: string | undefined,
  production: boolean,
  options?: { allowFoundryInProduction?: boolean },
): [SupportedTargetNetwork, ...SupportedTargetNetwork[]] | null {
  try {
    const allowFoundryInProduction = options?.allowFoundryInProduction ?? allowLocalE2EProductionBuild;
    const rpcOverrides = mergeRpcOverrides(
      RPC_OVERRIDES,
      resolveRpcOverrides(
        {
          31337: readEnv("NEXT_PUBLIC_RPC_URL_31337"),
          84532: readEnv("NEXT_PUBLIC_RPC_URL_84532"),
          8453: readEnv("NEXT_PUBLIC_RPC_URL_8453"),
          4801: readEnv("NEXT_PUBLIC_RPC_URL_4801"),
          480: readEnv("NEXT_PUBLIC_RPC_URL_480"),
        },
        {
          allowLocalhostInProduction: allowLocalE2EProductionBuild,
          production,
        },
      ),
    );
    const serverUseBasePreconfRpc = readEnv("RATELOOP_SERVER_USE_BASE_PRECONF_RPC") === "true";

    return resolveTargetNetworks(rawValue, {
      alchemyApiKey: readEnv("NEXT_PUBLIC_ALCHEMY_API_KEY"),
      production,
      fallback: !production || allowFoundryInProduction ? DEFAULT_DEV_TARGET_NETWORKS : undefined,
      allowFoundryInProduction,
      rpcOverrides,
      useBasePreconfRpc: serverUseBasePreconfRpc,
    });
  } catch {
    return null;
  }
}

function getServerTargetNetworks(): [SupportedTargetNetwork, ...SupportedTargetNetwork[]] | null {
  return resolveServerTargetNetworks(readEnv("NEXT_PUBLIC_TARGET_NETWORKS"), isProduction);
}

export function getPrimaryServerTargetNetwork(): SupportedTargetNetwork | null {
  return getServerTargetNetworks()?.[0] ?? null;
}

export function getServerTargetNetworkById(chainId: number): SupportedTargetNetwork | null {
  return getServerTargetNetworks()?.find(network => network.id === chainId) ?? null;
}

export function getServerRpcOverrides(): Partial<Record<number, string>> {
  return mergeRpcOverrides(
    RPC_OVERRIDES,
    resolveRpcOverrides(
      {
        31337: readEnv("NEXT_PUBLIC_RPC_URL_31337"),
        84532: readEnv("NEXT_PUBLIC_RPC_URL_84532"),
        8453: readEnv("NEXT_PUBLIC_RPC_URL_8453"),
        4801: readEnv("NEXT_PUBLIC_RPC_URL_4801"),
        480: readEnv("NEXT_PUBLIC_RPC_URL_480"),
      },
      {
        allowLocalhostInProduction: allowLocalE2EProductionBuild,
        production: isProduction,
      },
    ),
  );
}

export function getDatabaseConfig() {
  const rawDatabaseUrl = readEnv("DATABASE_URL");
  const url = rawDatabaseUrl ? normalizeDatabaseUrl(rawDatabaseUrl) : !isProduction ? defaultDevDatabaseUrl : undefined;

  if (!url) {
    throw new Error("DATABASE_URL is required in production.");
  }

  return {
    url,
  };
}

export function getOptionalAppUrl(): string | undefined {
  return resolveOptionalAppUrl({
    rawAppUrl: readEnv("APP_URL"),
    rawPublicAppUrl: readEnv("NEXT_PUBLIC_APP_URL"),
    rawVercelEnv: readEnv("VERCEL_ENV"),
    rawVercelProjectProductionUrl: readEnv("VERCEL_PROJECT_PRODUCTION_URL"),
    rawVercelUrl: readEnv("VERCEL_URL"),
    production: isProduction,
    allowLocalhostInProduction: allowLocalE2EProductionBuild,
  });
}

export function getExplicitAppUrl(): string | undefined {
  const hasConfiguredAppUrl = Boolean(
    readEnv("APP_URL") ||
      readEnv("NEXT_PUBLIC_APP_URL") ||
      readEnv("VERCEL_URL") ||
      (readEnv("VERCEL_ENV") === "production" && readEnv("VERCEL_PROJECT_PRODUCTION_URL")),
  );

  return hasConfiguredAppUrl ? getOptionalAppUrl() : undefined;
}

export function getTrustedRateLoopAppUrl(): string | undefined {
  return resolveTrustedRateLoopAppUrl({
    rawAppUrl: readEnv("APP_URL"),
    rawPublicAppUrl: readEnv("NEXT_PUBLIC_APP_URL"),
    rawVercelEnv: readEnv("VERCEL_ENV"),
    rawVercelProjectProductionUrl: readEnv("VERCEL_PROJECT_PRODUCTION_URL"),
    rawVercelUrl: readEnv("VERCEL_URL"),
    production: process.env.NODE_ENV === "production",
    allowLocalhostInProduction: isLocalE2EProductionBuildEnabled(),
  });
}

export function getResendConfig() {
  return {
    apiKey: readEnv("RESEND_API_KEY"),
    fromEmail: readEnv("RESEND_FROM_EMAIL"),
    appUrl: getOptionalAppUrl(),
  };
}

export function getNotificationDeliverySecret(): string | undefined {
  return readEnv("NOTIFICATION_DELIVERY_SECRET");
}

export function getConfidentialityJobSecrets(): string[] {
  return [readEnv("RATELOOP_CONFIDENTIALITY_JOB_SECRET"), readEnv("CRON_SECRET")].filter((secret): secret is string =>
    Boolean(secret),
  );
}

export function getThirdwebClientId(): string | undefined {
  return readEnv("NEXT_PUBLIC_THIRDWEB_CLIENT_ID");
}

export function getThirdwebServerVerifierSecret(): string | undefined {
  return readEnv("THIRDWEB_SERVER_VERIFIER_SECRET");
}

function readChainScopedEnv(name: string, chainId: number | undefined): string | undefined {
  return chainId === undefined ? undefined : readEnv(`${name}_${chainId}`);
}

export function getX402UsdcAddressOverride(chainId?: number): `0x${string}` | undefined {
  const publicUsdc = (
    readChainScopedEnv("NEXT_PUBLIC_USDC_ADDRESS", chainId) ?? readEnv("NEXT_PUBLIC_USDC_ADDRESS")
  )?.trim();
  const publicX402Usdc = (
    readChainScopedEnv("NEXT_PUBLIC_RATELOOP_X402_USDC_ADDRESS", chainId) ??
    readEnv("NEXT_PUBLIC_RATELOOP_X402_USDC_ADDRESS")
  )?.trim();
  const serverUsdc = (
    readChainScopedEnv("RATELOOP_X402_USDC_ADDRESS", chainId) ?? readEnv("RATELOOP_X402_USDC_ADDRESS")
  )?.trim();
  const normalizedPublic = publicUsdc?.startsWith("0x") ? (publicUsdc.toLowerCase() as `0x${string}`) : undefined;
  const normalizedPublicX402 = publicX402Usdc?.startsWith("0x")
    ? (publicX402Usdc.toLowerCase() as `0x${string}`)
    : undefined;
  const normalizedServer = serverUsdc?.startsWith("0x") ? (serverUsdc.toLowerCase() as `0x${string}`) : undefined;

  const configured = [normalizedPublic, normalizedPublicX402, normalizedServer].filter(
    (value): value is `0x${string}` => value !== undefined,
  );
  const unique = [...new Set(configured)];
  if (unique.length > 1) {
    throw new Error(
      "NEXT_PUBLIC_USDC_ADDRESS, NEXT_PUBLIC_RATELOOP_X402_USDC_ADDRESS, and RATELOOP_X402_USDC_ADDRESS must match when multiple are set for the same chain.",
    );
  }
  if (normalizedServer && !normalizedPublic && !normalizedPublicX402) {
    throw new Error(
      "RATELOOP_X402_USDC_ADDRESS requires NEXT_PUBLIC_USDC_ADDRESS or NEXT_PUBLIC_RATELOOP_X402_USDC_ADDRESS for browser parity on the same chain.",
    );
  }
  return normalizedServer ?? normalizedPublicX402 ?? normalizedPublic;
}

export function getFreeTransactionLimit(): number {
  const rawValue = readEnv("FREE_TRANSACTION_LIMIT");
  const parsedValue = rawValue ? Number.parseInt(rawValue, 10) : Number.NaN;

  if (!Number.isFinite(parsedValue) || parsedValue <= 0) {
    return 25;
  }

  return parsedValue;
}

export function getServerEnvironmentScope(): string {
  return (
    readEnv("APP_ENV") ??
    readEnv("VERCEL_ENV") ??
    readEnv("RAILWAY_ENVIRONMENT_NAME") ??
    process.env.NODE_ENV ??
    "development"
  );
}
