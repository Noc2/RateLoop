"use client";

import { useCallback, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAccount } from "wagmi";
import { type ClaimableRewardItem } from "~~/hooks/claimableRewards";
import { useScaffoldReadContract } from "~~/hooks/scaffold-eth";
import { useTargetNetwork } from "~~/hooks/scaffold-eth/useTargetNetwork";
import { fetchClaimableFrontendFeePage } from "~~/hooks/useFrontendClaimableFees";
import { usePageVisibility } from "~~/hooks/usePageVisibility";
import { useUnixTime } from "~~/hooks/useUnixTime";

const FRONTEND_CLAIMABLE_FEES_PAGE_SIZE = 50;

function safeBigInt(value: string | number | bigint | null | undefined): bigint {
  try {
    return BigInt(value ?? 0);
  } catch {
    return 0n;
  }
}

async function fetchAllClaimableFrontendFees(frontend: `0x${string}`, chainId: number) {
  const items: Awaited<ReturnType<typeof fetchClaimableFrontendFeePage>>["items"] = [];
  let offset = 0;
  let scannedRounds = 0;
  let totalRounds = 0;

  while (true) {
    const page = await fetchClaimableFrontendFeePage(frontend, chainId, FRONTEND_CLAIMABLE_FEES_PAGE_SIZE, offset);
    items.push(...page.items);
    scannedRounds = page.scannedRounds;
    totalRounds = page.totalRounds;

    if (!page.hasMore) {
      return { items, scannedRounds, totalRounds };
    }

    offset = page.nextOffset;
  }
}

function getClaimableFrontendRewardsQueryKey(address?: string, chainId?: number) {
  return ["claimableFrontendRewards", address?.toLowerCase() ?? null, chainId ?? null] as const;
}

export function getFrontendFeeWithdrawalPlan(params: {
  canWithdrawFees: boolean;
  hasOpenSnapshotDispute: boolean | undefined;
  nowSeconds: number;
  pendingAmount: bigint;
  pendingReleaseAt: bigint;
}) {
  const pendingMatured = params.pendingAmount > 0n && params.pendingReleaseAt <= BigInt(params.nowSeconds);
  const disputeStatusKnownClear = params.hasOpenSnapshotDispute === false;
  const canCompletePendingWithdrawal = params.canWithdrawFees && pendingMatured && disputeStatusKnownClear;

  return {
    canCompletePendingWithdrawal,
    pendingMatured,
    requestSlotFree: params.pendingAmount === 0n || canCompletePendingWithdrawal,
    withdrawalBlockedByDispute: params.hasOpenSnapshotDispute === true,
  };
}

type UseClaimableFrontendRewardsOptions = {
  enabled?: boolean;
};

