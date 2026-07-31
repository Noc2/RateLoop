import React, { type ReactNode } from "react";
import { AgentsLocaleProvider } from "../agents/AgentsLocaleProvider";
import { NextIntlClientProvider } from "next-intl";
import type { Locale } from "~~/i18n/config";
import { getMessagesForLocale } from "~~/i18n/messages";

export function AgentTestProviders({ children, locale = "en" }: { children: ReactNode; locale?: Locale }) {
  return (
    <NextIntlClientProvider locale={locale} messages={getMessagesForLocale(locale)} timeZone="UTC">
      <AgentsLocaleProvider locale={locale}>{children}</AgentsLocaleProvider>
    </NextIntlClientProvider>
  );
}

export function EnglishAgentTestProviders({ children }: { children: ReactNode }) {
  return <AgentTestProviders>{children}</AgentTestProviders>;
}

type TestingLibraryRender = typeof import("@testing-library/react").render;

export function withEnglishAppTestProviders(render: TestingLibraryRender): TestingLibraryRender {
  return ((ui: Parameters<TestingLibraryRender>[0], options?: Parameters<TestingLibraryRender>[1]) =>
    render(ui, {
      ...options,
      wrapper: options?.wrapper ?? EnglishAgentTestProviders,
    })) as TestingLibraryRender;
}
