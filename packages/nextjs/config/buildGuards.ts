const LOCAL_E2E_PRODUCTION_BUILD_FLAGS = [
  "RATELOOP_E2E_PRODUCTION_BUILD",
  "NEXT_PUBLIC_RATELOOP_E2E_PRODUCTION_BUILD",
] as const;

const MAINNET_TARGET_NETWORK_IDS = new Set([480, 8453]);
const LOCALHOST_HOSTNAMES = new Set(["localhost", "127.0.0.1", "::1"]);

type BuildGuardEnv = Record<string, string | undefined>;

function readEnv(env: BuildGuardEnv, name: string): string | undefined {
  const value = env[name]?.trim();
  return value ? value : undefined;
}

function hasLocalE2EProductionBuildFlag(env: BuildGuardEnv): boolean {
  return LOCAL_E2E_PRODUCTION_BUILD_FLAGS.some(name => readEnv(env, name) === "true");
}

function normalizeHostUrl(rawValue: string): string {
  return /^https?:\/\//i.test(rawValue) ? rawValue : `https://${rawValue}`;
}

function isLocalhostUrl(rawValue: string): boolean {
  try {
    const url = new URL(normalizeHostUrl(rawValue));
    return (url.protocol === "http:" || url.protocol === "https:") && LOCALHOST_HOSTNAMES.has(url.hostname);
  } catch {
    return false;
  }
}

function includesMainnetTargetNetwork(rawValue: string | undefined): boolean {
  if (!rawValue) {
    return false;
  }

  return rawValue
    .split(",")
    .map(value => value.trim())
    .filter(Boolean)
    .some(value => /^\d+$/.test(value) && MAINNET_TARGET_NETWORK_IDS.has(Number(value)));
}

function configuredAppUrls(env: BuildGuardEnv): string[] {
  return [
    readEnv(env, "APP_URL"),
    readEnv(env, "NEXT_PUBLIC_APP_URL"),
    readEnv(env, "VERCEL_URL"),
    readEnv(env, "VERCEL_PROJECT_PRODUCTION_URL"),
  ].filter((value): value is string => Boolean(value));
}

function assertSafeLocalE2EProductionBuild(env: BuildGuardEnv): void {
  if (!hasLocalE2EProductionBuildFlag(env)) {
    return;
  }

  if (readEnv(env, "APP_ENV") === "production" || readEnv(env, "VERCEL_ENV") === "production") {
    throw new Error(
      "RATELOOP_E2E_PRODUCTION_BUILD and NEXT_PUBLIC_RATELOOP_E2E_PRODUCTION_BUILD are local-only and must not be set for production deployments.",
    );
  }

  if (includesMainnetTargetNetwork(readEnv(env, "NEXT_PUBLIC_TARGET_NETWORKS"))) {
    throw new Error(
      "RATELOOP_E2E_PRODUCTION_BUILD and NEXT_PUBLIC_RATELOOP_E2E_PRODUCTION_BUILD must not be used with mainnet target networks.",
    );
  }

  if (configuredAppUrls(env).some(value => !isLocalhostUrl(value))) {
    throw new Error(
      "RATELOOP_E2E_PRODUCTION_BUILD and NEXT_PUBLIC_RATELOOP_E2E_PRODUCTION_BUILD require localhost app URLs.",
    );
  }
}

export function assertNextConfigBuildGuards(env: BuildGuardEnv = process.env): void {
  if (readEnv(env, "NEXT_PUBLIC_IGNORE_BUILD_ERROR") === "true") {
    throw new Error(
      "NEXT_PUBLIC_IGNORE_BUILD_ERROR is no longer supported. Fix TypeScript and ESLint errors before deploying.",
    );
  }

  assertSafeLocalE2EProductionBuild(env);
}
