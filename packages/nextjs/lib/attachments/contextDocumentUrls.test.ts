import assert from "node:assert/strict";
import { test } from "node:test";
import { parseContextDocumentPublicUrl } from "~~/lib/attachments/contextDocumentUrls";

test("parseContextDocumentPublicUrl accepts RateLoop document URLs", () => {
  assert.deepEqual(parseContextDocumentPublicUrl("https://www.rateloop.ai/context/documents/doc_testdocument0001"), {
    documentId: "doc_testdocument0001",
    path: "/context/documents/doc_testdocument0001",
    url: "https://www.rateloop.ai/context/documents/doc_testdocument0001",
  });
});

test("parseContextDocumentPublicUrl accepts same-origin relative document URLs", () => {
  assert.deepEqual(parseContextDocumentPublicUrl("/context/documents/doc_testdocument0002", "https://preview.test"), {
    documentId: "doc_testdocument0002",
    path: "/context/documents/doc_testdocument0002",
    url: "https://preview.test/context/documents/doc_testdocument0002",
  });
});

test("parseContextDocumentPublicUrl rejects lookalike document paths on other origins", () => {
  assert.equal(parseContextDocumentPublicUrl("https://example.com/context/documents/doc_testdocument0003"), null);
});
