import assert from "node:assert/strict";
import { test } from "node:test";
import {
  parseContextDocumentDisplayBlocks,
  parseContextDocumentInlineSegments,
} from "~~/lib/attachments/contextDocumentDisplay";
import {
  CONTEXT_DOCUMENT_MIME_TYPE_MARKDOWN,
  CONTEXT_DOCUMENT_MIME_TYPE_TEXT,
} from "~~/lib/auth/contextDocumentUploadChallenge.shared";

test("parseContextDocumentDisplayBlocks formats markdown structure", () => {
  const blocks = parseContextDocumentDisplayBlocks(
    [
      "# Launch notes",
      "",
      "Ship the **small** preview first.",
      "",
      "- Improve text",
      "- Improve markdown",
      "",
      "> Public context only",
      "",
      "```ts",
      "const ready = true;",
      "```",
    ].join("\n"),
    CONTEXT_DOCUMENT_MIME_TYPE_MARKDOWN,
  );

  assert.deepEqual(blocks, [
    { type: "heading", depth: 1, text: "Launch notes" },
    { type: "paragraph", text: "Ship the **small** preview first." },
    { type: "list", ordered: false, items: ["Improve text", "Improve markdown"] },
    { type: "blockquote", text: "Public context only" },
    { type: "code", language: "ts", text: "const ready = true;" },
  ]);
});

test("parseContextDocumentDisplayBlocks keeps plain text line breaks inside paragraphs", () => {
  const blocks = parseContextDocumentDisplayBlocks("Line one\nLine two\n\nLine three", CONTEXT_DOCUMENT_MIME_TYPE_TEXT);

  assert.deepEqual(blocks, [
    { type: "paragraph", text: "Line one\nLine two" },
    { type: "paragraph", text: "Line three" },
  ]);
});

test("parseContextDocumentInlineSegments detects safe markdown inline affordances", () => {
  const segments = parseContextDocumentInlineSegments(
    "Read **this** `flag` at [RateLoop](https://www.rateloop.ai/docs).",
  );

  assert.deepEqual(segments, [
    { type: "text", text: "Read " },
    { type: "strong", text: "this" },
    { type: "text", text: " " },
    { type: "code", text: "flag" },
    { type: "text", text: " at " },
    { type: "link", text: "RateLoop", href: "https://www.rateloop.ai/docs" },
    { type: "text", text: "." },
  ]);
});
