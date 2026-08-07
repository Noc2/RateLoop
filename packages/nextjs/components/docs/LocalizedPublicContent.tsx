import { type ReactNode, use } from "react";
import { PublicLink } from "./PublicLink";
import type { Metadata } from "next";
import {
  UntranslatedContent,
  localizeCatalogNode,
  translateCatalogString,
} from "~~/components/localization/recursiveCatalogLocalization";
import { Button } from "~~/components/tokenless/ui/Button";
import { Card } from "~~/components/tokenless/ui/Card";
import { type Locale, isLocale } from "~~/i18n/config";
import { getMessagesForLocale } from "~~/i18n/messages";

type PublicMessages = ReturnType<typeof getMessagesForLocale>["public"];
type PublicMessageSection = keyof PublicMessages;

const TRANSLATABLE_ATTRIBUTES = [
  "alt",
  "aria-description",
  "aria-label",
  "description",
  "eyebrow",
  "gradientText",
  "heading",
  "label",
  "placeholder",
  "subtitle",
  "title",
] as const;
export function translatePublicString(source: string, locale: Locale, section: PublicMessageSection) {
  if (locale === "en") return source;
  const phrases = getMessagesForLocale(locale).public[section].phrases as Record<string, string>;
  return translateCatalogString(source, phrases);
}

export type PublicLocaleParams = Promise<{ locale?: string }>;

export async function resolvePublicLocale(params?: PublicLocaleParams): Promise<Locale> {
  const locale = params ? (await params).locale : undefined;
  return isLocale(locale) ? locale : "en";
}

export function usePublicLocale(params?: PublicLocaleParams): Locale {
  const locale = params ? use(params).locale : undefined;
  return isLocale(locale) ? locale : "en";
}

export async function getLocalizedPublicMetadata({
  description,
  params,
  section,
  title,
}: {
  description?: string;
  params: PublicLocaleParams;
  section: PublicMessageSection;
  title: string;
}): Promise<Metadata> {
  const locale = await resolvePublicLocale(params);
  return {
    title: translatePublicString(title, locale, section),
    ...(description ? { description: translatePublicString(description, locale, section) } : {}),
  };
}

/**
 * Keeps public copy in the shared next-intl catalog while preserving pure,
 * provider-free English rendering in page contract tests.
 */
export function LocalizedPublicContent({
  children,
  locale = "en",
  section,
}: {
  children: ReactNode;
  locale?: Locale;
  section: PublicMessageSection;
}) {
  if (locale === "en") return children;
  const phrases = getMessagesForLocale(locale).public[section].phrases as Record<string, string>;
  return localizeCatalogNode(children, {
    attributes: TRANSLATABLE_ATTRIBUTES,
    phrases,
    elementProps(element, translate) {
      const props: Record<string, unknown> = {};
      // A PublicLink needs the locale injected to prefix its href. It can arrive
      // directly, or wrapped by a polymorphic component that renders it through
      // `as` — Card already did this, and Button now does too, so a link that
      // looks like a button still resolves to /de/… rather than /….
      const rendersPublicLink =
        element.type === PublicLink ||
        ((element.type === Card || element.type === Button) && element.props.as === PublicLink);
      if (rendersPublicLink) {
        props.locale = locale;
      }
      const example = element.props.example;
      if (example && typeof example === "object" && !Array.isArray(example)) {
        props.example = Object.fromEntries(
          Object.entries(example).map(([key, value]) => [
            key,
            typeof value === "string"
              ? translate(value)
              : Array.isArray(value)
                ? value.map(item => (typeof item === "string" ? translate(item) : item))
                : value,
          ]),
        );
      }
      return props;
    },
  });
}

export { UntranslatedContent };
