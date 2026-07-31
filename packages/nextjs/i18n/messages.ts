import type { Locale } from "./config";
import deAccount from "~~/messages/de/account.json";
import deAgents from "~~/messages/de/agents.json";
import deAuth from "~~/messages/de/auth.json";
import deCommon from "~~/messages/de/common.json";
import deHome from "~~/messages/de/home.json";
import deHuman from "~~/messages/de/human.json";
import dePublic from "~~/messages/de/public.json";
import deReview from "~~/messages/de/review.json";
import deShared from "~~/messages/de/shared.json";
import deShell from "~~/messages/de/shell.json";
import enAccount from "~~/messages/en/account.json";
import enAgents from "~~/messages/en/agents.json";
import enAuth from "~~/messages/en/auth.json";
import enCommon from "~~/messages/en/common.json";
import enHome from "~~/messages/en/home.json";
import enHuman from "~~/messages/en/human.json";
import enPublic from "~~/messages/en/public.json";
import enReview from "~~/messages/en/review.json";
import enShared from "~~/messages/en/shared.json";
import enShell from "~~/messages/en/shell.json";

const messages = {
  en: {
    account: enAccount,
    agents: enAgents,
    auth: enAuth,
    common: enCommon,
    home: enHome,
    human: enHuman,
    public: enPublic,
    review: enReview,
    shared: enShared,
    shell: enShell,
  },
  de: {
    account: deAccount,
    agents: deAgents,
    auth: deAuth,
    common: deCommon,
    home: deHome,
    human: deHuman,
    public: dePublic,
    review: deReview,
    shared: deShared,
    shell: deShell,
  },
} satisfies Record<Locale, Record<string, unknown>>;

export function getMessagesForLocale(locale: Locale) {
  return messages[locale];
}

/**
 * Phrase-keyed dictionaries are consumed by the exact-string localization
 * adapters. next-intl treats dots in object keys as namespace separators and
 * rejects those dictionaries, so they must not enter its request payload.
 */
export function getIntlMessagesForLocale(locale: Locale) {
  return Object.fromEntries(
    Object.entries(messages[locale]).filter(([namespace]) => namespace !== "public" && namespace !== "shared"),
  );
}