export function useClaimableFrontendRewards({ enabled = true }: UseClaimableFrontendRewardsOptions = {}) {
  const { address } = useAccount();
  const { targetNetwork } = useTargetNetwork();
  const isPageVisible = usePageVisibility();
  const frontendRewardsEnabled = enabled && !!address;

  const {
    data: frontendInfo,
    isLoading: frontendInfoLoading,
    refetch: refetchFrontendInfo,
  } = useScaffoldReadContract({
    contractName: "FrontendRegistry",
    functionName: "getFrontendInfo",
    args: [address],
    query: {
      enabled: frontendRewardsEnabled,
      staleTime: 30_000,
      refetchInterval: isPageVisible ? 60_000 : false,
    },
  });

  const isRegistered = frontendInfo ? frontendInfo[1] > 0n : false;
  const isSlashed = frontendInfo ? frontendInfo[3] : false;
  const canWithdrawFees = isRegistered && frontendInfo?.[2] === true;
  const nowSeconds = useUnixTime(60_000);

  const {
    data: exitAvailableAt,
    isLoading: exitAvailableAtLoading,
    refetch: refetchExitAvailableAt,
  } = useScaffoldReadContract({
    contractName: "FrontendRegistry",
    functionName: "frontendExitAvailableAt",
    args: [address],
    query: {
      enabled: frontendRewardsEnabled && isRegistered,
      staleTime: 30_000,
      refetchInterval: isPageVisible ? 60_000 : false,
    },
  });

  const isExitPending = typeof exitAvailableAt === "bigint" ? exitAvailableAt > 0n : false;
  const canCreditRoundFees = isRegistered && !isSlashed && (canWithdrawFees || isExitPending);

  const {
    data: accumulatedFees,
    isLoading: accumulatedFeesLoading,
    refetch: refetchAccumulatedFees,
  } = useScaffoldReadContract({
    contractName: "FrontendRegistry",
    functionName: "getAccumulatedFees",
    args: [address],
    query: {
      enabled: frontendRewardsEnabled && isRegistered,
      staleTime: 30_000,
      refetchInterval: isPageVisible ? 60_000 : false,
    },
  });

  const {
    data: pendingFeeWithdrawal,
    isLoading: pendingFeeWithdrawalLoading,
    refetch: refetchPendingFeeWithdrawal,
  } = useScaffoldReadContract({
    contractName: "FrontendRegistry",
    functionName: "pendingFeeWithdrawalAmount",
    args: [address],
    query: {
      enabled: frontendRewardsEnabled && isRegistered,
      staleTime: 30_000,
      refetchInterval: isPageVisible ? 60_000 : false,
    },
  });

  const {
    data: pendingFeeWithdrawalReleaseAt,
    isLoading: pendingFeeWithdrawalReleaseAtLoading,
    refetch: refetchPendingFeeWithdrawalReleaseAt,
  } = useScaffoldReadContract({
    contractName: "FrontendRegistry",
    functionName: "pendingFeeWithdrawalReleaseAt",
    args: [address],
    query: {
      enabled: frontendRewardsEnabled && isRegistered,
      staleTime: 30_000,
      refetchInterval: isPageVisible ? 60_000 : false,
    },
  });

  const {
    data: hasOpenSnapshotDispute,
    isError: hasOpenSnapshotDisputeError,
    isLoading: hasOpenSnapshotDisputeLoading,
    refetch: refetchHasOpenSnapshotDispute,
  } = useScaffoldReadContract({
    contractName: "FrontendRegistry",
    functionName: "hasOpenSnapshotDispute",
    args: [address],
    query: {
      enabled: frontendRewardsEnabled && isRegistered,
      staleTime: 30_000,
      refetchInterval: isPageVisible ? 60_000 : false,
    },
  });

  const frontendAddress = address?.toLowerCase() as `0x${string}` | undefined;
  const roundFeesQuery = useQuery({
    queryKey: getClaimableFrontendRewardsQueryKey(frontendAddress, targetNetwork.id),
    enabled: frontendRewardsEnabled && !!frontendAddress && canCreditRoundFees,
    staleTime: 30_000,
    refetchInterval: isPageVisible ? 60_000 : false,
    queryFn: () => fetchAllClaimableFrontendFees(frontendAddress!, targetNetwork.id),
  });

  const roundFeeItems = useMemo<ClaimableRewardItem[]>(() => {
    if (!frontendRewardsEnabled || !frontendAddress || !canCreditRoundFees) {
      return [];
    }

    return (roundFeesQuery.data?.items ?? []).flatMap(item => {
      const reward = safeBigInt(item.claimableFee);
      const contentId = safeBigInt(item.contentId);
      const roundId = safeBigInt(item.roundId);
      if (reward <= 0n || contentId <= 0n || roundId <= 0n) {
        return [];
      }

      return [
        {
          contentId,
          roundId,
          frontend: frontendAddress,
          reward,
          claimType: "frontend_round_fee" as const,
        } satisfies ClaimableRewardItem,
      ];
    });
  }, [canCreditRoundFees, frontendAddress, frontendRewardsEnabled, roundFeesQuery.data?.items]);

  const pendingAmount = pendingFeeWithdrawal ?? 0n;
  const pendingReleaseAt = pendingFeeWithdrawalReleaseAt ?? 0n;
  const frontendFeeWithdrawalPlan = useMemo(
    () =>
      getFrontendFeeWithdrawalPlan({
        canWithdrawFees,
        hasOpenSnapshotDispute,
        nowSeconds,
        pendingAmount,
        pendingReleaseAt,
      }),
    [canWithdrawFees, hasOpenSnapshotDispute, nowSeconds, pendingAmount, pendingReleaseAt],
  );

  const claimableItems = useMemo<ClaimableRewardItem[]>(() => {
    if (!frontendRewardsEnabled || !frontendAddress) {
      return [];
    }

    const items = [...roundFeeItems];
    const { canCompletePendingWithdrawal, requestSlotFree } = frontendFeeWithdrawalPlan;

    if (canCompletePendingWithdrawal) {
      items.push({
        frontend: frontendAddress,
        reward: pendingAmount,
        claimType: "frontend_registry_withdrawal",
      } satisfies ClaimableRewardItem);
    }

    // A new withdrawal request only succeeds once the pending bucket is empty —
    // either there is none, or the matured one above is completed first in the
    // same claim run.
    const withdrawableFees = canWithdrawFees ? (accumulatedFees ?? 0n) : 0n;
    if (canWithdrawFees && requestSlotFree && (withdrawableFees > 0n || roundFeeItems.length > 0)) {
      items.push({
        frontend: frontendAddress,
        reward: withdrawableFees,
        claimType: "frontend_registry_fee",
      } satisfies ClaimableRewardItem);
    }

    return items;
  }, [
    accumulatedFees,
    canWithdrawFees,
    frontendAddress,
    frontendRewardsEnabled,
    frontendFeeWithdrawalPlan,
    pendingAmount,
    roundFeeItems,
  ]);

  const totalClaimable = useMemo(() => claimableItems.reduce((sum, item) => sum + item.reward, 0n), [claimableItems]);

  const refetch = useCallback(async () => {
    if (!enabled) {
      return;
    }

    await Promise.all([
      refetchFrontendInfo(),
      refetchExitAvailableAt(),
      refetchAccumulatedFees(),
      refetchPendingFeeWithdrawal(),
      refetchPendingFeeWithdrawalReleaseAt(),
      refetchHasOpenSnapshotDispute(),
      ...(frontendAddress && canCreditRoundFees ? [roundFeesQuery.refetch()] : []),
    ]);
  }, [
    canCreditRoundFees,
    enabled,
    frontendAddress,
    refetchAccumulatedFees,
    refetchExitAvailableAt,
    refetchFrontendInfo,
    refetchHasOpenSnapshotDispute,
    refetchPendingFeeWithdrawal,
    refetchPendingFeeWithdrawalReleaseAt,
    roundFeesQuery,
  ]);

  return {
    claimableItems,
    totalClaimable,
    isLoading:
      frontendInfoLoading ||
      exitAvailableAtLoading ||
      accumulatedFeesLoading ||
      pendingFeeWithdrawalLoading ||
      pendingFeeWithdrawalReleaseAtLoading ||
      hasOpenSnapshotDisputeLoading ||
      (frontendRewardsEnabled && canCreditRoundFees && roundFeesQuery.isLoading),
    feeWithdrawalBlockedByDispute: hasOpenSnapshotDispute === true,
    feeWithdrawalMaturedBlockedByDispute:
      frontendFeeWithdrawalPlan.pendingMatured && frontendFeeWithdrawalPlan.withdrawalBlockedByDispute,
    feesUnavailable:
      (frontendRewardsEnabled && canCreditRoundFees && roundFeesQuery.isError) ||
      (frontendRewardsEnabled && isRegistered && hasOpenSnapshotDisputeError),
    refetch,
  };
}
