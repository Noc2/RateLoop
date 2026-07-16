"use client";

import { type ReactNode, useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RateLoopNotificationProvider } from "~~/components/tokenless/RateLoopNotificationProvider";

export function AppProviders({ children }: { children: ReactNode }) {
  const [queryClient] = useState(() => new QueryClient());

  return (
    <QueryClientProvider client={queryClient}>
      <RateLoopNotificationProvider>{children}</RateLoopNotificationProvider>
    </QueryClientProvider>
  );
}
