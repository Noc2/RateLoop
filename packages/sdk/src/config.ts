import { RateLoopSdkError } from "./errors";
import type { RateLoopClientConfig, RateLoopSdkOptions } from "./types";

const DEFAULT_TIMEOUT_MS = 10_000;

function normalizeApiBaseUrl(apiBaseUrl?: string) {
  if (!apiBaseUrl) return undefined;

  try {
    const normalized = new URL(apiBaseUrl);
    return normalized.toString().replace(/\/+$/, "");
  } catch {
    throw new RateLoopSdkError(`Invalid apiBaseUrl: ${apiBaseUrl}`);
  }
}

export function resolveClientConfig(options: RateLoopSdkOptions = {}): RateLoopClientConfig {
  return {
    chainId: options.chainId,
    apiBaseUrl: normalizeApiBaseUrl(options.apiBaseUrl),
    frontendCode: options.frontendCode,
    fetchImpl: options.fetchImpl ?? fetch,
    timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  };
}
