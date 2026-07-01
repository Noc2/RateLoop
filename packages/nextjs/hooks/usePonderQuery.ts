"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { invalidatePonderCache, isPonderAvailable, isPonderRateLimitError } from "~~/services/ponder/client";

const PONDER_QUERY_MAX_RETRIES = 2;
const PONDER_QUERY_RETRY_BASE_DELAY_MS = 750;
const PONDER_QUERY_RETRY_MAX_DELAY_MS = 3_000;

interface UsePonderQueryOptions<TPonder, TRpc> {
  queryKey: readonly unknown[];
  /** Deployment key that the configured Ponder endpoint must report before this query uses it. */
  availabilityDeploymentKey?: string | null;
  /** Fetch data from Ponder API */
  ponderFn: () => Promise<TPonder>;
  /** Fetch data from RPC as fallback */
  rpcFn: () => Promise<TRpc>;
  /** Whether the RPC fallback is allowed */
  rpcEnabled?: boolean;
  /** Whether the query is enabled */
  enabled?: boolean;
  /** How long data stays fresh (ms) */
  staleTime?: number;
  /** Auto-refetch interval (ms). Set to false to disable. */
  refetchInterval?: number | false;
  /** Keep previous data visible while new data is loading (e.g. pagination, filter changes) */
  keepPrevious?: boolean;
}

interface PonderQueryResult<T> {
  data: T;
  source: "ponder" | "rpc";
}

export function shouldRetryPonderQueryFailure(failureCount: number, error: unknown) {
  return !isPonderRateLimitError(error) && failureCount < PONDER_QUERY_MAX_RETRIES;
}

export function getPonderQueryRetryDelay(attemptIndex: number) {
  return Math.min(PONDER_QUERY_RETRY_BASE_DELAY_MS * 2 ** attemptIndex, PONDER_QUERY_RETRY_MAX_DELAY_MS);
}

/**
 * Hook that tries Ponder API first, falling back to RPC if unavailable.
 *
 * Usage:
 * ```ts
 * const { data } = usePonderQuery({
 *   queryKey: ["contentFeed"],
 *   ponderFn: () => ponderApi.getContent(),
 *   rpcFn: () => fetchContentFromRpc(),
 * });
 * // data.data = the actual data
 * // data.source = "ponder" | "rpc"
 * ```
 */
export function usePonderQuery<TPonder, TRpc>({
  queryKey,
  availabilityDeploymentKey,
  ponderFn,
  rpcFn,
  rpcEnabled = true,
  enabled = true,
  staleTime = 10_000,
  refetchInterval = false,
  keepPrevious = false,
}: UsePonderQueryOptions<TPonder, TRpc>) {
  return useQuery({
    queryKey: ["ponder-fallback", ...queryKey],
    queryFn: async (): Promise<PonderQueryResult<TPonder | TRpc>> => {
      const available = await isPonderAvailable(availabilityDeploymentKey);
      let ponderError: unknown = null;

      if (available) {
        try {
          const data = await ponderFn();
          return { data, source: "ponder" };
        } catch (e) {
          ponderError = e;
          if (process.env.NODE_ENV !== "production") {
            console.warn("[Ponder] Query failed, falling back to RPC:", e);
          }
          if (!isPonderRateLimitError(e)) {
            // Invalidate cache so next query re-checks availability.
            invalidatePonderCache();
          }
        }
      } else if (!rpcEnabled) {
        // No fallback is available, so a retry should perform a fresh
        // availability probe instead of reusing the short-lived failure cache.
        invalidatePonderCache();
      }

      if (!rpcEnabled) {
        if (ponderError) {
          throw ponderError;
        }
        throw new Error("Ponder is unavailable and RPC fallback is disabled.");
      }

      const data = await rpcFn();
      return { data, source: "rpc" };
    },
    enabled,
    staleTime,
    refetchInterval,
    retry: shouldRetryPonderQueryFailure,
    retryDelay: getPonderQueryRetryDelay,
    placeholderData: keepPrevious ? keepPreviousData : undefined,
  });
}
