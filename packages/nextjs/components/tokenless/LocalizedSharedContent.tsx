"use client";

import { Children, type ReactElement, type ReactNode, cloneElement, isValidElement } from "react";
import { useLocale } from "next-intl";
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
const SKIPPED_ELEMENTS = new Set(["code", "pre", "script", "style"]);

function preserveWhitespace(source: string, translated: string) {
  const leading = source.match(/^\s*/)?.[0] ?? "";
  const trailing = source.match(/\s*$/)?.[0] ?? "";
  return `${leading}${translated}${trailing}`;
}

export function translateSharedString(source: string, phrases: Record<string, string>) {
  const trimmed = source.trim();
  if (!trimmed) return source;

  const normalized = trimmed.replace(/\s+/g, " ");
  const exact =
    phrases[trimmed] ?? Object.entries(phrases).find(([english]) => english.replace(/\s+/g, " ") === normalized)?.[1];
  if (exact) return preserveWhitespace(source, exact);

  let translated = source;
  for (const english of Object.keys(phrases).sort((left, right) => right.length - left.length)) {
    if (translated.includes(english)) translated = translated.replaceAll(english, phrases[english]);
  }
  return translated;
}

function translateNode(node: ReactNode, phrases: Record<string, string>): ReactNode {
  if (typeof node === "string") return translateSharedString(node, phrases);
  if (typeof node === "number" || node == null || typeof node === "boolean") return node;
  if (Array.isArray(node)) return node.map(child => translateNode(child, phrases));
  if (!isValidElement(node)) return node;

  const element = node as ReactElement<Record<string, unknown>>;
  const elementName = typeof element.type === "string" ? element.type : "";
  if (SKIPPED_ELEMENTS.has(elementName) || element.props["data-no-translate"] === true) return element;

  const props: Record<string, unknown> = {};
  for (const attribute of TRANSLATABLE_ATTRIBUTES) {
    const value = element.props[attribute];
    if (typeof value === "string") props[attribute] = translateSharedString(value, phrases);
    else if (isValidElement(value) || Array.isArray(value)) {
      props[attribute] = translateNode(value as ReactNode, phrases);
    }
  }
  if ("children" in element.props) {
    props.children = Children.map(element.props.children as ReactNode, child => translateNode(child, phrases));
  }

  return cloneElement(element, props);
}

export function LocalizedSharedContent({ children }: { children: ReactNode }) {
  const locale = useLocale();
  if (locale === "en") return children;
  return translateNode(children, locale === "de" ? deShared.phrases : enShared.phrases);
}
