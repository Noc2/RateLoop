import { fallback, http, type Transport } from "viem";
import type { TokenlessDeployment } from "./protocol-deployment";

const MAXIMUM_RPC_FALLBACKS = 3;
const RPC_TIMEOUT_MS = 8_000;

export function resolvePonderRpcUrls(
  deployment: TokenlessDeployment,
  env: NodeJS.ProcessEnv = process.env,
) {
  const primaryKey = `PONDER_RPC_URL_${deployment.chainId}`;
  const fallbackKey = `PONDER_RPC_FALLBACK_URLS_${deployment.chainId}`;
  const primary =
    env[primaryKey]?.trim() ||
    (deployment.network === "hardhat" ? "http://127.0.0.1:8545" : "");
  if (!primary) throw new Error(`${primaryKey} is required.`);
  const fallbacks = (env[fallbackKey] ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  if (deployment.network !== "hardhat" && fallbacks.length === 0) {
    throw new Error(
      `${fallbackKey} must contain at least one independent HTTPS RPC.`,
    );
  }
  if (fallbacks.length > MAXIMUM_RPC_FALLBACKS) {
    throw new Error(
      `${fallbackKey} must contain at most ${MAXIMUM_RPC_FALLBACKS} URLs.`,
    );
  }
  const normalized = [primary, ...fallbacks].map((value, index) => {
    const key = index === 0 ? primaryKey : fallbackKey;
    let parsed: URL;
    try {
      parsed = new URL(value);
    } catch {
      throw new Error(`${key} must contain valid HTTP URLs.`);
    }
    if (
      !["http:", "https:"].includes(parsed.protocol) ||
      parsed.username ||
      parsed.password ||
      parsed.hash
    ) {
      throw new Error(
        `${key} must contain HTTP URLs without embedded credentials or fragments.`,
      );
    }
    if (deployment.network !== "hardhat" && parsed.protocol !== "https:") {
      throw new Error(`${key} must use HTTPS.`);
    }
    return parsed.toString();
  });
  if (new Set(normalized).size !== normalized.length) {
    throw new Error(`${primaryKey} and ${fallbackKey} must be distinct.`);
  }
  return normalized;
}

export function createOrderedRpcFallbackTransport(
  transports: readonly Transport[],
): Transport {
  if (transports.length === 0)
    throw new Error("At least one RPC transport is required.");
  if (transports.length === 1) return transports[0]!;
  return fallback(transports, { rank: false, retryCount: 0 });
}

export function createPonderRpcTransport(rpcUrls: readonly string[]) {
  return createOrderedRpcFallbackTransport(
    rpcUrls.map((url) => http(url, { retryCount: 0, timeout: RPC_TIMEOUT_MS })),
  );
}
