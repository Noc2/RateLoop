"use client";

import { useEffect, useMemo } from "react";
import { type QueryClient, useQuery, useQueryClient } from "@tanstack/react-query";

const SNAPSHOT_MAX_AGE_MS = 120_000;
const STORAGE_KEY_PREFIX = "rateloop:wallet-display-summary:";

export interface WalletDisplaySummary {
  liquidMicro: bigint;
  votingStakedMicro: bigint;
  submissionStakedMicro: bigint;
  frontendStakedMicro: bigint;
  pendingLiquidCreditMicro: bigint;
  pendingStakedMicro: bigint;
  totalStakedMicro: bigint;
  totalMicro: bigint;
  updatedAt: number;
}

interface WalletDisplaySummaryInput {
  liquidMicro: bigint;
  votingStakedMicro: bigint;
  submissionStakedMicro: bigint;
  frontendStakedMicro: bigint;
}

export function getWalletDisplaySummaryQueryKey(address: string, chainId?: number) {
  return ["wallet-display-summary", chainId ?? null, address.toLowerCase()] as const;
}

function getStorageKey(address: string, chainId?: number) {
  return `${STORAGE_KEY_PREFIX}${chainId ?? "unknown"}:${address.toLowerCase()}`;
}

function isSnapshotFresh(snapshot: WalletDisplaySummary, now = Date.now()) {
  return now - snapshot.updatedAt <= SNAPSHOT_MAX_AGE_MS;
}

export function buildWalletDisplaySummary(
  input: WalletDisplaySummaryInput,
  options?: { pendingLiquidCreditMicro?: bigint; pendingStakedMicro?: bigint; totalMicro?: bigint; updatedAt?: number },
): WalletDisplaySummary {
  const pendingLiquidCreditMicro = options?.pendingLiquidCreditMicro ?? 0n;
  const pendingStakedMicro = options?.pendingStakedMicro ?? 0n;
  const totalStakedMicro =
    input.votingStakedMicro + input.submissionStakedMicro + input.frontendStakedMicro + pendingStakedMicro;

  return {
    ...input,
    pendingLiquidCreditMicro,
    pendingStakedMicro,
    totalStakedMicro,
    totalMicro: options?.totalMicro ?? input.liquidMicro + totalStakedMicro,
    updatedAt: options?.updatedAt ?? Date.now(),
  };
}

function snapshotsEqual(a: WalletDisplaySummary, b: WalletDisplaySummary) {
  return (
    a.liquidMicro === b.liquidMicro &&
    a.votingStakedMicro === b.votingStakedMicro &&
    a.submissionStakedMicro === b.submissionStakedMicro &&
    a.frontendStakedMicro === b.frontendStakedMicro &&
    a.pendingLiquidCreditMicro === b.pendingLiquidCreditMicro &&
    a.pendingStakedMicro === b.pendingStakedMicro &&
    a.totalStakedMicro === b.totalStakedMicro &&
    a.totalMicro === b.totalMicro
  );
}

function serializeSnapshot(snapshot: WalletDisplaySummary) {
  return JSON.stringify({
    liquidMicro: snapshot.liquidMicro.toString(),
    votingStakedMicro: snapshot.votingStakedMicro.toString(),
    submissionStakedMicro: snapshot.submissionStakedMicro.toString(),
    frontendStakedMicro: snapshot.frontendStakedMicro.toString(),
    pendingLiquidCreditMicro: snapshot.pendingLiquidCreditMicro.toString(),
    pendingStakedMicro: snapshot.pendingStakedMicro.toString(),
    totalStakedMicro: snapshot.totalStakedMicro.toString(),
    totalMicro: snapshot.totalMicro.toString(),
    updatedAt: snapshot.updatedAt,
  });
}

