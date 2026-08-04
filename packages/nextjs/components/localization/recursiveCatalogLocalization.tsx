import { Children, type ReactElement, type ReactNode, cloneElement, isValidElement } from "react";

const SKIPPED_ELEMENTS = new Set(["code", "kbd", "pre", "samp", "script", "style", "time"]);
const PROTECTED_SEGMENT_PATTERNS = [
  /-----BEGIN [^-]+-----[\s\S]*?-----END [^-]+-----/gu,
  /\b(?:https?|wss):\/\/[^\s<>"']+/giu,
  /\b(?:mailto|urn):[^\s<>"']+/giu,
  /(?<![\p{L}\p{N}_])\/(?:[A-Za-z0-9._~!$&'()*+,;=:@%-]+\/)*[A-Za-z0-9._~!$&'()*+,;=:@%-]+(?:\?[^\s<>"']*)?(?:#[^\s<>"']*)?/gu,
  /\b(?:sha(?:256|384|512)|hmac-sha256):[A-Za-z0-9_-]+\b/giu,
  /\b0x[0-9a-f]{16,}\b/giu,
  /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/giu,
  /\b\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})?)?\b/gu,
  /\b\d{1,2}[./-]\d{1,2}[./-]\d{2,4}\b/gu,
  /\b[a-z][a-z0-9]{1,31}_[A-Za-z0-9][A-Za-z0-9_-]{4,}\b/gu,
  /\b[A-Za-z0-9_-]{24,}(?:\.[A-Za-z0-9_-]{16,}){0,2}\b/gu,
  /\b(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}(?::\d+)?(?:\/[^\s<>"']*)?\b/giu,
] as const;

type RecursiveCatalogLocalizationOptions = {
  attributes: readonly string[];
  elementProps?: (
    element: ReactElement<Record<string, unknown>>,
    translate: (source: string) => string,
  ) => Record<string, unknown> | undefined;
  phrases: Record<string, string>;
};

function preserveWhitespace(source: string, translated: string) {
  const leading = source.match(/^\s*/)?.[0] ?? "";
  const trailing = source.match(/\s*$/)?.[0] ?? "";
  return `${leading}${translated}${trailing}`;
}

function replaceEmbeddedPhrase(source: string, english: string, translated: string) {
  const escaped = english.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const startsWithWord = /^[\p{L}\p{N}_]/u.test(english);
  const endsWithWord = /[\p{L}\p{N}_]$/u.test(english);
  const pattern = new RegExp(
    `${startsWithWord ? "(?<![\\p{L}\\p{N}_])" : ""}${escaped}${endsWithWord ? "(?![\\p{L}\\p{N}_])" : ""}`,
    "gu",
  );
  return source.replace(pattern, () => translated);
}

function protectSegments(source: string) {
  if (/^\s*[\[{][\s\S]*[\]}]\s*$/u.test(source)) {
    return { protectedSource: "\uE0000\uE001", segments: [source] };
  }
  const segments: string[] = [];
  let protectedSource = source;
  for (const pattern of PROTECTED_SEGMENT_PATTERNS) {
    protectedSource = protectedSource.replace(pattern, value => {
      const marker = `\uE000${segments.length}\uE001`;
      segments.push(value);
      return marker;
    });
  }
  return { protectedSource, segments };
}

function restoreSegments(source: string, segments: readonly string[]) {
  return source.replace(/\uE000(\d+)\uE001/gu, (_marker, index: string) => segments[Number(index)] ?? "");
}

export function translateCatalogString(source: string, phrases: Record<string, string>) {
  const { protectedSource, segments } = protectSegments(source);
  const trimmed = protectedSource.trim();
  if (!trimmed) return source;

  const normalized = trimmed.replace(/\s+/g, " ");
  const exact =
    phrases[trimmed] ?? Object.entries(phrases).find(([english]) => english.replace(/\s+/g, " ") === normalized)?.[1];
  if (exact) return restoreSegments(preserveWhitespace(protectedSource, exact), segments);

  let translated = protectedSource;
  for (const english of Object.keys(phrases).sort((left, right) => right.length - left.length)) {
    if (translated.includes(english)) translated = replaceEmbeddedPhrase(translated, english, phrases[english]);
  }
  return restoreSegments(translated, segments);
}

export function UntranslatedContent({ children }: { children: ReactNode }) {
  return <>{children}</>;
}

export function localizeCatalogNode(node: ReactNode, options: RecursiveCatalogLocalizationOptions): ReactNode {
  const translate = (source: string) => translateCatalogString(source, options.phrases);
  if (typeof node === "string") return translate(node);
  if (typeof node === "number" || node == null || typeof node === "boolean") return node;
  if (Array.isArray(node)) return node.map(child => localizeCatalogNode(child, options));
  if (!isValidElement(node)) return node;

  const element = node as ReactElement<Record<string, unknown>>;
  const elementName = typeof element.type === "string" ? element.type : "";
  if (
    element.type === UntranslatedContent ||
    SKIPPED_ELEMENTS.has(elementName) ||
    element.props["data-no-translate"] === true ||
    element.props.translate === "no"
  ) {
    return element;
  }

  const props: Record<string, unknown> = options.elementProps?.(element, translate) ?? {};
  for (const attribute of options.attributes) {
    const value = element.props[attribute];
    if (typeof value === "string") props[attribute] = translate(value);
    else if (isValidElement(value) || Array.isArray(value)) {
      props[attribute] = localizeCatalogNode(value as ReactNode, options);
    }
  }
  if ("children" in element.props) {
    props.children = Children.map(element.props.children as ReactNode, child => localizeCatalogNode(child, options));
  }

  return cloneElement(element, props);
}
