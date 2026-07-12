"use client";

import { type ReactNode, useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { type State, WagmiProvider } from "wagmi";
import { getBaseAccountConfig } from "~~/config/baseAccount";

export function BaseAccountProviders({ children, initialState }: { children: ReactNode; initialState?: State }) {
  const [config] = useState(() => getBaseAccountConfig());
  const [queryClient] = useState(() => new QueryClient());

  return (
    <WagmiProvider config={config} initialState={initialState}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </WagmiProvider>
  );
}
