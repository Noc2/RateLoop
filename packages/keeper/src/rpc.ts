import { fallback, http, type Transport } from "viem";

const RPC_TIMEOUT_MS = 8_000;

export function createOrderedRpcFallbackTransport(
  transports: readonly Transport[],
): Transport {
  if (transports.length === 0) {
    throw new Error("At least one RPC transport is required");
  }
  if (transports.length === 1) return transports[0]!;
  return fallback(transports, { rank: false, retryCount: 0 });
}

export function createConfiguredRpcTransport(rpcUrls: readonly string[]) {
  return createOrderedRpcFallbackTransport(
    rpcUrls.map((url) => http(url, { retryCount: 0, timeout: RPC_TIMEOUT_MS })),
  );
}
