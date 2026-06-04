import { CONTEXT_DOCUMENT_MIME_TYPE_MARKDOWN } from "~~/lib/auth/contextDocumentUploadChallenge.shared";

export type ContextDocumentInlineSegment =
  | { type: "text"; text: string }
  | { type: "strong"; text: string }
  | { type: "emphasis"; text: string }
  | { type: "code"; text: string }
  | { type: "link"; href: string; text: string };

export type ContextDocumentDisplayBlock =
  | { type: "blockquote"; text: string }
  | { type: "code"; language: string | null; text: string }
  | { type: "heading"; depth: 1 | 2 | 3; text: string }
  | { type: "list"; items: string[]; ordered: boolean }
  | { type: "paragraph"; text: string }
  | { type: "rule" };

const FENCE_PATTERN = /^```([A-Za-z0-9_-]+)?\s*$/;
const HEADING_PATTERN = /^(#{1,6})\s+(.+)$/;
const RULE_PATTERN = /^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/;
const UNORDERED_LIST_PATTERN = /^\s*[-*+]\s+(.+)$/;
const ORDERED_LIST_PATTERN = /^\s*\d+[.)]\s+(.+)$/;
const BLOCKQUOTE_PATTERN = /^\s*>\s?(.*)$/;
const INLINE_MARKDOWN_PATTERN =
  /\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)|`([^`\n]+)`|\*\*([^*\n]+)\*\*|__([^_\n]+)__|\*([^*\n]+)\*|_([^_\n]+)_/g;

function isMarkdownDocument(mimeType: string) {
  return mimeType === CONTEXT_DOCUMENT_MIME_TYPE_MARKDOWN;
}

function isSpecialMarkdownLine(line: string) {
  return (
    FENCE_PATTERN.test(line) ||
    HEADING_PATTERN.test(line) ||
    RULE_PATTERN.test(line) ||
    UNORDERED_LIST_PATTERN.test(line) ||
    ORDERED_LIST_PATTERN.test(line) ||
    BLOCKQUOTE_PATTERN.test(line)
  );
}

function collectParagraph(lines: string[], startIndex: number, markdown: boolean) {
  const paragraphLines: string[] = [];
  let index = startIndex;

  while (index < lines.length) {
    const line = lines[index] ?? "";
    if (!line.trim()) break;
    if (markdown && paragraphLines.length > 0 && isSpecialMarkdownLine(line)) break;
    paragraphLines.push(line);
    index += 1;
  }

  return {
    index,
    text: markdown ? paragraphLines.map(line => line.trim()).join(" ") : paragraphLines.join("\n"),
  };
}

export function parseContextDocumentDisplayBlocks(text: string, mimeType: string): ContextDocumentDisplayBlock[] {
  const markdown = isMarkdownDocument(mimeType);
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const blocks: ContextDocumentDisplayBlock[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index] ?? "";
    if (!line.trim()) {
      index += 1;
      continue;
    }

    if (markdown) {
      const fenceMatch = line.match(FENCE_PATTERN);
      if (fenceMatch) {
        const codeLines: string[] = [];
        index += 1;
        while (index < lines.length && !FENCE_PATTERN.test(lines[index] ?? "")) {
          codeLines.push(lines[index] ?? "");
          index += 1;
        }
        if (index < lines.length) index += 1;
        blocks.push({ type: "code", language: fenceMatch[1] || null, text: codeLines.join("\n") });
        continue;
      }

      const headingMatch = line.match(HEADING_PATTERN);
      if (headingMatch) {
        const rawDepth = headingMatch[1]?.length ?? 1;
        blocks.push({
          type: "heading",
          depth: Math.min(rawDepth, 3) as 1 | 2 | 3,
          text: (headingMatch[2] ?? "").trim(),
        });
        index += 1;
        continue;
      }

      if (RULE_PATTERN.test(line)) {
        blocks.push({ type: "rule" });
        index += 1;
        continue;
      }

      const unorderedMatch = line.match(UNORDERED_LIST_PATTERN);
      const orderedMatch = line.match(ORDERED_LIST_PATTERN);
      if (unorderedMatch || orderedMatch) {
        const ordered = Boolean(orderedMatch);
        const pattern = ordered ? ORDERED_LIST_PATTERN : UNORDERED_LIST_PATTERN;
        const items: string[] = [];
        while (index < lines.length) {
          const itemMatch = (lines[index] ?? "").match(pattern);
          if (!itemMatch) break;
          items.push((itemMatch[1] ?? "").trim());
          index += 1;
        }
        blocks.push({ type: "list", items, ordered });
        continue;
      }

      const quoteMatch = line.match(BLOCKQUOTE_PATTERN);
      if (quoteMatch) {
        const quoteLines: string[] = [];
        while (index < lines.length) {
          const nextQuoteMatch = (lines[index] ?? "").match(BLOCKQUOTE_PATTERN);
          if (!nextQuoteMatch) break;
          quoteLines.push(nextQuoteMatch[1] ?? "");
          index += 1;
        }
        blocks.push({ type: "blockquote", text: quoteLines.join("\n").trim() });
        continue;
      }
    }

    const paragraph = collectParagraph(lines, index, markdown);
    if (paragraph.text.trim()) {
      blocks.push({ type: "paragraph", text: paragraph.text });
    }
    index = Math.max(paragraph.index, index + 1);
  }

  return blocks;
}

export function parseContextDocumentInlineSegments(text: string): ContextDocumentInlineSegment[] {
  const segments: ContextDocumentInlineSegment[] = [];
  let lastIndex = 0;

  INLINE_MARKDOWN_PATTERN.lastIndex = 0;
  for (const match of text.matchAll(INLINE_MARKDOWN_PATTERN)) {
    const index = match.index ?? 0;
    if (index > lastIndex) {
      segments.push({ type: "text", text: text.slice(lastIndex, index) });
    }

    if (match[1] && match[2]) {
      segments.push({ type: "link", text: match[1], href: match[2] });
    } else if (match[3]) {
      segments.push({ type: "code", text: match[3] });
    } else if (match[4] || match[5]) {
      segments.push({ type: "strong", text: match[4] ?? match[5] ?? "" });
    } else if (match[6] || match[7]) {
      segments.push({ type: "emphasis", text: match[6] ?? match[7] ?? "" });
    }

    lastIndex = index + match[0].length;
  }

  if (lastIndex < text.length) {
    segments.push({ type: "text", text: text.slice(lastIndex) });
  }

  return segments.length > 0 ? segments : [{ type: "text", text }];
}
