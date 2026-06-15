"use client";

import { useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useTargetNetwork } from "~~/hooks/scaffold-eth/useTargetNetwork";
import { applyWalletDisplayLiquidCredit, resetWalletDisplaySummaryCache } from "~~/hooks/useWalletDisplaySummary";

type RefreshWalletBalancesOptions = {
  lrepCreditMicro?: bigint;
};

export function useRefreshWalletBalances() {
  const queryClient = useQueryClient();
  const { targetNetwork } = useTargetNetwork();

  return useCallback(
    async (address?: string, options?: RefreshWalletBalancesOptions) => {
      const lrepCreditMicro = options?.lrepCreditMicro ?? 0n;
      if (lrepCreditMicro > 0n) {
        applyWalletDisplayLiquidCredit(queryClient, address, targetNetwork.id, lrepCreditMicro);
      }

      await queryClient.invalidateQueries({
        queryKey: ["readContract"],
        refetchType: "active",
      });

      if (lrepCreditMicro <= 0n) {
        resetWalletDisplaySummaryCache(queryClient, address, targetNetwork.id);
      }
    },
    [queryClient, targetNetwork.id],
  );
}
