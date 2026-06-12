import React from "react";
import ConfidentialContextTermsPage from "./page";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";
import {
  CONFIDENTIALITY_TERMS_TEXT,
  CONFIDENTIALITY_TERMS_TITLE,
  CONFIDENTIALITY_TERMS_VERSION,
} from "~~/lib/confidentiality/terms";

const require = createRequire(import.meta.url);
const { renderToStaticMarkup } = require("react-dom/server") as {
  renderToStaticMarkup: (element: React.ReactElement) => string;
};

test("confidential context terms page focuses on gated context access", () => {
  const html = renderToStaticMarkup(<ConfidentialContextTermsPage />).replace(/\s+/g, " ");

  assert.match(html, new RegExp(CONFIDENTIALITY_TERMS_TITLE));
  assert.match(html, new RegExp(CONFIDENTIALITY_TERMS_VERSION));
  assert.match(html, /protocol-facing access terms/);
  assert.match(html, /separate from the Terms of Service/);
  assert.match(html, new RegExp(CONFIDENTIALITY_TERMS_TEXT.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(html, /href="\/legal\/terms"/);
  assert.match(html, /href="\/legal\/privacy"/);
});
