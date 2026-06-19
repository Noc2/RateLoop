"use client";

import { useCallback } from "react";
import type { QueryClient } from "@tanstack/react-query";
import { useQueryClient } from "@tanstack/react-query";
import { useTargetNetwork } from "~~/hooks/scaffold-eth/useTargetNetwork";
import { applyWalletDisplayLiquidCredit, resetWalletDisplaySummaryCache } from "~~/hooks/useWalletDisplaySummary";

type RefreshWalletBalancesOptions = {
  lrepCreditMicro?: bigint;
};

const ACTIVE_WALLET_READ_QUERY_KEYS = [["balance"], ["readContract"], ["readContracts"]] as const;

export async function refreshActiveWalletReadQueries(queryClient: QueryClient) {
  await Promise.all(
    ACTIVE_WALLET_READ_QUERY_KEYS.map(queryKey =>
      queryClient.invalidateQueries({
        queryKey,
        refetchType: "active",
      }),
    ),
  );
}

export function useRefreshWalletBalances() {
  const queryClient = useQueryClient();
  const { targetNetwork } = useTargetNetwork();

  return useCallback(
    async (address?: string, options?: RefreshWalletBalancesOptions) => {
      const lrepCreditMicro = options?.lrepCreditMicro ?? 0n;
      if (lrepCreditMicro > 0n) {
        applyWalletDisplayLiquidCredit(queryClient, address, targetNetwork.id, lrepCreditMicro);
      }

      await refreshActiveWalletReadQueries(queryClient);

      if (lrepCreditMicro <= 0n) {
        resetWalletDisplaySummaryCache(queryClient, address, targetNetwork.id);
      }
    },
    [queryClient, targetNetwork.id],
  );
}