function deserializeSnapshot(raw: string): WalletDisplaySummary | null {
  try {
    const parsed = JSON.parse(raw) as {
      liquidMicro: string;
      votingStakedMicro: string;
      submissionStakedMicro: string;
      frontendStakedMicro: string;
      pendingLiquidCreditMicro?: string;
      pendingStakedMicro?: string;
      totalStakedMicro: string;
      totalMicro: string;
      updatedAt: number;
    };

    if (
      typeof parsed?.liquidMicro !== "string" ||
      typeof parsed?.votingStakedMicro !== "string" ||
      typeof parsed?.submissionStakedMicro !== "string" ||
      typeof parsed?.frontendStakedMicro !== "string" ||
      typeof parsed?.totalStakedMicro !== "string" ||
      typeof parsed?.totalMicro !== "string" ||
      typeof parsed?.updatedAt !== "number"
    ) {
      return null;
    }

    return {
      liquidMicro: BigInt(parsed.liquidMicro),
      votingStakedMicro: BigInt(parsed.votingStakedMicro),
      submissionStakedMicro: BigInt(parsed.submissionStakedMicro),
      frontendStakedMicro: BigInt(parsed.frontendStakedMicro),
      pendingLiquidCreditMicro: BigInt(parsed.pendingLiquidCreditMicro ?? "0"),
      pendingStakedMicro: BigInt(parsed.pendingStakedMicro ?? "0"),
      totalStakedMicro: BigInt(parsed.totalStakedMicro),
      totalMicro: BigInt(parsed.totalMicro),
      updatedAt: parsed.updatedAt,
    };
  } catch {
    return null;
  }
}

function readPersistedWalletDisplaySummary(address: string | undefined, chainId?: number, now = Date.now()) {
  if (!address || typeof window === "undefined") return null;

  try {
    const key = getStorageKey(address, chainId);
    const raw = window.sessionStorage.getItem(key);
    if (!raw) return null;
    const snapshot = deserializeSnapshot(raw);
    if (!snapshot || !isSnapshotFresh(snapshot, now)) {
      window.sessionStorage.removeItem(key);
      return null;
    }
    return snapshot;
  } catch {
    return null;
  }
}

export function persistWalletDisplaySummarySnapshot(
  address: string | undefined,
  chainId: number | undefined,
  snapshot: WalletDisplaySummary | null,
) {
  if (!address || !snapshot || typeof window === "undefined") return;

  try {
    window.sessionStorage.setItem(getStorageKey(address, chainId), serializeSnapshot(snapshot));
  } catch {
    // Ignore storage failures and continue rendering from in-memory cache.
  }
}

export function clearPersistedWalletDisplaySummarySnapshot(address: string | undefined, chainId?: number) {
  if (!address || typeof window === "undefined") return;

  try {
    window.sessionStorage.removeItem(getStorageKey(address, chainId));
  } catch {
    // Ignore storage failures and continue with the in-memory cache.
  }
}

export function resetWalletDisplaySummaryCache(
  queryClient: QueryClient,
  address: string | undefined,
  chainId?: number,
) {
  if (!address) return;

  clearPersistedWalletDisplaySummarySnapshot(address, chainId);
  queryClient.setQueryData(getWalletDisplaySummaryQueryKey(address, chainId), null);
}

export function applyWalletDisplayLiquidCredit(
  queryClient: QueryClient,
  address: string | undefined,
  chainId: number | undefined,
  creditMicro: bigint | undefined,
) {
  if (!address || !creditMicro || creditMicro <= 0n) return;

  const normalizedAddress = address.toLowerCase();
  const key = getWalletDisplaySummaryQueryKey(normalizedAddress, chainId);
  const updatedSnapshot = queryClient.setQueryData<WalletDisplaySummary | null | undefined>(key, current => {
    if (!current) return current;

    return buildWalletDisplaySummary(
      {
        liquidMicro: current.liquidMicro + creditMicro,
        votingStakedMicro: current.votingStakedMicro,
        submissionStakedMicro: current.submissionStakedMicro,
        frontendStakedMicro: current.frontendStakedMicro,
      },
      {
        pendingLiquidCreditMicro: (current.pendingLiquidCreditMicro ?? 0n) + creditMicro,
        pendingStakedMicro: current.pendingStakedMicro,
        totalMicro: current.totalMicro + creditMicro,
        updatedAt: Date.now(),
      },
    );
  });

  if (updatedSnapshot) {
    persistWalletDisplaySummarySnapshot(normalizedAddress, chainId, updatedSnapshot);
  }
}

