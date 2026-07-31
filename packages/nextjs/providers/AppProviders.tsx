"use client";

import { type ReactNode, useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RateLoopNotificationProvider } from "~~/components/tokenless/RateLoopNotificationProvider";

export function AppProviders({
  children,
  notificationDismissLabel,
}: {
  children: ReactNode;
  notificationDismissLabel?: string;
}) {
  const [queryClient] = useState(() => new QueryClient());

  return (
    <QueryClientProvider client={queryClient}>
      <RateLoopNotificationProvider dismissLabel={notificationDismissLabel}>{children}</RateLoopNotificationProvider>
    </QueryClientProvider>
  );
}
