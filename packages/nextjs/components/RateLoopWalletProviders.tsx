"use client";

import { type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "react-hot-toast";
import { ThirdwebProvider } from "thirdweb/react";
import { WagmiProvider } from "wagmi";
import { LocalTestWalletBridge } from "~~/components/thirdweb/LocalTestWalletBridge";
import { ThirdwebAutoConnectBridge } from "~~/components/thirdweb/ThirdwebAutoConnectBridge";
import { ThirdwebConnectorWalletBridge } from "~~/components/thirdweb/ThirdwebConnectorWalletBridge";
import { wagmiConfig } from "~~/services/web3/wagmiConfig";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      staleTime: 30_000,
      gcTime: 5 * 60_000,
    },
  },
});

export function RateLoopWalletProviders({ children }: { children: ReactNode }) {
  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <ThirdwebProvider>
          <LocalTestWalletBridge />
          <ThirdwebConnectorWalletBridge />
          <ThirdwebAutoConnectBridge />
          <Toaster />
          {children}
        </ThirdwebProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
