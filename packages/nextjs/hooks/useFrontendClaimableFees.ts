"use client";

import { useMemo } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { usePageVisibility } from "~~/hooks/usePageVisibility";

interface FrontendClaimableFeeItem {
  contentId: string;
  roundId: string;
  title: string | null;
  description: string | null;
  url: string | null;
  settledAt: string | null;
  claimableFee: string;
  totalFrontendPool: string;
  frontendStake: string;
  totalEligibleStake: string;
  totalFrontendClaimants: number;
}

interface FrontendClaimableFeePage {
  items: FrontendClaimableFeeItem[];
  hasMore: boolean;
  nextOffset: number;
  scannedRounds: number;
  totalRounds: number;
  degraded?: boolean;
}

const PAGE_SIZE = 10;

function isFrontendClaimableFeePage(value: unknown): value is FrontendClaimableFeePage {
  if (!value || typeof value !== "object") return false;
  const page = value as Partial<FrontendClaimableFeePage>;
  return (
    Array.isArray(page.items) &&
    typeof page.hasMore === "boolean" &&
    typeof page.nextOffset === "number" &&
    typeof page.scannedRounds === "number" &&
    typeof page.totalRounds === "number"
  );
}

export async function fetchClaimableFrontendFeePage(
  frontend: `0x${string}`,
  chainId: number,
  limit: number,
  offset: number,
) {
  const response = await fetch(
    `/api/frontend/claimable-fees?frontend=${frontend}&chainId=${chainId}&limit=${limit}&offset=${offset}`,
  );
  const body = (await response.json().catch(() => null)) as unknown;

  if (!response.ok) {
    if (isFrontendClaimableFeePage(body) && body.degraded === true) {
      return body;
    }

    const errorBody = body as { error?: string } | null;
    throw new Error(errorBody?.error || "Failed to fetch claimable frontend fees");
  }

  if (!isFrontendClaimableFeePage(body)) {
    throw new Error("Invalid claimable frontend fees response");
  }

  return body;
}

export function useFrontendClaimableFees(frontend?: `0x${string}`, chainId?: number) {
  const isPageVisible = usePageVisibility();
  const query = useInfiniteQuery({
    queryKey: ["frontend-claimable-fees", chainId, frontend],
    initialPageParam: 0,
    enabled: !!frontend && Number.isFinite(chainId),
    staleTime: 30_000,
    refetchInterval: isPageVisible ? 60_000 : false,
    queryFn: ({ pageParam }) => fetchClaimableFrontendFeePage(frontend!, chainId!, PAGE_SIZE, pageParam),
    getNextPageParam: lastPage => (lastPage.hasMore ? lastPage.nextOffset : undefined),
  });

  const items = useMemo(() => query.data?.pages.flatMap(page => page.items) ?? [], [query.data]);

  const totalClaimable = useMemo(() => items.reduce((total, item) => total + BigInt(item.claimableFee), 0n), [items]);

  return {
    ...query,
    items,
    totalClaimable,
  };
}
