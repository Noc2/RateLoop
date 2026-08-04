"use client";

import { type ReactNode } from "react";
import { useLocale } from "next-intl";
import {
  UntranslatedContent,
  localizeCatalogNode,
  translateCatalogString,
} from "~~/components/localization/recursiveCatalogLocalization";
import deShared from "~~/messages/de/shared.json";
import enShared from "~~/messages/en/shared.json";

const TRANSLATABLE_ATTRIBUTES = [
  "alt",
  "aria-description",
  "aria-label",
  "cancelLabel",
  "confirmLabel",
  "description",
  "emptyBody",
  "emptyTitle",
  "heading",
  "hint",
  "label",
  "loadingLabel",
  "placeholder",
  "title",
] as const;
export function translateSharedString(source: string, phrases: Record<string, string>) {
  return translateCatalogString(source, phrases);
}

export function LocalizedSharedContent({ children }: { children: ReactNode }) {
  const locale = useLocale();
  if (locale === "en") return children;
  return localizeCatalogNode(children, {
    attributes: TRANSLATABLE_ATTRIBUTES,
    phrases: locale === "de" ? deShared.phrases : enShared.phrases,
  });
}

export { UntranslatedContent };
