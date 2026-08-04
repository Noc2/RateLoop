"use client";

import type { ReactNode } from "react";
import { TokenlessShell } from "./TokenlessShell";
import { NextIntlClientProvider } from "next-intl";
import { DEFAULT_LOCALE } from "~~/i18n/config";
import enAuth from "~~/messages/en/auth.json";
import enShell from "~~/messages/en/shell.json";

const messages = { auth: enAuth, shell: enShell };

export function RootRecoveryShell({ children }: { children: ReactNode }) {
  return (
    <NextIntlClientProvider locale={DEFAULT_LOCALE} messages={messages} timeZone="UTC">
      <TokenlessShell>{children}</TokenlessShell>
    </NextIntlClientProvider>
  );
}
