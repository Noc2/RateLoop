"use client";

import { useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useTargetNetwork } from "~~/hooks/scaffold-eth/useTargetNetwork";
import { resetWalletDisplaySummaryCache } from "~~/hooks/useWalletDisplaySummary";

export function useRefreshWalletBalances() {
  const queryClient = useQueryClient();
  const { targetNetwork } = useTargetNetwork();

  return useCallback(
    async (address?: string) => {
      await queryClient.invalidateQueries({
        queryKey: ["readContract"],
        refetchType: "active",
      });

      resetWalletDisplaySummaryCache(queryClient, address, targetNetwork.id);
    },
    [queryClient, targetNetwork.id],
  );
}
