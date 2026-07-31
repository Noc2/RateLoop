"use client";

import React, { type ReactNode, createContext, useContext, useMemo } from "react";
import type { Locale } from "~~/i18n/config";
import deAgents from "~~/messages/de/agents.json";
import enAgents from "~~/messages/en/agents.json";

const AgentsLocaleContext = createContext<Locale>("en");
const catalogs = { en: enAgents, de: deAgents } as const;

export function AgentsLocaleProvider({ children, locale }: { children: ReactNode; locale: Locale }) {
  return <AgentsLocaleContext.Provider value={locale}>{children}</AgentsLocaleContext.Provider>;
}

export function useAgentLocale() {
  return useContext(AgentsLocaleContext);
}

function messageAt(locale: Locale, namespace: string, key: string) {
  const path = `${namespace}.${key}`.split(".");
  let value: unknown = catalogs[locale];
  for (const part of path) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return key;
    value = (value as Record<string, unknown>)[part];
  }
  return typeof value === "string" ? value : key;
}

export function useAgentTranslations(namespace: string) {
  const locale = useAgentLocale();
  return useMemo(
    () =>
      (key: string, values: Record<string, number | string> = {}) =>
        messageAt(locale, namespace, key).replace(/\{(\w+)\}/gu, (placeholder, name: string) =>
          Object.hasOwn(values, name) ? String(values[name]) : placeholder,
        ),
    [locale, namespace],
  );
}

export function useAgentFormatter() {
  const locale = useAgentLocale();
  return useMemo(
    () => ({
      dateTime(value: Date | number, options?: Intl.DateTimeFormatOptions) {
        return new Intl.DateTimeFormat(locale, options).format(value);
      },
      number(value: number, options?: Intl.NumberFormatOptions) {
        return new Intl.NumberFormat(locale, options).format(value);
      },
    }),
    [locale],
  );
}
