import { Children, type ReactElement, type ReactNode, cloneElement, isValidElement, use } from "react";
import { PublicLink } from "./PublicLink";
import type { Metadata } from "next";
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
const SKIPPED_ELEMENTS = new Set(["code", "pre", "script", "style"]);

function preserveWhitespace(source: string, translated: string) {
  const leading = source.match(/^\s*/)?.[0] ?? "";
  const trailing = source.match(/\s*$/)?.[0] ?? "";
  return `${leading}${translated}${trailing}`;
}

export function translatePublicString(source: string, locale: Locale, section: PublicMessageSection) {
  if (locale === "en") return source;
  const phrases = getMessagesForLocale(locale).public[section].phrases as Record<string, string>;
  return translateString(source, phrases);
}

function translateString(source: string, phrases: Record<string, string>) {
  const trimmed = source.trim();
  if (!trimmed) return source;

  const normalized = trimmed.replace(/\s+/g, " ");
  const exact =
    phrases[trimmed] ?? Object.entries(phrases).find(([english]) => english.replace(/\s+/g, " ") === normalized)?.[1];
  if (exact) return preserveWhitespace(source, exact);

  let translated = source;
  for (const english of Object.keys(phrases).sort((left, right) => right.length - left.length)) {
    if (english.length < 5) continue;
    if (translated.includes(english)) translated = translated.replaceAll(english, phrases[english]);
  }
  return translated;
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

function translateNode(node: ReactNode, phrases: Record<string, string>, locale: Locale): ReactNode {
  if (typeof node === "string") return translateString(node, phrases);
  if (typeof node === "number" || node == null || typeof node === "boolean") return node;
  if (Array.isArray(node)) return node.map(child => translateNode(child, phrases, locale));
  if (!isValidElement(node)) return node;

  const element = node as ReactElement<Record<string, unknown>>;
  const elementName = typeof element.type === "string" ? element.type : "";
  if (SKIPPED_ELEMENTS.has(elementName) || element.props["data-no-translate"] === true) return element;

  const props: Record<string, unknown> = {};
  if (element.type === PublicLink || (element.type === Card && element.props.as === PublicLink)) {
    props.locale = locale;
  }
  for (const attribute of TRANSLATABLE_ATTRIBUTES) {
    const value = element.props[attribute];
    if (typeof value === "string") props[attribute] = translateString(value, phrases);
    else if (isValidElement(value) || Array.isArray(value))
      props[attribute] = translateNode(value as ReactNode, phrases, locale);
  }
  const example = element.props.example;
  if (example && typeof example === "object" && !Array.isArray(example)) {
    props.example = Object.fromEntries(
      Object.entries(example).map(([key, value]) => [
        key,
        typeof value === "string"
          ? translateString(value, phrases)
          : Array.isArray(value)
            ? value.map(item => (typeof item === "string" ? translateString(item, phrases) : item))
            : value,
      ]),
    );
  }
  if ("children" in element.props) {
    props.children = Children.map(element.props.children as ReactNode, child => translateNode(child, phrases, locale));
  }

  return cloneElement(element, props);
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
  return translateNode(children, phrases, locale);
}
