import "dotenv/config";

export type TokenlessAgentsRuntimeConfig = {
  apiKey?: string;
  apiBaseUrl: string;
  apiPath?: string;
  requestTimeoutMs?: number;
};

function readEnv(env: NodeJS.ProcessEnv, name: string) {
  const value = env[name]?.trim();
  return value || undefined;
}

function positiveInteger(value: string | undefined, name: string) {
  if (value === undefined) return undefined;
  if (!/^[1-9]\d*$/.test(value)) {
    throw new Error(`${name} must be a positive base-10 integer.`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) {
    throw new Error(`${name} must be a positive safe integer.`);
  }
  return parsed;
}

function normalizeBaseUrl(value: string) {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("RATELOOP_API_BASE_URL must be a valid URL.");
  }

  const loopback = ["localhost", "127.0.0.1", "::1", "[::1]"].includes(
    parsed.hostname.toLowerCase(),
  );
  if (
    parsed.protocol !== "https:" &&
    !(parsed.protocol === "http:" && loopback)
  ) {
    throw new Error(
      "RATELOOP_API_BASE_URL must use HTTPS except for loopback development.",
    );
  }
  if (parsed.username || parsed.password) {
    throw new Error("RATELOOP_API_BASE_URL must not contain credentials.");
  }
  const hostname = parsed.hostname.toLowerCase();
  if (hostname === "rateloop.ai" || hostname.endsWith(".rateloop.ai")) {
    throw new Error(
      "RATELOOP_API_BASE_URL must point to the isolated tokenless deployment, not rateloop.ai.",
    );
  }
  return parsed.toString().replace(/\/+$/, "");
}

function normalizeApiPath(value: string | undefined) {
  if (!value) return undefined;
  if (!value.startsWith("/") || value.includes("?") || value.includes("#")) {
    throw new Error(
      "RATELOOP_AGENT_API_PATH must be an absolute path without a query or fragment.",
    );
  }
  return value.replace(/\/+$/, "");
}

export function loadTokenlessAgentsRuntimeConfig(
  env: NodeJS.ProcessEnv = process.env,
): TokenlessAgentsRuntimeConfig {
  const rawBaseUrl = readEnv(env, "RATELOOP_API_BASE_URL");
  if (!rawBaseUrl) {
    throw new Error(
      "RATELOOP_API_BASE_URL is required. Point it at the isolated tokenless deployment; this package never defaults to the legacy rateloop.ai service.",
    );
  }

  return {
    apiKey: readEnv(env, "RATELOOP_AGENT_API_KEY"),
    apiBaseUrl: normalizeBaseUrl(rawBaseUrl),
    apiPath: normalizeApiPath(readEnv(env, "RATELOOP_AGENT_API_PATH")),
    requestTimeoutMs: positiveInteger(
      readEnv(env, "RATELOOP_REQUEST_TIMEOUT_MS"),
      "RATELOOP_REQUEST_TIMEOUT_MS",
    ),
  };
}