export function reconcileWalletDisplaySummary(
  current: WalletDisplaySummary | null,
  rawSnapshot: WalletDisplaySummary | null,
  now = Date.now(),
) {
  if (!rawSnapshot) return current;
  if (!current) return rawSnapshot;
  if (!isSnapshotFresh(current, now)) return rawSnapshot;
  if (current.pendingLiquidCreditMicro > 0n) {
    if (rawSnapshot.liquidMicro >= current.liquidMicro || rawSnapshot.totalMicro >= current.totalMicro) {
      return rawSnapshot;
    }

    return current;
  }
  if (current.totalMicro === rawSnapshot.totalMicro) return rawSnapshot;

  const rawKnownStakedMicro =
    rawSnapshot.votingStakedMicro + rawSnapshot.submissionStakedMicro + rawSnapshot.frontendStakedMicro;
  const currentKnownStakedMicro =
    current.votingStakedMicro + current.submissionStakedMicro + current.frontendStakedMicro;

  if (
    rawSnapshot.totalMicro < current.totalMicro &&
    rawSnapshot.liquidMicro < current.liquidMicro &&
    rawKnownStakedMicro <= currentKnownStakedMicro &&
    current.pendingStakedMicro === 0n
  ) {
    return rawSnapshot;
  }

  // Keep the last coherent total while stake indexing catches up to a balance decrease.
  if (rawSnapshot.totalMicro < current.totalMicro && rawSnapshot.liquidMicro !== current.liquidMicro) {
    const reconciledTotalStakedMicro = current.totalMicro - rawSnapshot.liquidMicro;
    if (reconciledTotalStakedMicro >= rawKnownStakedMicro) {
      return buildWalletDisplaySummary(rawSnapshot, {
        pendingStakedMicro: reconciledTotalStakedMicro - rawKnownStakedMicro,
        totalMicro: current.totalMicro,
        updatedAt: now,
      });
    }
  }

  // Keep the previous coherent snapshot while stake releases settle into the indexed stake views.
  return current;
}

export function getWalletDisplayLiquidMicro(
  summary: WalletDisplaySummary | null,
  fallbackLiquidMicro: bigint | undefined,
) {
  return summary?.liquidMicro ?? fallbackLiquidMicro;
}

export function useWalletDisplaySummary(
  address: string | undefined,
  input: WalletDisplaySummaryInput | null,
  chainId?: number,
) {
  const queryClient = useQueryClient();
  const normalizedAddress = address?.toLowerCase();

  const persistedSnapshot = useMemo(
    () => readPersistedWalletDisplaySummary(normalizedAddress, chainId),
    [chainId, normalizedAddress],
  );

  const rawSnapshot = useMemo(() => {
    if (!normalizedAddress || !input) return null;
    return buildWalletDisplaySummary(input);
  }, [normalizedAddress, input]);

  const queryKey = normalizedAddress
    ? getWalletDisplaySummaryQueryKey(normalizedAddress, chainId)
    : ["wallet-display-summary", chainId ?? null];

  const { data } = useQuery({
    queryKey,
    queryFn: async () => rawSnapshot,
    enabled: Boolean(normalizedAddress && rawSnapshot),
    initialData: persistedSnapshot ?? rawSnapshot ?? undefined,
    staleTime: Infinity,
    gcTime: 30 * 60 * 1000,
  });

  const resolvedSnapshot = useMemo(
    () => reconcileWalletDisplaySummary((data ?? persistedSnapshot) as WalletDisplaySummary | null, rawSnapshot),
    [data, persistedSnapshot, rawSnapshot],
  );

  useEffect(() => {
    if (!normalizedAddress || !resolvedSnapshot) return;

    const key = getWalletDisplaySummaryQueryKey(normalizedAddress, chainId);
    const current = queryClient.getQueryData<WalletDisplaySummary>(key);
    if (!current || !snapshotsEqual(current, resolvedSnapshot)) {
      queryClient.setQueryData(key, resolvedSnapshot);
    }
    persistWalletDisplaySummarySnapshot(normalizedAddress, chainId, resolvedSnapshot);
  }, [chainId, normalizedAddress, queryClient, resolvedSnapshot]);

  return resolvedSnapshot as WalletDisplaySummary | null;
}
